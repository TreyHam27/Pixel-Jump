const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the gem shop: buying a skin deducts shards, persists
// ownership, and isSkinLocked()/updateSkinUI() reflect it afterward.
eval(loadGameSource() + `
try {
    const game = new Game();
    const CHEAP_INDEX = SKINS.findIndex(s => s.cost !== undefined);
    if (CHEAP_INDEX === -1) throw new Error("No gem-shop skin found in SKINS");
    const cost = SKINS[CHEAP_INDEX].cost;

    // Not enough shards yet: purchase must fail and nothing should change.
    game.state.shards = cost - 1;
    let ok = game.buyGemSkin(CHEAP_INDEX);
    if (ok || game.ownedSkins.includes(CHEAP_INDEX)) {
        throw new Error("Purchase should have failed with insufficient shards");
    }
    console.log("INSUFFICIENT SHARDS BLOCKED SUCCESS");

    // Grant enough shards and buy it.
    game.state.shards = cost;
    ok = game.buyGemSkin(CHEAP_INDEX);
    if (!ok) throw new Error("Purchase should have succeeded");
    if (game.state.shards !== 0) throw new Error("Shards were not deducted correctly");
    if (!game.ownedSkins.includes(CHEAP_INDEX)) throw new Error("Skin was not added to ownedSkins");
    if (game.isSkinLocked(CHEAP_INDEX)) throw new Error("isSkinLocked() should report unlocked after purchase");
    console.log("PURCHASE SUCCESS");

    // Buying again should be a no-op (already owned).
    game.state.shards = 99999;
    ok = game.buyGemSkin(CHEAP_INDEX);
    if (ok) throw new Error("Buying an already-owned skin should be a no-op");
    if (game.state.shards !== 99999) throw new Error("Shards should not be spent twice on the same skin");
    console.log("DOUBLE PURCHASE BLOCKED SUCCESS");

    // Ownership must persist across a fresh Game instance (new page load).
    const game2 = new Game();
    if (!game2.ownedSkins.includes(CHEAP_INDEX)) {
        throw new Error("Ownership did not persist to a new Game instance via localStorage");
    }
    if (game2.isSkinLocked(CHEAP_INDEX)) {
        throw new Error("Fresh instance should also report the purchased skin as unlocked");
    }
    console.log("PERSISTENCE ACROSS RELOAD SUCCESS");

    // The shop shows purchasable skins one at a time in a carousel: stepping
    // must cover every one of them and wrap at both ends.
    const shopSkins = game2.gemShopSkins();
    if (!shopSkins.length) throw new Error("gemShopSkins() returned nothing");
    if (shopSkins.some(({ s }) => s.cost === undefined)) {
        throw new Error("gemShopSkins() included a skin that isn't shards-purchasable");
    }

    game2.gemShopIndex = 0;
    const seen = [];
    for (let n = 0; n < shopSkins.length; n++) {
        seen.push(game2.gemShopIndex);
        game2.changeGemShopSkin(1);
    }
    if (new Set(seen).size !== shopSkins.length) {
        throw new Error("Stepping forward did not visit every purchasable skin exactly once");
    }
    if (game2.gemShopIndex !== 0) throw new Error("Forward stepping should wrap back to the first card");

    game2.changeGemShopSkin(-1);
    if (game2.gemShopIndex !== shopSkins.length - 1) {
        throw new Error("Backward stepping from the first card should wrap to the last");
    }
    console.log("CAROUSEL WRAPS BOTH WAYS SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
