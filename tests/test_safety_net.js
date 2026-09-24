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

    // A spent life: a red rescue net bounces you back in for a second, with
    // no floor platform, and a red notice.
    game = new Game();
    game.startGame();
    game.state.extraLives = 2;
    const alerts = [];
    const realAlert = game.showAlert.bind(game);
    game.showAlert = (text, type) => { alerts.push([text, type]); realAlert(text, type); };
    const platformsBefore = game.platforms.length;
    game.player.y = CONFIG.HEIGHT + 10;
    game.die();
    assert(game.state.running && game.state.extraLives === 1, "a life was spent");
    assert(game.safetyNet.rescue && game.safetyNet.deploy === 1, "red rescue net is up");
    assert(game.player.y === CONFIG.HEIGHT - 60 && game.player.vy === CONFIG.BOUNCE_FORCE, "bounced back in from the net");
    assert(game.platforms.length === platformsBefore, "no floor platform");
    assert(alerts.some(([t, type]) => /EXTRA LIFE SPENT/.test(t) && type === 'life'), "red life notice");
    // Falling again inside the second bounces instead of costing a life.
    game.update(1);
    game.player.y = CONFIG.HEIGHT + 10;
    game.die();
    assert(game.state.extraLives === 1, "caught by the rescue net, no second life spent");
    for (let i = 0; i < RESCUE_NET_FRAMES + 40; i++) { game.player.y = 300; game.player.vy = 0; game.update(1); }
    assert(game.state.rescueNetT === 0 && game.safetyNet.deploy === 0, "the net is gone after a second");
    game.player.y = CONFIG.HEIGHT + 10;
    game.die();
    assert(game.state.extraLives === 0, "after that, a fall spends a life again");
    console.log("RESCUE NET SUCCESS");

    // The free revive uses the same net.
    game = new Game();
    game.startGame();
    const before = game.platforms.length;
    game.state.running = false;
    game.revive();
    assert(game.safetyNet.rescue && game.state.rescueNetT === RESCUE_NET_FRAMES && game.platforms.length === before, "revive uses the rescue net");
    console.log("REVIVE NET SUCCESS");
} catch(e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
