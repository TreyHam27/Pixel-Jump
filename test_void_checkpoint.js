const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for The Void's exclusive checkpoint-start buff: equipping
// it must start every future single-player run already at The Rift (5000m),
// and must NOT affect multiplayer (which always passes an explicit seed).
eval(loadGameSource() + `
try {
    const VOID_INDEX = SKINS.findIndex(s => s.name === "The Void");
    if (VOID_INDEX === -1) throw new Error("The Void skin not found in SKINS");
    if (!SKINS[VOID_INDEX].ability.startAtScore) throw new Error("The Void has no startAtScore ability");

    const game = new Game();
    game.viewParams.skinIndex = VOID_INDEX;
    game.startGame();

    const expectedScore = SKINS[VOID_INDEX].ability.startAtScore;
    if (game.state.score !== expectedScore) {
        throw new Error("Expected state.score to start at " + expectedScore + ", got " + game.state.score);
    }
    console.log("CHECKPOINT SCORE INIT SUCCESS");

    // The initial platform batch should already reflect Rift-tier hazards
    // (moving platforms unlocked at 1800m, well below the 5000m checkpoint).
    game.renderer.updateBiome(game.state.score / 10);
    if (!game.renderer.currentBiome.hazards.includes('moving')) {
        throw new Error("Expected checkpoint start to already be past Low Orbit's 'moving' hazard");
    }
    if (game.renderer.currentBiome.name !== "The Rift") {
        throw new Error("Expected checkpoint start biome to be The Rift, got " + game.renderer.currentBiome.name);
    }
    console.log("CHECKPOINT BIOME/HAZARDS SUCCESS");

    // Multiplayer must be completely unaffected by the equipped skin.
    const mpGame = new Game();
    mpGame.viewParams.skinIndex = VOID_INDEX;
    mpGame.state.isHost = true;
    mpGame.startMultiplayerGame(99999);
    if (mpGame.state.score !== 0) {
        throw new Error("Multiplayer incorrectly picked up the startAtScore checkpoint: score=" + mpGame.state.score);
    }
    console.log("MULTIPLAYER UNAFFECTED SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
