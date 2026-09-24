const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// The boss used to snap to 450px above the player every frame, before the
// collision check, so it could never be stomped: from 4000m every run had an
// unkillable boss that also stopped drone spawns. It now telegraphs a dive to
// the player's level and sits there exposed. This test has a simple bot play
// the fight at several frame rates and checks the reward bookkeeping.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function seedRandom(seed) {
    let s = seed;
    Math.random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const FLOOR_Y = 700;

// Plays one boss fight with a scripted player on a fixed floor. Returns what
// happened. Volleys are cleared every tick: this checks the stomp loop is
// reachable, not the bot's dodging of bullets.
function fight(dt) {
    seedRandom(1234);
    localStorage.removeItem('lp_loops');
    const g = new Game();
    g.startGame();
    g.state.score = 40000; // 4000m: the first boss is due
    const keys = g.input.keys;
    let boss = null, killedAt = null, scoreAtKill = null;
    const shardsBefore = g.state.shards;
    const origDefeat = g.onBossDefeated.bind(g);
    g.onBossDefeated = () => {
        scoreAtKill = g.state.score;
        origDefeat();
        killedAt = Math.floor(g.state.score / 10);
    };

    const maxSteps = Math.ceil(4 * 60 * 60 / dt); // 4 minutes of game time
    for (let step = 0; step < maxSteps && g.state.running; step++) {
        g.platforms = [{ x: 0, y: FLOOR_Y, w: CONFIG.WIDTH, h: 40 }];
        g.projectiles = [];
        g.powerups = [];
        if (!boss) boss = g.enemies.find(e => e instanceof BossDrone) || null;

        keys.left = keys.right = false;
        if (boss && !boss.markedForDeletion) {
            const p = g.player;
            const pc = p.x + p.w / 2;
            const bc = boss.x + boss.w / 2;
            if (boss.state === 'telegraph' || boss.state === 'dive') {
                // Get out of the lane it's about to come down in.
                const laneC = boss.laneX + boss.w / 2;
                const safeX = laneC > CONFIG.WIDTH / 2 ? 40 : CONFIG.WIDTH - 40;
                if (Math.abs(pc - safeX) > 6) { if (pc < safeX) keys.right = true; else keys.left = true; }
            } else if (boss.state === 'exposed' && boss.invuln <= 0) {
                // Walk up to it, hop, and steer onto its top.
                const gap = pc < bc ? boss.x - (p.x + p.w) : p.x - (boss.x + boss.w);
                if (p.grounded && gap < 40) keys.buffer = 6;
                if (!p.grounded || gap >= 40) { if (pc < bc) keys.right = true; else keys.left = true; }
            }
        }

        g.update(dt);
        if (killedAt !== null) break;
    }
    return { g, boss, killedAt, scoreAtKill, shardsBefore };
}

try {
    for (const dt of [1, 0.5, 2]) {
        const r = fight(dt);
        assert(r.boss, "a boss should spawn at 4000m (dt " + dt + ")");
        assert(r.killedAt !== null, "the bot should beat the boss (dt " + dt + "), boss hp " + r.boss.hp + ", state " + r.boss.state);
        assert(r.g.state.running, "the bot should survive the fight (dt " + dt + ")");
        assert(r.g.state.runLoops === 1, "one boss beaten this run");
        assert(localStorage.getItem('lp_loops') === '1', "lifetime loop count saved");
        assert(r.g.state.bonusScore === BOSS_BONUS_METERS * 10, "bonus distance banked: " + r.g.state.bonusScore);
        assert(r.g.state.shards === r.shardsBefore + BOSS_GEM_BOUNTY, "gem bounty paid");
        assert(r.g.state.score === r.scoreAtKill, "no warp: the camera height doesn't jump");
        assert(r.g.state.nextBossAt === r.killedAt + CONFIG.BOSS_LOOP_DISTANCE, "next boss a full loop later");
        r.g.update(1);
        assert(!r.g.state.bossActive, "no boss chain right after the kill");
        console.log("BOSS BEATEN AT dt=" + dt);
    }

    // HARD SHIELD absorbs a crash into the boss; it doesn't one-shot it.
    {
        const g = new Game();
        g.startGame();
        const b = new BossDrone(0);
        b.update = function () {};
        b.state = 'hover';
        b.x = g.player.x - 20; b.y = g.player.y - 20;
        g.enemies = [b];
        g.state.bossActive = true;
        g.player.activePower = POWERS.SHIELD; g.player.powerTimer = 600;
        g.player.vy = -5;
        g.update(1); g.update(1);
        assert(g.enemies.includes(b) && b.hp === b.maxHp && !b.markedForDeletion, "boss survives a shield crash");
        assert(g.state.running && g.player.activePower === null && g.player.invuln > 0, "shield is spent, player protected");
        console.log("SHIELD VS BOSS SUCCESS");
    }

    // A hit only lands once per invulnerability window.
    {
        const b = new BossDrone(0);
        const ps = new ParticleSystem();
        assert(b.takeDamage(ps) === true && b.takeDamage(ps) === false && b.hp === b.maxHp - 1, "double stomp counts once");
        console.log("HIT INVULN SUCCESS");
    }

    // Camera scroll keeps an exposed boss anchored in the world.
    {
        const g = new Game();
        g.startGame();
        const b = new BossDrone(300);
        b.state = 'exposed'; b.anchorY = 300; b.y = 300;
        g.enemies = [b];
        const worldY = b.y - g.state.score, worldAnchor = b.anchorY - g.state.score;
        g.scrollCamera(57);
        assert(b.y - g.state.score === worldY && b.anchorY - g.state.score === worldAnchor, "boss moves with the world");
        console.log("BOSS SCROLL SUCCESS");
    }

    // A checkpoint start at 5000m (The Void) doesn't open straight into a boss.
    {
        localStorage.setItem('lp_best', '20000');
        const g = new Game();
        g.equipSkin(skinIndexById('thevoid'));
        g.startGame();
        assert(g.state.startMeters === 5000, "The Void starts at 5000m");
        for (let i = 0; i < 60; i++) { g.player.y = 400; g.player.vy = 0; g.update(1); }
        assert(!g.state.bossActive && g.state.nextBossAt === 9000, "first boss at 9000m, not immediately");
        console.log("VOID START SUCCESS");
    }
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
