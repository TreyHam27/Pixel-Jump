const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

eval(loadGameSource() + `
try {
    let mockGame = new Game();
    mockGame.startGame();

    // Create a mock powerup colliding with player
    mockGame.powerups.push({ x: mockGame.player.x, y: mockGame.player.y, w: 20, h: 20, isShard: false });

    mockGame.update(1);
    console.log("UPDATE AFTER POWERUP SUCCESS");
} catch(e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
