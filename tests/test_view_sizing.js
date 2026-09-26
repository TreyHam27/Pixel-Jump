const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Screen sizing: phones get a HUD strip and a taller view (extra sky above
// the 600x800 frame), desktops a 3:4 column with the HUD beside it, and the
// taller view is only ever drawn: the game plays the same on every screen.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
try {
    // ---- Layout picker (container size in CSS px, HUD strip 88px).
    const phone = viewLayout(393, 852, 88);
    assert(phone.mode === 'strip', "portrait phone gets the strip: " + phone.mode);
    assert(phone.cssW === 393 && phone.cssH === 852 - 88, "full width, from the strip to the bottom edge");
    assert(phone.extra === Math.round(600 * 764 / 393) - 800, "extra sky fills the height: " + phone.extra);

    const tall = viewLayout(390, 2000, 88);
    assert(tall.mode === 'strip' && tall.extra === VIEW_MAX_EXTRA, "very tall screens are capped: " + tall.extra);
    assert(tall.cssH === Math.floor(390 * (800 + VIEW_MAX_EXTRA) / 600), "the canvas stops growing at the cap: " + tall.cssH);

    const mac = viewLayout(1440, 900, 88);
    assert(mac.mode === 'flank' && mac.extra === 0, "a laptop gets the flanked 3:4 column");
    assert(mac.cssH === 900 && mac.cssW === 675, "fitted to the height: " + mac.cssW + "x" + mac.cssH);

    const ipad = viewLayout(820, 1180, 88);
    assert(ipad.mode === 'overlay' && ipad.extra === 0, "an iPad is too narrow to flank: " + ipad.mode);
    const narrowWindow = viewLayout(900, 800, 88);
    assert(narrowWindow.mode === 'overlay', "a narrow desktop window keeps the HUD in the column");
    const landscapePhone = viewLayout(852, 393, 88);
    assert(landscapePhone.mode !== 'strip' && landscapePhone.extra === 0, "landscape phones get a 3:4 column");
    console.log("LAYOUT SUCCESS");

    // ---- The taller view is purely visual: the same run, with a normal and
    // the tallest view, climbs, scores and dies identically.
    const play = (extra) => {
        let seed = 12345;
        const realRandom = Math.random;
        Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        try {
            const g = new Game();
            g.renderer.viewExtra = extra;
            g.startGame();
            const trace = [];
            for (let f = 0; f < 900; f++) {
                g.input.keys.left = f % 240 < 60;
                g.input.keys.right = f % 240 >= 120 && f % 240 < 180;
                if (f % 30 === 0) g.input.keys.buffer = 6;
                g.update(1);
                if (f % 50 === 0) trace.push([Math.round(g.state.score), Math.round(g.player.y), g.player.isDead, g.platforms.length].join(','));
            }
            trace.push(g.platforms.map(p => Math.round(p.y - g.state.score)).join(','));
            return trace.join('|');
        } finally {
            Math.random = realRandom;
        }
    };
    const normal = play(0);
    assert(normal.split('|').some(t => Number(t.split(',')[0]) > 0), "the scripted run climbs (else this proves little): " + normal.slice(0, 80));
    assert(normal === play(VIEW_MAX_EXTRA), "a tall view plays exactly like a 3:4 one");
    console.log("VIEW IS VISUAL SUCCESS");

    // ---- Platforms are generated far enough ahead to fill the tallest view.
    const g = new Game();
    g.renderer.viewExtra = VIEW_MAX_EXTRA;
    g.startGame();
    const top = Math.min(...g.platforms.map(p => p.y));
    assert(top < g.renderer.viewTop, "platforms exist above the top of a tall view: " + top);
    console.log("LOOKAHEAD SUCCESS");

    // ---- Things that first appear in a tall view's extra sky fade in; on a
    // 3:4 view (or anywhere on screen already) they draw at full strength.
    const alphas = [];
    const probe = (y) => ({ y: y, h: 30, draw(ctx) { alphas.push(ctx.globalAlpha); } });
    g.state.time = 100;
    const skySpawn = probe(-200);
    g.drawFadingIn(skySpawn);
    assert(alphas.pop() === 0, "spawned in the extra sky: starts invisible");
    g.state.time = 100 + SPAWN_FADE_FRAMES / 2;
    g.drawFadingIn(skySpawn);
    assert(Math.abs(alphas.pop() - 0.5) < 1e-9, "halfway through the fade");
    g.state.time = 100 + SPAWN_FADE_FRAMES;
    g.drawFadingIn(skySpawn);
    assert(alphas.pop() === 1, "fully faded in");
    assert(g.renderer.ctx.globalAlpha === 1, "alpha is restored after drawing");
    g.drawFadingIn(probe(300));
    assert(alphas.pop() === 1, "on-screen spawns (bullets) never fade");
    g.renderer.viewExtra = 0;
    g.drawFadingIn(probe(-200));
    assert(alphas.pop() === 1, "off the top of a 3:4 view: no fade");
    console.log("SPAWN FADE SUCCESS");
} catch (e) {
    console.error(e);
    process.exit(1);
}
`);
