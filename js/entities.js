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
        this.skin = SKINS[skinIndex];
        this.color = this.skin.color;
        this.w = 26;
        this.h = 26;
        this.color = SKINS[skinIndex] ? SKINS[skinIndex].color : "#00ffcc";
        this.isDead = false;
        this.grounded = false;
        this.coyote = 0;
        this.doubleReady = false;
        this.activePower = null;
        this.powerTimer = 0;
    }

    setSkin(index) {
        this.skin = SKINS[index];
        this.color = this.skin.color;
    }

    update(dt, input, platforms, powerups) {
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
                input.keys.buffer = 0;
                return "jump";
            } else if (this.activePower === POWERS.DOUBLE && this.doubleReady) {
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

            // Magnet Logic
            if (this.activePower === POWERS.MAGNET) {
                let dx = this.x - p.x;
                let dy = this.y - p.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 200) {
                    p.x += dx * 0.1;
                    p.y += dy * 0.1;
                }
            }

            if (rectsIntersect(this, p)) {
                if (p.isShard) {
                    p.markedForDeletion = true;
                    return { event: "shard", x: p.x, y: p.y };
                } else {
                    this.activatePower();
                    p.markedForDeletion = true;
                    return { event: "powerup", x: p.x, y: p.y };
                }
            }
        }

        return event;
    }

    activatePower() {
        const types = Object.values(POWERS);
        const p = types[Math.floor(Math.random() * types.length)];
        this.activePower = p;
        this.powerTimer = p.time;
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
        this.x += this.v * dt;
        this.y += Math.sin(this.x * 0.05 + this.sinOffset) * 2;
        if ((this.v > 0 && this.x > CONFIG.WIDTH + 50) || (this.v < 0 && this.x < -100)) {
            this.markedForDeletion = true;
        }
    }

    draw(ctx) {
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

class BossDrone extends Entity {
    constructor(y) {
        super(CONFIG.WIDTH / 2 - 60, y, 120, 80, "#880000");
        this.hp = 10;
        this.maxHp = 10;
        this.shootTimer = 100;
        this.hoverY = y;
        this.hoverOffsetX = 0;
    }

    update(dt, player, projectiles) {
        let targetY = player.y - 450;
        if (this.hoverY < targetY) {
            this.hoverY += (targetY - this.hoverY) * 0.05 * dt;
        } else {
            this.hoverY = targetY;
        }

        this.y = this.hoverY + Math.sin(Date.now() * 0.002) * 20;

        this.hoverOffsetX += 2 * dt;
        this.x = (CONFIG.WIDTH / 2 - this.w / 2) + Math.sin(this.hoverOffsetX * 0.02) * 150;

        this.shootTimer -= dt;
        if (this.shootTimer <= 0) {
            for (let i = -1; i <= 1; i++) {
                projectiles.push(new Projectile(this.x + this.w / 2, this.y + this.h, i * 3, 6));
            }
            this.shootTimer = 90;
        }
    }

    takeDamage(particles) {
        this.hp--;
        particles.spawn(this.x + this.w / 2, this.y + this.h / 2, "#fff", 50, "blast");
        this.hoverY -= 800;
        this.shootTimer = 20;
        if (this.hp <= 0) {
            this.markedForDeletion = true;
        }
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);

        ctx.fillStyle = "#ff0000";
        ctx.fillRect(this.x, this.y - 15, this.w, 8);
        ctx.fillStyle = "#00ff00";
        ctx.fillRect(this.x, this.y - 15, this.w * (this.hp / this.maxHp), 8);

        ctx.fillStyle = this.shootTimer < 20 ? "#fff" : "#ffaa00";
        ctx.beginPath();
        ctx.arc(this.x + this.w / 2, this.y + this.h / 2, 20, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#444";
        const rot = Math.sin(Date.now() * 0.2) * 20;
        ctx.fillRect(this.x - 20, this.y + 10 + rot, 40, 6);
        ctx.fillRect(this.x + this.w - 20, this.y + 10 - rot, 40, 6);
    }
}
