/**
 * Parallax Background System
 */
class Background {
    constructor(canvasWidth, canvasHeight) {
        this.width = canvasWidth;
        this.height = canvasHeight;
        this.layers = [
            { speed: 0.1, elements: this.generatePoints(100, "#222") }, // Far stars
            { speed: 0.2, elements: this.generatePoints(50, "#444") },  // Mid stars
            { speed: 0.5, elements: this.generateNebulae(3) }           // Rare nebulae
        ];
    }

    generatePoints(count, color) {
        const points = [];
        for (let i = 0; i < count; i++) {
            points.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                size: Math.random() * 2,
                color: color
            });
        }
        return points;
    }

    generateNebulae(count) {
        const nebulae = [];
        for (let i = 0; i < count; i++) {
            nebulae.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                size: 100 + Math.random() * 200,
                color: `hsla(${Math.random() * 360}, 50%, 20%, 0.1)`
            });
        }
        return nebulae;
    }

    draw(ctx, offset) {
        this.layers.forEach(layer => {
            const yOffset = (offset * layer.speed) % this.height;

            ctx.fillStyle = layer.elements[0].color;
            layer.elements.forEach(el => {
                let drawY = (el.y + yOffset) % this.height;
                if (el.size > 10) { // Nebula
                    // The gradient is built once, around the origin, and
                    // moved into place: no new gradient objects every frame.
                    if (!el.grad || el.gradCtx !== ctx) {
                        el.grad = ctx.createRadialGradient(0, 0, 0, 0, 0, el.size);
                        el.grad.addColorStop(0, el.color);
                        el.grad.addColorStop(1, "transparent");
                        el.gradCtx = ctx;
                    }
                    ctx.save();
                    ctx.translate(el.x, drawY);
                    ctx.fillStyle = el.grad;
                    ctx.fillRect(-el.size, -el.size, el.size * 2, el.size * 2);
                    ctx.restore();
                } else { // Star
                    ctx.fillRect(el.x, drawY, el.size, el.size);
                }
            });
        });
    }
}
