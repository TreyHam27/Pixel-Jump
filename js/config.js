// Master switch for the entire ad system (js/ads.js). Off = zero ad-related
// UI, delay, or network calls anywhere: side rails stay blank, the revive
// prompt is skipped in favor of an instant free continue, and the
// restart interstitial never fires. Flip to true once ready to run ads.
const ADS_ENABLED = false;

// Build identity. GAME_VERSION tags asset URLs (index.html ?v=...) so a
// deploy never mixes cached old scripts with new ones; NET_PROTOCOL must
// match for two players to share a co-op run. Bump NET_PROTOCOL whenever the
// co-op messages, level generation, or the SKINS/POWERS order change.
const GAME_VERSION = '1.9.1';
const NET_PROTOCOL = 5;

const CONFIG = {
    WIDTH: 600,
    HEIGHT: 800,
    GRAVITY: 0.6,
    FRICTION: 0.85,
    SPEED: 0.9,
    JUMP_FORCE: -13.2,
    SUPER_JUMP_FORCE: -22,
    BOUNCE_FORCE: -25,
    PLATFORM_BASE_GAP: 95,
    SCROLL_THRESHOLD: 0.5,
    DRONE_BASE_VELOCITY: 2,
    DRONE_MAX_VELOCITY: 8,
    // Drones: one every DRONE_SPAWN_RATE frames at 0m, speeding up by a
    // frame per 50m down to DRONE_MIN_SPAWN_RATE. At most DRONE_CAP_BASE are
    // out at once, plus one more every DRONE_CAP_STEP metres up to
    // DRONE_CAP_MAX (drones circle back rather than leave, so without a cap
    // a slow climb piles them up). Laser drones have their own cap.
    DRONE_SPAWN_RATE: 180,
    DRONE_MIN_SPAWN_RATE: 90,
    DRONE_CAP_BASE: 2,
    DRONE_CAP_MAX: 6,
    DRONE_CAP_STEP: 1500,
    LASER_CAP: 2,
    PROJECTILE_SPEED: 6,
    BOSS_LOOP_DISTANCE: 3000
};

// Level generation version: bump when spawnPlatform() would build a different
// layout from the same seed (saved ghosts from other versions are dropped).
const PLATFORM_GEN_VERSION = 3;
// Pickups rolled per platform. The power-up chance climbs from MIN at 0m to
// MAX at POWERUP_RAMP_METERS; hearts are rarer, and only exist for a player
// with no hearts left (see Game.visiblePickups()); otherwise 40% of
// platforms carry a gem, worth its biome's `gem.value` (see BIOMES).
const POWERUP_CHANCE_MIN = 0.06;
const POWERUP_CHANCE_MAX = 0.12;
const POWERUP_RAMP_METERS = 8000;
// Hearts thin out with height (HEART_CHANCE_START at 0m down to
// HEART_CHANCE_END at HEART_RAMP_METERS) and are always more than a screen
// apart, so at most one is ever in view.
const HEART_CHANCE_START = 0.04;
const HEART_CHANCE_END = 0.01;
const HEART_RAMP_METERS = 8000;
const HEART_MIN_GAP = 1000; // px of world height between hearts (> CONFIG.HEIGHT)
const RUN_CARD_TAP_GRACE_MS = 600; // backdrop taps right after the run card opens are ignored
const GEM_CHANCE = 0.4;
// Tall screens (portrait phones) see up to this much extra sky above the
// 600x800 playfield. It's view-only: the game itself (score, camera, death
// line, co-op ceiling) always runs in the 800-tall reference frame, and the
// extra rows are drawn above its top edge, at negative screen y.
const VIEW_MAX_EXTRA = 500;
// How far above the top of the screen platforms are generated in advance
// (enough to fill the tallest view).
const PLATFORM_LOOKAHEAD = CONFIG.HEIGHT + VIEW_MAX_EXTRA;
// CSS px each side of the 3:4 column needs before the HUD moves out beside
// it (the 'flank' layout) instead of sitting in its corners.
const FLANK_MIN_GUTTER = 170;
// Frames an enemy that first appears in a tall view's extra sky takes to fade in.
const SPAWN_FADE_FRAMES = 12;
// Ghost recording: one sample every GHOST_STEP frames of game time, capped
// at GHOST_MAX_POINTS samples (about half an hour of climbing).
const GHOST_STEP = 6;
const GHOST_MAX_POINTS = 20000;

