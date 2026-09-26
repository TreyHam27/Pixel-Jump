// Picks how the playfield fills an availW x availH container (CSS px):
//  - 'strip': portrait phones and tall windows. The playfield is full width
//    and runs from under the HUD strip (stripH tall) to the bottom edge; the
//    extra height shows as extra sky above the 600x800 frame, capped at
//    VIEW_MAX_EXTRA (past that the canvas stops growing and the spare space
//    sits under the strip).
//  - 'flank': a 3:4 column with room either side for the HUD.
//  - 'overlay': a 3:4 column too narrow to flank; the HUD sits in its corners.
// Returns the canvas CSS size and the extra logical px of sky (an integer).
function viewLayout(availW, availH, stripH) {
    const aspect = CONFIG.WIDTH / CONFIG.HEIGHT;
    const playH = availH - stripH;
    if (availW > 0 && playH > availW / aspect + 1) {
        const maxH = availW * (CONFIG.HEIGHT + VIEW_MAX_EXTRA) / CONFIG.WIDTH;
        const cssH = Math.floor(Math.min(playH, maxH));
        const extra = Math.max(0, Math.min(VIEW_MAX_EXTRA, Math.round(CONFIG.WIDTH * cssH / availW) - CONFIG.HEIGHT));
        return { mode: 'strip', cssW: availW, cssH: cssH, extra: extra };
    }
    let w = availW, h = availW / aspect;
    if (h > availH) { h = availH; w = availH * aspect; }
    const gutter = (availW - w) / 2;
    return { mode: gutter >= FLANK_MIN_GUTTER ? 'flank' : 'overlay', cssW: Math.floor(w), cssH: Math.floor(h), extra: 0 };
}

class Renderer {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        // Built for the tallest view, so resizing never regenerates the stars.
        this.background = new Background(CONFIG.WIDTH, CONFIG.HEIGHT + VIEW_MAX_EXTRA);
        this.currentBiome = BIOMES[0];
        this.dpr = 1;
        this.layout = 'flank';
        this.viewExtra = 0;
        this.onResize = null; // set by the Game (touch-control layout, sprites)
        this.resize();
        // Debounced: dragging a window edge fires dozens of these.
        let pending = null;
        const later = () => {
            clearTimeout(pending);
            pending = setTimeout(() => this.resize(), 100);
        };
        window.addEventListener('resize', later);
        window.addEventListener('orientationchange', later);
        if (window.visualViewport && window.visualViewport.addEventListener) {
            window.visualViewport.addEventListener('resize', later);
        }
    }

    // Fits the playfield into its container (sized with dvh, so mobile
    // browser toolbars don't cover the bottom; see viewLayout() for the three
    // layouts) and sizes the backing store for the screen's pixel density so
    // it stays sharp. Drawing stays in logical 600-wide units; the transform
    // shifts it down by viewExtra, so the 800-tall reference frame always
    // ends at the canvas bottom and any extra sky sits above y = 0.
    resize() {
        const container = this.canvas.parentElement;
        const availW = (container && container.clientWidth) || window.innerWidth;
        const availH = (container && container.clientHeight) || window.innerHeight;
        const strip = document.getElementById('hud-strip');
        const layout = viewLayout(availW, availH, (strip && strip.offsetHeight) || 0);
        this.layout = layout.mode;
        this.viewExtra = layout.extra;
        this.canvas.style.width = layout.cssW + 'px';
        this.canvas.style.height = layout.cssH + 'px';

        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const bw = Math.round(CONFIG.WIDTH * dpr);
        const bh = Math.round((CONFIG.HEIGHT + layout.extra) * dpr);
        if (this.canvas.width !== bw || this.canvas.height !== bh) {
            this.canvas.width = bw;   // (resets the context state)
            this.canvas.height = bh;
        }
        this.dpr = dpr;
        if (this.ctx.setTransform) this.ctx.setTransform(dpr, 0, 0, dpr, 0, layout.extra * dpr);
        this.publishLayout(container);
        if (this.onResize) this.onResize();
    }

    // The top edge of what's on screen, in game coordinates: 0 on a 3:4 view,
    // negative on a tall one. Only drawing may use this. Gameplay stays in
    // the 800-tall reference frame so every screen plays the same.
    get viewTop() {
        return -(this.viewExtra || 0);
    }

    // Tells the CSS which layout is active and where the playfield sits
    // (--pf-left/top/right/w/h, relative to the container), so the HUD can
    // anchor to the playfield instead of the window.
    publishLayout(container) {
        if (!container || !container.style || !container.style.setProperty) return;
        if (container.setAttribute) container.setAttribute('data-layout', this.layout);
        if (!this.canvas.getBoundingClientRect || !container.getBoundingClientRect) return;
        const c = this.canvas.getBoundingClientRect();
        const box = container.getBoundingClientRect();
        container.style.setProperty('--pf-left', (c.left - box.left) + 'px');
        container.style.setProperty('--pf-top', (c.top - box.top) + 'px');
        container.style.setProperty('--pf-right', (box.right - c.right) + 'px');
        container.style.setProperty('--pf-w', c.width + 'px');
        container.style.setProperty('--pf-h', c.height + 'px');
    }

    updateBiome(meters) {
        this.currentBiome = biomeAt(meters);
    }

    clear(offsetY) {
        this.ctx.fillStyle = this.currentBiome.bg;
        this.ctx.fillRect(0, this.viewTop, CONFIG.WIDTH, CONFIG.HEIGHT - this.viewTop);
        this.background.draw(this.ctx, offsetY, -VIEW_MAX_EXTRA);
    }

    drawGrid(offsetY) {
        this.ctx.strokeStyle = this.currentBiome.grid;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        const top = this.viewTop;
        for (let i = 0; i < CONFIG.WIDTH; i += 40) {
            this.ctx.moveTo(i, top); this.ctx.lineTo(i, CONFIG.HEIGHT);
        }
        let gridY = offsetY % 40;
        while (gridY > top) gridY -= 40;
        for (let i = gridY; i < CONFIG.HEIGHT; i += 40) {
            this.ctx.moveTo(0, i); this.ctx.lineTo(CONFIG.WIDTH, i);
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
        const w = CONFIG.WIDTH;
        const h = CONFIG.HEIGHT;
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

    // The side edges are one seam: both glow faintly in the biome's platform
    // colour, and brighten together as the player nears either one, so it
    // reads that walking off one side brings you in on the other.
    drawWrapEdges(playerX, playerW) {
        const ctx = this.ctx;
        const nearest = Math.min(playerX, CONFIG.WIDTH - (playerX + playerW));
        const near = Math.max(0, Math.min(1, 1 - nearest / 90));
        const width = 10;
        ctx.save();
        ctx.fillStyle = this.currentBiome.platform;
        for (const [x0, x1] of [[0, width], [CONFIG.WIDTH, CONFIG.WIDTH - width]]) {
            const grad = ctx.createLinearGradient ? ctx.createLinearGradient(x0, 0, x1, 0) : null;
            if (grad) {
                grad.addColorStop(0, this.currentBiome.platform);
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = grad;
            }
            ctx.globalAlpha = 0.12 + 0.5 * near;
            ctx.fillRect(Math.min(x0, x1), this.viewTop, width, CONFIG.HEIGHT - this.viewTop);
        }
        ctx.restore();
    }

    drawText(text, x, y, font, color, align = "center") {
        this.ctx.fillStyle = color;
        this.ctx.font = font;
        this.ctx.textAlign = align;
        this.ctx.fillText(text, x, y);
    }
}
