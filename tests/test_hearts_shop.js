const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the shop's purchasable HEART consumable: shards are
// deducted, stock caps at MAX_HEARTS, it persists across a reload, and a
// banked life is spent on a death that would otherwise end the run, every
// run starts with at least one, and with ads off nothing else revives you.
eval(loadGameSource() + `
try {
    const game = new Game();

    // Not enough shards: purchase must fail and change nothing.
    game.state.shards = HEART_COST - 1;
    if (game.buyHeart()) throw new Error("Purchase should have failed with insufficient shards");
    if (game.state.hearts !== 0) throw new Error("Hearts should still be 0 after a failed purchase");
    console.log("INSUFFICIENT SHARDS BLOCKED SUCCESS");

    // Enough shards: buy one.
    game.state.shards = HEART_COST;
    if (!game.buyHeart()) throw new Error("Purchase should have succeeded");
    if (game.state.shards !== 0) throw new Error("Shards were not deducted correctly");
    if (game.state.hearts !== 1) throw new Error("Heart was not banked");
    console.log("PURCHASE SUCCESS");

    // Stock is capped: buying past MAX_HEARTS must not spend shards.
    game.state.shards = HEART_COST * 10;
    while (game.state.hearts < MAX_HEARTS) {
        if (!game.buyHeart()) throw new Error("Purchase should succeed below the stock cap");
    }
    const shardsAtCap = game.state.shards;
    if (game.buyHeart()) throw new Error("Buying past MAX_HEARTS should be a no-op");
    if (game.state.shards !== shardsAtCap) throw new Error("Shards should not be spent once stock is full");
    if (game.state.hearts !== MAX_HEARTS) throw new Error("Stock exceeded MAX_HEARTS");
    console.log("STOCK CAP SUCCESS");

    // Stock must survive a reload (new Game instance reads localStorage).
    const game2 = new Game();
    if (game2.state.hearts !== MAX_HEARTS) {
        throw new Error("Banked hearts did not persist to a new Game instance");
    }
    console.log("PERSISTENCE ACROSS RELOAD SUCCESS");

    // Spending: the banked lives are what keeps the run alive.
    game2.viewParams.skinIndex = 0;
    game2.startGame();
    const before = game2.state.hearts;

    game2.die(true);
    if (!game2.state.running) throw new Error("Run should continue while a banked heart remains");
    if (game2.state.hearts !== before - 1) throw new Error("A death should spend exactly one banked life");
    if (game2.state.revived) throw new Error("Spending stock should not consume the ad-revive flag");
    console.log("SPEND ON DEATH SUCCESS");

    // Banked stock carries across runs — it is not cleared on a new run the
    // way the per-run skin revive is.
    game2.startGame();
    if (game2.state.hearts !== before - 1) throw new Error("Banked lives should carry into the next run");
    console.log("STOCK CARRIES ACROSS RUNS SUCCESS");

    // Drain the bank: with ads off there's no revive offer, so the next
    // death ends the run.
    while (game2.state.hearts > 0) {
        game2.die(true);
        if (!game2.state.running) throw new Error("Run ended while banked lives remained");
    }
    game2.die(true);
    if (game2.state.running) throw new Error("Run should end once the hearts are spent");
    if (game2.state.revived) throw new Error("No hidden revive with ads off");
    console.log("EXHAUSTION ENDS RUN SUCCESS");

    // The free life each run is a visible heart: a run never starts on 0.
    game2.startGame();
    if (game2.state.hearts !== 1) throw new Error("A run should start with 1 heart when the bank is empty");
    if (localStorage.getItem('lp_hearts') !== '1') throw new Error("The run-start heart should be saved");
    if (game2.ui.lifeDisplay.innerText !== '1 ❤️') throw new Error("The run-start heart should show in the meter");
    game2.setHearts(2);
    game2.startGame();
    if (game2.state.hearts !== 2) throw new Error("The top-up must not add to a bank that isn't empty");
    console.log("RUN-START HEART SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
