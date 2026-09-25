function rectsIntersect(r1, r2) {
    return !(r2.x > r1.x + r1.w ||
        r2.x + r2.w < r1.x ||
        r2.y > r1.y + r1.h ||
        r2.y + r2.h < r1.y);
}

// Draws a Pixel: its body (with an optional glow) and eyes looking `look`
// px sideways. Shared by the player, teammates and the daily ghost.
function drawPixel(ctx, x, y, skin, look = 0, glowColor = null, glowBlur = 10) {
    if (glowColor) {
        ctx.shadowBlur = glowBlur;
        ctx.shadowColor = glowColor;
    }
    ctx.fillStyle = skin.color;
    ctx.fillRect(x, y, 26, 26);
    ctx.shadowBlur = 0;
    ctx.fillStyle = skin.eye;
    ctx.fillRect(x + 5 + look, y + 7, 5, 5);
    ctx.fillRect(x + 16 + look, y + 7, 5, 5);
}

// Enemy art is all fillRect, chunky pixel art like the Pixels themselves.
// Every helper leaves shadowBlur at 0 and globalAlpha as it found it.

// A rotor seen side-on: a strut up from `topY`, a faint blur disc, and a
// blade whose visible width swings with cos(t) so it reads as spinning.
// `t` is the enemy's own dt clock, so TIME WARP slows it and pause stops it.
function drawRotor(ctx, cx, topY, span, t, speed, scale = 1) {
    const s = scale;
    ctx.fillStyle = "#4a4e60";
    ctx.fillRect(cx - s, topY - 4 * s, 2 * s, 4 * s);
    const bladeY = topY - 6 * s;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * 0.25;
    ctx.fillStyle = "#c8ccdc";
    ctx.fillRect(cx - span / 2, bladeY, span, 2 * s);
    ctx.globalAlpha = alpha;
    const half = Math.max(s, Math.round(Math.abs(Math.cos(t * speed)) * span / 2));
    ctx.fillRect(cx - half, bladeY, half * 2, 2 * s);
    ctx.fillStyle = "#6b7086";
    ctx.fillRect(cx - 2 * s, bladeY - s, 4 * s, 3 * s);
}

// A body with `c`px chamfered corners: a 2px neon rim in `rim` (glowing)
// around a dark `fill`, with a faint highlight along the top.
function drawHull(ctx, x, y, w, h, fill, rim, c = 2, glow = 8) {
    ctx.fillStyle = rim;
    ctx.shadowBlur = glow;
    ctx.shadowColor = rim;
    ctx.fillRect(x + c, y, w - 2 * c, h);
    ctx.fillRect(x, y + c, w, h - 2 * c);
    ctx.shadowBlur = 0;
    // The same shape shrunk by 2px, so the rim steps round the corners too.
    ctx.fillStyle = fill;
    ctx.fillRect(x + c + 2, y + 2, w - 2 * c - 4, h - 4);
    ctx.fillRect(x + 2, y + c + 2, w - 4, h - 2 * c - 4);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(x + c + 2, y + 2, w - 2 * c - 4, 1);
}

// A glowing rect (eyes, lenses, muzzles).
function drawGlow(ctx, x, y, w, h, color, blur = 10) {
    ctx.fillStyle = color;
    ctx.shadowBlur = blur;
    ctx.shadowColor = color;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
}

class Entity {
    constructor(x, y, w, h, color) {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.vx = 0; this.vy = 0;
        this.color = color;
        this.markedForDeletion = false;
    }
    update(dt) { }
    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
    }
}

class Player extends Entity {
    constructor(x, y, skinIndex = 0) {
        super(x, y, 26, 26, "#fff");
        this.skin = SKINS[skinIndex] || SKINS[0];
        this.color = this.skin.color;
        this.isDead = false;
        this.grounded = false;
        this.coyote = 0;
        this.doubleReady = false;
        this.activePower = null;
        this.powerTimer = 0;
        this.invuln = 0; // frames of hit immunity (after a jetpack crash into the boss)
    }

    // Throws the player upward from a revive or spent life. Standing on a
    // platform when they died left grounded/coyote set, which let a buffered
    // jump replace the launch with a weaker hop on the very next frame.
    launch(vy) {
        this.vy = vy;
        this.vx = 0;
        this.grounded = false;
        this.coyote = 0;
    }

    setSkin(index) {
        this.skin = SKINS[index] || SKINS[0];
        this.color = this.skin.color;
    }