// Boss fight tuning, in 60fps frames of game time. The boss hovers above the
// player firing volleys, then telegraphs a dive (a warning column shows the
// lane), swoops down to the player's level and sits there exposed: land on
// top of it to deal damage. Below half health it rages (shorter windows,
// wider volleys).
const BOSS = {
    HOVER_OFFSET: 380,   // hover this far above the player it's tracking
    HOVER_MIN_Y: 30,     // ...but never higher than this on screen
    HOVER: 150, HOVER_RAGE: 90,           // time between dives
    VOLLEY: 80, VOLLEY_RAGE: 55,          // time between volleys while hovering
    TELEGRAPH: 50, TELEGRAPH_RAGE: 38,    // warning before the dive
    WINDUP: 30,          // how far it rears back while telegraphing
    DIVE_SPEED: 16,      // px per frame
    EXPOSED: 90,         // how long it sits at the player's level
    RECOVER: 45,         // time to climb back to hover height
    HIT_INVULN: 40,      // invulnerability after each hit
    ABOVE_FEET: 50       // exposed: its top sits this far above the target's feet
};
// Beating the boss: bonus distance (score only, the camera doesn't move) and
// a gem bounty (not doubled by GEMS x2). The next boss is BOSS_LOOP_DISTANCE
// metres further on.
const BOSS_BONUS_METERS = 500;
const BOSS_GEM_BOUNTY = 150;

// Each biome's `hazards` list is cumulative: once a hazard is introduced by a
// biome, it stays active in every later biome too (by The Void, everything is
// stacked at once — that's the intended "hardest tier" feel).
// `gem` is what a gem found in that biome is worth, and its colour: higher
// biomes pay more, from 5 at the start up to 100 in The Void.
const BIOMES = [
    { threshold: 0, name: "Atmosphere", bg: "#050505", grid: "#1a1a1a", platform: "#00ffcc", hazards: [], gem: { value: 5, color: "#00ffff" } },
    { threshold: 600, name: "Ionosphere", bg: "#0a001a", grid: "#330066", platform: "#ff00ff", hazards: ["wind"], gem: { value: 10, color: "#33ff66" } },
    { threshold: 1800, name: "Low Orbit", bg: "#000a1a", grid: "#003366", platform: "#00ccff", hazards: ["wind", "moving"], gem: { value: 15, color: "#3399ff" } },
    { threshold: 3200, name: "Deep Space", bg: "#0a0a0a", grid: "#222", platform: "#ffd700", hazards: ["wind", "moving", "meteor"], gem: { value: 25, color: "#b266ff" } },
    { threshold: 5000, name: "The Rift", bg: "#1a0022", grid: "#4d0066", platform: "#cc00ff", hazards: ["wind", "moving", "meteor", "gravityPulse"], gem: { value: 35, color: "#ff66cc" } },
    { threshold: 8000, name: "Neon Grid", bg: "#001010", grid: "#00ffaa", platform: "#00ff99", hazards: ["wind", "moving", "meteor", "gravityPulse", "laser"], gem: { value: 50, color: "#ff9900" } },
    { threshold: 12000, name: "Static Field", bg: "#0a0a0a", grid: "#555555", platform: "#ffffff", hazards: ["wind", "moving", "meteor", "gravityPulse", "laser", "glitch"], gem: { value: 75, color: "#ff3344" } },
    { threshold: 17000, name: "The Void", bg: "#000000", grid: "#220022", platform: "#ff0055", hazards: ["wind", "moving", "meteor", "gravityPulse", "laser", "glitch"], gem: { value: 100, color: "#ffffff" } }
];

// The biome at a given height in meters (the single source of truth for both
// the renderer and level generation).
function biomeAt(meters) {
    for (let i = BIOMES.length - 1; i >= 0; i--) {
        if (meters >= BIOMES[i].threshold) return BIOMES[i];
    }
    return BIOMES[0];
}

// Index into BIOMES of the biome at `meters` (a gem's tier).
function biomeIndexAt(meters) {
    return BIOMES.indexOf(biomeAt(meters));
}

