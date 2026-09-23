const { chromium } = require('playwright');

const URL = 'http://localhost:8934/index.html';

(async () => {
    const browser = await chromium.launch();
    const consoleErrors = [];
    const shotDir = 'playwright_shots';
    require('fs').mkdirSync(shotDir, { recursive: true });

    async function freshContext() {
        const ctx = await browser.newContext({ viewport: { width: 700, height: 1000 } });
        const page = await ctx.newPage();
        page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
        page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));
        return { ctx, page };
    }

    // --- 1. Fresh load: menu screenshot ---
    let { ctx, page } = await freshContext();
    await page.goto(URL);
    await page.waitForSelector('#start-prompt');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shotDir}/01_menu.png` });
    console.log('01_menu captured');

    // --- 2. Start a run, play for real with keyboard input ---
    await page.click('#title'); // clicking empty menu background triggers startGame()
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shotDir}/02_run_start.png` });

    const start = Date.now();
    await page.keyboard.down('ArrowRight');
    while (Date.now() - start < 25000) {
        await page.keyboard.press(' ');
        await page.waitForTimeout(220);
    }
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shotDir}/03_after_25s_play.png` });
    const scoreText = await page.locator('#score-display').innerText();
    const shardText = await page.locator('#shard-display').innerText().catch(() => '(no shard display found)');
    console.log('Score after ~25s of real play:', scoreText, '| Shards HUD:', shardText);

    await ctx.close();

    // --- 3. Inject localStorage state to reach late-game UI without a long play session ---
    ({ ctx, page } = await freshContext());
    await page.goto(URL);
    await page.evaluate(() => {
        localStorage.setItem('lp_shards', '10000');
        localStorage.setItem('lp_best', '0'); // secret skins still locked
    });
    await page.reload();
    await page.waitForSelector('#start-prompt');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shotDir}/04_menu_with_shards.png` });

    // Browse skin carousel to the gem-shop area is separate; browse to a secret skin (should show ???).
    // Skin order: 0-6 normal, 7-11 gem-shop, 12 Rift Diver(secret), 13 Neon Ghost, 14 Static King, 15 The Void
    for (let i = 0; i < 12; i++) await page.click('#next-btn');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${shotDir}/05_secret_skin_masked.png` });
    const maskedName = await page.locator('#skin-name').innerText();
    const maskedStatus = await page.locator('#skin-status').innerText();
    console.log('Secret skin while locked -> name:', maskedName, '| status:', maskedStatus);

    // Buy a gem-shop skin via the real UI (click first buy button).
    await page.waitForTimeout(150);
    const gemShopHTML = await page.locator('#gem-skin-shop').innerHTML();
    console.log('Gem shop HTML present:', gemShopHTML.length > 0);
    const firstBuyBtn = page.locator('.gem-skin-buy-btn').first();
    await firstBuyBtn.click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${shotDir}/06_after_gem_purchase.png` });
    const shardsAfterBuy = await page.locator('#menu-shards').innerText();
    console.log('Shards after gem purchase:', shardsAfterBuy);

    // --- 4. Unlock a secret skin via high best-distance and confirm it reveals ---
    await page.evaluate(() => localStorage.setItem('lp_best', '20000'));
    await page.reload();
    await page.waitForSelector('#start-prompt');
    for (let i = 0; i < 15; i++) await page.click('#next-btn'); // land on The Void (index 15)
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${shotDir}/07_secret_skin_revealed.png` });
    const revealedName = await page.locator('#skin-name').innerText();
    const revealedStatus = await page.locator('#skin-status').innerText();
    console.log('Secret skin after reaching 20000m -> name:', revealedName, '| status:', revealedStatus);

    await ctx.close();
    await browser.close();

    console.log('\n=== CONSOLE ERRORS ===');
    if (consoleErrors.length === 0) {
        console.log('(none)');
    } else {
        consoleErrors.forEach(e => console.log(e));
    }
})();