    update(dt, input, platforms, powerups) {
        if (this.invuln > 0) this.invuln -= dt;

        // Powerup Timer
        if (this.activePower) {
            this.powerTimer -= dt;
            if (this.powerTimer <= 0) {
                this.activePower = null;
                this.doubleReady = false;
            }
        }

        // Skin Abilities
        const ability = this.skin.ability || { jumpMult: 1, speedMult: 1, gravityMult: 1 };
        let moveSpeed = CONFIG.SPEED * (ability.speedMult || 1) * dt;

        if (input.keys.left) this.vx -= moveSpeed;
        if (input.keys.right) this.vx += moveSpeed;

        // Friction
        this.vx *= Math.pow(CONFIG.FRICTION, dt);

        // Apply Movement
        this.x += this.vx * dt;

        // Screen wrap: the sides are one seam. x stays in [0, WIDTH); past
        // WIDTH - w the Pixel straddles the edge and draw() shows the rest of
        // it coming in on the left.
        if (this.x >= CONFIG.WIDTH) this.x -= CONFIG.WIDTH;
        if (this.x < 0) this.x += CONFIG.WIDTH;

        // Gravity & Jetpack
        if (this.activePower && this.activePower.name === "JETPACK") {
            this.vy = -16;
            this.y += this.vy * dt;
            if (Math.random() < 0.5) return "thrust";
        } else {
            this.vy += CONFIG.GRAVITY * (ability.gravityMult || 1) * dt;
            this.y += this.vy * dt;
        }

        // Trail Particles
        let event = null;
        if (Math.abs(this.vy) > 2 || Math.abs(this.vx) > 2) {
            event = "trail";
        }

        // Grounded State Logic
        if (this.grounded) {
            this.coyote = 8;
            this.doubleReady = true;
        } else if (this.coyote > 0) {
            this.coyote -= dt;
        }

        // Jump
        if (input.keys.buffer > 0) {
            let jumpPwr = ((this.activePower === POWERS.SUPER) ? CONFIG.SUPER_JUMP_FORCE : CONFIG.JUMP_FORCE) * (ability.jumpMult || 1);

            if (this.coyote > 0) {
                this.vy = jumpPwr;
                this.coyote = 0;
                // This returns before the platform check below, so drop the
                // grounded flag here; otherwise next frame still counts as
                // standing, refills coyote time and allows a mid-air re-jump.
                this.grounded = false;
                input.keys.buffer = 0;
                return "jump";
            } else if ((this.activePower === POWERS.DOUBLE || ability.airJump) && this.doubleReady) {
                this.vy = CONFIG.JUMP_FORCE * (ability.jumpMult || 1);
                this.doubleReady = false;
                input.keys.buffer = 0;
                return "double_jump";
            }
        }

        // Platform Collisions
        this.grounded = false;
        if (this.vy > 0) {
            for (let p of platforms) {
                // Platforms scrolled below the screen are kept around briefly
                // before being culled; don't let an invisible one catch a fall.
                if (p.y >= CONFIG.HEIGHT - 3) continue;
                // Also the part of us that has wrapped round to the left edge.
                const overlaps = (x) => x + this.w > p.x && x < p.x + p.w;
                if (overlaps(this.x) || overlaps(this.x - CONFIG.WIDTH)) {
                    let bottom = this.y + this.h;
                    let limit = p.y + p.h + (this.vy * dt) + 10;

                    if (bottom > p.y && bottom < limit) {
                        this.grounded = true;
                        this.vy = 0;
                        this.y = p.y - this.h;
                        if (p.vx) {
                            this.x += p.vx * dt; // Stick to moving platform
                        }
                    }
                }
            }
        }

        // Powerup Collisions
        for (let i = powerups.length - 1; i >= 0; i--) {
            let p = powerups[i];

            // Magnet Logic (temporary MAGNET power-up pulls any pickup)
            if (this.activePower === POWERS.MAGNET) this.pullPickup(p, 200, dt);

            // Always-on shard pull from an equipped Pixel's permanent ability
            // (separate from, and stacks with, the temporary MAGNET power-up)
            if (p.isShard && ability.shardMagnetRadius) this.pullPickup(p, ability.shardMagnetRadius, dt);

            if (rectsIntersect(this, p)) {
                if (p.isShard) {
                    p.markedForDeletion = true;
                    return { event: "shard", x: p.x, y: p.y, value: p.shardValue || 1, color: BIOMES[p.tier || 0].gem.color };
                } else if (p.isHeart) {
                    p.markedForDeletion = true;
                    return { event: "heart", x: p.x, y: p.y };
                } else {
                    this.activatePower();
                    p.markedForDeletion = true;
                    return { event: "powerup", x: p.x, y: p.y };
                }
            }
        }

        return event;
    }

