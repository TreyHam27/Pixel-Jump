const { chromium } = require('playwright');

const URL = 'http://localhost:8934/index.html';

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

    // Jump constantly (high frequency so we don't miss the ~100ms landing
    // buffer window) with brief alternating strafe taps to drift gently
    // instead of careening off one edge.
    const start = Date.now();
    let dir = 'ArrowRight';
    let lastSwitch = start;
    await page.keyboard.down(dir);

    let lastLogged = 0;
    while (Date.now() - start < 45000) {
        await page.keyboard.press(' ');
        if (Date.now() - lastSwitch > 900) {
            await page.keyboard.up(dir);
            dir = dir === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
            await page.keyboard.down(dir);
            lastSwitch = Date.now();
        }
        await page.waitForTimeout(90);

        const elapsed = Date.now() - start;
        if (elapsed - lastLogged > 5000) {
            lastLogged = elapsed;
            const score = await page.locator('#score-display').innerText().catch(() => '?');
            const revive = await page.locator('#revive-overlay').evaluate(el => getComputedStyle(el).display).catch(() => '?');
            console.log(`t=${(elapsed / 1000).toFixed(0)}s score=${score} reviveOverlay=${revive}`);
            if (revive === 'flex') {
                // Bot died — take the free revive path so live play continues.
                await page.click('#revive-skip').catch(() => {});
                await page.waitForTimeout(200);
                await page.click('#title').catch(() => {});
                await page.waitForTimeout(200);
            }
        }
    }
    await page.keyboard.up(dir);
    await page.waitForTimeout(300);

    require('fs').mkdirSync('playwright_shots', { recursive: true });
    await page.screenshot({ path: 'playwright_shots/08_after_45s_liveplay.png' });
    const finalScore = await page.locator('#score-display').innerText().catch(() => '(not in HUD, likely back at menu)');
    const menuLast = await page.locator('#menu-lastscore').innerText().catch(() => '?');
    const menuHigh = await page.locator('#menu-highscore').innerText().catch(() => '?');
    console.log('Final HUD score:', finalScore, '| menu last:', menuLast, '| menu high:', menuHigh);

    await browser.close();

    console.log('\n=== CONSOLE ERRORS ===');
    console.log(consoleErrors.length === 0 ? '(none)' : consoleErrors.join('\n'));
})();
