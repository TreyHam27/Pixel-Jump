const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

eval(loadGameSource() + `
try {
    let mockGame = new Game();
    mockGame.startGame();

    // Push into meteor/shooter-drone territory and run a long soak to check
    // that projectiles/meteors get cleaned up instead of growing unbounded.
    mockGame.state.score = 65000; // scoreMeters = 6500
    for (let i = 0; i < 3000; i++) {
        mockGame.update(1);
    }
    console.log("Projectiles after soak:", mockGame.projectiles.length);
    console.log("Enemies after soak:", mockGame.enemies.length);
    if (mockGame.projectiles.length > 50) {
        console.error("FAIL: projectile/meteor list is growing unbounded");
        process.exitCode = 1;
    } else {
        console.log("SOAK SUCCESS");
    }

    // Simulate a first run that beats the high score, then a second worse
    // run, to check the ghost-recording isNewBest bug is actually fixed.
    mockGame.gameOver();
    const ghostAfterFirstBest = localStorage.getItem('lp_ghost');

    mockGame.startGame();
    mockGame.state.score = 10; // much worse run
    mockGame.ghostRec.pts = [999, 999, 999, 999];
    mockGame.gameOver();
    const ghostAfterWorseRun = localStorage.getItem('lp_ghost');

    if (ghostAfterWorseRun === ghostAfterFirstBest) {
        console.error("FAIL: latest run didn't replace the previous ghost recording");
        process.exitCode = 1;
    } else {
        console.log("GHOST LATEST-RUN SUCCESS");
    }
} catch(e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
