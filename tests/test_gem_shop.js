const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the gem shop: buying a skin deducts shards, persists
// ownership by skin id, equips it on the spot, and the carousel walks the
// price-sorted tier ladder. Also covers migrating old index-based saves.
eval(loadGameSource() + `
try {
    // Old saves stored Pixels by SKINS position. Index 8 was Chrome Unit and
    // index 14 Static King in the pre-id roster; both must survive migration.
    localStorage.setItem('lp_owned_skins', JSON.stringify([8]));
    localStorage.setItem('lp_skin', '8');
    const migrated = new Game();
    if (JSON.stringify(migrated.ownedSkins) !== JSON.stringify(['chrome'])) {
        throw new Error("Legacy owned skins were not migrated to ids: " + JSON.stringify(migrated.ownedSkins));
    }
    if (SKINS[migrated.viewParams.skinIndex].id !== 'chrome') {
        throw new Error("Legacy equipped skin was not migrated, got " + SKINS[migrated.viewParams.skinIndex].id);
    }
    if (localStorage.getItem('lp_skin') !== 'chrome') throw new Error("lp_skin should now hold an id");
    console.log("LEGACY SAVE MIGRATION SUCCESS");

    // A migrated save is left alone on the next load.
    const migratedAgain = new Game();
    if (JSON.stringify(migratedAgain.ownedSkins) !== JSON.stringify(['chrome'])) {
        throw new Error("Migration should be a no-op on an already-migrated save");
    }
    localStorage.removeItem('lp_owned_skins');
    localStorage.removeItem('lp_skin');
    console.log("MIGRATION IDEMPOTENT SUCCESS");

    const game = new Game();
    const shopSkins = game.gemShopSkins();
    const { s: cheap, i: CHEAP_INDEX } = shopSkins[0];
    const cost = cheap.cost;

    // The shop is a ladder: cheapest first, prices strictly climbing.
    for (let n = 1; n < shopSkins.length; n++) {
        if (!(shopSkins[n].s.cost > shopSkins[n - 1].s.cost)) {
            throw new Error("Shop tiers are not strictly increasing in price at tier " + (n + 1));
        }
    }
    console.log("TIER LADDER SORTED SUCCESS");

    // Not enough shards yet: purchase must fail and nothing should change.
    game.state.shards = cost - 1;
    let ok = game.buyGemSkin(CHEAP_INDEX);
    if (ok || game.ownedSkins.includes(cheap.id)) {
        throw new Error("Purchase should have failed with insufficient shards");
    }
    console.log("INSUFFICIENT SHARDS BLOCKED SUCCESS");

    // Grant enough shards and buy it: owned, and equipped straight away.
    game.state.shards = cost;
    ok = game.buyGemSkin(CHEAP_INDEX);
    if (!ok) throw new Error("Purchase should have succeeded");
    if (game.state.shards !== 0) throw new Error("Shards were not deducted correctly");
    if (!game.ownedSkins.includes(cheap.id)) throw new Error("Skin id was not added to ownedSkins");
    if (game.isSkinLocked(CHEAP_INDEX)) throw new Error("isSkinLocked() should report unlocked after purchase");
    if (game.viewParams.skinIndex !== CHEAP_INDEX) throw new Error("Buying a Pixel should equip it");
    if (localStorage.getItem('lp_skin') !== cheap.id) throw new Error("The purchased Pixel should be saved as equipped");
    console.log("PURCHASE EQUIPS SUCCESS");

    // Buying again should be a no-op (already owned).
    game.state.shards = 99999;
    ok = game.buyGemSkin(CHEAP_INDEX);
    if (ok) throw new Error("Buying an already-owned skin should be a no-op");
    if (game.state.shards !== 99999) throw new Error("Shards should not be spent twice on the same skin");
    console.log("DOUBLE PURCHASE BLOCKED SUCCESS");

    // Ownership and the equipped Pixel persist across a fresh Game instance.
    const game2 = new Game();
    if (!game2.ownedSkins.includes(cheap.id)) {
        throw new Error("Ownership did not persist to a new Game instance via localStorage");
    }
    if (game2.isSkinLocked(CHEAP_INDEX)) {
        throw new Error("Fresh instance should also report the purchased skin as unlocked");
    }
    if (game2.viewParams.skinIndex !== CHEAP_INDEX) {
        throw new Error("Equipped Pixel did not persist across reload");
    }
    console.log("PERSISTENCE ACROSS RELOAD SUCCESS");

    // The shop shows purchasable skins one at a time in a carousel: stepping
    // must cover every one of them and wrap at both ends.
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
