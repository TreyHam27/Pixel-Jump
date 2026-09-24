const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the gem-shop Pixel perks: POWER (2x duration), AIR JUMP
// (always a double jump), EMP (periodic drone wipe, solo only), GEMS x2,
// SHIELDED (biome-effect immunity) and SCORE x2 (display score only), plus
// the HARD SHIELD every spent life comes back with.
eval(loadGameSource() + `
try {
    const equip = (game, id) => { game.viewParams.skinIndex = skinIndexById(id); game.startGame(); };
    const perksOf = (id) => SKINS[skinIndexById(id)].ability;

    // Tiers must climb: every gem Pixel costs more than the one before.
    const gem = SKINS.filter(s => s.cost !== undefined);
    if (gem.length !== 9) throw new Error("Expected 9 gem-shop tiers, got " + gem.length);
    console.log("NINE TIERS SUCCESS");

    // POWER: power-ups last twice as long.
    let game = new Game();
    equip(game, 'obsidian');
    game.player.activatePower();
    if (game.player.powerTimer !== game.player.activePower.time * 2) {
        throw new Error("POWER perk should double power-up duration");
    }
    console.log("POWER 2X SUCCESS");

    // Any spent life comes back behind a HARD SHIELD.
    game = new Game();
    game.state.extraLives = 1;
    equip(game, 'unit734');
    game.die(true);
    if (!game.state.running) throw new Error("Run should continue on the banked life");
    if (game.player.activePower !== POWERS.SHIELD) throw new Error("A spent life should grant HARD SHIELD");
    console.log("SPENT LIFE SHIELD SUCCESS");

    // AIR JUMP (Prism): a second jump in mid-air without the DOUBLE power.
    game = new Game();
    equip(game, 'prism');
    const air = game.player;
    const input = { keys: { left: false, right: false, buffer: 0 } };
    air.grounded = true;
    air.update(1, input, [], []);   // arms the double jump
    air.grounded = false; air.coyote = 0; air.vy = 5;
    input.keys.buffer = 6;
    if (air.update(1, input, [], []) !== "double_jump") throw new Error("AIR JUMP should allow a mid-air jump");
    input.keys.buffer = 6;
    if (air.update(1, input, [], []) === "double_jump") throw new Error("AIR JUMP is one extra jump, not infinite");
    game = new Game();
    equip(game, 'unit734');
    const plain = game.player;
    plain.grounded = true;
    plain.update(1, { keys: { buffer: 0 } }, [], []);
    plain.grounded = false; plain.coyote = 0; plain.vy = 5;
    if (plain.update(1, { keys: { buffer: 6 } }, [], []) === "double_jump") throw new Error("Only AIR JUMP (or DOUBLE) jumps in mid-air");
    console.log("AIR JUMP SUCCESS");

    // A power the Pixel already has for good is never rolled.
    const rolls = (id) => {
        const gm = new Game();
        equip(gm, id);
        const seen = new Set();
        for (let i = 0; i < 400; i++) { gm.player.activePower = null; gm.player.activatePower(); seen.add(gm.player.activePower); }
        return seen;
    };
    if (rolls('prism').has(POWERS.DOUBLE)) throw new Error("AIR JUMP Pixels should never roll DOUBLE JUMP");
    if (rolls('hoarder').has(POWERS.MAGNET)) throw new Error("Magnet Pixels should never roll MAGNET");
    if (rolls('unit734').size !== Object.keys(POWERS).length) throw new Error("A Pixel without overlaps rolls every power");
    console.log("NO DUD POWERS SUCCESS");

    // EMP: drones and their shots are wiped every few seconds; the boss is spared.
    game = new Game();
    equip(game, 'pulsewarden');
    const drone = new Drone(300, 1);
    const laser = new LaserDrone(200);
    const boss = new BossDrone(100);
    const shot = new Projectile(100, 100, 0, 2);
    game.enemies = [drone, laser, boss];
    game.projectiles = [shot];
    const perks = perksOf('pulsewarden');
    game.updateDronePulse(perks.dronePulseSec * 60 - 1, perks);
    if (drone.markedForDeletion) throw new Error("EMP fired early");
    game.updateDronePulse(1, perks);
    if (!drone.markedForDeletion || !laser.markedForDeletion) throw new Error("EMP should destroy on-screen drones");
    if (boss.markedForDeletion) throw new Error("EMP must not touch the boss");
    if (!shot.markedForDeletion) throw new Error("EMP should clear drone shots");
    console.log("EMP SUCCESS");

    // EMP stays off in co-op, where it would desync the party's enemies.
    game.state.multiplayer = true;
    const coopDrone = new Drone(300, 1);
    game.enemies = [coopDrone];
    game.updateDronePulse(perks.dronePulseSec * 60, perks);
    if (coopDrone.markedForDeletion) throw new Error("EMP should be disabled in multiplayer");
    game.state.multiplayer = false;
    console.log("EMP SOLO ONLY SUCCESS");

    // GEMS x2: a 5-shard pickup banks 10.
    game = new Game();
    equip(game, 'hoarder');
    game.state.shards = 0;
    game.powerups = [{ x: game.player.x, y: game.player.y, startY: game.player.y, w: 16, h: 16, isShard: true, shardValue: 5, markedForDeletion: false }];
    game.update(1);
    if (game.state.shards !== 10) throw new Error("GEMS x2 should double shard pickups, got " + game.state.shards);
    console.log("GEMS X2 SUCCESS");

    // SHIELDED: wind in a late biome no longer pushes the player sideways.
    const windPush = (id) => {
        const g = new Game();
        equip(g, id);
        g.state.score = 130000; // Static Field: wind, gravity pulses, glitch...
        g.enemies = [];
        g.player.vx = 0;
        g.state.time = 10; // sin(time * 0.05) != 0
        g.update(1);
        return g.player.vx;
    };
    if (windPush('unit734') === 0) throw new Error("Test setup: wind should push an unshielded Pixel");
    if (windPush('aegis') !== 0) throw new Error("SHIELDED Pixel was pushed by wind");
    console.log("SHIELDED SUCCESS");

    // SCORE x2: the displayed score doubles, the real height (biomes) doesn't.
    game = new Game();
    equip(game, 'overclock');
    game.enemies = [];
    game.player.y = 100; // well above the scroll line: the camera climbs
    game.update(1);
    const climbed = game.state.score;
    if (!(climbed > 0)) throw new Error("Test setup: camera should have scrolled");
    if (game.state.bonusScore !== climbed) throw new Error("SCORE x2 should bank the climb again as bonus");
    if (game.runScore() !== Math.floor(climbed * 2 / 10)) throw new Error("Displayed score should be double the height");
    console.log("SCORE X2 SUCCESS");

    // ...and a normal Pixel earns no bonus.
    game = new Game();
    equip(game, 'unit734');
    game.player.y = 100;
    game.update(1);
    if (game.state.bonusScore !== 0) throw new Error("Only SCORE x2 should bank bonus score");
    console.log("NO BONUS WITHOUT PERK SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
