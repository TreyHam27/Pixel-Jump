const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// The REVIVE perk is gone (hearts are the only lives). Aegis now starts
// every run behind a HARD SHIELD, and Static King is fast and SHIELDED.
eval(loadGameSource() + `
try {
    const assert = (c, m) => { if (!c) throw new Error(m); };
    assert(!PERKS.some(p => p.key === 'extraRevive'), "the REVIVE perk is gone");
    assert(!SKINS.some(s => s.ability.extraRevive), "no Pixel has a free revive");

    const king = SKINS[skinIndexById('staticking')].ability;
    assert(king.speedMult === 1.25 && king.biomeImmune, "Static King: +25% speed and SHIELDED");
    assert(skinPerks(king).map(p => p.perk.label).join() === 'SPEED,SHIELDED', "Static King's tags");
    const aegis = SKINS[skinIndexById('aegis')].ability;
    assert(skinPerks(aegis).map(p => p.perk.label).includes('SHIELD START'), "Aegis shows SHIELD START");

    // Aegis: every run (solo and co-op) opens with HARD SHIELD.
    const game = new Game();
    game.state.bestHeight = 99999;
    game.ownedSkins.push('aegis');
    game.viewParams.skinIndex = skinIndexById('aegis');
    game.startGame();
    assert(game.player.activePower === POWERS.SHIELD, "Aegis starts a solo run shielded");
    game.startGame();
    assert(game.player.activePower === POWERS.SHIELD, "...and every run after");
    window.network = { myId: 'me', send() {} };
    game.startMultiplayerGame(5);
    assert(game.player.activePower === POWERS.SHIELD, "...and co-op runs too");
    console.log("AEGIS START SHIELD SUCCESS");

    // Other Pixels don't.
    game.viewParams.skinIndex = skinIndexById('staticking');
    game.startGame();
    assert(game.player.activePower === null, "Static King starts without a power-up");
    game.state.extraLives = 0;
    game.die(true);
    assert(!game.state.running, "Static King has no free revive: out of hearts ends the run");
    console.log("STATIC KING NO REVIVE SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
