const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Spending a heart hides hearts near where it was spent, and tapping beside
// the run card closes it.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
try {
    // ---- A heart already on screen when you spend your last one stays
    // hidden, so the rebound can't pick it straight back up.
    let g = new Game();
    g.state.hearts = 1;
    g.startGame();
    assert(g.state.heartBlockWY === null, "no block at the start of a run");
    g.state.score = 5000;
    g.powerups = [];
    const heart = (wy) => ({ x: 100, y: wy + g.state.score, w: 28, h: 28, wy, isHeart: true });
    const onScreen = heart(-g.state.score + 300);
    const nextScreen = heart(-g.state.score - CONFIG.HEIGHT / 2);
    const later = heart(-g.state.score - CONFIG.HEIGHT - HEART_MIN_GAP);
    g.powerups.push(onScreen, nextScreen, later);
    assert(g.visiblePickups().length === 0, "hearts hidden while you still have one");

    assert(g.useSpareLife(), "the heart saves you");
    assert(g.state.hearts === 0, "heart spent");
    const vis = g.visiblePickups();
    assert(!vis.includes(onScreen), "heart on screen stays hidden");
    assert(!vis.includes(nextScreen), "heart just above stays hidden");
    assert(vis.includes(later), "hearts further up still appear");

    g.startGame();
    assert(g.state.heartBlockWY === null, "a new run clears the block");
    console.log("HEART BLOCK SUCCESS");

    // ---- Run card: backdrop taps close it (after the grace period), taps
    // inside the box don't.
    g = new Game();
    g.startGame();
    g.showRunCard(123);
    assert(g.runCardOpen, "card open");
    g.ui.runCard.onclick({ target: g.ui.runCard });
    assert(g.runCardOpen, "a tap during the grace period is ignored");
    g.runCardOpenedAt = performance.now() - RUN_CARD_TAP_GRACE_MS - 1;
    g.ui.runCard.onclick({ target: g.ui.runAgainBtn });
    assert(g.runCardOpen, "a tap inside the card doesn't close it");
    g.ui.runCard.onclick({ target: g.ui.runCard });
    assert(!g.runCardOpen && g.ui.runCard.hidden, "a tap beside the card closes it");
    console.log("RUN CARD BACKDROP SUCCESS");
} catch (e) {
    console.error(e);
    process.exit(1);
}
`);
