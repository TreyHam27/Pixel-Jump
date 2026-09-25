const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Save-data robustness and scoring rules:
//  - a corrupt or wrong-shaped localStorage value must not stop the game
//    from starting (it used to throw in the Game constructor);
//  - distance Pixels unlock on real height, so SCORE x2 can't unlock them
//    at half the distance;
//  - Hall of Fame entries are HTML-escaped.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

try {
    // Corrupt and wrong-shaped saves.
    localStorage.setItem('lp_achievements', '{not json');
    localStorage.setItem('lp_owned_skins', '{"chrome": true}');
    localStorage.setItem('lp_fame', '"nope"');
    localStorage.setItem('lp_ghost', '[[[');
    let g = new Game();
    assert(Array.isArray(g.achievements) && g.achievements.length >= 0, "achievements fall back to a list");
    assert(Array.isArray(g.ownedSkins) && g.ownedSkins.length === 0, "owned skins fall back to empty");
    g.startGame();
    g.update(1);
    g.state.score = 100;
    g.gameOver();
    assert(Array.isArray(JSON.parse(localStorage.getItem('lp_fame'))), "fame rewritten as a list");
    console.log("CORRUPT SAVES SUCCESS");

    // Gems used to be saved as lp_shards: carried over once, old key removed.
    localStorage.removeItem('lp_gems');
    localStorage.setItem('lp_shards', '250');
    g = new Game();
    assert(g.state.gems === 250, "old lp_shards balance carries over");
    assert(localStorage.getItem('lp_gems') === '250' && localStorage.getItem('lp_shards') === null, "migrated to lp_gems");
    console.log("SHARDS MIGRATION SUCCESS");

    // Older saves only had lp_best: real height starts from it.
    localStorage.clear && localStorage.clear();
    ['lp_best_height', 'lp_owned_skins', 'lp_achievements', 'lp_fame', 'lp_ghost'].forEach(k => localStorage.removeItem(k));
    localStorage.setItem('lp_best', '800');
    g = new Game();
    assert(g.state.bestHeight === 800, "bestHeight migrates from lp_best, got " + g.state.bestHeight);
    console.log("HEIGHT MIGRATION SUCCESS");

    // SCORE x2 doubles the score, not the unlock height.
    localStorage.setItem('lp_best', '0');
    localStorage.setItem('lp_best_height', '0');
    localStorage.setItem('lp_owned_skins', JSON.stringify(['overclock']));
    g = new Game();
    g.equipSkin(skinIndexById('overclock'));
    g.startGame();
    for (let climbed = 0; climbed < 10000; climbed += 50) {
        g.player.y = CONFIG.HEIGHT / 2;
        g.scrollCamera(50);
    }
    g.player.y = CONFIG.HEIGHT / 2; g.player.vy = 0; g.player.invuln = 1e9;
    g.update(1);
    assert(g.state.highScore >= 1990, "SCORE x2 doubles the displayed score, got " + g.state.highScore);
    assert(g.state.bestHeight >= 999 && g.state.bestHeight < 1100, "real height is ~1000m, got " + g.state.bestHeight);
    const golden = skinIndexById('golden'); // unlocks at 1400m
    assert(g.isSkinLocked(golden), "Golden (1400m) stays locked at 1000m of real climbing");
    assert(!g.achievements.includes('skin:Golden'), "no early unlock badge either");
    console.log("SCORE X2 UNLOCK SUCCESS");

    // Hall of Fame output is escaped.
    localStorage.setItem('lp_fame', JSON.stringify([
        { score: 50, skin: '<img src=x onerror=alert(1)>', date: '<b>d</b>' },
        { score: 40, skin: 'Unit 734', skinId: 'unit734', date: '1/1/2026' }
    ]));
    g = new Game();
    g.updateFameUI();
    const html = g.ui.fame.innerHTML;
    assert(!html.includes('<img') && !html.includes('<b>d'), "fame entries are escaped");
    assert(html.includes('Unit 734'), "known skins still show by name");
    console.log("FAME ESCAPE SUCCESS");

    // A co-op respawn comes back behind a HARD SHIELD.
    window.network = { myId: 'me', send() {} };
    g = new Game();
    g.startMultiplayerGame(77);
    g.player.isDead = true;
    g.mpRevive();
    assert(g.player.activePower === POWERS.SHIELD, "a co-op respawn grants HARD SHIELD");
    console.log("COOP RESPAWN SHIELD SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