    // Drags a pickup 10% of the way toward the player per 60fps frame. The
    // pickup bobs around startY (Game.draw() rewrites y from it every frame),
    // so the pull has to move startY too or it only ever works sideways.
    pullPickup(p, radius, dt) {
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        if (dx * dx + dy * dy >= radius * radius) return;
        const k = 1 - Math.pow(0.9, dt);
        p.x += dx * k;
        p.y += dy * k;
        if (p.startY !== undefined) p.startY += dy * k;
    }

    activatePower() {
        const ability = this.skin.ability || {};
        // A pickup while a power is running refreshes it instead of swapping.
        if (this.activePower) {
            this.powerTimer = this.activePower.time * (ability.powerDurationMult || 1);
            if (this.activePower === POWERS.DOUBLE) this.doubleReady = true;
            return;
        }
        // A power the Pixel already has for good (AIR JUMP, MAGNET) would be
        // a dud, so it's left out of the draw.
        const covered = skinPerks(ability).map(({ perk }) => POWERS[perk.covers]).filter(Boolean);
        const types = Object.values(POWERS).filter(p => !covered.includes(p));
        this.grantPower(types[Math.floor(Math.random() * types.length)]);
    }

    // Starts a specific power (replacing any running one) for its full,
    // perk-stretched duration.
    grantPower(p) {
        const ability = this.skin.ability || {};
        this.activePower = p;
        this.powerTimer = p.time * (ability.powerDurationMult || 1);
        if (p === POWERS.DOUBLE) this.doubleReady = true;
    }

    draw(ctx) {
        const glow = this.activePower ? this.activePower.color : this.color;
        const blur = this.activePower ? 20 : 10;
        const look = this.vx > 0.5 ? 4 : (this.vx < -0.5 ? -4 : 0);
        drawPixel(ctx, this.x, this.y, this.skin, look, glow, blur);
        // Straddling the right edge: the rest of the Pixel is already coming
        // in on the left.
        if (this.x > CONFIG.WIDTH - this.w) {
            drawPixel(ctx, this.x - CONFIG.WIDTH, this.y, this.skin, look, glow, blur);
        }
    }
}

class ParticleSystem {
    constructor() {
        this.particles = [];
    }

    spawn(x, y, color, count = 5, type = "normal") {
        // Reduced motion (Settings) thins every burst out.
        if (this.scale !== undefined && this.scale !== 1) count = Math.max(1, Math.round(count * this.scale));
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: x, y: y,
                vx: (Math.random() - 0.5) * (type === "blast" ? 15 : 6),
                vy: (Math.random() - 0.5) * (type === "blast" ? 15 : 6),
                life: type === "trail" ? 10 : 30,
                maxLife: type === "trail" ? 10 : 30,
                color: color,
                size: type === "blast" ? 6 : 4
            });
        }
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    draw(ctx) {
        this.particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.fillRect(p.x, p.y, p.size, p.size);
        });
        ctx.globalAlpha = 1;
    }
}

class Drone extends Entity {
    constructor(y, difficulty = 1) {
        const side = Math.random() < 0.5 ? -40 : CONFIG.WIDTH + 40;
        super(side, y, 30, 20, "#ff0000");
        this.targetX = side < 0 ? CONFIG.WIDTH + 100 : -100;

        // Scale speed with difficulty
        const baseSpeed = CONFIG.DRONE_BASE_VELOCITY || 2;
        const maxSpeed = CONFIG.DRONE_MAX_VELOCITY || 8;
        let speed = (baseSpeed + Math.random() * 3) * difficulty;
        if (speed > maxSpeed) speed = maxSpeed;

        this.v = speed * (side < 0 ? 1 : -1);
        this.sinOffset = Math.random() * Math.PI * 2;
        this.difficulty = difficulty;
        this.t = 0; // animation clock (guests advance it in followNetEnemy)
    }

    update(dt) {
        this.t += dt;
        // After leaving the screen a drone waits off-screen briefly, then
        // comes back in from the same side, a little higher or lower.
        if (this.hidden) {
            this.respawnTimer -= dt;
            if (this.respawnTimer > 0) return;
            this.hidden = false;
            this.x = this.exitSide < 0 ? -40 : CONFIG.WIDTH + 40;
            this.v = -this.v;
            this.y += (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 30);
            this.sinOffset = Math.random() * Math.PI * 2;
            return;
        }

        this.x += this.v * dt;
        this.y += Math.sin(this.x * 0.05 + this.sinOffset) * 2 * dt;
        if ((this.v > 0 && this.x > CONFIG.WIDTH + 50) || (this.v < 0 && this.x < -100)) {
            this.hidden = true;
            this.exitSide = this.v > 0 ? 1 : -1;
            this.respawnTimer = 45 + Math.random() * 45;
        }
    }

