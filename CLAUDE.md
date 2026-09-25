# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pixel Jump is a vanilla-JS HTML5 canvas endless jumper with solo daily runs and 2-4 player PeerJS co-op. There is no build step and no npm dependencies. `README.md` has the controls, the features and a file map.

## Commands

```bash
npm test                        # every tests/test_*.js in parallel child processes (real exit codes)
node tests/run_all.js boss mp   # only files whose name contains a filter
node tests/test_perks.js        # one file, full output
npm run serve                   # python3 -m http.server 8765 → http://localhost:8765/
```

To drive the real game in headless Chromium (screenshots, touch/DPR emulation, `eval` against the live game), use the `run-pixel-jump` skill (`.claude/skills/run-pixel-jump/`). It needs `npm install --no-save playwright && npx playwright install chromium`. `Game` isn't a global; the driver exposes the live instance as `window.__game`.

After any gameplay, UI or CSS change, verify it in the real game with `/run-pixel-jump` before opening a PR. Look at the screenshots, and run a `PJ_TOUCH=1` pass for anything touch- or layout-related. The node tests use a mocked DOM, so they can't catch rendering or tap bugs.

## Shipping: merging to `main` is deploying

GitHub Pages serves `main` as-is, so a merge is live immediately. CI (`.github/workflows/test.yml`, `npm test` on Node 20) runs on PRs and on pushes to `main`, and it is the only gate. Work on a branch and open a PR.

- **`GAME_VERSION`** (`js/config.js`) must equal every `?v=` query in `index.html` and `VERSION` in `sw.js`. Bump all three when shipping. `tests/test_version.js` and `tests/test_pwa_share.js` enforce this.
- **`NET_PROTOCOL`**: bump it when co-op messages, level generation, or the order of `SKINS` or `POWERS` changes. Array indexes are sent over the wire, and mismatched clients are told to refresh.
- **`PLATFORM_GEN_VERSION`**: bump it when platform generation changes. This discards saved ghosts from the old layouts.
- **A new source file** must go in three places:
  - a `<script>` tag in `index.html` (load order matters)
  - `loadGameSource()` in `tests/test_helpers.js`, in the same order
  - the `SHELL` precache list in `sw.js`
- **The service worker** only registers on https, or locally with `?sw`, so local development never serves stale cached files.

## Architecture

**No modules.** Plain `<script>`s share one global scope and load in this order: `js/vendor/peerjs.min.js` → `config` → `sounds` → `background` → `input` → `renderer` → `entities` → `ads` → `network` → `app.js`. `window.onload` (the end of `app.js`) does `new Game()` and registers the service worker.

**`Game` (`app.js`) owns everything:**
- run state in `this.state` (rebuilt by `reset()`)
- DOM references cached in `this.ui` and wired up in `bindEvents()`/`bindMetaEvents()`
- menus, shop, co-op party logic, collisions
- the loop: `loop()` → `update(dt)` → `draw()`

`js/config.js` holds all tuning, and `js/entities.js` holds the entity classes, including the `BossDrone` state machine.

**Time is in 60fps frames:**
- `dt = 1` means 16.7ms, capped at 4.
- Every per-frame effect must scale by `dt`.
- Periodic events use `this.tick(name, dt, every)` with accumulators in `state.timers`, never `state.frames % N`. Frame-counting made difficulty scale with refresh rate; `tests/test_frame_rate.js` guards against it.

**Coordinates:**
- Entities live in screen space (y grows downward).
- `state.score` is the total camera scroll in px, so meters = `score / 10`. The displayed score is `runScore()`, which adds `bonusScore` from boss kills.
- World y is `y - state.score`. All network messages carry world y (`wy`).
- Scrolling goes through `scrollCamera(diff)`, which shifts every entity. Entities with their own anchors implement `shiftY(d)`.

**Level generation is deterministic.** Co-op clients and the daily ghost rely on it.
- `spawnPlatform(wy)` depends only on the platform's world y, `biomeAt(meters)`, and the `seededRandom()` LCG.
  - The seed is `getDailySeed()` for solo runs and the host's seed in co-op.