// Shop consumables. Hearts are bought with gems and carried between
// runs as stock — each one is spent automatically on a death that would
// otherwise end the run (see Game.die()).
const HEART_COST = 50;
// A spent life (or revive) springs up a red safety net for a second that
// bounces the player back in.
const RESCUE_NET_FRAMES = 60;
const RESCUE_NET_COLOR = '#ff3366';
const MAX_HEARTS = 3;

// Multiplayer: host + up to 3 guests (NetworkManager.maxGuests must match).
// Slot 0 is always the party leader; each slot's colour is used for that
// player's in-game name tag and their row in the party panel.
const MAX_PARTY_SIZE = 4;
// TURN relay for co-op on strict networks (school/office WiFi, some mobile
// carriers) where two browsers can't connect directly. Host and join fetch
// relay logins from this Metered Open Relay URL:
//   https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>
// The key is public by design (it's in the page); the free plan stops at
// 20 GB/month with no charge, and co-op then falls back to direct-only.
// WebRTC still prefers a direct link, so only games that need it use the
// relay. Empty = no relay.
const TURN_CREDENTIALS_URL = 'https://pixeljump.metered.live/api/v1/turn/credentials?apiKey=f430cd6be005e6cd08915b58d886132f11ba';
const TURN_FETCH_TIMEOUT_MS = 4000;       // host/join never wait longer
const TURN_CACHE_MS = 30 * 60 * 1000;     // reuse fetched logins this long
// Extra hand-configured WebRTC ICE servers, appended after Google's public
// STUN servers and the relay above, e.g.
//   { urls: 'turn:turn.example.com:443?transport=tcp', username: '...', credential: '...' }
const EXTRA_ICE_SERVERS = [];
// A teammate with no position update for this many frames (60fps game time)
// is shown as away and stops steering the shared camera; after the second
// threshold they count as down when deciding whether the run is over.
const REMOTE_AWAY_FRAMES = 150;
const REMOTE_GONE_FRAMES = 600;
// Co-op enemies are run by the host and mirrored by guests: snapshots every
// NET_SNAPSHOT_FRAMES (15/s); a guest's own kill is hidden for
// NET_TOMBSTONE_FRAMES so a snapshot sent before the host heard about it
// can't bring the enemy back.
const NET_SNAPSHOT_FRAMES = 4;
const NET_TOMBSTONE_FRAMES = 60;
const PARTY_COLORS = ['#00ffff', '#ff3cf0', '#ffe600', '#ff8a00'];

