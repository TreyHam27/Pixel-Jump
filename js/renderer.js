class Renderer {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.background = new Background(CONFIG.WIDTH, CONFIG.HEIGHT);
        this.currentBiome = BIOMES[0];
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        // Letterbox scaling
        const aspect = CONFIG.WIDTH / CONFIG.HEIGHT;
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const winAspect = winW / winH;

        if (winAspect < aspect) {
            // Window is taller than game
            this.canvas.style.width = '100vw';
            this.canvas.style.height = `${100 / aspect}vw`;
        } else {
            // Window is wider than game
            this.canvas.style.height = '100vh';
            this.canvas.style.width = `${100 * aspect}vh`;
        }

        // Internal Resolution matches Game Logical Size
        this.canvas.width = CONFIG.WIDTH;
        this.canvas.height = CONFIG.HEIGHT;
    }

    updateBiome(score) {
        for (let i = BIOMES.length - 1; i >= 0; i--) {
            if (score >= BIOMES[i].threshold) {
                this.currentBiome = BIOMES[i];
                break;
            }
        }
    }

    clear(offsetY) {
        this.ctx.fillStyle = this.currentBiome.bg;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.background.draw(this.ctx, offsetY);
    }

    drawGrid(offsetY) {
        this.ctx.strokeStyle = this.currentBiome.grid;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let i = 0; i < this.canvas.width; i += 40) {
            this.ctx.moveTo(i, 0); this.ctx.lineTo(i, this.canvas.height);
        }
        let gridY = offsetY % 40;
        for (let i = gridY; i < this.canvas.height; i += 40) {
            this.ctx.moveTo(0, i); this.ctx.lineTo(this.canvas.width, i);
        }
        this.ctx.stroke();
    }

    drawRect(x, y, w, h, color, glow = null) {
        this.ctx.fillStyle = color;
        if (glow) {
            this.ctx.shadowBlur = glow.blur;
            this.ctx.shadowColor = glow.color;
        }
        this.ctx.fillRect(x, y, w, h);
        this.ctx.shadowBlur = 0;
    }

    // The SAFETY NET power-up's trampoline, strung across the bottom of the
    // screen so the player can see the floor they are bouncing off. `net`
    // carries the deploy/retract progress plus the decaying bounce wobble that
    // `Game.updateSafetyNet` advances each frame.
    drawSafetyNet(net, color, time) {
        if (net.deploy <= 0.01) return;

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const SEGMENTS = 32;
        // Springs up into place on pickup, drops back out when the power expires.
        // Rests high enough that a full downward dip still reads on screen.
        const baseY = (h - 42) + (1 - net.deploy) * 70;

        // Resting ripple, plus a dip centred on the last bounce that oscillates
        // and decays the way a real trampoline bed does.
        const surfaceY = (x) => {
            let dy = Math.sin(x * 0.03 + time * 0.1) * 2.5;
            if (net.impact > 0) {
                const d = (x - net.impactX) / 150;
                dy += Math.exp(-d * d) * net.impact * 28 * Math.sin(net.phase);
            }
            return baseY + dy * net.deploy;
        };

        const points = [];
        for (let i = 0; i <= SEGMENTS; i++) {
            const x = (w / SEGMENTS) * i;
            points.push({ x: x, y: surfaceY(x) });
        }

        // Blink once the power-up is nearly spent, so losing the net is never a
        // surprise mid-fall.
        const alpha = net.deploy * (net.expiring ? 0.35 + 0.65 * Math.abs(Math.sin(time * 0.35)) : 1);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.shadowColor = color;

        // Translucent bed under the cord.
        ctx.globalAlpha = alpha * 0.18;
        ctx.beginPath();
        ctx.moveTo(0, h);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(w, h);
        ctx.fill();

        // Zig-zag springs tying the bed down to the floor.
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        points.forEach((p, i) => {
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + (i % 2 ? -12 : 12), h);
        });
        ctx.stroke();

        // Frame posts at either edge.
        ctx.globalAlpha = alpha * 0.8;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(3, points[0].y);
        ctx.lineTo(3, h);
        ctx.moveTo(w - 3, points[points.length - 1].y);
        ctx.lineTo(w - 3, h);
        ctx.stroke();

        // The cord itself.
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();

        // Highlight rail riding just above it, for a taut, springy read.
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y - 4);
        points.forEach(p => ctx.lineTo(p.x, p.y - 4));
        ctx.stroke();

        ctx.restore();
    }

    drawText(text, x, y, font, color, align = "center") {
        this.ctx.fillStyle = color;
        this.ctx.font = font;
        this.ctx.textAlign = align;
        this.ctx.fillText(text, x, y);
    }
}
