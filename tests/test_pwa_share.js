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
    // A checkpoint start (The Void, 5000m) is a different climb: no target,
    // and its share link isn't a challenge either.
    localStorage.setItem('lp_best_height', '20000');
    const v = new Game();
    v.challenge = { meters: 50 };
    v.equipSkin(skinIndexById('thevoid'));
    v.startGame();
    v.player.y = 400; v.player.vy = 0;
    v.update(1);
    assert(v.state.startMeters === 5000 && !v.challengeActive() && !v.state.challengeBeaten, "no instant win from a checkpoint start");
    v.gameOver();
    assert(!/beat=/.test(v.shareUrl(v.lastRun)), "a Void run shares a plain link");
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

    // ---- iPhone: browser tabs get Add to Home Screen steps, not the game.
    const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
    const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0';
    const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
    const tab = { matchMedia: () => ({ matches: false }) };
    const app = { matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) };
    assert(needsHomeScreenInstall({ userAgent: SAFARI }, tab), "iPhone Safari tab is gated");
    assert(needsHomeScreenInstall({ userAgent: INSTAGRAM }, tab), "iPhone in-app browser is gated");
    assert(!needsHomeScreenInstall({ userAgent: SAFARI, standalone: true }, tab), "the Home Screen app plays");
    assert(!needsHomeScreenInstall({ userAgent: SAFARI }, app), "display-mode standalone plays");
    assert(!needsHomeScreenInstall({ userAgent: IPAD }, tab), "iPad isn't gated");
    assert(!needsHomeScreenInstall({ userAgent: ANDROID }, tab), "Android isn't gated");
    assert(!needsHomeScreenInstall(null, null), "no navigator: not gated");
    assert(!isIOSNonSafari(SAFARI) && isIOSNonSafari(CHROME_IOS) && isIOSNonSafari(INSTAGRAM), "non-Safari browsers are told to open Safari");

    const realNav = globalThis.navigator;
    __setNav({ userAgent: CHROME_IOS });
    const gated = new Game();
    assert(gated.installGated && gated.ui.installGate.hidden === false, "the gate shows on an iPhone tab");
    assert(gated.ui.installGateSafari.hidden === false, "with the open-in-Safari step for Chrome");
    gated.startGame();
    assert(!gated.state.running, "no run can start behind the gate");
    __setNav({ userAgent: SAFARI, standalone: true });
    const installed = new Game();
    assert(!installed.installGated, "the installed app isn't gated");
    __setNav(realNav);
    console.log("IPHONE GATE SUCCESS");

    process.exit(0);
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exit(1);
}
})();
`);
