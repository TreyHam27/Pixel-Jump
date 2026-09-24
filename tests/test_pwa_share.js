const fs = require('fs');
const path = require('path');
const { setupMocks, loadGameSource, failIfUnfinished } = require('./test_helpers');

setupMocks({ realTimers: true });
failIfUnfinished();
// Node has a read-only built-in navigator; swap it for each case.
global.__setNav = (nav) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });

// Install/offline files, link-preview tags, challenge links, sharing, the
// touch pads and HiDPI sizing.
const root = path.join(__dirname, '..');
global.__read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
global.__exists = (f) => fs.existsSync(path.join(root, f));

eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
try {
    // ---- Manifest: valid, and every icon exists.
    const manifest = JSON.parse(__read('manifest.webmanifest'));
    assert(manifest.name && manifest.start_url === './' && manifest.display === 'standalone', "manifest basics");
    assert(manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'), "installable icon sizes");
    assert(manifest.icons.some(i => i.purpose === 'maskable'), "maskable icon");
    for (const icon of manifest.icons) assert(__exists(icon.src), "missing icon " + icon.src);
    console.log("MANIFEST SUCCESS");

    // ---- Service worker: same version as the game, shell files exist.
    const sw = __read('sw.js');
    const swVersion = (sw.match(/const VERSION = '([^']+)'/) || [])[1];
    assert(swVersion === GAME_VERSION, "sw.js VERSION (" + swVersion + ") must match GAME_VERSION (" + GAME_VERSION + ")");
    const shellBlock = (sw.match(/const SHELL = \\[([\\s\\S]*?)\\];/) || [])[1] || '';
    const shell = [...shellBlock.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
    assert(shell.length >= 15, "shell list found (" + shell.length + ")");
    for (const f of shell) assert(__exists(f.replace(/\\?v=$/, '')), "service worker caches a missing file: " + f);
    console.log("SERVICE WORKER SUCCESS");

    // ---- index.html: install + preview tags with absolute URLs, local PeerJS.
    const html = __read('index.html');
    for (const needle of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="theme-color"', 'name="description"',
        'property="og:image" content="https://', 'name="twitter:card" content="summary_large_image"', 'rel="canonical" href="https://']) {
        assert(html.includes(needle), "index.html should include " + needle);
    }
    assert(__exists('og-image.png'), "og image exists");
    assert(!/unpkg\\.com/.test(html) && html.includes('js/vendor/peerjs.min.js'), "PeerJS is served locally");
    console.log("HEAD TAGS SUCCESS");

    // ---- Challenge links only count on their own day.
    assert(JSON.stringify(parseChallenge('?beat=1234&d=20260923', 20260923)) === '{"meters":1234}', "valid link");
    assert(parseChallenge('?beat=1234&d=20260922', 20260923) === null, "another day's link is ignored");
    assert(parseChallenge('?beat=abc&d=20260923', 20260923) === null, "junk is ignored");
    assert(parseChallenge('', 20260923) === null, "no link, no challenge");
    const g = new Game();
    g.challenge = { meters: 50 };
    g.startGame();
    assert(g.challengeActive() && g.ui.challengeHud.hidden === false, "target shown on today's solo run");
    const alerts = [];
    g.showAlert = t => alerts.push(t);
    g.state.score = 600; g.player.y = 400; g.player.vy = 0;
    g.update(1);
    assert(g.state.challengeBeaten && alerts.includes('TARGET BEATEN!'), "beating it is announced once");
    window.network = { myId: 'me', send() {} };
    const mp = new Game();
    mp.challenge = { meters: 50 };
    mp.startMultiplayerGame(99);
    assert(!mp.challengeActive(), "no challenge in co-op");
    console.log("CHALLENGE SUCCESS");

    // ---- Share: today's solo run links to its challenge; clipboard fallback.
    g.state.score = 12340;
    g.gameOver();
    assert(g.lastRun && g.lastRun.score === 1234, "last run remembered");
    const url = g.shareUrl(g.lastRun);
    assert(url === SITE_URL + '?beat=1234&d=' + g.getDailySeed(), "challenge link, got " + url);
    let copied = null;
    __setNav({ clipboard: { writeText: async (t) => { copied = t; } } });
    await g.shareRun();
    assert(copied && copied.includes('1,234m') && copied.includes('?beat=1234'), "copied the challenge: " + copied);
    assert(g.ui.shareToast.innerText === 'LINK COPIED!', "toast confirms the copy");
    let shared = null;
    __setNav({ share: async (d) => { shared = d; } });
    await g.shareRun();
    assert(shared && shared.url.includes('?beat=1234'), "Web Share gets the link");
    __setNav({ share: async () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; } });
    g.ui.shareToast.innerText = '';
    await g.shareRun();
    assert(g.ui.shareToast.innerText === '', "cancelling the share sheet says nothing");
    console.log("SHARE SUCCESS");

    // ---- Touch pads: phones only, during a live run, and switchable.
    const t = new Game();
    t.coarsePointer = true;
    t.startGame();
    assert(t.ui.touchControls.hidden === false, "pads show on a phone run");
    t.pauseGame();
    assert(t.ui.touchControls.hidden === true, "hidden under the pause menu");
    t.resumeGame();
    t.settings.touchControls = false;
    t.applySettings();
    assert(t.ui.touchControls.hidden === true, "the setting hides them");
    const desk = new Game();
    desk.coarsePointer = false;
    desk.startGame();
    assert(desk.ui.touchControls.hidden === true, "never on desktop");
    console.log("TOUCH PADS SUCCESS");

    // ---- HiDPI: the backing store follows devicePixelRatio (capped at 2).
    window.devicePixelRatio = 3;
    const r = new Renderer();
    assert(r.canvas.width === CONFIG.WIDTH * 2 && r.canvas.height === CONFIG.HEIGHT * 2 && r.dpr === 2, "2x backing store");
    window.devicePixelRatio = 1;
    r.resize();
    assert(r.canvas.width === CONFIG.WIDTH && r.dpr === 1, "1x on a normal screen");
    console.log("HIDPI SUCCESS");

    process.exit(0);
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exit(1);
}
})();
`);