    draw(ctx) {
        if (this.hidden) return;
        const x = Math.round(this.x), y = Math.round(this.y), w = this.w, h = this.h;
        const dir = this.v < 0 ? -1 : 1;

        drawRotor(ctx, x + 7, y, 14, this.t, 0.5);
        drawRotor(ctx, x + w - 7, y, 14, this.t + 2, 0.5);
        this.drawThrusters(ctx, x, y);
        drawHull(ctx, x, y, w, h, "#1b1b26", "#ff2a44");

        // Visor with a red eye on the leading edge, scanning a pixel or two.
        ctx.fillStyle = "#0a0a10";
        ctx.fillRect(x + 4, y + 6, w - 8, 7);
        const scan = Math.round(Math.sin(this.t * 0.08) * 1.5);
        const ex = (dir > 0 ? x + w - 12 : x + 6) + scan;
        drawGlow(ctx, ex, y + 7, 6, 5, "#ff2a44");
        ctx.fillStyle = "#ffd0d6";
        ctx.fillRect(ex + (dir > 0 ? 4 : 0), y + 7, 2, 2);

        ctx.fillStyle = "#2e2e3e";
        ctx.fillRect(x + 4, y + 15, w - 8, 1);
    }

    // Two nubs under the hull with a flickering exhaust.
    drawThrusters(ctx, x, y) {
        const flick = Math.abs(Math.sin(this.t * 0.6));
        for (const nx of [x + 6, x + this.w - 10]) {
            ctx.fillStyle = "#4a4e60";
            ctx.fillRect(nx, y + this.h - 1, 4, 3);
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * (0.4 + 0.6 * flick);
            ctx.fillStyle = "#ff8a3d";
            ctx.fillRect(nx + 1, y + this.h + 2, 2, 1 + Math.round(flick * 2));
            ctx.globalAlpha = alpha;
        }
    }
}

class Projectile extends Entity {
    constructor(x, y, vx, vy) {
        super(x, y, 8, 8, "#ff3300");
        this.vx = vx;
        this.vy = vy;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.y > CONFIG.HEIGHT + 50 || this.y < -500 || this.x < -50 || this.x > CONFIG.WIDTH + 50) {
            this.markedForDeletion = true;
        }
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.shadowBlur = 0;
    }
}

class ShooterDrone extends Drone {
    constructor(y, difficulty = 1) {
        super(y, difficulty);
        this.color = "#ffaa00";
        this.shootTimer = 60 + Math.random() * 60;
        this.w = 34; // Slightly larger
        this.h = 24;
    }

    update(dt, player, projectiles) {
        super.update(dt);
        if (this.hidden) return;

        this.shootTimer -= dt;
        if (this.shootTimer <= 0) {
            this.shoot(player, projectiles);
            this.shootTimer = Math.max(40, 120 - (this.difficulty * 10)) + Math.random() * 60;
        }
    }

    shoot(player, projectiles) {
        if (!player) return;

        // Simple aim at player
        const dx = (player.x + player.w / 2) - (this.x + this.w / 2);
        const dy = (player.y + player.h / 2) - (this.y + this.h / 2);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const speed = CONFIG.PROJECTILE_SPEED || 6;
        const vx = (dx / dist) * speed;
        const vy = (dy / dist) * speed;

        projectiles.push(new Projectile(this.x + this.w / 2 - 4, this.y + this.h / 2 - 4, vx, vy));
    }

    draw(ctx) {
        if (this.hidden) return;
        const x = Math.round(this.x), y = Math.round(this.y), w = this.w, h = this.h;
        const dir = this.v < 0 ? -1 : 1;
        const charging = this.shootTimer < 20;

        drawRotor(ctx, x + 8, y, 16, this.t, 0.7);
        drawRotor(ctx, x + w - 8, y, 16, this.t + 2, 0.7);

        // Under-slung cannon; the muzzle charges white just before it fires.
        const cx = x + w / 2;
        ctx.fillStyle = "#2b2b38";
        ctx.fillRect(cx - 4, y + h - 1, 8, 3);
        ctx.fillRect(cx - 2, y + h + 2, 4, 3);
        const m = charging ? 6 : 4;
        drawGlow(ctx, cx - m / 2, y + h + 5, m, charging ? 4 : 2, charging ? "#ffffff" : "#ffaa00", charging ? 16 : 6);

        drawHull(ctx, x, y, w, h, "#1d1b24", "#ffaa00");

        // Armour: a plating seam and rivets.
        ctx.fillStyle = "#3a3444";
        ctx.fillRect(x + 3, y + 13, w - 6, 1);
        ctx.fillRect(x + 5, y + 16, 2, 2);
        ctx.fillRect(x + w - 7, y + 16, 2, 2);

        // Visor slit on the leading side.
        ctx.fillStyle = "#0a0a10";
        ctx.fillRect(x + 4, y + 5, w - 8, 6);
        drawGlow(ctx, dir > 0 ? x + w - 16 : x + 6, y + 6, 10, 3, charging ? "#ffffff" : "#ffaa00");
    }
}

