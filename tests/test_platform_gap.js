const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// The platform spacing (CONFIG.PLATFORM_BASE_GAP, tuned by playtest) must
// stay comfortably inside a plain jump's height, or the next platform could
// be out of reach. Measured with the real Player physics, not a formula.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
try {
    const input = { keys: { left: false, right: false, buffer: 0 } };
    const floor = { x: 0, y: 700, w: CONFIG.WIDTH, h: 40 };
    const p = new Player(CONFIG.WIDTH / 2, floor.y - 26);
    for (let f = 0; f < 30 && !p.grounded; f++) p.update(1, input, [floor], []);
    assert(p.grounded, "the Pixel settles on the floor");
    const startY = p.y;
    input.keys.buffer = 6;
    let top = startY;
    for (let f = 0; f < 120; f++) {
        p.update(1, input, [floor], []);
        input.keys.buffer = 0;
        top = Math.min(top, p.y);
    }
    const rise = startY - top;
    assert(rise > 100, "a plain jump rises well off the floor: " + rise.toFixed(1));
    assert(CONFIG.PLATFORM_BASE_GAP <= rise - 10, "platform gap " + CONFIG.PLATFORM_BASE_GAP + " must leave room under a jump of " + rise.toFixed(1));
    console.log("PLATFORM GAP SUCCESS (gap " + CONFIG.PLATFORM_BASE_GAP + ", jump rises " + rise.toFixed(1) + ")");
} catch (e) {
    console.error(e);
    process.exit(1);
}
`);
