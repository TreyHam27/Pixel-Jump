class InputHandler {
    constructor() {
        this.keys = { left: false, right: false, jump: false, buffer: 0 };

        // Keyboard
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Touch
        this.setupTouch();
    }

    onKeyDown(e) {
        if (e.key === "ArrowLeft" || e.key === "a") this.keys.left = true;
        if (e.key === "ArrowRight" || e.key === "d") this.keys.right = true;
        if (e.key === " " || e.key === "ArrowUp" || e.key === "w") this.keys.buffer = 6;
    }

    onKeyUp(e) {
        if (e.key === "ArrowLeft" || e.key === "a") this.keys.left = false;
        if (e.key === "ArrowRight" || e.key === "d") this.keys.right = false;
    }

    setupTouch() {
        const container = document.getElementById('game-container');

        container.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scroll
            for (let i = 0; i < e.changedTouches.length; i++) {
                this.handleTouch(e.changedTouches[i], true);
            }
        }, { passive: false });

        container.addEventListener('touchend', (e) => {
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                this.handleTouch(e.changedTouches[i], false);
            }
        }, { passive: false });

        // Handle touch cancel/leave as reset
        container.addEventListener('touchcancel', () => this.resetInput());
    }

    handleTouch(touch, isPressed) {
        const w = window.innerWidth;
        if (touch.clientX < w / 2) {
            if (touch.clientX < w * 0.25) this.keys.left = isPressed;
            else this.keys.right = isPressed;
        } else {
            // Right Half = Jump
            if (isPressed) this.keys.buffer = 6;
        }
    }

    update(dt) {
        if (this.keys.buffer > 0) this.keys.buffer -= dt;
    }

    resetInput() {
        this.keys.left = false;
        this.keys.right = false;
    }
}