class LaserDrone extends Entity {
    // Hovers roughly in place, cycling cooldown -> telegraph -> firing.
    // While firing, its own x/y/w/h expand into a full-width beam rect, so
    // the game's generic rectsIntersect(player, enemy) collision check just
    // works without any special-casing (same as every other enemy type).
    constructor(y) {
        const bodyW = 34, bodyH = 20;
        super(CONFIG.WIDTH / 2 - bodyW / 2, y, bodyW, bodyH, "#ff0055");
        this.bodyW = bodyW;
        this.bodyH = bodyH;
        this.driftPhase = Math.random() * Math.PI * 2;
        this.phase = "cooldown"; // cooldown -> telegraph -> firing -> cooldown
        this.timer = 90 + Math.random() * 90;
        this.t = 0; // animation clock (guests advance it in followNetEnemy)
    }

    update(dt) {
        this.t += dt;
        this.driftPhase += 0.02 * dt;

        if (this.phase !== "firing") {
            this.x = CONFIG.WIDTH / 2 - this.bodyW / 2 + Math.sin(this.driftPhase) * 200;
            this.w = this.bodyW;
            this.h = this.bodyH;
        }

        this.timer -= dt;
        if (this.timer <= 0) {
            if (this.phase === "cooldown") {
                this.phase = "telegraph";
                this.timer = 45; // warning window before the beam fires
            } else if (this.phase === "telegraph") {
                this.phase = "firing";
                this.timer = 18; // beam stays live briefly
                this.x = 0;
                this.w = CONFIG.WIDTH;
                this.h = 8;
            } else {
                this.phase = "cooldown";
                this.timer = 150 + Math.random() * 90;
            }
        }

        if (this.y > CONFIG.HEIGHT + 200) this.markedForDeletion = true;
    }

    draw(ctx) {
        const y = Math.round(this.y);
        // While firing, x/w are the beam's, so remember where the body was.
        // Co-op snapshots send x = 0 during the beam too, so this is the only
        // place host and guests both know it.
        if (this.phase !== "firing") this.bodyX = this.x;
        const bx = Math.round(this.bodyX !== undefined ? this.bodyX : CONFIG.WIDTH / 2 - this.bodyW / 2);

        // The warning band covers exactly the rect the beam will hit
        // (y .. y + 8 once it fires).
        if (this.phase === "telegraph") {
            const a = 0.2 + 0.2 * Math.abs(Math.sin(this.t * 0.25));
            ctx.fillStyle = `rgba(255, 0, 85, ${a})`;
            ctx.fillRect(0, y, CONFIG.WIDTH, 8);
            ctx.fillStyle = `rgba(255, 170, 0, ${a + 0.2})`;
            ctx.fillRect(0, y + 4, CONFIG.WIDTH, 1);
        }

        if (this.phase === "firing") {
            drawGlow(ctx, this.x, y, this.w, this.h, "#ff0055", 20);
            ctx.fillStyle = "#ffd6e4";
            ctx.fillRect(this.x, y + 3, this.w, 2);
        }

        this.drawBody(ctx, bx, y);
    }

    drawBody(ctx, x, y) {
        const w = this.bodyW, h = this.bodyH;
        const blink = Math.floor(this.t / 4) % 2 === 0;
        const charge = this.phase === "telegraph" ? (blink ? "#ffaa00" : "#ffffff")
            : this.phase === "firing" ? "#ffffff" : "#ff0055";

        drawRotor(ctx, x + 6, y, 12, this.t, 0.55);
        drawRotor(ctx, x + w - 6, y, 12, this.t + 2, 0.55);

        // Emitter prongs level with the beam band.
        ctx.fillStyle = "#3a0c22";
        ctx.fillRect(x - 4, y + 1, 4, 6);
        ctx.fillRect(x + w, y + 1, 4, 6);
        drawGlow(ctx, x - 4, y + 3, 2, 2, charge, 8);
        drawGlow(ctx, x + w + 2, y + 3, 2, 2, charge, 8);

        drawHull(ctx, x, y, w, h, "#1e0a16", "#ff0055");

        // Lens housing and lens, centred on the beam line.
        ctx.fillStyle = "#0a0308";
        ctx.fillRect(x + w / 2 - 6, y, 12, 8);
        drawGlow(ctx, x + w / 2 - 3, y + 1, 6, 6, charge, this.phase === "cooldown" ? 8 : 16);

        // Cooling vents.
        ctx.fillStyle = "#4a1030";
        ctx.fillRect(x + 6, y + 11, w - 12, 1);
        ctx.fillRect(x + 6, y + 14, w - 12, 1);
    }
}

