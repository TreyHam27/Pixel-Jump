# Pixel Jump

A neon endless vertical jumper for the browser. Climb through eight biomes, dodge drones, meteors and lasers, beat a boss every 4000m, and unlock Pixels with their own perks. You can play solo on the daily layout or in co-op with up to four friends.

**Play:** https://treyham27.github.io/Pixel-Jump/

## Controls

| | Keyboard | Touch |
|---|---|---|
| Move | ← → or A D | Hold the left quarter of the screen (move left) or the second quarter (move right) |
| Jump | Space, ↑ or W | Tap the right half |
| Pause | Esc or P | ❚❚ button (top right) |
| Menu | ← → browse Pixels · Space / Enter start | Tap |

## Features

- **Biomes:** eight of them. Hazards stack as you climb: wind, moving platforms, meteors, gravity pulses, laser drones and control glitches.
- **Boss fights:** every 4000m. The boss hovers and fires volleys, then telegraphs a dive to your level. Land on it while it's exposed. Each kill is worth +500m and 150 💎.
- **Pixels (skins):** you unlock them by height, by buying them in the gem shop, or by finding the secret ones. Each has a perk, such as JUMP, EMP, GEMS x2 or SCORE x2.
- **Daily layout:** solo runs use the day's seed, and your best run of the day replays as a ghost.
- **Co-op:** 2-4 players via a 6-character room code (PeerJS WebRTC). Levels are generated identically on every client. Only public STUN servers are configured, so players behind strict NATs (some mobile carriers and office networks) need a TURN relay: add one with your own credentials to `EXTRA_ICE_SERVERS` in `js/config.js`.
- **Extra lives:** buy them in the shop; ads are off (`ADS_ENABLED` in `js/config.js`).
- **Run summary and Records:** every run ends with a summary card. RECORDS shows lifetime stats and every achievement (secret Pixels stay hidden until earned).
- **Settings:** volume, mute, the daily ghost, and reduced motion. Solo runs pause when you switch tabs.

## Run locally

There's no build step. Serve the folder statically:

```bash
npm run serve        # python3 -m http.server 8765
# open http://localhost:8765/
```

## Tests

Game logic is tested in Node under a mocked DOM (no browser needed):

```bash
npm test                       # every tests/test_*.js, in parallel
node tests/run_all.js boss     # only files whose name contains "boss"
node tests/test_perks.js       # one file, full output
```

To drive the real game in headless Chromium (screenshots, touch emulation), see `.claude/skills/run-pixel-jump/SKILL.md`.

## Project layout

| File | What it holds |
|---|---|
| `index.html`, `style.css` | Menus, HUD, shop and co-op screens |
| `app.js` | `Game`: the main loop, level generation, collisions, menus, co-op party logic |
| `js/config.js` | Tuning: `CONFIG`, biomes, Pixels (`SKINS`), perks, power-ups, achievements, boss, versions |
| `js/entities.js` | Player, drones, projectiles, meteors, the boss |
| `js/input.js` | Keyboard and touch input |
| `js/network.js` | PeerJS hub-and-spoke networking for co-op |
| `js/renderer.js`, `js/background.js` | Canvas drawing |
| `js/sounds.js` | Synthesized chiptune sound effects (Web Audio) |
| `js/ads.js` | Ad integration seams (off) |

## Deploying

GitHub Pages serves `main` directly, so every merge goes live straight away.

- **Bump `GAME_VERSION`** in `js/config.js`, and the matching `?v=` query on every script/stylesheet in `index.html`, whenever you ship. `tests/test_version.js` checks they agree. This stops browsers mixing cached files from different deploys.
- **Bump `NET_PROTOCOL`** in `js/config.js` whenever co-op messages, level generation, or the order of `SKINS`/`POWERS` change. Players on different protocols are told to refresh instead of joining a desynced run.
- **Bump `PLATFORM_GEN_VERSION`** when level generation changes, so ghosts from the old generator are dropped.
