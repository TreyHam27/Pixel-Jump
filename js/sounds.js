/**
 * 8-Bit Sound System using Web Audio API
 * Generates chiptune-style sounds without external assets.
 */
class SoundManager {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.enabled = true;
        this.volume = 0.8;
        this.muted = false;

        // Browsers only let audio start from a user gesture. Keyboard players
        // never click, and iOS can suspend the context again later, so every
        // gesture gets a (cheap) chance to create or resume it.
        const unlock = () => this.unlock();
        ['pointerdown', 'keydown', 'touchend'].forEach(evt =>
            window.addEventListener(evt, unlock, { capture: true }));
    }

    unlock() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            this.ctx = new AudioCtx();
            this.master = this.ctx.createGain();
            this.master.connect(this.ctx.destination);
            this.applyVolume();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        this.applyVolume();
    }

    setMuted(muted) {
        this.muted = !!muted;
        this.applyVolume();
    }

    applyVolume() {
        if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    }

    play(type) {
        if (!this.ctx || !this.enabled || this.muted) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.master);

        const now = this.ctx.currentTime;

        switch (type) {
            case 'jump':
                osc.type = 'square';
                osc.frequency.setValueAtTime(150, now);
                osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;
            case 'powerup':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.2);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;
            case 'death':
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.linearRampToValueAtTime(50, now + 0.5);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
                osc.start(now);
                osc.stop(now + 0.5);
                break;
            case 'hit':
                osc.type = 'square';
                osc.frequency.setValueAtTime(100, now);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
                osc.start(now);
                osc.stop(now + 0.05);
                break;
        }
    }
}

// Create global instance
const sounds = new SoundManager();