class Meteor extends Entity {
    constructor(x, y, vx, vy) {
        super(x, y, 14, 14, "#ffaa00");
        this.vx = vx;
        this.vy = vy;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.y > CONFIG.HEIGHT + 200 || this.x < -100 || this.x > CONFIG.WIDTH + 100) {
            this.markedForDeletion = true;
        }
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#ff3300";

        ctx.beginPath();
        ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Meteor tail
        ctx.fillStyle = "rgba(255, 68, 0, 0.6)";
        ctx.beginPath();
        let cx = this.x + this.w / 2;
        let cy = this.y + this.h / 2;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - this.vx * 3, cy - this.vy * 3);
        ctx.lineTo(cx - this.vx * 3 + (this.vy * 0.2), cy - this.vy * 3 - (this.vx * 0.2));
        ctx.fill();
    }
}

// Snapshot encodings for co-op (index = wire value).
const BOSS_STATES = ['enter', 'hover', 'telegraph', 'dive', 'exposed', 'recover'];
const LASER_PHASES = ['cooldown', 'telegraph', 'firing'];

class BossDrone extends Entity {
    // A dt-driven state machine: enter -> hover -> telegraph -> dive ->
    // exposed -> recover -> hover ... (see BOSS in config.js). The boss lives
    // in screen space like everything else; shiftY() keeps its anchors in
    // step when the camera scrolls. It keeps its own clock, so TIME WARP
    // (which slows enemy dt) slows the whole fight.
    constructor(y) {
        super(CONFIG.WIDTH / 2 - 60, y, 120, 80, "#880000");
        this.hp = 10;
        this.maxHp = 10;
        this.state = 'enter';
        this.timer = 120;
        this.shootTimer = BOSS.VOLLEY;
        this.t = 0;
        this.strafe = 0;
        this.invuln = 0;
        this.laneX = this.x;
        this.anchorY = y;
    }

    get raging() { return this.hp <= this.maxHp / 2; }

    // Exposed (or still climbing away): side contact knocks you back
    // instead of killing you.
    isExposed() { return this.state === 'exposed' || this.state === 'recover'; }

    shiftY(d) {
        this.y += d;
        this.anchorY += d;
    }

    // `focus` is the player it hovers over; `pickDiveTarget` chooses whom to
    // dive at (the focus by default).
    update(dt, focus, projectiles, pickDiveTarget = () => focus) {
        this.t += dt;
        if (this.invuln > 0) this.invuln -= dt;

        const hoverY = Math.max(BOSS.HOVER_MIN_Y, focus.y - BOSS.HOVER_OFFSET);
        const easeY = (target, rate) => { this.y += (target - this.y) * (1 - Math.pow(1 - rate, dt)); };

        switch (this.state) {
            case 'enter':
                easeY(hoverY, 0.05);
                this.timer -= dt;
                if (this.timer <= 0 || Math.abs(this.y - hoverY) < 4) this.enterHover();
                break;

            case 'hover':
                this.strafe += dt;
                this.x = (CONFIG.WIDTH / 2 - this.w / 2) + Math.sin(this.strafe * 0.02) * 150;
                easeY(hoverY, 0.08);
                this.shootTimer -= dt;
                if (this.shootTimer <= 0) {
                    this.fireVolley(projectiles);
                    this.shootTimer = this.raging ? BOSS.VOLLEY_RAGE : BOSS.VOLLEY;
                }
                this.timer -= dt;
                if (this.timer <= 0) this.lockOn(pickDiveTarget() || focus);
                break;

            case 'telegraph':
                // Slide over the lane and rear back; the warning column (see
                // draw) shows exactly where it will come down.
                this.x += (this.laneX - this.x) * (1 - Math.pow(0.8, dt));
                easeY(Math.max(-40, hoverY - BOSS.WINDUP), 0.1);
                this.timer -= dt;
                if (this.timer <= 0) {
                    this.x = this.laneX;
                    this.state = 'dive';
                }
                break;

            case 'dive':
                this.y = Math.min(this.anchorY, this.y + BOSS.DIVE_SPEED * dt);
                if (this.y >= this.anchorY) {
                    this.state = 'exposed';
                    this.timer = BOSS.EXPOSED;
                }
                break;

            case 'exposed':
                this.y = this.anchorY;
                this.timer -= dt;
                if (this.timer <= 0) this.startRecover();
                break;

            case 'recover':
                easeY(hoverY, 0.1);
                this.timer -= dt;
                if (this.timer <= 0) this.enterHover();
                break;
        }
    }

