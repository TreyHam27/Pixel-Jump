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
        classList: { add() {}, remove() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {},
        appendChild() {}, closest() { return null; },
        dataset: {}, disabled: false, offsetWidth: 0,
        innerText: '', innerHTML: '', textContent: '', value: '',
        getContext() { return makeMockContext(); },
        focus() {}, blur() {}
    };
}

function setupMocks() {
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
    global.document = {
        getElementById: () => makeMockElement(),
        createElement: () => makeMockElement(),
        body: makeMockElement()
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
        .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))
        .join('\n')
        .replace(/window\.onload[\s\S]*$/, '');
}

module.exports = { setupMocks, loadGameSource };
