const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for the multiplayer desync bug: host and guest must
// generate an identical platform layout from the same shared seed, since
// the network sync protocol sends absolute world coordinates that only
// make sense if both sides built the same level.
eval(loadGameSource() + `
try {
    const sharedSeed = 55555;

    const host = new Game();
    host.state.isHost = true;
    host.startMultiplayerGame(sharedSeed);

    const guest = new Game();
    guest.state.isHost = false;
    guest.startMultiplayerGame(sharedSeed);

    // The initial platform batch alone isn't a strong enough check: it's built
    // from getDailySeed() before any multiplayer-seed handling even runs, so it
    // matches by coincidence regardless of the bug. Simulate ongoing play by
    // spawning more platforms (as the real update loop does while climbing) —
    // this is where a desynced RNG state actually diverges.
    for (let i = 0; i < 20; i++) {
        host.spawnPlatform(host.platforms[host.platforms.length - 1].y - CONFIG.PLATFORM_BASE_GAP);
        guest.spawnPlatform(guest.platforms[guest.platforms.length - 1].y - CONFIG.PLATFORM_BASE_GAP);
    }

    // Note: state.seed doubles as the running LCG state inside seededRandom(),
    // so by the time platforms are generated it no longer equals the original
    // shared seed on either side — the real proof of sync is identical platforms.
    if (host.platforms.length !== guest.platforms.length) {
        throw new Error("Platform count differs between host and guest");
    }
    for (let i = 0; i < host.platforms.length; i++) {
        const hp = host.platforms[i], gp = guest.platforms[i];
        if (hp.x !== gp.x || hp.y !== gp.y || hp.w !== gp.w) {
            throw new Error("Platform " + i + " differs: host=" + JSON.stringify(hp) + " guest=" + JSON.stringify(gp));
        }
    }

    // Single-player must still use the daily seed, unaffected by multiplayer changes.
    const sp = new Game();
    sp.startGame();
    if (sp.state.seed === sharedSeed) {
        throw new Error("Single player incorrectly picked up the multiplayer seed");
    }

    console.log("MP SEED SYNC SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
