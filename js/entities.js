function rectsIntersect(r1, r2) {
    return !(r2.x > r1.x + r1.w ||
        r2.x + r2.w < r1.x ||
        r2.y > r1.y + r1.h ||
        r2.y + r2.h < r1.y);
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

        // Screen Wrap
        if (this.x > CONFIG.WIDTH) this.x = -this.w;
        if (this.x < -this.w) this.x = CONFIG.WIDTH;

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
                if (this.x + this.w > p.x && this.x < p.x + p.w) {
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
                    return { event: "shard", x: p.x, y: p.y, value: p.shardValue || 1 };
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
        const types = Object.values(POWERS);
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
        // Glow
        if (this.activePower) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = this.activePower.color;
        } else {
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.color;
        }

        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.shadowBlur = 0;

        // Eyes
        ctx.fillStyle = this.skin.eye;
        let look = this.vx > 0.5 ? 4 : (this.vx < -0.5 ? -4 : 0);
        ctx.fillRect(this.x + 5 + look, this.y + 7, 5, 5);
        ctx.fillRect(this.x + 16 + look, this.y + 7, 5, 5);
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
    }

    update(dt) {
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
        // Drone body
        ctx.fillStyle = "#333";
        ctx.fillRect(this.x, this.y, this.w, this.h);
        // Red eye
        ctx.fillStyle = "#ff0000";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#ff0000";
        ctx.fillRect(this.x + (this.v > 0 ? 20 : 5), this.y + 5, 5, 5);
        ctx.shadowBlur = 0;
        // Rotors
        ctx.fillStyle = "#666";
        const rot = Math.sin(Date.now() * 0.1) * 10;
        ctx.fillRect(this.x - 5, this.y - 2 + rot, 10, 2);
        ctx.fillRect(this.x + this.w - 5, this.y - 2 - rot, 10, 2);
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
        // Different look for shooter drone
        ctx.fillStyle = "#444";
        ctx.fillRect(this.x, this.y, this.w, this.h);

        // Warning light
        ctx.fillStyle = this.shootTimer < 20 ? "#fff" : "#ffaa00";
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.shootTimer < 20 ? "#fff" : "#ffaa00";
        ctx.fillRect(this.x + (this.v > 0 ? 24 : 5), this.y + 7, 6, 6);
        ctx.shadowBlur = 0;

        // Rotors
        ctx.fillStyle = "#888";
        const rot = Math.sin(Date.now() * 0.15) * 12;
        ctx.fillRect(this.x - 6, this.y - 2 + rot, 12, 2);
        ctx.fillRect(this.x + this.w - 6, this.y - 2 - rot, 12, 2);

        // Cannon
        ctx.fillStyle = "#222";
        ctx.fillRect(this.x + this.w / 4, this.y + this.h, this.w / 2, 4);
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
    }

    update(dt) {
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
        if (this.phase === "telegraph") {
            ctx.fillStyle = "rgba(255, 0, 85, 0.35)";
            ctx.fillRect(0, this.y + this.bodyH / 2 - 3, CONFIG.WIDTH, 6);
        }

        if (this.phase === "firing") {
            ctx.fillStyle = "#ff0055";
            ctx.shadowBlur = 20;
            ctx.shadowColor = "#ff0055";
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = "#440022";
            ctx.fillRect(this.x, this.y, this.bodyW, this.bodyH);
            ctx.fillStyle = this.phase === "telegraph" ? "#ffaa00" : "#ff0055";
            ctx.shadowBlur = 8;
            ctx.shadowColor = ctx.fillStyle;
            ctx.fillRect(this.x + this.bodyW / 2 - 3, this.y + this.bodyH / 2 - 3, 6, 6);
            ctx.shadowBlur = 0;
        }
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
        const y = this.y + (hovering ? Math.sin(this.t * 0.12) * 6 : 0);
        const flashing = this.invuln > 0 && Math.floor(this.t / 3) % 2 === 0;

        ctx.fillStyle = flashing ? "#ffffff" : (this.state === 'telegraph' && Math.floor(this.t / 4) % 2 ? "#cc2222" : this.color);
        ctx.fillRect(this.x, y, this.w, 80);

        // Exposed: the top edge lights up as the weak spot.
        if (this.state === 'exposed') {
            ctx.fillStyle = "#00ffcc";
            ctx.shadowBlur = 12;
            ctx.shadowColor = "#00ffcc";
            ctx.fillRect(this.x, y, this.w, 5);
            ctx.shadowBlur = 0;
        }

        ctx.fillStyle = "#ff0000";
        ctx.fillRect(this.x, y - 15, this.w, 8);
        ctx.fillStyle = "#00ff00";
        ctx.fillRect(this.x, y - 15, this.w * (this.hp / this.maxHp), 8);

        ctx.fillStyle = this.shootTimer < 20 && hovering ? "#fff" : (this.raging ? "#ff3300" : "#ffaa00");
        ctx.beginPath();
        ctx.arc(this.x + this.w / 2, y + 40, 20, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#444";
        const rot = Math.sin(this.t * 3.3) * 20;
        ctx.fillRect(this.x - 20, y + 10 + rot, 40, 6);
        ctx.fillRect(this.x + this.w - 20, y + 10 - rot, 40, 6);
    }
}