// Every Pixel carries a stable `id`. Saves (lp_owned_skins, lp_skin) store
// ids, never array positions, so skins can be added or reordered freely. The
// running game still addresses skins by SKINS index (Player, co-op sync),
// which is fine as long as every client ships the same list.
const SKINS = [
    { id: 'unit734', name: "Unit 734", color: "#ff3366", eye: "white", unlock: 0, ability: {} },
    { id: 'ghost', name: "The Ghost", color: "#ffffff", eye: "black", unlock: 150, ability: { gravityMult: 0.85 } },
    { id: 'matrix', name: "Matrix", color: "#00ff00", eye: "black", unlock: 350, ability: { speedMult: 1.2 } },
    { id: 'deepvoid', name: "Deep Void", color: "#330033", eye: "#ff00ff", unlock: 700, ability: { jumpMult: 1.15 } },
    { id: 'golden', name: "Golden", color: "#ffd700", eye: "#8B4500", unlock: 1400, ability: { speedMult: 1.1, gravityMult: 0.9 } },
    { id: 'glitch', name: "Glitch", color: "#00ffff", eye: "white", unlock: 2500, ability: { jumpMult: 1.1, speedMult: 1.1 } },
    { id: 'theend', name: "The End", color: "#111", eye: "red", unlock: 4000, ability: { gravityMult: 0.75 } },

    // Gem-shop Pixels, cheapest first. Each one beats every free Pixel: the
    // bottom two carry one big stat (+30% jump already means 1.7x the jump
    // height), and every tier above adds a wildcard
    // perk on top of a stat boost. Gems pay more in higher biomes (about 170
    // per 1000m in the Atmosphere, 1,700+ in Neon Grid, plus 150 per boss),
    // so the lower tiers come quickly and the top tier at 50,000 rewards
    // climbing high rather than grinding the first screens. See Game.renderGemShop().
    { id: 'nebula', name: "Nebula Drifter", color: "#6633ff", eye: "#ccccff", cost: 75, ability: { speedMult: 1.5 } },
    { id: 'chrome', name: "Chrome Unit", color: "#cccccc", eye: "#333333", cost: 200, ability: { jumpMult: 1.3 } },
    { id: 'solarflare', name: "Solar Flare", color: "#ff6600", eye: "#ffffff", cost: 500, ability: { speedMult: 1.25, gravityMult: 0.7 } },
    { id: 'obsidian', name: "Obsidian", color: "#1a0033", eye: "#ff00ff", cost: 1200, ability: { jumpMult: 1.25, powerDurationMult: 2 } },
    { id: 'prism', name: "Prism", color: "#ff00ff", eye: "#ffffff", cost: 2500, ability: { speedMult: 1.25, airJump: true } },
    { id: 'pulsewarden', name: "Pulse Warden", color: "#00ff99", eye: "#003322", cost: 5000, ability: { jumpMult: 1.25, dronePulseSec: 5 } },
    { id: 'hoarder', name: "Crystal Hoarder", color: "#33e0ff", eye: "#002233", cost: 9000, ability: { speedMult: 1.25, gemMagnetRadius: 150, gemMult: 2 } },
    { id: 'aegis', name: "Aegis", color: "#3366ff", eye: "#ffffff", cost: 15000, ability: { jumpMult: 1.25, startShield: true, biomeImmune: true } },
    { id: 'overclock', name: "Overclock", color: "#ff2222", eye: "#ffe600", cost: 50000, ability: { speedMult: 1.3, jumpMult: 1.3, powerDurationMult: 2, scoreMult: 2 } },

    // Secret skins: never shown in the menu picker until their distance is
    // reached (see Game.unlockedSkinIndexes()), one per new biome.
    { id: 'riftdiver', name: "Rift Diver", color: "#6600cc", eye: "#00ffff", unlock: 5000, secret: true, ability: { powerDurationMult: 1.5 } },
    { id: 'neonghost', name: "Neon Ghost", color: "#ff0099", eye: "#00ffff", unlock: 8000, secret: true, ability: { gemMagnetRadius: 150 } },
    { id: 'staticking', name: "Static King", color: "#ffffff", eye: "#ff0000", unlock: 12000, secret: true, ability: { speedMult: 1.25, biomeImmune: true } },
    { id: 'thevoid', name: "The Void", color: "#000000", eye: "#ff0000", unlock: 17000, secret: true, ability: { startAtScore: 50000, jumpMult: 1.1 } }
];

function skinIndexById(id) {
    return SKINS.findIndex(s => s.id === id);
}