    enterHover() {
        this.state = 'hover';
        this.timer = this.raging ? BOSS.HOVER_RAGE : BOSS.HOVER;
    }

    startRecover() {
        this.state = 'recover';
        this.timer = BOSS.RECOVER;
    }

    // Commit to a dive at `target`: its lane, and a landing height that puts
    // the boss's top just above the target's feet (a normal jump clears it).
    lockOn(target) {
        this.laneX = Math.max(0, Math.min(CONFIG.WIDTH - this.w, target.x + target.w / 2 - this.w / 2));
        this.anchorY = Math.max(100, Math.min(640, target.y + target.h - BOSS.ABOVE_FEET));
        this.state = 'telegraph';
        this.timer = this.raging ? BOSS.TELEGRAPH_RAGE : BOSS.TELEGRAPH;
    }

    fireVolley(projectiles) {
        const spread = this.raging ? 2 : 1;
        for (let i = -spread; i <= spread; i++) {
            projectiles.push(new Projectile(this.x + this.w / 2 - 4, this.y + this.h, i * 3, 6));
        }
    }

    // Returns true if the hit landed (it doesn't while the boss is still
    // flashing from the last one).
    takeDamage(particles) {
        if (this.invuln > 0 || this.markedForDeletion) return false;
        this.hp--;
        this.invuln = BOSS.HIT_INVULN;
        particles.spawn(this.x + this.w / 2, this.y + this.h / 2, "#fff", 50, "blast");
        if (this.hp <= 0) {
            this.markedForDeletion = true;
        } else {
            this.startRecover();
            this.shootTimer = 30;
        }
        return true;
    }

    draw(ctx) {
        // Warning column down to the landing spot while it winds up.
        if (this.state === 'telegraph') {
            const blink = 0.18 + 0.17 * Math.abs(Math.sin(this.t * 0.3));
            ctx.fillStyle = `rgba(255, 0, 60, ${blink})`;
            ctx.fillRect(this.laneX, this.y + this.h, this.w, Math.max(0, this.anchorY + this.h - (this.y + this.h)));
            ctx.fillStyle = "rgba(255, 0, 60, 0.8)";
            ctx.fillRect(this.laneX, this.anchorY + this.h - 3, this.w, 3);
        }

        const hovering = this.state === 'hover' || this.state === 'enter';
        const x = Math.round(this.x);
        const y = Math.round(this.y + (hovering ? Math.sin(this.t * 0.12) * 6 : 0));
        const w = this.w, h = this.h;
        const flashing = this.invuln > 0 && Math.floor(this.t / 3) % 2 === 0;
        const volleyDue = this.shootTimer < 20 && hovering;
        const pulse = Math.abs(Math.sin(this.t * (this.raging ? 0.25 : 0.08)));
        const rim = this.raging ? (pulse > 0.5 ? "#ff8800" : "#ff3300") : "#ff2244";

        this.drawRotorPods(ctx, x, y, rim);
        this.drawCannons(ctx, x, y, volleyDue);
        drawHull(ctx, x, y, w, h, "#1e070b", rim, 6, 14);

        // Armour plates; they blink hot while it lines up a dive.
        ctx.fillStyle = this.state === 'telegraph' && Math.floor(this.t / 4) % 2 ? "#cc2222" : this.color;
        ctx.fillRect(x + 8, y + 6, w - 16, 10);
        ctx.fillRect(x + 6, y + 20, 18, 40);
        ctx.fillRect(x + w - 24, y + 20, 18, 40);
        ctx.fillRect(x + 8, y + 64, w - 16, 10);
        ctx.fillStyle = "#4a0008";
        for (const px of [x + 6, x + w - 24]) {
            ctx.fillRect(px, y + 33, 18, 1);
            ctx.fillRect(px, y + 46, 18, 1);
        }
        for (let i = 0; i < 5; i++) {
            ctx.fillRect(x + 13 + i * 22, y + 12, 2, 2);
            ctx.fillRect(x + 13 + i * 22, y + 68, 2, 2);
        }

        this.drawEye(ctx, x, y, volleyDue);

        // Exposed: the top plate lights up as the weak spot, vents pulsing.
        if (this.state === 'exposed') {
            drawGlow(ctx, x + 6, y, w - 12, 5, "#00ffcc", 12);
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.abs(Math.sin(this.t * 0.3)));
            for (let i = 0; i < 5; i++) ctx.fillRect(x + 14 + i * 20, y + 9, 12, 3);
            ctx.globalAlpha = alpha;
        }

