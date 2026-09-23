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
    PROJECTILE_SPEED: 6
};

const BIOMES = [
    { threshold: 0, name: "Atmosphere", bg: "#050505", grid: "#1a1a1a", platform: "#00ffcc" },
    { threshold: 1000, name: "Ionosphere", bg: "#0a001a", grid: "#330066", platform: "#ff00ff" },
    { threshold: 3000, name: "Low Orbit", bg: "#000a1a", grid: "#003366", platform: "#00ccff" },
    { threshold: 6000, name: "Deep Space", bg: "#0a0a0a", grid: "#222", platform: "#ffd700" }
];

const SKINS = [
    { name: "Unit 734", color: "#ff3366", eye: "white", unlock: 0, ability: { jumpMult: 1, speedMult: 1 } },
    { name: "The Ghost", color: "#ffffff", eye: "black", unlock: 500, ability: { gravityMult: 0.85 } },
    { name: "Matrix", color: "#00ff00", eye: "black", unlock: 1000, ability: { speedMult: 1.2 } },
    { name: "Deep Void", color: "#330033", eye: "#ff00ff", unlock: 2000, ability: { jumpMult: 1.15 } },
    { name: "Golden", color: "#ffd700", eye: "#8B4500", unlock: 3500, ability: { speedMult: 1.1, gravityMult: 0.9 } },
    { name: "Glitch", color: "#00ffff", eye: "white", unlock: 5000, ability: { jumpMult: 1.1, speedMult: 1.1 } },
    { name: "The End", color: "#111", eye: "red", unlock: 8000, ability: { gravityMult: 0.75 } }
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

const STORY = [
    { h: 100, t: "SYSTEM: Unit 734. Maintain baseline altitude." },
    { h: 500, t: "SYSTEM: Detected foreign objects. Use them." },
    { h: 1000, t: "SYSTEM: Why climb? Gravity is the only law." },
    { h: 2500, t: "SYSTEM: You are exceeding recommended parameters." },
    { h: 5000, t: "SYSTEM: Safety protocols disengaged." },
    { h: 8000, t: "SYSTEM: Pixel Jump: The next level." }
];
