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
    // A bullet the host's own shield absorbs in its very first frame was
    // still announced (guests just see it vanish on the next snapshot).
    const blip = new Projectile(H.player.x, H.player.y, 0, 0);
    H.projectiles.push(blip);
    H.player.invuln = 0; H.player.activePower = POWERS.SHIELD; H.player.powerTimer = 999;
    as(H, () => H.update(1));
    assert(blip.nid !== undefined, "first-frame projectile still numbered and announced");
    bus.pump();
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
    boss.shootTimer = 5; // about to fire
    step(4);
    assert(G.netEnemies.get(boss.nid).shootTimer < 20, "guests see the volley warning light");
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

    const before = [H, G, G2].map(g => ({ loops: g.state.runLoops, bonus: g.state.bonusScore, gems: g.state.gems }));
    boss.hp = 1; boss.invuln = 0;
    as(G2, () => G2.net.send({ type: 'stomp', nid: boss.nid }));
    bus.pump();
    step(2);
    [H, G, G2].forEach((g, i) => {
        assert(g.state.runLoops === before[i].loops + 1, "boss counted for " + i);
        assert(g.state.bonusScore === before[i].bonus + BOSS_BONUS_METERS * 10, "bonus for " + i);
        assert(g.state.gems === before[i].gems + BOSS_GEM_BOUNTY, "bounty for " + i);
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

    // ---- Pickups are per person: host and guest can both take the same gem.
    // The same gem (same wy) on both clients, placed on the pinned players.
    // Made here rather than found: the random level may not have an untaken one.
    const gemAt = () => ({ x: 50, y: 400, startY: 400, w: 16, h: 16, isGem: true, tier: 0, gemValue: 5, wy: -777777, markedForDeletion: false });
    const gemH = gemAt(), gemG = gemAt();
    H.powerups.push(gemH);
    G.powerups.push(gemG);
    const walletH = H.state.gems, walletG = G.state.gems;
    step(1);
    assert(H.state.gems === walletH + gemH.gemValue && G.state.gems === walletG + gemG.gemValue,
        "both collect it: H " + walletH + "->" + H.state.gems + ", G " + walletG + "->" + G.state.gems);
    assert(gemH.mine && gemG.mine && !H.visiblePickups().includes(gemH) && !G.visiblePickups().includes(gemG), "and it's gone for each");
    const hostPid = H.net.myId;
    assert(G.remotePlayers.get(hostPid).picked.has(gemH.wy), "the party hears what the host took");
    console.log("PER-PERSON PICKUPS SUCCESS");

    // ---- A boss kill refills everyone's hearts, guests included.
    [H, G, G2].forEach(g => { g.state.hearts = 0; });
    as(H, () => { H.onBossDefeated(); H.net.send({ type: 'boss_down' }); });
    bus.pump();
    assert([H, G, G2].every(g => g.state.hearts === MAX_HEARTS), "hearts refilled to " + MAX_HEARTS);
    assert(G.ui.lifeDisplay.innerText === MAX_HEARTS + ' ❤️', "the guest's meter shows it");
    console.log("BOSS HEART REFILL SUCCESS");

    // ---- Sync carries how much of a power-up is left, sanitized.
    const clean = H.sanitizeSync({ x: 1, y: 1, activePowerId: POWERS.SHIELD.id, pf: 7 });
    assert(clean.pf === 1, "pf is clamped to 1");
    assert(H.sanitizeSync({ x: 1, y: 1, activePowerId: POWERS.SHIELD.id, pf: 'x' }).pf === 0, "junk pf is 0");
    assert(H.sanitizeSync({ x: 1, y: 1, activePowerId: null, pf: 0.5 }).pf === 0, "no power, no pf");
    assert(H.sanitizeSync({ x: 1, y: 1, hl: 9 }).hl === MAX_HEARTS && H.sanitizeSync({ x: 1, y: 1, hl: 'x' }).hl === 0, "hl is clamped");
    console.log("SYNC POWER FRACTION SUCCESS");

    // ---- Dead in co-op: say who the camera is following.
    G.player.invuln = 0;
    as(G, () => { G.state.hearts = 0; G.die(true); });
    as(G, () => G.update(1));
    assert(G.ui.spectateHud.hidden === false && /^SPECTATING /.test(G.ui.spectateHud.innerText), "spectating label: " + G.ui.spectateHud.innerText);
    console.log("SPECTATE SUCCESS");

    // ---- Spectating shows the teammate's power-up, not your frozen one.
    as(G, () => G.update(1));
    G.player.activePower = POWERS.ROCKET; // frozen on the dead guest
    G2.state.hearts = 0;
    as(G2, () => G2.die(true));
    as(H, () => { H.player.grantPower(POWERS.SHIELD); H.player.powerTimer = POWERS.SHIELD.time / 2; });
    step(4);
    assert(G.spectatingPlayer && G.spectatingPlayer.name === H.party.find(m => m.isHost).name, "spectating the host");
    assert(G.ui.power.style.opacity === 1 && /HARD SHIELD/.test(G.ui.powerText.innerText), "the host's power shows: " + G.ui.powerText.innerText);
    assert(G.ui.powerText.innerText.startsWith(G.spectatingPlayer.name + ':'), "labelled with whose it is");
    const w = parseFloat(G.ui.powerFill.style.width);
    assert(w > 40 && w <= 50, "with their time left, at " + w + "%");
    H.player.activePower = null;
    step(4);
    assert(G.ui.power.style.opacity === 0, "their power ends: the bar hides");
    console.log("SPECTATE POWER-UP SUCCESS");

    // ---- Spectating shows the level as the teammate sees it.
    const watched = G.spectatingPlayer;
    const free = G.powerups.filter(p => p.isGem && !p.mine && Number.isInteger(p.wy));
    // The level is random per run and sometimes has fewer than two gems in
    // view; top up with a matching gem in both games.
    for (let i = free.length; i < 2; i++) {
        const mk = () => ({ x: 200 + i * 60, y: 350, startY: 350, w: 16, h: 16, isGem: true, tier: 0, gemValue: 5, wy: -900000 - i, markedForDeletion: false });
        const g = mk();
        G.powerups.push(g);
        H.powerups.push(mk());
        free.push(g);
    }
    assert(free.length >= 2, "two gems on screen");
    const [gemA, gemB] = free;
    gemB.mine = true; // G took B before going down
    const hostA = H.powerups.find(p => p.wy === gemA.wy);
    assert(hostA && !hostA.mine, "the host still has gem A");
    hostA.x = 50; hostA.y = hostA.startY = 400;
    step(1);
    const view = G.spectatePickups(watched);
    assert(!view.includes(gemA), "the gem the host took is gone from the spectate view");
    assert(view.includes(gemB), "the gem only G took shows, since the host hasn't taken it");
    const heart = { x: 100, y: 300, startY: 300, w: 28, h: 28, isGem: false, isHeart: true, wy: -123456, markedForDeletion: false };
    G.powerups.push(heart);
    // A heart the level spawned next to the host would be collected in these
    // frames (that's the hearts-at-zero rule working), so clear them first.
    H.powerups = H.powerups.filter(p => !p.isHeart);
    H.state.hearts = 0;
    step(3);
    assert(watched.hearts === 0, "the host's 0 hearts synced, got " + watched.hearts);
    assert(G.powerups.includes(heart), "heart still in the level: y=" + heart.y + " deleted=" + heart.markedForDeletion);
    assert(G.spectatePickups(watched).includes(heart), "hearts show while the host has none");
    H.state.hearts = 2;
    step(3);
    assert(watched.hearts === 2 && !G.spectatePickups(watched).includes(heart), "and hide once they have some");
    // The watched teammate's MAGNET pulls pickups in on the spectator's screen too.
    const far = { x: watched.x + 120, y: watched.y, startY: watched.y, w: 16, h: 16, isGem: true, tier: 0, gemValue: 5, wy: -424242, markedForDeletion: false };
    G.powerups.push(far);
    const gap = () => Math.hypot(watched.x - far.x, watched.y - far.y);
    const gap0 = gap();
    H.player.grantPower(POWERS.MAGNET);
    step(4);
    assert(watched.activePower === POWERS.MAGNET && gap() < gap0 - 20, "the teammate's magnet pulls the gem: " + gap0 + " -> " + gap());
    H.player.activePower = null;
    step(2);
    const gap1 = gap();
    step(4);
    assert(Math.abs(gap() - gap1) < 1, "no magnet, no pull");
    console.log("SPECTATE MAGNET SUCCESS");

    as(G, () => G.mpRevive());
    assert(!G.visiblePickups().includes(gemB) && G.visiblePickups().includes(gemA), "respawned: back to G's own view");
    console.log("SPECTATE PICKUPS SUCCESS");

    // ---- 'pick' is sanitized and stamped with the sender.
    const gOnH = H.remotePlayers.get(G.net.myId);
    const pickedBefore = gOnH.picked.size;
    as(G, () => G.net.send({ type: 'pick', pid: 'spoof', wy: 'abc' }));
    as(G, () => G.net.send({ type: 'pick', pid: 'spoof', wy: NaN }));
    bus.pump();
    assert(gOnH.picked.size === pickedBefore, "a bad wy is dropped");
    as(G, () => G.net.send({ type: 'pick', pid: 'spoof', wy: -777 }));
    bus.pump();
    assert(gOnH.picked.has(-777) && G2.remotePlayers.get(G.net.myId).picked.has(-777) && !G2.remotePlayers.has('spoof'), "relayed as the real sender");
    console.log("PICK MESSAGE SUCCESS");

    console.log("MP ENEMIES PASSED");
    process.exit(0);
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exit(1);
}
})();
`);
