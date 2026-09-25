const { setupMocks, loadGameSource } = require('./test_helpers');
const fs = require('fs');
const path = require('path');

setupMocks();
global.__sounds = fs.readFileSync(path.join(__dirname, '..', 'js', 'sounds.js'), 'utf8');
global.__app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Heart pickups (only for a player with no hearts), spare lives in
// co-op, the drone cap and the power-up ramp.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
try {
    // ---- Hearts are part of the level whatever your lives: the layout
    // (and every pickup) is identical at 0 and at 2 hearts.
    const layout = (lives) => {
        const g = new Game();
        g.state.hearts = lives;
        g.startGame();
        for (let i = 0; i < 600; i++) g.spawnPlatform(-1000 - i * 95);
        return JSON.stringify({ p: g.platforms.map(p => [p.x, p.y, p.w]), u: g.powerups.map(p => [p.x, p.y, !!p.isHeart, !!p.isGem]) });
    };
    assert(layout(0) === layout(2), "hearts don't change the generated level");
    console.log("HEART DETERMINISM SUCCESS");

    // ---- Findable but rarer than power-ups, never two within a screen of
    // each other, and thinning out with height.
    let g = new Game();
    g.startGame();
    g.powerups = [];
    for (let i = 0; i < 4000; i++) g.spawnPlatform(-1000 - i * 95);
    const heartWYs = g.powerups.filter(p => p.isHeart).map(p => p.startY - g.state.score);
    const powers = g.powerups.filter(p => !p.isHeart && !p.isGem).length;
    assert(heartWYs.length > 20 && heartWYs.length < powers, "hearts are findable but rarer than power-ups (" + heartWYs.length + " vs " + powers + ")");
    for (let i = 1; i < heartWYs.length; i++) {
        assert(heartWYs[i - 1] - heartWYs[i] >= HEART_MIN_GAP, "hearts are at least HEART_MIN_GAP apart");
    }
    assert(HEART_MIN_GAP > CONFIG.HEIGHT, "so two can never be on screen together");
    const inBand = (lo, hi) => heartWYs.filter(wy => -wy / 10 >= lo && -wy / 10 < hi).length;
    assert(inBand(0, 4000) > inBand(8000, 12000), "fewer hearts high up (" + inBand(0, 4000) + " vs " + inBand(8000, 12000) + ")");
    console.log("HEART RARITY SUCCESS");

    // ---- Only visible and collectible at 0 lives.
    g = new Game();
    g.state.hearts = 1;
    g.startGame();
    const heart = () => ({ x: g.player.x, y: g.player.y, startY: g.player.y, w: 20, h: 20, isHeart: true, isGem: false, markedForDeletion: false });
    g.powerups = [heart()];
    assert(g.visiblePickups().length === 0, "hearts are hidden while you have a life");
    g.update(1);
    assert(g.state.hearts === 1 && g.powerups.length === 1, "a hidden heart can't be collected");
    g.state.hearts = 0;
    g.powerups = [heart()];
    g.update(1);
    assert(g.state.hearts === 1, "a heart at 0 lives gives a life");
    assert(localStorage.getItem('lp_hearts') === '1', "the new life is saved");
    assert(g.ui.lifeDisplay.innerText === '1 ❤️', "the hearts counter updates");
    assert(g.powerups.length === 0, "the heart is used up");
    console.log("HEART PICKUP SUCCESS");

    // ---- Killing a boss refills the hearts (solo; co-op is in
    // test_mp_enemies.js).
    g = new Game();
    g.startGame();
    g.state.hearts = 0;
    g.onBossDefeated();
    assert(g.state.hearts === MAX_HEARTS, "a boss kill refills the hearts");
    assert(localStorage.getItem('lp_hearts') === String(MAX_HEARTS), "and saves them");
    assert(g.ui.lifeDisplay.innerText === MAX_HEARTS + ' ❤️', "the meter shows them");
    console.log("BOSS REFILL SUCCESS");

    // ---- Hearts and power-ups each have their own sound.
    assert(/case 'heart':/.test(__sounds) && /case 'power':/.test(__sounds), "heart and power sounds exist");
    assert(__app.includes("sounds.play('heart')") && __app.includes("sounds.play('power')"), "and are played");
    console.log("SOUNDS SUCCESS");

    // ---- Co-op: banked hearts save you instantly, behind a HARD SHIELD,
    // without ever telling the party you died.
    const sent = [];
    window.network = { myId: 'me', send(m) { sent.push(m); } };
    localStorage.setItem('lp_hearts', '2');
    g = new Game();
    g.startMultiplayerGame(77);
    g.die(true);
    assert(!g.player.isDead && g.state.hearts === 1, "a banked heart saves you");
    assert(g.player.activePower === POWERS.SHIELD, "a co-op rescue grants HARD SHIELD");
    g.player.activePower = null;
    g.die(true);
    assert(!g.player.isDead && g.state.hearts === 0, "then the next one");
    assert(g.player.activePower === POWERS.SHIELD, "with a HARD SHIELD again");
    assert(!sent.some(m => m.type === 'die'), "a saved player never reports a death");
    g.die(true);
    assert(g.player.isDead && sent.some(m => m.type === 'die'), "out of lives: down as before");
    g.stopRespawnTimer();
    console.log("COOP SPARE LIVES SUCCESS");

    // ---- Drones are capped by height, and the cap grows as you climb.
    for (const meters of [500, 8000]) {
        g = new Game();
        g.startGame();
        g.state.score = meters * 10;
        g.state.nextBossAt = 1e9; // no boss (it pauses drone spawning)
        let most = 0;
        for (let i = 0; i < 6000; i++) {
            g.player.y = 400; g.player.vy = 0; g.player.invuln = 1e9;
            g.update(1);
            most = Math.max(most, g.countEnemies(Drone));
        }
        assert(most <= g.droneCap(meters), meters + "m: at most " + g.droneCap(meters) + " drones, saw " + most);
        assert(most === g.droneCap(meters), meters + "m: the cap is reached");
    }
    assert(new Game().droneCap(0) === 2 && new Game().droneCap(20000) === CONFIG.DRONE_CAP_MAX, "cap runs from 2 to the max");
    console.log("DRONE CAP SUCCESS");

    // ---- Power-ups get more common the higher you climb.
    const powersAt = (meters) => {
        const game = new Game();
        game.startGame();
        game.powerups = [];
        for (let i = 0; i < 3000; i++) game.spawnPlatform(-meters * 10 - i * 95 / 10);
        return game.powerups.filter(p => !p.isHeart && !p.isGem).length;
    };
    const low = powersAt(0), high = powersAt(9000);
    assert(high > low * 1.5, "more power-ups high up (" + low + " at 0m, " + high + " at 9000m)");
    console.log("POWER-UP RAMP SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
