const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the 8-tier biome/hazard system: hazards must accumulate
// cumulatively (never drop) as distance increases, and the new hazard code
// paths (gravity pulse, laser drones, glitch input-swap) must not crash even
// deep into The Void where everything is stacked at once.
eval(loadGameSource() + `
try {
    const game = new Game();
    game.startGame();

    const checkpoints = [0, 600, 1800, 3200, 5000, 8000, 12000, 17000, 25000];
    let previousHazardCount = -1;

    checkpoints.forEach(meters => {
        game.state.score = meters * 10;
        game.renderer.updateBiome(meters);
        const hazards = game.renderer.currentBiome.hazards;
        if (hazards.length < previousHazardCount) {
            throw new Error("Hazards regressed at " + meters + "m: " + JSON.stringify(hazards));
        }
        previousHazardCount = hazards.length;
    });
    console.log("HAZARD ACCUMULATION SUCCESS");

    // Run a long soak deep in The Void (all hazards active: wind, moving,
    // meteor, gravityPulse, laser, glitch) to make sure nothing crashes and
    // enemies/projectiles/platforms stay bounded (no leaks).
    game.state.score = 180000; // 18,000m — inside The Void
    game.state.frames = 0;
    for (let i = 0; i < 2000; i++) {
        game.update(1);
    }
    console.log("Enemies after Void soak:", game.enemies.length);
    console.log("Projectiles after Void soak:", game.projectiles.length);
    if (game.enemies.length > 40 || game.projectiles.length > 40) {
        throw new Error("Enemy/projectile count grew unbounded during Void soak");
    }
    console.log("VOID SOAK NO-CRASH SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
