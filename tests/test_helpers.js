const fs = require('fs');
const path = require('path');

// Minimal headless DOM/browser shim sufficient to load and run the game's
// update loop outside a browser (no rendering is verified, only game logic).
function makeMockContext() {
    return {
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left',
        shadowBlur: 0, shadowColor: '', globalAlpha: 1,
        fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, arc() {}, fillText() {}, save() {}, restore() {},
        createRadialGradient() { return { addColorStop() {} }; }
    };
}

function makeMockElement() {
    return {
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        addEventListener() {}, removeEventListener() {},
        appendChild() {}, closest() { return null; },
        dataset: {}, disabled: false, offsetWidth: 0,
        innerText: '', innerHTML: '', textContent: '', value: '',
        getContext() { return makeMockContext(); },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        focus() {}, blur() {}
    };
}

// The game's UI timers (alert auto-hide, achievement pops, respawn countdowns,
// network watchdogs) would otherwise keep node alive for seconds after a test
// finishes. Tests never wait on them, so let them lapse; a test that really
// needs to wait uses sleep(), which keeps the process alive.
const realSetTimeout = setTimeout;
function sleep(ms) { return new Promise(r => realSetTimeout(r, ms)); }
function unrefTimers() {
    for (const name of ['setTimeout', 'setInterval']) {
        const real = global[name];
        global[name] = (...args) => {
            const t = real(...args);
            if (t && typeof t.unref === 'function') t.unref();
            return t;
        };
    }
}

// Async tests (ones that await timers) pass { realTimers: true }: with
// unref'd timers node could run out of work mid-test and exit 0 silently.
// They should also call failIfUnfinished() and end with process.exit().
function setupMocks(opts = {}) {
    if (!opts.realTimers) unrefTimers();
    const store = {};
    global.localStorage = {
        getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };

    global.window = {
        innerWidth: 1200, innerHeight: 800,
        addEventListener() {}, removeEventListener() {},
        network: null
    };
    global.location = { hostname: 'localhost' };
    global.document = {
        getElementById: () => makeMockElement(),
        createElement: () => makeMockElement(),
        body: makeMockElement(),
        addEventListener() {}, removeEventListener() {},
        hidden: false,
        activeElement: null
    };
    global.performance = { now: () => 1000 };
    global.requestAnimationFrame = () => {};
    global.Image = class {};
    global.Audio = class { play() {} };
}

// Concatenates every game source file (in the same load order as index.html)
// into one string, minus the browser-only window.onload bootstrap, so that
// all classes land in a single eval scope and can see each other.
function loadGameSource() {
    const files = [
        'js/config.js',
        'js/sounds.js',
        'js/background.js',
        'js/input.js',
        'js/renderer.js',
        'js/entities.js',
        'js/ads.js',
        'js/network.js',
        'app.js'
    ];
    return files
        .map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
        .join('\n')
        .replace(/window\.onload[\s\S]*$/, '');
}

// For async tests that finish with process.exit(): if node instead runs out
// of work first (a promise that never settled), fail loudly rather than
// exiting 0 as if everything passed.
function failIfUnfinished() {
    process.on('beforeExit', () => {
        console.error("FAILED: the test exited before finishing (a promise never settled)");
        process.exit(1);
    });
}

module.exports = { setupMocks, loadGameSource, sleep, failIfUnfinished };
