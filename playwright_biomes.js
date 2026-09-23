const { chromium } = require('playwright');

const URL = 'http://localhost:8934/index.html';
const stops = [
    { meters: 700, label: '09_ionosphere_wind' },
    { meters: 2000, label: '10_low_orbit_moving' },
    { meters: 4000, label: '11_deep_space_meteor' },
    { meters: 6000, label: '12_the_rift_gravitypulse' },
    { meters: 9000, label: '13_neon_grid_laser' },
    { meters: 13000, label: '14_static_field_glitch' },
];

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 700, height: 1000 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

    await page.goto(URL);
    await page.waitForSelector('#start-prompt');
    await page.click('#title');
    await page.waitForTimeout(300);

    require('fs').mkdirSync('playwright_shots', { recursive: true });

    for (const stop of stops) {
        await page.evaluate((meters) => {
            const g = window.game;
            g.state.score = meters * 10;
            g.state.running = true;
            g.player.isDead = false;
            g.player.y = 400; // keep the player safely mid-screen so it doesn't
            g.player.vy = 0;  // free-fall to death before the next frame runs
            g.platforms.push({ x: 0, y: 460, w: 600, h: 20 });
        }, stop.meters);
        // Let a couple frames run so enemies/hazards for this biome actually spawn.
        await page.waitForTimeout(1500);
        const biome = await page.evaluate(() => window.game.renderer.currentBiome.name);
        const hazards = await page.evaluate(() => window.game.renderer.currentBiome.hazards.join(','));
        const enemyTypes = await page.evaluate(() => window.game.enemies.map(e => e.constructor.name).join(','));
        console.log(`${stop.meters}m -> biome=${biome} hazards=[${hazards}] enemies=[${enemyTypes}]`);
        await page.screenshot({ path: `playwright_shots/${stop.label}.png` });
    }

    await browser.close();
    console.log('\n=== CONSOLE ERRORS ===');
    console.log(consoleErrors.length === 0 ? '(none)' : consoleErrors.join('\n'));
})();
