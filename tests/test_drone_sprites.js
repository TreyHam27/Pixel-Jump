const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// The drone and boss sprites are drawn with plain canvas calls every frame.
// A glow or alpha left set would bleed onto everything drawn after them, and
// the animation has to run on each enemy's own dt clock (so TIME WARP slows
// it, pause freezes it, and co-op guests animate the enemies they mirror).
eval(loadGameSource() + `
function assert(cond, msg) {
    if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

// A canvas context that records every rect and circle.
function recordingCtx() {
    const calls = [];
    const ctx = {
        fillStyle: '', strokeStyle: '', shadowBlur: 0, shadowColor: '', globalAlpha: 1, lineWidth: 1,
        calls,
        fillRect(...a) { calls.push(['fillRect', ctx.fillStyle, ...a]); },
        arc(...a) { calls.push(['arc', ...a]); },
        beginPath() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}
    };
    return ctx;
}

function drawChecked(e, label) {
    const ctx = recordingCtx();
    const box = [e.x, e.y, e.w, e.h].join();
    e.draw(ctx);
    assert(ctx.shadowBlur === 0, label + ": shadowBlur left at " + ctx.shadowBlur);
    assert(ctx.globalAlpha === 1, label + ": globalAlpha left at " + ctx.globalAlpha);
    for (const c of ctx.calls) {
        const nums = c.filter(v => typeof v === 'number');
        assert(nums.every(Number.isFinite), label + ": non-finite draw args " + JSON.stringify(c));
    }
    assert([e.x, e.y, e.w, e.h].join() === box, label + ": drawing moved the hitbox");
    return ctx.calls;
}

try {
    // Every enemy draws cleanly in every state.
    const drone = new Drone(200, 1);
    drone.x = 100;
    drone.v = 3; assert(drawChecked(drone, "drone right").length > 0, "drone draws something");
    drone.v = -3; drawChecked(drone, "drone left");
    drone.hidden = true;
    assert(drawChecked(drone, "drone hidden").length === 0, "a hidden drone draws nothing");

    const shooter = new ShooterDrone(200, 1);
    shooter.x = 100;
    shooter.shootTimer = 60; const idle = drawChecked(shooter, "shooter idle");
    shooter.shootTimer = 10; const charging = drawChecked(shooter, "shooter charging");
    assert(charging.some(c => c[1] === '#ffffff') && !idle.some(c => c[1] === '#ffffff'),
        "the shooter's muzzle turns white only while it charges");

    const laser = new LaserDrone(300);
    laser.update(1);
    drawChecked(laser, "laser cooldown");
    const bodyX = laser.x;
    laser.phase = 'telegraph';
    laser.timer = 1;
    const tele = drawChecked(laser, "laser telegraph");
    const band = tele.find(c => c[0] === 'fillRect' && c[2] === 0 && c[4] === CONFIG.WIDTH);
    assert(band, "telegraph draws a full-width warning band");
    laser.update(1);
    assert(laser.phase === 'firing', "laser fires after the telegraph");
    assert(band[3] === Math.round(laser.y) && band[5] === laser.h,
        "the warning band covers the beam's rect: band y/h " + band[3] + "/" + band[5] + ", beam " + laser.y + "/" + laser.h);
    const firing = drawChecked(laser, "laser firing");
    // The body stays drawn where it was, not at the beam's x = 0.
    assert(firing.some(c => c[0] === 'fillRect' && c[2] === Math.round(bodyX) + 2), "the laser body is still drawn while it fires");

    // A guest that only ever saw the laser mid-beam still draws a body.
    const guestLaser = new LaserDrone(300);
    guestLaser.phase = 'firing';
    guestLaser.x = 0; guestLaser.w = CONFIG.WIDTH; guestLaser.h = 8;
    drawChecked(guestLaser, "guest laser firing");

    for (const state of BOSS_STATES) {
        const boss = new BossDrone(300);
        boss.state = state;
        boss.laneX = 200; boss.anchorY = 400;
        drawChecked(boss, "boss " + state);
        boss.hp = 3; drawChecked(boss, "raging boss " + state);
        boss.invuln = 5; boss.t = 0; drawChecked(boss, "flashing boss " + state);
        boss.hp = 0; drawChecked(boss, "dead boss " + state);
    }
    const volley = new BossDrone(300);
    volley.state = 'hover';
    volley.hp = 10; const three = drawChecked(volley, "boss cannons");
    volley.hp = 3; const five = drawChecked(volley, "raging boss cannons");
    assert(five.length > three.length, "a raging boss grows extra cannons");
    console.log("SPRITE DRAW SUCCESS");

    // Animation runs on each enemy's own clock, which scales with dt.
    for (const make of [() => new Drone(200, 1), () => new ShooterDrone(200, 1), () => new LaserDrone(300)]) {
        const a = make(), b = make();
        a.update(1, null, []);
        b.update(0.5, null, []); b.update(0.5, null, []);
        assert(a.t === 1 && b.t === 1, a.constructor.name + " clock scales with dt: " + a.t + " vs " + b.t);
    }

    // ...and only on that clock: the wall clock doesn't move anything.
    const still = new Drone(200, 1);
    still.x = 100; still.t = 17;
    const realNow = Date.now;
    Date.now = () => 1000;
    const first = JSON.stringify(drawChecked(still, "drone at t=17"));
    Date.now = () => 987654;
    const second = JSON.stringify(drawChecked(still, "drone at t=17 again"));
    Date.now = realNow;
    assert(first === second, "a drone's pose depends only on its own clock");
    still.t = 40;
    assert(JSON.stringify(drawChecked(still, "drone at t=40")) !== first, "the rotors move as the clock runs");

    // Co-op guests don't run update() on mirrored enemies; followNetEnemy
    // advances their clock instead.
    const game = new Game();
    game.startGame();
    const mirrored = new Drone(200, 1);
    mirrored.net = { x: mirrored.x, wy: 200 - game.state.score, v: 0, t: game.state.time };
    game.followNetEnemy(mirrored, 1);
    assert(mirrored.t === 1, "a guest's mirrored drone animates");

    console.log("SPRITE CLOCK SUCCESS");
} catch (e) {
    console.error(e);
    process.exit(1);
}
`);
