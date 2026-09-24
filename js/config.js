// Master switch for the entire ad system (js/ads.js). Off = zero ad-related
// UI, delay, or network calls anywhere: side rails stay blank, the revive
// prompt is skipped in favor of an instant free continue, and the
// restart interstitial never fires. Flip to true once ready to run ads.
const ADS_ENABLED = false;

// Build identity. GAME_VERSION tags asset URLs (index.html ?v=...) so a
// deploy never mixes cached old scripts with new ones; NET_PROTOCOL must
// match for two players to share a co-op run. Bump NET_PROTOCOL whenever the
// co-op messages, level generation, or the SKINS/POWERS order change.
const GAME_VERSION = '1.5.0';
const NET_PROTOCOL = 2;

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
    DRONE_SPAWN_RATE: 120,
    PROJECTILE_SPEED: 6,
    BOSS_LOOP_DISTANCE: 4000
};

// Level generation version: bump when spawnPlatform() would build a different
// layout from the same seed (saved ghosts from other versions are dropped).
const PLATFORM_GEN_VERSION = 2;
// How far above the top of the screen platforms are generated in advance.
const PLATFORM_LOOKAHEAD = CONFIG.HEIGHT;
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
const BIOMES = [
    { threshold: 0, name: "Atmosphere", bg: "#050505", grid: "#1a1a1a", platform: "#00ffcc", hazards: [] },
    { threshold: 600, name: "Ionosphere", bg: "#0a001a", grid: "#330066", platform: "#ff00ff", hazards: ["wind"] },
    { threshold: 1800, name: "Low Orbit", bg: "#000a1a", grid: "#003366", platform: "#00ccff", hazards: ["wind", "moving"] },
    { threshold: 3200, name: "Deep Space", bg: "#0a0a0a", grid: "#222", platform: "#ffd700", hazards: ["wind", "moving", "meteor"] },
    { threshold: 5000, name: "The Rift", bg: "#1a0022", grid: "#4d0066", platform: "#cc00ff", hazards: ["wind", "moving", "meteor", "gravityPulse"] },
    { threshold: 8000, name: "Neon Grid", bg: "#001010", grid: "#00ffaa", platform: "#00ff99", hazards: ["wind", "moving", "meteor", "gravityPulse", "laser"] },
    { threshold: 12000, name: "Static Field", bg: "#0a0a0a", grid: "#555555", platform: "#ffffff", hazards: ["wind", "moving", "meteor", "gravityPulse", "laser", "glitch"] },
    { threshold: 17000, name: "The Void", bg: "#000000", grid: "#220022", platform: "#ff0055", hazards: ["wind", "moving", "meteor", "gravityPulse", "laser", "glitch"] }
];

// The biome at a given height in meters (the single source of truth for both
// the renderer and level generation).
function biomeAt(meters) {
    for (let i = BIOMES.length - 1; i >= 0; i--) {
        if (meters >= BIOMES[i].threshold) return BIOMES[i];
    }
    return BIOMES[0];
}

// Shop consumables. Extra lives are bought with shards and carried between
// runs as stock — each one is spent automatically on a death that would
// otherwise end the run (see Game.die()).
const EXTRA_LIFE_COST = 50;
const MAX_EXTRA_LIVES = 3;

