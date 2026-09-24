// Physical key codes (layout-independent, and immune to Caps Lock/Shift).
const INPUT_CODES = {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    jump: ['Space', 'ArrowUp', 'KeyW']
};
// Fallback by the character typed (e.key), for keyboards whose events carry
// no usable e.code (some IMEs, remote desktops, virtual keyboards) and for
// players who press the keys *labelled* W A D on a non-QWERTY layout.
const INPUT_KEYS = {
    left: ['a', 'arrowleft'],
    right: ['d', 'arrowright'],
    jump: [' ', 'w', 'arrowup']
};
// Text-entry fields keep their keys; checkboxes, sliders and buttons don't.
const INPUT_TEXT_SELECTOR = 'textarea, select, [contenteditable=""], [contenteditable="true"], ' +
    'input:not([type]), input[type=text], input[type=search], input[type=email], input[type=number], input[type=password], input[type=url], input[type=tel]';

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

        this.heldCodes = new Map();    // movement keys currently held: keyId() -> role
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

        // ?keys: a tiny on-screen log of key events, for diagnosing keys
        // that stop working on a particular machine.
        this.debugKeys = typeof location !== 'undefined' && /[?&]keys\b/.test(location.search || '');
    }

    static codeRole(code) {
        for (const role of ['left', 'right', 'jump']) {
            if (INPUT_CODES[role].includes(code)) return role;
        }
        return null;
    }

    // A key's role by its physical code, else by the character it typed.
    static eventRole(e) {
        const byCode = InputHandler.codeRole(e.code);
        if (byCode) return byCode;
        const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
        for (const role of ['left', 'right', 'jump']) {
            if (INPUT_KEYS[role].includes(key)) return role;
        }
        return null;
    }

    // What a held key is tracked by: its physical code, which keydown and
    // keyup always agree on, or its character when there's no code.
    static keyId(e) {
        return e.code || ('key:' + String(e.key || '').toLowerCase());
    }

    isTyping(e) {
        const t = e.target;
        return !!(t && t.closest && t.closest(INPUT_TEXT_SELECTOR));
    }

    logKey(type, e) {
        if (!this.debugKeys || typeof document === 'undefined') return;
        let el = document.getElementById('key-debug');
        if (!el && document.createElement && document.body) {
            el = document.createElement('div');
            el.id = 'key-debug';
            el.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99;font:11px monospace;color:#0f0;background:rgba(0,0,0,.75);padding:4px;pointer-events:none;white-space:pre';
            document.body.appendChild(el);
        }
        if (!el) return;
        this.keyLog = (this.keyLog || []).concat(
            `${type} code=${e.code || '∅'} key=${e.key} mods=${['metaKey', 'ctrlKey', 'altKey', 'shiftKey'].filter(m => e[m]).join('+') || '-'} target=${(e.target && e.target.tagName) || '?'}`
        ).slice(-6);
        el.textContent = this.keyLog.join('\n') + '\nheld: ' + [...this.heldCodes.keys()].join(' ');
    }

    onKeyDown(e) {
        this.logKey('down', e);
        const role = InputHandler.eventRole(e);
        if (!role || this.isTyping(e)) return;
        // Browser shortcuts (Ctrl+D, Cmd+A...) aren't moves, and a key held
        // under Cmd never gets its keyup on macOS.
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (this.isActive()) {
            // Keep Space/arrows from scrolling the page (or an embedding
            // iframe's parent) and from re-activating a focused button.
            e.preventDefault();
        }
        if (role === 'jump') {
            this.keys.buffer = 6;
        } else {
            this.heldCodes.set(InputHandler.keyId(e), role);
            this.syncDirections();
        }
    }

    onKeyUp(e) {
        this.logKey('up', e);
        // macOS drops the keyup of any key released while Cmd was down, so
        // letting go of Cmd lets go of everything.
        if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') {
            if (this.heldCodes.size) { this.heldCodes.clear(); this.syncDirections(); }
            return;
        }
        // Buttons activate on Space *keyup*, so this one has to be stopped too.
        if (InputHandler.eventRole(e) && this.isActive() && !this.isTyping(e)) e.preventDefault();
        if (this.heldCodes.delete(InputHandler.keyId(e))) this.syncDirections();
    }

    // Left/right are held while any key or any finger says so.
    syncDirections() {
        let left = false, right = false;
        for (const role of this.heldCodes.values()) {
            if (role === 'left') left = true;
            if (role === 'right') right = true;
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
