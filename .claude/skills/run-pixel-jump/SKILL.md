---
name: run-pixel-jump
description: Run, start, play, drive, or screenshot the Pixel Jump browser game (menu, solo run, shop, co-op menu) in headless Chromium via a Playwright step driver, and run its node test suite. Use to confirm a gameplay/UI change works in the real game.
---

# Run Pixel Jump

Pixel Jump is a static HTML5 canvas game (`index.html` + `app.js` + `js/*.js`,
no build step, no npm dependencies). The agent path is
`.claude/skills/run-pixel-jump/driver.mjs`: it serves the repo with
`python3 -m http.server`, opens it in headless Chromium through Playwright,
runs a list of steps (click/keys/wait/screenshot/eval), then shuts everything
down. Paths below are relative to the repo root.

Verified on macOS (Darwin, Node 26, Python 3, Playwright 1.63).

## Prerequisites

`node_modules/` is gitignored and `package.json` has no dependencies, so install
Playwright without saving it:

```bash
npm install --no-save playwright
npx playwright install chromium
```

## Run (agent path)

```bash
PJ_OUT=/path/to/shots node .claude/skills/run-pixel-jump/driver.mjs
```

With no arguments it runs `ss menu start wait 500 jump wait 1000 ss run score`,
which captures the menu, starts a run, jumps and captures gameplay. It exits
with 1 if the page threw or logged `console.error`. **Open the PNGs and look
at them.**

Steps run in order:

| Step | Effect |
|---|---|
| `start` | force-click CLICK TO START |
| `left <ms>` / `right <ms>` | hold the arrow key |
| `jump` | tap Space |
| `key <key>` | press any key, e.g. `key Escape` |
| `wait <ms>` | sleep |
| `click <css>` | force-click any selector |
| `tap <css>` | touch-tap a selector with `PJ_TOUCH=1` (a forced click otherwise) |
| `ss <name>` | screenshot to `$PJ_OUT/<name>.png` (default `./pj-shots`) |
| `score` | print `#score-display` |
| `text <css>` | print an element's text |
| `eval <js>` | evaluate in the page and print JSON; the live game is `window.__game` |

Verified recipes:

```bash
# Warp to 500m (jumps biomes, fires height-based unlocks such as "PIXEL UNLOCKED: The Ghost")
node .claude/skills/run-pixel-jump/driver.mjs start wait 300 eval '__game.state.score = 5000' wait 1500 ss warp score

# Inspect state
node .claude/skills/run-pixel-jump/driver.mjs start wait 300 eval '[__game.player.x, __game.player.y, __game.player.isDead]'

# Shop, then co-op menu
node .claude/skills/run-pixel-jump/driver.mjs click '#shop-open-btn' wait 600 ss shop click '#shop-back-btn' wait 600 click '#to-mp-btn' wait 700 ss coop
```

Phone check (touch events, 390x844): menu taps must go through real touch
events, which is how the "can't start on a phone" bug was caught:

```bash
PJ_TOUCH=1 node .claude/skills/run-pixel-jump/driver.mjs tap '#shop-open-btn' wait 600 ss shop-touch tap '#shop-back-btn' wait 600 start wait 500 eval '__game.state.running'
```

If a `PJ_TOUCH=1` run shows the Add to Home Screen gate instead of the menu,
the page took the browser for a phone tab, and the gate also blocks starting a run.
To test gameplay at phone sizes, pass a desktop UA, which keeps touch and the viewport:

```bash
PJ_UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' \
  PJ_TOUCH=1 PJ_W=393 PJ_H=852 node .claude/skills/run-pixel-jump/driver.mjs start wait 800 ss phone-run eval '[__game.renderer.layout, __game.renderer.viewExtra]'
```

Layouts: a portrait phone gets `strip`: a black HUD strip on top, the playfield
running to the bottom edge, and `viewExtra` rows of extra sky above the 600x800
frame, up to `VIEW_MAX_EXTRA`. A wide window gets `flank`, with the HUD beside
the 3:4 column. Anything in between gets `overlay`, with the HUD in the column's corners.

High-DPI phone and URL options: `PJ_DPR=3` sets the device pixel ratio. The
canvas backing store is then capped at 2x: 1200 x 2*(800 + viewExtra). `PJ_PATH` is appended to the
URL, e.g. `PJ_PATH='?beat=120&d=20260923'` (a same-day challenge link) or
`PJ_PATH='?sw'` (registers the service worker, which is otherwise
production-only). `PJ_UA` overrides the user agent, e.g. an iPhone Safari UA with
`PJ_TOUCH=1` shows the Add to Home Screen gate.

Other useful selectors: `#prev-btn` / `#next-btn` (skin picker), `#to-sp-btn`,
`#mp-host-btn`, `#mp-join-btn`, `#shop-life-btn`, `#gem-prev-btn` / `#gem-next-btn`,
`#records-open-btn` / `#records-back-btn`, `#settings-open-btn` / `#settings-close-btn`,
`#pause-btn` (or `key Escape`), `#pause-resume-btn`, `#pause-quit-btn`, and the
end-of-run card's `#run-again-btn` / `#run-menu-btn`.

## Run (human path)

```bash
python3 -m http.server 8765   # then open http://localhost:8765/
```

## Test

Game-logic tests run under a mocked DOM (`tests/test_helpers.js`) with no
browser. Each file is standalone; `npm test` runs them all in parallel child
processes and reports each file's real exit code:

```bash
npm test                        # every tests/test_*.js
node tests/run_all.js boss mp   # only files whose name contains a filter
node tests/test_perks.js        # one file, full output
```

The mocks `unref()` game timers so a test exits as soon as its code finishes.
A test that awaits timers passes `setupMocks({ realTimers: true })`, calls
`failIfUnfinished()` and ends with `process.exit()`, or Node can exit 0
halfway through; inside it, wait with `sleep(ms)` from the helpers.

## Gotchas

- **Plain clicks on `#start-prompt` time out.** `#menu-layer` intercepts pointer
  events, and the game starts from `menu.onclick` on the layer itself. The
  driver uses `{ force: true }` for every click.
- **The score stays at 0m after a jump or two.** The score is camera scroll
  (`state.score / 10`), and the camera only scrolls once the player rises above
  the middle of the screen (`SCROLL_THRESHOLD: 0.5`). Landing on the first
  couple of platforms still shows 0m. Chaining jumps with hand-tuned
  `left`/`right` timings is flaky, so use `eval '__game.state.score = N'` to
  test height-dependent features.
- **`Game` isn't global.** `window.onload` does a bare `new Game()`. The driver
  wraps `Game.prototype.update` to capture the instance as `window.__game` on
  the next frame.
- **Each driver run starts with empty `localStorage`** (fresh browser context):
  0 gems, default skin, no Hall of Fame, no saved ghost. To test something
  that depends on saved progress, set the state inside that run.
- **Falling below the screen ends the run** and returns you to the menu. The
  run's score then shows in LAST RUN, HIGH SCORE and the Hall of Fame.
- **Ads and co-op networking** have no live backend. Ads are off
  (`ADS_ENABLED = false`), so the ad rails stay empty, and co-op can only be
  tested as far as its menu with a single browser.
- **The static server port is 8765.** Set `PJ_PORT` if that port is busy. The
  driver doesn't check what's already listening on it.

## Troubleshooting

- `page.click: Timeout 30000ms exceeded … <div id="menu-layer"> intercepts pointer events`:
  use a forced click, as the driver does.
- `Cannot find module 'playwright'`: run the `npm install --no-save playwright`
  line from the repo root. The driver resolves Playwright from `<repo>/node_modules`.
