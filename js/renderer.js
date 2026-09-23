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

    drawText(text, x, y, font, color, align = "center") {
        this.ctx.fillStyle = color;
        this.ctx.font = font;
        this.ctx.textAlign = align;
        this.ctx.fillText(text, x, y);
    }
}
