const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test: dying mid-boss-fight used to leave state.bossActive stuck
// `true` forever (reset() cleared `enemies` but never the flag), permanently
// blocking all future drone/boss spawns for the rest of the session. Also
// checks state.maxScore resets so the story reveal doesn't replay instantly
// on every run after the first.
eval(loadGameSource() + `
try {
    let mockGame = new Game();
    mockGame.startGame();

    // Simulate being mid-boss-fight with a live (undefeated) boss.
    mockGame.state.bossActive = true;
    mockGame.enemies.push(new BossDrone(mockGame.player.y - 600));
    mockGame.state.maxScore = 12345;

    // Die without defeating the boss, then start a brand new run.
    mockGame.die(true);
    mockGame.startGame();

    if (mockGame.state.bossActive !== false) {
        console.error("FAIL: state.bossActive stuck true after a fresh run started");
        process.exitCode = 1;
    } else {
        console.log("BOSS ACTIVE RESET SUCCESS");
    }

    if (mockGame.state.maxScore !== 0) {
        console.error("FAIL: state.maxScore did not reset for the new run");
        process.exitCode = 1;
    } else {
        console.log("MAX SCORE RESET SUCCESS");
    }

    // Confirm a regular drone can actually spawn again post-fix (previously
    // blocked forever since drone spawning is gated on !bossActive).
    mockGame.state.score = 30000; // scoreMeters = 3000, past the 60m gate
    // Spawn interval at this score is max(60, 120 - 3000/100) = 90 frames of
    // game time; the drone timer at 89 reaches 90 on this update(1).
    mockGame.state.timers.drone = 89;
    mockGame.enemies = [];
    mockGame.update(1);
    if (mockGame.enemies.length === 0) {
        console.error("FAIL: no enemy spawned after boss-death reset (spawning still blocked)");
        process.exitCode = 1;
    } else {
        console.log("ENEMY SPAWN RESUMED SUCCESS");
    }
} catch(e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
