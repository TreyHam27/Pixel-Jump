const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the shop's purchasable EXTRA LIFE consumable: shards are
// deducted, stock caps at MAX_EXTRA_LIVES, it persists across a reload, and a
// banked life is spent on a death that would otherwise end the run.
//
// Note: with ADS_ENABLED false (current default) AdManager.showRevivePrompt()
// grants one free continue of its own, so the run only truly ends one death
// after the banked lives run out — same caveat as test_extra_revive.js.
eval(loadGameSource() + `
try {
    const game = new Game();

    // Not enough shards: purchase must fail and change nothing.
    game.state.shards = EXTRA_LIFE_COST - 1;
    if (game.buyExtraLife()) throw new Error("Purchase should have failed with insufficient shards");
    if (game.state.extraLives !== 0) throw new Error("Extra lives should still be 0 after a failed purchase");
    console.log("INSUFFICIENT SHARDS BLOCKED SUCCESS");

    // Enough shards: buy one.
    game.state.shards = EXTRA_LIFE_COST;
    if (!game.buyExtraLife()) throw new Error("Purchase should have succeeded");
    if (game.state.shards !== 0) throw new Error("Shards were not deducted correctly");
    if (game.state.extraLives !== 1) throw new Error("Extra life was not banked");
    console.log("PURCHASE SUCCESS");

    // Stock is capped: buying past MAX_EXTRA_LIVES must not spend shards.
    game.state.shards = EXTRA_LIFE_COST * 10;
    while (game.state.extraLives < MAX_EXTRA_LIVES) {
        if (!game.buyExtraLife()) throw new Error("Purchase should succeed below the stock cap");
    }
    const shardsAtCap = game.state.shards;
    if (game.buyExtraLife()) throw new Error("Buying past MAX_EXTRA_LIVES should be a no-op");
    if (game.state.shards !== shardsAtCap) throw new Error("Shards should not be spent once stock is full");
    if (game.state.extraLives !== MAX_EXTRA_LIVES) throw new Error("Stock exceeded MAX_EXTRA_LIVES");
    console.log("STOCK CAP SUCCESS");

    // Stock must survive a reload (new Game instance reads localStorage).
    const game2 = new Game();
    if (game2.state.extraLives !== MAX_EXTRA_LIVES) {
        throw new Error("Banked extra lives did not persist to a new Game instance");
    }
    console.log("PERSISTENCE ACROSS RELOAD SUCCESS");

    // Spending: default skin (index 0) has no extraRevive ability, so the
    // banked lives are what keeps the run alive here.
    game2.viewParams.skinIndex = 0;
    game2.startGame();
    const before = game2.state.extraLives;

    game2.die(true);
    if (!game2.state.running) throw new Error("Run should continue while a banked extra life remains");
    if (game2.state.extraLives !== before - 1) throw new Error("A death should spend exactly one banked life");
    if (game2.state.revived) throw new Error("Spending stock should not consume the ad-revive flag");
    console.log("SPEND ON DEATH SUCCESS");

    // Banked stock carries across runs — it is not cleared on a new run the
    // way the per-run skin revive is.
    game2.startGame();
    if (game2.state.extraLives !== before - 1) throw new Error("Banked lives should carry into the next run");
    console.log("STOCK CARRIES ACROSS RUNS SUCCESS");

    // Drain the bank, then the ads-disabled fallback, then the run must end.
    while (game2.state.extraLives > 0) {
        game2.die(true);
        if (!game2.state.running) throw new Error("Run ended while banked lives remained");
    }
    game2.die(true);
    if (!game2.state.running) throw new Error("Empty bank should fall through to the ads-fallback revive");
    game2.die(true);
    if (game2.state.running) throw new Error("Run should end once bank and ad-revive are both spent");
    console.log("EXHAUSTION ENDS RUN SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