// Multiplayer: host + up to 3 guests (NetworkManager.maxGuests must match).
// Slot 0 is always the party leader; each slot's colour is used for that
// player's in-game name tag and their row in the party panel.
const MAX_PARTY_SIZE = 4;
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

    // Gem-shop Pixels, cheapest first. The bottom tiers each carry one plain
    // stat perk; every tier above buys a unique perk stronger than the last.
    // At roughly 200 shards per 1000m climbed the top tier is a long grind
    // (softened once GEMS x2 is owned). See Game.renderGemShop().
    { id: 'nebula', name: "Nebula Drifter", color: "#6633ff", eye: "#ccccff", cost: 75, ability: { speedMult: 1.15 } },
    { id: 'chrome', name: "Chrome Unit", color: "#cccccc", eye: "#333333", cost: 200, ability: { jumpMult: 1.15 } },
    { id: 'solarflare', name: "Solar Flare", color: "#ff6600", eye: "#ffffff", cost: 500, ability: { gravityMult: 0.88 } },
    { id: 'obsidian', name: "Obsidian", color: "#1a0033", eye: "#ff00ff", cost: 1200, ability: { powerDurationMult: 2 } },
    { id: 'prism', name: "Prism", color: "#ff00ff", eye: "#ffffff", cost: 2500, ability: { lifePowerUp: true } },
    { id: 'pulsewarden', name: "Pulse Warden", color: "#00ff99", eye: "#003322", cost: 5000, ability: { dronePulseSec: 7 } },
    { id: 'hoarder', name: "Crystal Hoarder", color: "#33e0ff", eye: "#002233", cost: 9000, ability: { shardMult: 2 } },
    { id: 'aegis', name: "Aegis", color: "#3366ff", eye: "#ffffff", cost: 15000, ability: { biomeImmune: true } },
    { id: 'overclock', name: "Overclock", color: "#ff2222", eye: "#ffe600", cost: 25000, ability: { scoreMult: 2 } },

    // Secret skins: never shown in the menu picker until their distance is
    // reached (see Game.unlockedSkinIndexes()), one per new biome.
    { id: 'riftdiver', name: "Rift Diver", color: "#6600cc", eye: "#00ffff", unlock: 5000, secret: true, ability: { powerDurationMult: 1.5 } },
    { id: 'neonghost', name: "Neon Ghost", color: "#ff0099", eye: "#00ffff", unlock: 8000, secret: true, ability: { shardMagnetRadius: 150 } },
    { id: 'staticking', name: "Static King", color: "#ffffff", eye: "#ff0000", unlock: 12000, secret: true, ability: { extraRevive: 1 } },
    { id: 'thevoid', name: "The Void", color: "#000000", eye: "#ff0000", unlock: 17000, secret: true, ability: { startAtScore: 50000, jumpMult: 1.1 } }
];

function skinIndexById(id) {
    return SKINS.findIndex(s => s.id === id);
}

// Perks: the passive buff a Pixel grants, keyed by its SKINS[i].ability key.
// `label` is the short tag shown on the menu/shop, `describe(value)` the full
// stat text revealed on hover/tap, and `active(value)` whether a value does
// anything at all (a 1x multiplier doesn't). Tags render in this order.
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
    { key: 'shardMagnetRadius', label: 'MAGNET', color: '#ffff00', active: v => !!v,
      describe: () => 'Always pulls in nearby shards' },
    { key: 'extraRevive', label: 'REVIVE', color: '#00ffaa', active: v => !!v,
      describe: v => v + ' free revive every run' },
    { key: 'startAtScore', label: 'RIFT', color: '#9933ff', active: v => !!v,
      describe: v => 'Solo runs start at ' + Math.floor(v / 10) + 'm (The Rift)' },
    { key: 'lifePowerUp', label: 'PHOENIX', color: '#ff5533', active: v => !!v,
      describe: () => 'Using an extra life or revive grants a random power-up' },
    { key: 'dronePulseSec', label: 'EMP', color: '#00ff99', active: v => !!v,
      describe: v => 'Every ' + v + 's, destroys all drones on screen (solo only)' },
    { key: 'shardMult', label: 'GEMS x2', color: '#33e0ff', active: v => !!v && v !== 1,
      describe: v => 'Shard pickups are worth ' + v + 'x' },
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
    { id: '1km', name: 'Kilometer Club', condition: (state, player) => state.score >= 10000 },
    { id: '5km', name: 'Stratosphere', condition: (state, player) => state.score >= 50000 },
    { id: 'magnet', name: 'Attractive', condition: (state, player) => player.activePower && player.activePower.name === "MAGNET" },
    { id: 'pacifist', name: 'Pacifist Pilot', condition: (state, player) => state.score >= 50000 && state.powersCollected === 0 },
    { id: 'boss', name: 'Titan Slayer', condition: (state, player) => state.loops >= 1 },
    { id: 'rich', name: 'Data Hoarder', condition: (state, player) => state.shards >= 100 },

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
            skin: true,
            condition: (state) => state.highScore >= s.unlock
        }))
];

const STORY = [
    { h: 30, t: "SYSTEM: Unit 734. Maintain baseline altitude." },
    { h: 150, t: "SYSTEM: Detected foreign objects. Use them." },
    { h: 400, t: "SYSTEM: Why climb? Gravity is the only law." },
    { h: 1000, t: "SYSTEM: You are exceeding recommended parameters." },
    { h: 2500, t: "SYSTEM: Safety protocols disengaged." },
    { h: 4000, t: "SYSTEM: Pixel Jump: The next level." }
];
