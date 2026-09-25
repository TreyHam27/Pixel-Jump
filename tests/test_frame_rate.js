const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test: spawns used to key off the rendered-frame counter, so a
// 120Hz or 144Hz screen got 2-2.4x the drones, meteors and laser drones of a
// 60Hz one (and the ghost replayed at the wrong speed). Everything now runs
// on game time.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function seedRandom(seed) {
    let s = seed;
    Math.random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// 60 seconds of game time at the given refresh rate, deep enough (9000m)
// that drones, meteors and laser drones are all active. The player hovers in
// place and every spawn is counted, then removed.
function spawnsPerMinute(hz) {
    seedRandom(7);
    const g = new Game();
    g.startGame();
    g.state.score = 90000;
    g.state.loops = 1e9;            // keep the boss out of the way
    g.state.nextBossAt = Infinity;
    const dt = 60 / hz;
    const counts = { drone: 0, meteor: 0, laser: 0 };
    for (let i = 0; i < hz * 60; i++) {
        g.player.y = 300; g.player.vy = 0; g.player.invuln = 1e9;
        g.update(dt);
        g.enemies.forEach(e => { if (e instanceof LaserDrone) counts.laser++; else counts.drone++; });
        g.projectiles.forEach(p => { if (p instanceof Meteor) counts.meteor++; });
        g.enemies = [];
        g.projectiles = [];
    }
    return counts;
}

try {
    const at60 = spawnsPerMinute(60);
    for (const hz of [120, 144]) {
        const c = spawnsPerMinute(hz);
        for (const k of Object.keys(at60)) {
            assert(Math.abs(c[k] - at60[k]) <= 1, k + " spawns differ: " + at60[k] + " @60Hz vs " + c[k] + " @" + hz + "Hz");
        }
    }
    assert(at60.drone > 0 && at60.meteor > 0 && at60.laser > 0, "every spawn type should occur: " + JSON.stringify(at60));
    console.log("SPAWN PARITY SUCCESS", JSON.stringify(at60));

    // Ghost samples follow game time, not frames.
    function ghostSamples(hz) {
        const g = new Game();
        g.startGame();
        for (let i = 0; i < hz * 10; i++) { g.player.y = 400; g.player.vy = 0; g.update(60 / hz); }
        return g.ghostRec.pts.length / 2;
    }
    const s60 = ghostSamples(60), s144 = ghostSamples(144);
    assert(Math.abs(s60 - s144) <= 1, "ghost samples differ: " + s60 + " vs " + s144);
    console.log("GHOST CADENCE SUCCESS");

    // Ghost rules: saved for today's layout, only replaced by a better run,
    // ignored on another day or in co-op, and the old format is dropped.
    localStorage.removeItem('lp_ghost');
    const g = new Game();
    g.startGame();
    for (let i = 0; i < 120; i++) { g.player.y = 400; g.player.vy = 0; g.update(1); }
    g.state.score = 5000;
    g.gameOver();
    const saved = JSON.parse(localStorage.getItem('lp_ghost'));
    assert(saved && saved.v === 2 && saved.seed === g.getDailySeed() && saved.score === 500, "first run saves today's ghost");

    g.startGame();
    assert(g.ghostPlayback && g.ghostPlayback.score === 500, "the next run on the same layout races it");
    g.state.score = 1000;
    g.gameOver();
    assert(JSON.parse(localStorage.getItem('lp_ghost')).score === 500, "a worse run keeps the better ghost");

    g.startGame();
    for (let i = 0; i < 60; i++) { g.player.y = 400; g.player.vy = 0; g.update(1); }
    g.state.score = 9000;
    g.gameOver();
    assert(JSON.parse(localStorage.getItem('lp_ghost')).score === 900, "a better run replaces it");

    const other = JSON.parse(localStorage.getItem('lp_ghost'));
    other.seed = 19991231;
    localStorage.setItem('lp_ghost', JSON.stringify(other));
    g.startGame();
    assert(g.ghostPlayback === null, "a ghost from another day isn't replayed");

    localStorage.setItem('lp_ghost', JSON.stringify([{ x: 1, y: 2 }]));
    g.startGame();
    assert(g.ghostPlayback === null, "the old array format is ignored");

    const mp = new Game();
    mp.startMultiplayerGame(4242);
    assert(mp.ghostRec === null && mp.ghostPlayback === null, "co-op neither records nor replays a ghost");
    console.log("GHOST RULES SUCCESS");

    // A dead co-op player's body doesn't keep falling or collecting gems.
    const dead = new Game();
    dead.startMultiplayerGame(99);
    dead.player.isDead = true;
    const y0 = dead.player.y, gems0 = dead.state.gems;
    dead.powerups = [{ x: dead.player.x, y: dead.player.y, startY: dead.player.y, w: 16, h: 16, isGem: true, gemValue: 5, markedForDeletion: false }];
    for (let i = 0; i < 30; i++) dead.update(1);
    assert(dead.player.y === y0 && dead.state.gems === gems0, "dead body stays put and collects nothing");
    console.log("DEAD BODY SUCCESS");

    // Magnets pull pickups vertically as well as sideways.
    const m = new Game();
    m.startGame();
    m.player.activePower = POWERS.MAGNET; m.player.powerTimer = 999;
    const gem = { x: m.player.x, y: m.player.y - 150, startY: m.player.y - 150, w: 16, h: 16, isGem: true, gemValue: 5, markedForDeletion: false };
    m.powerups = [gem];
    const gap0 = m.player.y - gem.startY;
    for (let i = 0; i < 5; i++) { m.player.vy = 0; m.player.update(1, m.input, [], m.powerups); m.draw(); }
    assert(m.player.y - gem.startY < gap0 * 0.8, "magnet should pull a pickup above the player down toward it");
    console.log("MAGNET PULL SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
