const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// The SAFETY NET power-up draws a trampoline across the bottom of the screen.
// This covers the visual state machine: it deploys while the power is held,
// wobbles on each bounce, warns before expiry, and retracts afterwards.
eval(loadGameSource() + `
function assert(cond, msg) {
    if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

try {
    let game = new Game();
    game.startGame();

    assert(game.safetyNet.deploy === 0, "net starts retracted");

    game.player.activePower = POWERS.SAFETY;
    game.player.powerTimer = POWERS.SAFETY.time;
    for (let i = 0; i < 20; i++) game.update(1);
    assert(game.safetyNet.deploy === 1, "net fully deploys while the power is held");
    assert(!game.safetyNet.expiring, "net is not warning at full timer");

    // Fall off the bottom: the net should catch the player and start wobbling.
    game.player.y = CONFIG.HEIGHT + 100;
    game.die();
    assert(game.player.vy === CONFIG.BOUNCE_FORCE, "player is bounced back up");
    assert(game.safetyNet.impact === 1, "bounce kicks off the wobble");
    assert(Math.abs(game.safetyNet.impactX - (game.player.x + 13)) < 0.001, "wobble is centred on the player");

    game.update(1);
    assert(game.safetyNet.impact < 1 && game.safetyNet.impact > 0, "wobble decays");
    assert(game.safetyNet.phase > 0, "wobble oscillates");

    // Drawing the net at every stage must not throw.
    game.draw();

    // Near the end of the timer the net blinks as a warning.
    game.player.powerTimer = 100;
    game.update(1);
    assert(game.safetyNet.expiring, "net warns before the power expires");
    game.draw();

    // Once the power lapses the net retracts, and the fall is fatal again.
    game.player.powerTimer = 0;
    game.update(1);
    assert(game.player.activePower === null, "power expired");
    for (let i = 0; i < 40; i++) game.update(1);
    assert(game.safetyNet.deploy === 0, "net fully retracts");
    game.draw();

    // A game over clears the net rather than leaving it over the menu.
    game.player.activePower = POWERS.SAFETY;
    game.player.powerTimer = POWERS.SAFETY.time;
    for (let i = 0; i < 20; i++) game.update(1);
    assert(game.safetyNet.deploy === 1, "net redeployed");
    game.gameOver();
    assert(game.safetyNet.deploy === 0, "game over clears the net");

    // A fresh run starts with no net left over from the last one.
    game.player.activePower = POWERS.SAFETY;
    game.player.powerTimer = POWERS.SAFETY.time;
    game.update(1);
    game.reset();
    assert(game.safetyNet.deploy === 0 && game.safetyNet.impact === 0, "reset clears the net");

    console.log("SAFETY NET SUCCESS");
} catch(e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
