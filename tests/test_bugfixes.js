const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression coverage for a batch of gameplay fixes: off-screen platforms,
// jetpack crashes, returning drones, power-up refresh and shard value.
eval(loadGameSource() + `
function assert(cond, msg) {
    if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

const noInput = { keys: { left: false, right: false, buffer: 0 } };

try {
    // 1. A platform scrolled just below the screen must not catch a fall.
    {
        let p = new Player(100, CONFIG.HEIGHT - 20, 0);
        p.vy = 5;
        let hidden = [{ x: 0, y: CONFIG.HEIGHT + 5, w: CONFIG.WIDTH, h: 40 }];
        p.update(1, noInput, hidden, []);
        assert(!p.grounded, "off-screen platform does not catch the player");

        let q = new Player(100, CONFIG.HEIGHT - 80, 0);
        q.vy = 5;
        let visible = [{ x: 0, y: CONFIG.HEIGHT - 52, w: CONFIG.WIDTH, h: 40 }];
        q.update(1, noInput, visible, []);
        assert(q.grounded, "on-screen platform still catches the player");
    }

    // Falling past a hidden floor ends the run instead of standing on it.
    {
        let game = new Game();
        game.startGame();
        game.state.revived = true; // free revive already spent, so a fall ends the run
        game.platforms = [{ x: 0, y: CONFIG.HEIGHT + 10, w: CONFIG.WIDTH, h: 40 }];
        game.player.y = CONFIG.HEIGHT - 20;
        game.player.vy = 6;
        for (let i = 0; i < 10 && game.state.running; i++) game.update(1);
        assert(!game.state.running, "player falls off rather than landing on an invisible floor");
    }

    // 4. Jetpack into a drone: jetpack ends, drone destroyed, player lives.
    {
        let game = new Game();
        game.startGame();
        game.player.activePower = POWERS.ROCKET;
        game.player.powerTimer = POWERS.ROCKET.time;
        let d = new Drone(game.player.y, 1);
        d.v = 0;
        d.x = game.player.x;
        d.y = game.player.y - 10;
        game.enemies = [d];
        game.update(1);
        assert(game.state.running, "jetpack crash does not kill the player");
        assert(game.player.activePower === null, "jetpack ends on impact");
        assert(d.markedForDeletion, "drone is destroyed");
    }

    // Jetpack into the boss: jetpack ends, boss survives, brief immunity.
    {
        let game = new Game();
        game.startGame();
        game.player.activePower = POWERS.ROCKET;
        game.player.powerTimer = POWERS.ROCKET.time;
        let b = new BossDrone(game.player.y);
        b.x = game.player.x - 10;
        b.y = game.player.y - 10;
        b.update = function () {}; // pin it in place (it normally hovers 450px above the player)
        game.state.bossActive = true;
        game.enemies = [b];
        game.update(1);
        assert(game.state.running, "jetpack crash into the boss does not kill");
        assert(game.player.activePower === null, "jetpack ends on boss impact");
        assert(game.player.invuln > 0, "player gets brief immunity");
        assert(game.enemies.includes(b), "boss is not destroyed");
    }

    // 5. A drone that leaves comes back from the same side after a delay.
    {
        let d = new Drone(200, 1);
        d.x = CONFIG.WIDTH + 49;
        d.v = 3;
        d.update(1);
        assert(d.hidden && !d.markedForDeletion, "drone hides instead of being deleted");
        let y0 = d.y;
        let frames = 0;
        while (d.hidden && frames < 200) { d.update(1); frames++; }
        assert(frames > 30, "drone waits before returning");
        assert(!d.hidden, "drone returns");
        assert(d.x > CONFIG.WIDTH && d.v < 0, "drone re-enters from the side it left, moving inward");
        assert(Math.abs(d.y - y0) >= 30, "drone comes back at a different height");

        let s = new ShooterDrone(200, 1);
        s.x = -150; s.v = -3;
        s.update(1, null, []);
        assert(s.hidden, "shooter drone hides too");
        let shots = [];
        s.shootTimer = 0;
        s.update(1, { x: 0, y: 0, w: 26, h: 26 }, shots);
        assert(shots.length === 0, "hidden shooter drone does not fire");
    }

    // 6. A second pickup refreshes the current power instead of swapping it.
    {
        let p = new Player(100, 100, 0);
        p.activatePower();
        let first = p.activePower;
        p.powerTimer = 10;
        for (let i = 0; i < 20; i++) {
            p.activatePower();
            assert(p.activePower === first, "power is not switched");
        }
        assert(p.powerTimer === first.time * ((p.skin.ability || {}).powerDurationMult || 1), "timer is refreshed");
    }

    // 7. Shards are worth 5 gems.
    {
        let game = new Game();
        game.startGame();
        for (let i = 0; i < 200; i++) game.spawnPlatform(-100 - i * 10);
        let shards = game.powerups.filter(p => p.isShard);
        assert(shards.length > 0, "some shards spawned");
        assert(shards.every(p => p.shardValue === 5), "every shard is worth 5");
        let before = game.state.shards;
        game.powerups = [{ x: game.player.x, y: game.player.y, startY: game.player.y, w: 16, h: 16, isShard: true, shardValue: 5, markedForDeletion: false }];
        game.update(1);
        assert(game.state.shards === before + 5, "picking up a shard adds 5");
    }

    console.log("BUGFIX TESTS PASSED");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
