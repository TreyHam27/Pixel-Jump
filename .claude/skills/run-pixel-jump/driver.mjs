#!/usr/bin/env node
// Pixel Jump driver: serves the repo statically, opens it in headless
// Chromium (Playwright), runs a list of steps, then tears everything down.
//
//   node .claude/skills/run-pixel-jump/driver.mjs [step ...]
//
// Steps (run in order; default = "ss menu start wait 500 jump wait 1000 ss run score"):
//   start            click CLICK TO START (forced; the menu layer eats real clicks)
//   left <ms>        hold ArrowLeft for <ms>
//   right <ms>       hold ArrowRight for <ms>
//   jump             tap Space (one jump; only fires while grounded/coyote)
//   wait <ms>        sleep
//   click <sel>      force-click a CSS selector (e.g. '#to-mp-btn', '#shop-open-btn')
//   tap <sel>        touch-tap a selector (needs PJ_TOUCH=1); goes through real
//                    touch events, so it catches taps the game swallows
//   key <key>        press a key by Playwright name (e.g. Escape, Enter, KeyP)
//   ss <name>        screenshot -> $PJ_OUT/<name>.png
//   score            print #score-display text
//   text <sel>       print textContent of a selector
//   eval <js>        evaluate JS in the page and print the result;
//                    the live Game instance is window.__game
//                    (e.g. '__game.state.score', '__game.player.y')
//
// Env: PJ_OUT (screenshot dir, default ./pj-shots), PJ_PORT (default 8765),
//      PJ_W / PJ_H (viewport, default 1200x800, or 390x844 with PJ_TOUCH=1),
//      PJ_TOUCH=1 (emulate a phone: touch events, mobile viewport; `start`
//      then taps instead of clicking).
// Exits 1 if the page threw any error or logged console.error.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');

const port = Number(process.env.PJ_PORT || 8765);
const out = path.resolve(process.env.PJ_OUT || 'pj-shots');
mkdirSync(out, { recursive: true });

let steps = process.argv.slice(2);
if (!steps.length) steps = 'ss menu start wait 500 jump wait 1000 ss run score'.split(' ');

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'],
    { cwd: root, stdio: 'ignore' });
const url = `http://127.0.0.1:${port}/`;

async function waitForServer() {
    for (let i = 0; i < 50; i++) {
        try { if ((await fetch(url)).ok) return; } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`static server never came up on ${url} (port in use?)`);
}

const errs = [];
let browser;
try {
    await waitForServer();
    browser = await chromium.launch();
    const touch = process.env.PJ_TOUCH === '1';
    const page = await browser.newPage({
        viewport: {
            width: Number(process.env.PJ_W || (touch ? 390 : 1200)),
            height: Number(process.env.PJ_H || (touch ? 844 : 800))
        },
        ...(touch ? { hasTouch: true, isMobile: true } : {})
    });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
    await page.goto(url);
    await page.waitForTimeout(1000); // fonts + first menu frame
    // The Game instance is never stored globally (window.onload does a bare
    // `new Game()`), so capture it from the next update() tick as window.__game.
    await page.evaluate(() => {
        const orig = Game.prototype.update;
        Game.prototype.update = function (...a) { window.__game = this; return orig.apply(this, a); };
    });
    await page.waitForFunction(() => window.__game);

    const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
    for (let i = 0; i < steps.length; i++) {
        const cmd = steps[i];
        const arg = () => steps[++i];
        switch (cmd) {
            case 'start':
                if (touch) await page.tap('#start-prompt', { force: true });
                else await page.click('#start-prompt', { force: true });
                break;
            case 'left': await hold('ArrowLeft', Number(arg())); break;
            case 'right': await hold('ArrowRight', Number(arg())); break;
            case 'jump': await page.keyboard.press('Space'); break;
            case 'wait': await page.waitForTimeout(Number(arg())); break;
            case 'click': await page.click(arg(), { force: true }); break;
            case 'tap': await page.tap(arg(), { force: true }); break;
            case 'key': await page.keyboard.press(arg()); break;
            case 'ss': { const f = path.join(out, arg() + '.png'); await page.screenshot({ path: f }); console.log('screenshot:', f); break; }
            case 'score': console.log('score:', await page.textContent('#score-display')); break;
            case 'text': { const s = arg(); console.log(`${s}:`, await page.textContent(s)); break; }
            case 'eval': console.log('eval:', JSON.stringify(await page.evaluate(arg()))); break;
            default: throw new Error(`unknown step "${cmd}"`);
        }
    }
} finally {
    if (browser) await browser.close();
    server.kill();
}
console.log(errs.length ? errs.join('\n') : 'no page errors');
process.exitCode = errs.length ? 1 : 0;
