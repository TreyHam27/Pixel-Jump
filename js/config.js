// Master switch for the entire ad system (js/ads.js). Off = zero ad-related
// UI, delay, or network calls anywhere: side rails stay blank, the revive
// prompt is skipped in favor of an instant free continue, and the
// restart interstitial never fires. Flip to true once ready to run ads.
const ADS_ENABLED = false;

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

// Shop consumables. Extra lives are bought with shards and carried between
// runs as stock — each one is spent automatically on a death that would
// otherwise end the run (see Game.die()).
const EXTRA_LIFE_COST = 50;
const MAX_EXTRA_LIVES = 3;

const SKINS = [
    { name: "Unit 734", color: "#ff3366", eye: "white", unlock: 0, ability: { jumpMult: 1, speedMult: 1 } },
    { name: "The Ghost", color: "#ffffff", eye: "black", unlock: 150, ability: { gravityMult: 0.85 } },
    { name: "Matrix", color: "#00ff00", eye: "black", unlock: 350, ability: { speedMult: 1.2 } },
    { name: "Deep Void", color: "#330033", eye: "#ff00ff", unlock: 700, ability: { jumpMult: 1.15 } },
    { name: "Golden", color: "#ffd700", eye: "#8B4500", unlock: 1400, ability: { speedMult: 1.1, gravityMult: 0.9 } },
    { name: "Glitch", color: "#00ffff", eye: "white", unlock: 2500, ability: { jumpMult: 1.1, speedMult: 1.1 } },
    { name: "The End", color: "#111", eye: "red", unlock: 4000, ability: { gravityMult: 0.75 } },

    // Gem-shop skins: bought directly with shards (not distance-gated), price
    // steps ~3x per tier so early ones are an easy buy and the top end is a
    // real grind. See Game.isSkinLocked()/renderGemShop().
    { name: "Nebula Drifter", color: "#6633ff", eye: "#ccccff", cost: 75, ability: { speedMult: 1.15 } },
    { name: "Chrome Unit", color: "#cccccc", eye: "#333333", cost: 250, ability: { jumpMult: 1.15 } },
    { name: "Solar Flare", color: "#ff6600", eye: "#ffffff", cost: 750, ability: { gravityMult: 0.9, speedMult: 1.05 } },
    { name: "Obsidian", color: "#1a0033", eye: "#ff00ff", cost: 2200, ability: { shardMagnetRadius: 100, jumpMult: 1.05 } },
    { name: "Prism", color: "#ff00ff", eye: "#ffffff", cost: 6000, ability: { powerDurationMult: 1.75 } },

    // Secret skins: masked as "???" in the carousel until their distance is
    // reached (see Game.isSkinLocked()/updateSkinUI()), one per new biome.
    { name: "Rift Diver", color: "#6600cc", eye: "#00ffff", unlock: 5000, secret: true, ability: { powerDurationMult: 1.5 } },
    { name: "Neon Ghost", color: "#ff0099", eye: "#00ffff", unlock: 8000, secret: true, ability: { shardMagnetRadius: 150 } },
    { name: "Static King", color: "#ffffff", eye: "#ff0000", unlock: 12000, secret: true, ability: { extraRevive: 1 } },
    { name: "The Void", color: "#000000", eye: "#ff0000", unlock: 17000, secret: true, ability: { startAtScore: 50000, jumpMult: 1.1 } }
];

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
    { id: 'rich', name: 'Data Hoarder', condition: (state, player) => state.shards >= 100 }
];

const STORY = [
    { h: 30, t: "SYSTEM: Unit 734. Maintain baseline altitude." },
    { h: 150, t: "SYSTEM: Detected foreign objects. Use them." },
    { h: 400, t: "SYSTEM: Why climb? Gravity is the only law." },
    { h: 1000, t: "SYSTEM: You are exceeding recommended parameters." },
    { h: 2500, t: "SYSTEM: Safety protocols disengaged." },
    { h: 4000, t: "SYSTEM: Pixel Jump: The next level." }
];
