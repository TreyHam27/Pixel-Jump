const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the extraRevive Pixel ability (Static King): the first
// death in a run should auto-continue once without touching the normal
// one-ad-revive-per-run flow, and must not trigger a second time same run.
eval(loadGameSource() + `
try {
    const STATIC_KING_INDEX = SKINS.findIndex(s => s.name === "Static King");
    if (STATIC_KING_INDEX === -1) throw new Error("Static King skin not found in SKINS");
    if (!SKINS[STATIC_KING_INDEX].ability.extraRevive) throw new Error("Static King has no extraRevive ability");

    const game = new Game();
    game.viewParams.skinIndex = STATIC_KING_INDEX;
    game.startGame();

    // First death: should auto-continue (extraRevive), not touch state.revived,
    // and running should remain true.
    game.die(true);
    if (!game.state.usedExtraRevive) throw new Error("usedExtraRevive was not set after first death");
    if (!game.state.running) throw new Error("Run should still be running after the free revive");
    if (game.state.revived) throw new Error("extraRevive should not consume the normal ad-revive flag");
    console.log("FIRST DEATH AUTO-CONTINUE SUCCESS");

    // Second death same run: extraRevive is used up, must fall through to the
    // normal ad-revive-prompt flow (state.running becomes false).
    game.die(true);
    if (game.state.running) throw new Error("Second death should not auto-continue again");
    console.log("SECOND DEATH FALLS THROUGH SUCCESS");

    // A brand new run should refresh the free revive.
    game.startGame();
    if (game.state.usedExtraRevive) throw new Error("usedExtraRevive did not reset on a new run");
    console.log("RESET ON NEW RUN SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
