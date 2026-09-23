const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// All game classes + the test body must share one eval scope: classes
// declared in one eval() call are invisible to code in a later eval() call.
eval(loadGameSource() + `
try {
    let mockGame = new Game();
    mockGame.startGame();
    mockGame.update(1);
    console.log("UPDATE SUCCESS");
} catch(e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