- `fillPlatforms()` generates platforms strictly in height order, from the integer counter `nextPlatWY`.
- Never call `seededRandom()` for anything else, and never read camera or biome state during generation. Either one splits co-op levels apart.
- `tests/test_level_gen_determinism.js` guards this.

**Saves** are `localStorage` keys prefixed `lp_`:
- Read them with `loadJSON(key, fallback, validator)`, never a bare `JSON.parse`. A corrupt save must not crash the constructor.
- Pixel unlocks use `state.bestHeight` (`lp_best_height`, real meters).
- `highScore` (`lp_best`) is the displayed score, which includes SCORE x2 and boss bonuses, so it must not drive unlocks.

**Co-op** (`js/network.js` `NetworkManager` plus the party and net methods in `Game`):
- **Topology:** hub-and-spoke over PeerJS. The host relays guest traffic. Room codes are 6 characters, and peer ids are `pixeljump-XXXXXX`.
  - `joinGen` tokens abort stale join and connect loops.
  - Peers are retired before `destroy()` so teardown can't trigger a reconnect.
- **Trust boundary:** `handleNetworkData()`.
  - The host accepts only `handshake`, `sync`, `die`, `revive`, `hit` and `stomp` from guests.
  - It relays sanitized copies (`sanitizeSync`), stamped with the sender's id.
  - Guests only listen to their host.
- **The host is authoritative** (`isAuthority()`). It alone spawns and simulates drones, lasers, meteors, projectiles and the boss, and stamps each with a `nid`.
  - It broadcasts `snap` snapshots (15Hz, `NET_SNAPSHOT_FRAMES`) and `ps` projectile spawns.
  - Guests mirror these in `netEnemies` (blended by `followNetEnemy`) and collide only with their own player.
  - A guest's kills and boss stomps are `hit`/`stomp` requests, backed by short local tombstones so the next snapshot doesn't bring the enemy back.
  - `boss_down` pays everyone.
- **Adding a new enemy or message type** means updating `buildSnapshot`/`applySnapshot` and the trust list, then bumping `NET_PROTOCOL`.
- **Away and gone teammates:** a teammate silent for `REMOTE_AWAY_FRAMES` drops out of the camera and ceiling calculations. After `REMOTE_GONE_FRAMES` they count as down.
- **TURN relay:** `host()`/`join()` fetch relay logins from `TURN_CREDENTIALS_URL` (Metered) before creating the Peer, cached for 30 minutes and warmed when the co-op menu opens. A slow or failed fetch falls back to STUN only. `?relay` forces relay-only connections for testing. Tests stub `fetch` to `undefined`; `tests/test_turn_relay.js` installs fakes.
- **EMP is solo-only.**

**Ads:** `js/ads.js` is a seam that is off (`ADS_ENABLED = false`).

## Writing tests

Each `tests/test_*.js` is a standalone Node script.

**Structure:**
- It calls `setupMocks()`, then `eval(loadGameSource() + \`…\`)`. That puts every game global in one scope under a mocked DOM.
- It drives the game directly: `new Game()`, `g.startGame()`, `g.update(1)`, setting `g.state.*` as needed.
- It throws on failure. The process exit code is the result.

**Gotchas:**
- The mock's `getElementById` returns a fresh stub on every call, so assert through the game's cached `g.ui.*` references.
- The test body is a template literal, so double-escape regex backslashes (`\\s`, `\\[`).
- Timers are `unref`'d, so an async test must use `setupMocks({ realTimers: true })` plus `failIfUnfinished()`, and end with `process.exit()`. Otherwise Node can exit 0 halfway through the test.
- For co-op tests, `installMpFakes()` from `tests/mp_fakes.js` provides `FakePeer`, `Bus` and `FakeNet`:
  - Create several `Game`s in one process.
  - Point `window.network` at each game's `FakeNet` before calling into that game.
  - Call `bus.pump()` to deliver messages.
  - `tests/test_mp_enemies.js` is the reference example.