// Perks: the passive buff a Pixel grants, keyed by its SKINS[i].ability key.
// `label` is the short tag shown on the menu/shop, `describe(value)` the full
// stat text revealed on hover/tap, and `active(value)` whether a value does
// anything at all (a 1x multiplier doesn't). `covers` names the POWERS entry
// the perk already gives for good, which that Pixel then never rolls. Tags
// render in this order.
const perkPct = (mult) => Math.round(Math.abs(mult - 1) * 100) + '%';
const PERKS = [
    { key: 'speedMult', label: 'SPEED', color: '#00ccff', active: v => !!v && v !== 1,
      describe: v => (v > 1 ? '+' : '-') + perkPct(v) + ' move speed' },
    { key: 'jumpMult', label: 'JUMP', color: '#00ff66', active: v => !!v && v !== 1,
      describe: v => (v > 1 ? '+' : '-') + perkPct(v) + ' jump height' },
    { key: 'gravityMult', label: 'GRAVITY', color: '#b388ff', active: v => !!v && v !== 1,
      describe: v => (v < 1 ? '-' : '+') + perkPct(v) + ' gravity' + (v < 1 ? ' (floatier)' : '') },
    { key: 'powerDurationMult', label: 'POWER', color: '#ffaa00', active: v => !!v && v !== 1,
      describe: v => Number.isInteger(v) ? 'Power-ups last ' + v + 'x as long' : '+' + perkPct(v) + ' power-up duration' },
    { key: 'gemMagnetRadius', label: 'MAGNET', color: '#ffff00', active: v => !!v, covers: 'MAGNET',
      describe: () => 'Always pulls in nearby gems' },
    { key: 'startShield', label: 'SHIELD START', color: '#3366ff', active: v => !!v,
      describe: () => 'Every run starts with a HARD SHIELD' },
    { key: 'startAtScore', label: 'RIFT', color: '#9933ff', active: v => !!v,
      describe: v => 'Solo runs start at ' + Math.floor(v / 10) + 'm (The Rift)' },
    { key: 'airJump', label: 'AIR JUMP', color: '#ff66ff', active: v => !!v, covers: 'DOUBLE',
      describe: () => 'Always has a double jump' },
    { key: 'dronePulseSec', label: 'EMP', color: '#00ff99', active: v => !!v,
      describe: v => 'Every ' + v + 's, destroys all drones on screen (solo only)' },
    { key: 'gemMult', label: 'GEMS x2', color: '#33e0ff', active: v => !!v && v !== 1,
      describe: v => 'Gem pickups are worth ' + v + 'x' },
    { key: 'biomeImmune', label: 'SHIELDED', color: '#3399ff', active: v => !!v,
      describe: () => 'Immune to wind, gravity pulses and glitches' },
    { key: 'scoreMult', label: 'SCORE x2', color: '#ff3333', active: v => !!v && v !== 1,
      describe: v => 'Climbing earns ' + v + 'x distance score' }
];

// The perks a Pixel actually grants, in PERKS order, each with its value.
function skinPerks(ability) {
    if (!ability) return [];
    return PERKS
        .filter(p => p.active(ability[p.key]))
        .map(p => ({ perk: p, value: ability[p.key] }));
}

const POWERS = {
    DOUBLE: { id: 1, name: "DOUBLE JUMP", color: "#00ccff", time: 600 },
    SUPER: { id: 2, name: "SUPER JUMP", color: "#ffaa00", time: 400 },
    SAFETY: { id: 3, name: "SAFETY NET", color: "#cc00ff", time: 800 },
    MAGNET: { id: 4, name: "MAGNET", color: "#ffff00", time: 500 },
    ROCKET: { id: 5, name: "JETPACK", color: "#ff3300", time: 250 },
    SHIELD: { id: 6, name: "HARD SHIELD", color: "#00ffaa", time: 600 },
    TIME_WARP: { id: 7, name: "TIME WARP", color: "#ffffff", time: 500 }
};

const ACHIEVEMENTS = [
    { id: '1km', name: 'Kilometer Club', desc: 'Climb to 1,000m', condition: (state, player) => state.score >= 10000 },
    { id: '5km', name: 'Stratosphere', desc: 'Climb to 5,000m', condition: (state, player) => state.score >= 50000 },
    { id: 'magnet', name: 'Attractive', desc: 'Pick up a MAGNET power-up', condition: (state, player) => player.activePower && player.activePower.name === "MAGNET" },
    { id: 'pacifist', name: 'Pacifist Pilot', desc: 'Reach 5,000m without collecting a power-up', condition: (state, player) => state.score >= 50000 && state.powersCollected === 0 },
    { id: 'boss', name: 'Titan Slayer', desc: 'Beat a boss', condition: (state, player) => state.loops >= 1 },
    { id: 'rich', name: 'Data Hoarder', desc: 'Hold 100 gems', condition: (state, player) => state.gems >= 100 },

    // Every distance-gated skin doubles as an achievement. Crossing its high
    // score is exactly what unlocks it (see Game.isSkinLocked()), so that same
    // moment pops a badge instead of the unlock sitting silently in the
    // carousel until the player happens to scroll past it. Gem-shop skins are
    // bought rather than earned, so they stay out of this, as does the starter
    // skin (unlock: 0), which nobody earns.
    ...SKINS
        .filter(s => s.unlock > 0)
        .map(s => ({
            id: 'skin:' + s.name,
            name: s.name,
            desc: 'Reach ' + s.unlock.toLocaleString('en-US') + 'm to unlock this Pixel',
            skin: s, // the Pixel it unlocks
            secret: !!s.secret,
            condition: (state) => state.bestHeight >= s.unlock
        }))
];
