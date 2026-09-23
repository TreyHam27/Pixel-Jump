const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the main-menu Pixel picker: it only ever cycles through
// Pixels the player can use (locked gem Pixels live in the shop, locked
// distance/secret ones stay hidden), shows a collection counter, and never
// equips a Pixel the player doesn't have.
eval(loadGameSource() + `
try {
    const idx = (id) => skinIndexById(id);

    // Brand-new player: just the starter.
    const game = new Game();
    if (JSON.stringify(game.unlockedSkinIndexes()) !== JSON.stringify([0])) {
        throw new Error("A new player should only have the starter Pixel, got " + JSON.stringify(game.unlockedSkinIndexes()));
    }
    game.changeSkin(1);
    if (game.viewParams.skinIndex !== 0) throw new Error("Stepping with one Pixel should stay on it");
    if (game.ui.prev.style.visibility !== 'hidden') throw new Error("Arrows should hide with only one Pixel");
    if (game.ui.skinStatus.innerText !== "PIXELS 1 / " + SKINS.length) {
        throw new Error("Counter should read PIXELS 1 / " + SKINS.length + ", got " + game.ui.skinStatus.innerText);
    }
    console.log("STARTER ONLY SUCCESS");

    // 400m high score + one bought Pixel: starter, Ghost, Matrix, Nebula.
    game.state.highScore = 400;
    game.ownedSkins.push('nebula');
    const expected = [0, idx('ghost'), idx('matrix'), idx('nebula')];
    if (JSON.stringify(game.unlockedSkinIndexes()) !== JSON.stringify(expected)) {
        throw new Error("Unlocked set wrong: " + JSON.stringify(game.unlockedSkinIndexes()));
    }
    const seen = [];
    for (let n = 0; n < expected.length; n++) {
        game.changeSkin(1);
        seen.push(game.viewParams.skinIndex);
        if (game.isSkinLocked()) throw new Error("Picker landed on a locked Pixel: " + SKINS[game.viewParams.skinIndex].name);
    }
    if (game.viewParams.skinIndex !== 0) throw new Error("Picker should wrap back to the starter");
    if (new Set(seen).size !== expected.length) throw new Error("Picker skipped an unlocked Pixel");
    game.changeSkin(-1);
    if (game.viewParams.skinIndex !== idx('nebula')) throw new Error("Stepping back from the starter should wrap to the last Pixel");
    if (game.ui.prev.style.visibility !== 'visible') throw new Error("Arrows should show with several Pixels");
    console.log("CYCLES UNLOCKED ONLY SUCCESS");

    // Choosing a Pixel equips and saves it.
    if (localStorage.getItem('lp_skin') !== 'nebula') throw new Error("Picking a Pixel should save it as equipped");
    console.log("PICK EQUIPS SUCCESS");

    // A saved Pixel the player no longer has falls back to the starter.
    localStorage.setItem('lp_skin', 'thevoid');
    const stale = new Game();
    if (stale.viewParams.skinIndex !== 0) throw new Error("A locked saved Pixel should fall back to the starter");
    console.log("LOCKED SAVE FALLBACK SUCCESS");

    // Perk tags: short labels with the full stat in the tooltip.
    const tags = game.renderPerkTags(SKINS[idx('golden')].ability);
    if (!tags.includes('SPEED') || !tags.includes('GRAVITY') || !tags.includes('+10% move speed')) {
        throw new Error("Perk tags missing label or stat text: " + tags);
    }
    if (!game.renderPerkTags(SKINS[0].ability).includes('NO PERK')) {
        throw new Error("A Pixel with no perk should say so");
    }
    console.log("PERK TAGS SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