        if (flashing) {
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * 0.85;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x + 6, y, w - 12, h);
            ctx.fillRect(x, y + 6, w, h - 12);
            ctx.globalAlpha = alpha;
        }

        this.drawHealthBar(ctx, x, y);
    }

    // Side arms carrying the two big rotor pods.
    drawRotorPods(ctx, x, y, rim) {
        const flick = Math.abs(Math.sin(this.t * 0.5));
        for (const side of [-1, 1]) {
            ctx.fillStyle = "#3a1016";
            ctx.fillRect(side < 0 ? x - 10 : x + this.w, y + 20, 10, 6);
            const podX = side < 0 ? x - 26 : x + this.w + 10;
            drawRotor(ctx, podX + 8, y + 14, 44, this.t + (side > 0 ? 1.5 : 0), 0.35, 2);
            drawHull(ctx, podX, y + 14, 16, 20, "#1e070b", rim, 2, 6);
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * (0.4 + 0.6 * flick);
            ctx.fillStyle = "#ff8a3d";
            ctx.fillRect(podX + 5, y + 34, 6, 2 + Math.round(flick * 4));
            ctx.globalAlpha = alpha;
        }
    }

    // One barrel per shot in the volley (five once it's raging).
    drawCannons(ctx, x, y, volleyDue) {
        const n = this.raging ? 5 : 3;
        const cx = x + this.w / 2;
        for (let i = 0; i < n; i++) {
            const bx = cx + (i - (n - 1) / 2) * 16;
            ctx.fillStyle = "#2b0a10";
            ctx.fillRect(bx - 3, y + this.h - 2, 6, 8);
            drawGlow(ctx, bx - 2, y + this.h + 6, 4, volleyDue ? 4 : 2,
                volleyDue ? "#ffffff" : "#ff5500", volleyDue ? 14 : 4);
        }
    }

    // The big eye: white just before a volley, looking down while it dives,
    // dim and dazed while exposed.
    drawEye(ctx, x, y, volleyDue) {
        const cx = x + this.w / 2, cy = y + 40;
        ctx.fillStyle = "#5a0a14";
        ctx.fillRect(cx - 24, cy - 20, 48, 40);
        ctx.fillStyle = "#0c0306";
        ctx.fillRect(cx - 22, cy - 18, 44, 36);
        ctx.fillStyle = "#26060c";
        ctx.fillRect(cx - 22, cy - 18, 44, 4);

        if (this.state === 'exposed') {
            ctx.fillStyle = "#5a3a10";
            ctx.fillRect(cx - 14, cy - 12, 28, 26);
            ctx.fillStyle = "#1a0005";
            ctx.fillRect(cx - 10, cy, 20, 3);
            return;
        }

        drawGlow(ctx, cx - 14, cy - 13, 28, 28, volleyDue ? "#ffffff" : (this.raging ? "#ff3300" : "#ffaa00"), 18);
        const diving = this.state === 'telegraph' || this.state === 'dive';
        const px = diving ? 0 : Math.round(Math.sin(this.t * 0.05) * 5);
        const py = diving ? 6 : 0;
        ctx.fillStyle = "#1a0005";
        ctx.fillRect(cx - 6 + px, cy - 5 + py, 12, 12);
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.fillRect(cx - 11, cy - 10, 4, 4);
    }

    // One segment per HP.
    drawHealthBar(ctx, x, y) {
        const w = this.w;
        ctx.fillStyle = "#1a0005";
        ctx.fillRect(x - 2, y - 17, w + 4, 12);
        ctx.fillStyle = "#550010";
        ctx.fillRect(x, y - 15, w, 8);
        ctx.fillStyle = "#33ff66";
        ctx.fillRect(x, y - 15, Math.round(w * Math.max(0, this.hp) / this.maxHp), 8);
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.fillRect(x, y - 15, Math.round(w * Math.max(0, this.hp) / this.maxHp), 1);
        ctx.fillStyle = "#1a0005";
        for (let i = 1; i < this.maxHp; i++) ctx.fillRect(x + Math.round(w * i / this.maxHp), y - 15, 1, 8);
    }
}
