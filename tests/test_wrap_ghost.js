const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// The screen wrap is one seamless seam (x stays on screen, and you land on
// what you see of yourself across it), and the daily ghost carries its Pixel.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
try {
    const input = { keys: { left: false, right: false, buffer: 0 } };
    const p = new Player(CONFIG.WIDTH - 5, 300);
    p.vx = 8;
    p.update(1, input, [], []);
    assert(p.x >= 0 && p.x < CONFIG.WIDTH, "wrapping right lands back on screen: " + p.x);
    assert(p.x < 20, "and wraps by exactly the screen width");
    p.x = 2; p.vx = -8;
    p.update(1, input, [], []);
    assert(p.x > CONFIG.WIDTH - 20 && p.x < CONFIG.WIDTH, "wrapping left: " + p.x);

    // Straddling the right edge over a platform at the left edge: land on it.
    const q = new Player(CONFIG.WIDTH - 10, 300);
    q.vy = 4; q.vx = 0;
    const plat = { x: 0, y: 300 + q.h + 2, w: 60, h: 18 };
    q.update(1, input, [plat], []);
    assert(q.grounded && q.y === plat.y - q.h, "lands on a platform with the wrapped part");
    console.log("SEAMLESS WRAP SUCCESS");

    // The ghost remembers which Pixel ran it; old ghosts fall back.
    const g = new Game();
    g.viewParams.skinIndex = skinIndexById('matrix');
    g.state.bestHeight = 99999;
    g.startGame();
    g.ghostRec.pts = [10, -10, 20, -20, 30, -30, 40, -40];
    g.saveGhost(500);
    const saved = JSON.parse(localStorage.getItem('lp_ghost'));
    assert(saved.skin === 'matrix', "the ghost stores its skin");
    g.startGame();
    assert(g.ghostPlayback && g.ghostPlayback.skin === 'matrix', "and plays it back");
    g.state.time = 3;
    g.drawGhost(); // draws without throwing
    delete g.ghostPlayback.skin;
    g.drawGhost();
    console.log("GHOST SKIN SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
