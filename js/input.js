// Physical key codes (layout-independent, and immune to Caps Lock/Shift).
const INPUT_CODES = {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    jump: ['Space', 'ArrowUp', 'KeyW']
};

// Touches on these never steer the player: they're the menus, overlays and
// buttons, which need their normal taps (and the synthetic clicks those make).
const INPUT_UI_SELECTOR = 'button, input, a, #menus-wrapper, #revive-overlay, .overlay, .ui-control';

class InputHandler {
    constructor() {
        this.keys = { left: false, right: false, jump: false, buffer: 0 };

        // Gameplay input only counts while a run is live. The Game replaces
        // this; until then nothing is intercepted, so the menus behave like a
        // normal page.
        this.isActive = () => false;

        this.heldCodes = new Set();    // movement keys currently held (e.code)
        this.pointers = new Map();     // live touch pointerId -> 'left' | 'right' | 'jump'

        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
        // A key released while the window is unfocused never sends keyup, so
        // anything held when focus leaves would otherwise stay "down".
        window.addEventListener('blur', () => this.resetInput());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.resetInput();
        });

        this.setupPointers();
    }

    static codeRole(code) {
        for (const role of ['left', 'right', 'jump']) {
            if (INPUT_CODES[role].includes(code)) return role;
        }
        return null;
    }

    isTyping(e) {
        const t = e.target;
        return !!(t && t.closest && t.closest('input, textarea, select'));
    }

    onKeyDown(e) {
        const role = InputHandler.codeRole(e.code);
        if (!role || this.isTyping(e)) return;
        if (this.isActive()) {
            // Keep Space/arrows from scrolling the page (or an embedding
            // iframe's parent) and from re-activating a focused button.
            e.preventDefault();
        }
        if (role === 'jump') {
            this.keys.buffer = 6;
        } else {
            this.heldCodes.add(e.code);
            this.syncDirections();
        }
    }

    onKeyUp(e) {
        const role = InputHandler.codeRole(e.code);
        if (!role) return;
        // Buttons activate on Space *keyup*, so this one has to be stopped too.
        if (this.isActive() && !this.isTyping(e)) e.preventDefault();
        if (this.heldCodes.delete(e.code)) this.syncDirections();
    }

    // Left/right are held while any key or any finger says so.
    syncDirections() {
        let left = false, right = false;
        for (const code of this.heldCodes) {
            if (INPUT_CODES.left.includes(code)) left = true;
            if (INPUT_CODES.right.includes(code)) right = true;
        }
        for (const zone of this.pointers.values()) {
            if (zone === 'left') left = true;
            if (zone === 'right') right = true;
        }
        this.keys.left = left;
        this.keys.right = right;
    }

    // Touch zones across the game canvas: left quarter moves left, second
    // quarter moves right, the right half jumps.
    zoneAt(clientX) {
        const canvas = document.getElementById('gameCanvas');
        let left = 0, width = window.innerWidth;
        if (canvas && canvas.getBoundingClientRect) {
            const r = canvas.getBoundingClientRect();
            if (r.width > 0) { left = r.left; width = r.width; }
        }
        const fx = (clientX - left) / width;
        if (fx >= 0.5) return 'jump';
        return fx < 0.25 ? 'left' : 'right';
    }

    // Each finger is tracked on its own from touchdown to lift, so sliding
    // between zones hands the move over cleanly and lifting always releases
    // exactly what that finger was holding.
    setupPointers() {
        const container = document.getElementById('game-container');
        if (!container) return;

        container.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' || !this.isActive()) return;
            if (e.target && e.target.closest && e.target.closest(INPUT_UI_SELECTOR)) return;
            e.preventDefault();
            const zone = this.zoneAt(e.clientX);
            this.pointers.set(e.pointerId, zone);
            if (zone === 'jump') this.keys.buffer = 6;
            this.syncDirections();
        });

        container.addEventListener('pointermove', (e) => {
            if (!this.pointers.has(e.pointerId)) return;
            const zone = this.zoneAt(e.clientX);
            if (zone !== this.pointers.get(e.pointerId)) {
                this.pointers.set(e.pointerId, zone);
                this.syncDirections();
            }
        });

        const release = (e) => {
            if (this.pointers.delete(e.pointerId)) this.syncDirections();
        };
        container.addEventListener('pointerup', release);
        container.addEventListener('pointercancel', release);
    }

    update(dt) {
        if (this.keys.buffer > 0) this.keys.buffer -= dt;
    }

    resetInput() {
        this.heldCodes.clear();
        this.pointers.clear();
        this.keys.left = false;
        this.keys.right = false;
        this.keys.buffer = 0;
    }
}
