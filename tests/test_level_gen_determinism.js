const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test: co-op clients share a seed, but each one scrolls its own
// camera (following the lowest living player, with network lag). Platform
// generation used to read the camera score and the renderer's biome, so two
// clients a few metres apart at the 1800m 'moving' edge drew a different
// number of random numbers and built different levels from then on. Now a
// platform depends only on its own world height, so any two cameras must
// produce the same platforms and pickups.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function makeClient(seed) {
    const g = new Game();
    g.startMultiplayerGame(seed);
    g.genLog = [];
    const orig = g.spawnPlatform.bind(g);
    g.spawnPlatform = (wy) => {
        const beforeP = g.platforms.length, beforeU = g.powerups.length;
        orig(wy);
        const p = g.platforms[beforeP];
        const u = g.powerups[beforeU];
        g.genLog.push([wy, p.x, p.w, p.vx, u ? (u.isGem ? 'gem' : 'power') : '-'].join('|'));
    };
    return g;
}

// Scroll a client's camera up to targetPx in steps of stepPx.
function climb(g, targetPx, stepPx) {
    while (g.state.score < targetPx) {
        const diff = Math.min(stepPx, targetPx - g.state.score);
        g.player.y = CONFIG.HEIGHT / 2; // keep the camera target in place
        g.scrollCamera(diff);
    }
}

try {
    const seed = 55555;
    const a = makeClient(seed);
    const b = makeClient(seed);
    // The initial screen came from reset(), before the log was hooked up.
    assert(JSON.stringify(a.platforms.map(p => [p.x, p.w])) === JSON.stringify(b.platforms.map(p => [p.x, p.w])),
        "initial platforms should match");

    // A climbs smoothly to 1830m; B trails 40m behind in coarser steps (so
    // one is past the 1800m edge while the other isn't), then catches up.
    climb(a, 18300, 7.3);
    climb(b, 17900, 13.1);
    const n = Math.min(a.genLog.length, b.genLog.length);
    for (let i = 0; i < n; i++) {
        assert(a.genLog[i] === b.genLog[i], "platform " + i + " differs mid-climb: " + a.genLog[i] + " vs " + b.genLog[i]);
    }
    climb(b, 18300, 13.1);
    assert(a.genLog.length === b.genLog.length, "same height, same platform count");
    assert(a.genLog.join() === b.genLog.join(), "same platforms and pickups once both reach 1830m");

    // Keep going past The Rift (5000m) with yet another pair of step sizes.
    climb(a, 52000, 11.7);
    climb(b, 52000, 5.9);
    assert(a.genLog.join() === b.genLog.join(), "still identical past 5000m");
    assert(a.genLog.some(l => l.split('|')[3] !== '0'), "the climb should have generated moving platforms");
    console.log("LAGGED CAMERA DETERMINISM SUCCESS (" + a.genLog.length + " platforms)");

    // Platforms are generated ahead of the camera, never popping in on screen.
    const highest = Math.min(...a.platforms.map(p => p.y));
    assert(highest < -CONFIG.PLATFORM_BASE_GAP, "a spare platform should always exist above the screen, highest at " + highest);
    console.log("LOOKAHEAD SUCCESS");

    // The first screen keeps its pickups (reset() used to wipe them).
    const fresh = new Game();
    fresh.startMultiplayerGame(12345);
    assert(fresh.powerups.length > 0, "the first screen of a run should have gems/power-ups");
    const solo = new Game();
    solo.startGame();
    assert(solo.powerups.length > 0, "solo runs keep their first-screen pickups too");
    console.log("FIRST SCREEN PICKUPS SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
