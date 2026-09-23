const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

eval(loadGameSource() + `
try {
    let mockGame = new Game();
    mockGame.startGame();

    mockGame.state.score = 10010; // scoreMeters = 1001

    // Simulate multiple frames to trigger % intervals
    for (let i = 0; i < 60; i++) {
        mockGame.update(1);
    }
    console.log("UPDATE AFTER 1000M SUCCESS");
} catch(e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
