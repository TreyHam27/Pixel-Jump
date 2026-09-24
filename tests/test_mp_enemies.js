const { setupMocks, loadGameSource, failIfUnfinished } = require('./test_helpers');
const { installMpFakes } = require('./mp_fakes');

setupMocks({ realTimers: true });
failIfUnfinished();
installMpFakes();

// Co-op enemies are run by the host and mirrored by guests: everyone faces
// the same drones, bullets, meteors and boss. Guests only draw and collide;
// their kills and stomps are requests the host carries out.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
try {
    const bus = new Bus();
    const games = {};
    ['HOST', 'g1', 'g2'].forEach(id => {
        window.network = new FakeNet(bus, id);
        const g = new Game();
        g.net = window.network;
        games[id] = g;
    });
    const as = (g, fn) => { window.network = g.net; return fn(); };
    const H = games.HOST, G = games.g1, G2 = games.g2;
    G.ui.mpNameInput.value = 'player';
    G2.ui.mpNameInput.value = 'Player';
    const connect = (id) => {
        const g = games[id];
        g.net.links.add('HOST');
        H.net.links.add(id);
        g.net.friendId = 'HOST';
        as(g, () => g.net.onConnected());
        bus.pump();
    };
    await as(H, () => H.ui.mpHostBtn.onclick());
    connect('g1'); connect('g2');
    const names = H.party.map(m => m.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['PLAYER', 'PLAYER 2', 'PLAYER 3']),
        "duplicate names get a number: " + JSON.stringify(names));
    console.log("DUPLICATE NAMES SUCCESS");

    as(H, () => H.ui.mpStartBtn.onclick());
    bus.pump();
    assert(H.state.running && G.state.running && G2.state.running, "run started");

    // Keep everyone safely in place: pinned players, no deaths.
    const pin = (g) => { g.player.y = 400; g.player.vy = 0; g.player.x = 50; g.player.invuln = 1e9; };
    const step = (n = 1) => {
        for (let i = 0; i < n; i++) {
            for (const g of [H, G, G2]) { pin(g); as(g, () => g.update(1)); }
            bus.pump();
        }
    };

    // ---- A host drone shows up for guests with the same id and position.
    const drone = new Drone(250, 1);
    drone.x = 300; drone.v = 2;
    H.enemies.push(drone);
    step(6);
    assert(drone.nid !== undefined, "host numbered its drone");
    const copy = G.netEnemies.get(drone.nid);
    assert(copy && G.enemies.includes(copy) && copy instanceof Drone, "guest mirrors it");
    step(4);
    const hostWorld = [drone.x, drone.y - H.state.score];
    const guestWorld = [copy.x, copy.y - G.state.score];
    assert(Math.abs(hostWorld[0] - guestWorld[0]) < 12 && Math.abs(hostWorld[1] - guestWorld[1]) < 12,
        "same world position: host " + hostWorld.map(Math.round) + " guest " + guestWorld.map(Math.round));
    console.log("MIRRORED DRONE SUCCESS");

    // ---- Guests never spawn enemies of their own.
    G.state.score = 90000; G.state.nextBossAt = Infinity;
    for (let i = 0; i < 400; i++) { pin(G); as(G, () => G.update(1)); }
    assert(G.enemies.every(e => e.nid !== undefined && G.netEnemies.get(e.nid) === e), "every guest enemy is a host mirror");
    assert(G.projectiles.every(q => q.nid !== undefined), "no guest-made meteors or bullets");
    G.state.score = H.state.score;
    bus.pump();
    console.log("NO GUEST SPAWNS SUCCESS");

    // ---- A guest's jetpack kill: gone locally at once, then on the host,
    // and the next snapshot doesn't bring it back.
    const still = new Drone(300, 1);
    still.x = 200; still.v = 0; // parked in view
    H.enemies.push(still);
    step(6);
    const target = G.netEnemies.get(still.nid);
    assert(target && !target.hidden, "guest has the parked drone to ram");
    const nid = target.nid;
    G.player.invuln = 0;
    G.player.activePower = POWERS.ROCKET; G.player.powerTimer = 999;
    G.player.x = target.x; G.player.y = target.y + 8; // the jetpack lifts it into the drone
    as(G, () => G.update(1));
    assert(target.markedForDeletion && G.tombstones.has(nid) && !G.netEnemies.has(nid), "rammed drone is destroyed for the guest");
    pin(G); as(G, () => G.update(1));
    assert(!G.enemies.some(e => e.nid === nid), "and removed on the next frame");
    bus.pump();
    for (let i = 0; i < 6; i++) { pin(H); as(H, () => H.update(1)); pin(G2); as(G2, () => G2.update(1)); bus.pump(); pin(G); as(G, () => G.update(1)); }
    assert(!H.enemies.some(e => e.nid === nid), "host removed it");
    assert(!G.enemies.some(e => e.nid === nid) && !G2.enemies.some(e => e.nid === nid), "gone for everyone");
    console.log("GUEST KILL SUCCESS");

    // ---- Projectiles: born on the host, flown by guests, removed with it.
    const shot = new Projectile(200, 100, 0, 1);
    H.projectiles.push(shot);
    step(1);
    const gShot = G.projectiles.find(q => q.nid === shot.nid);
    assert(gShot, "guest got the bullet");
    shot.markedForDeletion = true;
    step(6);
    assert(!G.projectiles.some(q => q.nid === shot.nid), "removed for the guest when the host drops it");
    console.log("PROJECTILES SUCCESS");

    // ---- Party-wide TIME WARP.
    const rp = H.remotePlayers.get('g1');
    rp.activePower = POWERS.TIME_WARP;
    assert(H.partyTimeWarp(), "a teammate's TIME WARP slows the host's enemies");
    rp.activePower = null;

    // ---- Boss: host-owned health, stomps are requests, the kill pays everyone.
    H.enemies = H.enemies.filter(e => e instanceof BossDrone);
    const boss = new BossDrone(200);
    boss.update = function (dt) { this.t += dt; if (this.invuln > 0) this.invuln -= dt; }; // hold still
    boss.state = 'exposed';
    H.enemies.push(boss);
    H.state.bossActive = true;
    step(6);
    const gBoss = G.netEnemies.get(boss.nid);
    assert(gBoss instanceof BossDrone && gBoss.hp === 10, "guest mirrors the boss");
    // G lands on its copy.
    G.player.invuln = 0; G.player.activePower = null;
    G.player.x = gBoss.x + 40; G.player.y = gBoss.y - G.player.h - 4; G.player.vy = 6;
    G.platforms = []; // nothing to land on but the boss
    as(G, () => G.update(1));
    assert(G.player.vy < 0, "the stomper bounces");
    bus.pump();
    assert(boss.hp === 9, "host applied the stomp, hp " + boss.hp);
    as(G2, () => G2.net.send({ type: 'stomp', nid: boss.nid }));
    bus.pump();
    assert(boss.hp === 9, "a second stomp in the same flash doesn't count");
    step(6);
    assert(G.netEnemies.get(boss.nid).hp === 9, "guests see the new health");

    const before = [H, G, G2].map(g => ({ loops: g.state.runLoops, bonus: g.state.bonusScore, gems: g.state.shards }));
    boss.hp = 1; boss.invuln = 0;
    as(G2, () => G2.net.send({ type: 'stomp', nid: boss.nid }));
    bus.pump();
    step(2);
    [H, G, G2].forEach((g, i) => {
        assert(g.state.runLoops === before[i].loops + 1, "boss counted for " + i);
        assert(g.state.bonusScore === before[i].bonus + BOSS_BONUS_METERS * 10, "bonus for " + i);
        assert(g.state.shards === before[i].gems + BOSS_GEM_BOUNTY, "bounty for " + i);
    });
    step(6);
    assert(!G.enemies.some(e => e instanceof BossDrone), "boss gone for guests");
    console.log("SHARED BOSS SUCCESS");

    // ---- Teammates glide instead of teleporting 30 times a second.
    const hostOnG = G.remotePlayers.get('HOST');
    const x0 = hostOnG.x;
    as(H, () => H.net.send({ type: 'sync', pid: 'HOST', x: x0 + 60, y: hostOnG.y - G.state.score, vx: 0, vy: 0, skinIndex: 0, activePowerId: null }));
    bus.pump();
    assert(hostOnG.x === x0, "position isn't snapped by a routine update");
    for (let i = 0; i < 20; i++) { pin(G); as(G, () => G.update(1)); }
    assert(Math.abs(hostOnG.x - (x0 + 60)) < 3, "eases into place, at " + hostOnG.x);
    console.log("SMOOTHING SUCCESS");

    // ---- Dead in co-op: say who the camera is following.
    G.player.invuln = 0;
    as(G, () => G.die(true));
    as(G, () => G.update(1));
    assert(G.ui.spectateHud.hidden === false && /^SPECTATING /.test(G.ui.spectateHud.innerText), "spectating label: " + G.ui.spectateHud.innerText);
    console.log("SPECTATE SUCCESS");

    console.log("MP ENEMIES PASSED");
    process.exit(0);
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exit(1);
}
})();
`);
