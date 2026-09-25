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

        if (type === 'jump') return this.playJump();
        if (type === 'death') return this.playDeath();
        if (type === 'hit') return this.playHit();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.master);

        const now = this.ctx.currentTime;

        switch (type) {
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
            case 'heart':
                // Two soft notes up a fifth: a warm "ding-ding".
                osc.type = 'sine';
                osc.frequency.setValueAtTime(660, now);
                osc.frequency.setValueAtTime(990, now + 0.12);
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.setValueAtTime(0.18, now + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
                osc.start(now);
                osc.stop(now + 0.4);
                break;
            case 'heart_lost':
                // The gain sound flipped: down a fifth, "de-do" instead of "do-de".
                osc.type = 'sine';
                osc.frequency.setValueAtTime(990, now);
                osc.frequency.setValueAtTime(660, now + 0.12);
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.setValueAtTime(0.18, now + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
                osc.start(now);
                osc.stop(now + 0.4);
                break;
            case 'power':
                // A quick rising arpeggio, distinct from the gem blip.
                osc.type = 'square';
                [330, 440, 554, 660, 880].forEach((f, i) => osc.frequency.setValueAtTime(f, now + i * 0.055));
                gain.gain.setValueAtTime(0.07, now);
                gain.gain.setValueAtTime(0.07, now + 0.22);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.32);
                osc.start(now);
                osc.stop(now + 0.32);
                break;
        }
    }

    // "Mellow": the original 150 -> 600 Hz sweep on a pure triangle, so no
    // buzz, fading out instead of clicking off.
    playJump() {
        this.voice({ wave: 'triangle', dur: 0.12, peak: 0.15, attack: 0.004, freq: [[0, 150], [0.1, 600, 'exp']] });
    }

    // "Tumble": a noise hit, a yelp up, a wobbling 8-bit staircase down, then
    // a low thud as the player drops off screen.
    playDeath() {
        this.voice({ noise: true, dur: 0.14, peak: 0.28, attack: 0.002, bandpass: 1800, q: 0.8 });
        this.voice({ duty: 0.5, dur: 0.95, peak: 0.09, hold: 0.5, lowpass: 3000,
                     freq: [[0, 520], [0.07, 780, 'exp'], ...this.steps(780, 98, 0.1, 0.8, 16)],
                     vibrato: { rate: 14, cents: 45, at: 0.1 } });
        this.voice({ wave: 'triangle', start: 0.78, dur: 0.32, peak: 0.24, attack: 0.005, freq: [[0, 110], [0.25, 40, 'exp']] });
    }

    // "Clang": bumping the exposed boss knocks you back unhurt, so two
    // clashing metallic tones over a noise hit, like striking its armor.
    playHit() {
        this.voice({ noise: true, dur: 0.05, peak: 0.2, attack: 0.001, bandpass: 4000, q: 0.9 });
        this.voice({ duty: 0.5, dur: 0.26, peak: 0.06, attack: 0.002, lowpass: 5000, freq: [[0, 880], [0.25, 860, 'exp']] });
        this.voice({ duty: 0.25, dur: 0.22, peak: 0.05, attack: 0.002, lowpass: 5000, freq: [[0, 1245], [0.2, 1220, 'exp']] });
    }

    // One enveloped voice routed to master. Options: wave | duty | noise,
    // start, dur, peak, attack, hold, freq: [[t, hz, 'set'|'exp'|'lin']],
    // lowpass | bandpass (hz, or [from, to] swept over dur), q,
    // vibrato: { rate, cents, at }.
    voice(o) {
        const ctx = this.ctx, t0 = ctx.currentTime + (o.start || 0);
        const src = o.noise ? ctx.createBufferSource() : ctx.createOscillator();
        if (o.noise) { src.buffer = this.noiseBuffer(); src.loop = true; }
        else if (o.duty) src.setPeriodicWave(this.pulseWave(o.duty));
        else src.type = o.wave || 'square';

        let node = src;
        const sweep = o.bandpass || o.lowpass;
        if (sweep) {
            const f = ctx.createBiquadFilter();
            f.type = o.bandpass ? 'bandpass' : 'lowpass';
            if (Array.isArray(sweep)) {
                f.frequency.setValueAtTime(sweep[0], t0);
                f.frequency.exponentialRampToValueAtTime(sweep[1], t0 + o.dur);
            } else f.frequency.value = sweep;
            if (o.q) f.Q.value = o.q;
            node.connect(f);
            node = f;
        }
        const gain = ctx.createGain();
        node.connect(gain);
        gain.connect(this.master);

        (o.freq || []).forEach(([t, hz, how]) => {
            if (how === 'exp') src.frequency.exponentialRampToValueAtTime(hz, t0 + t);
            else if (how === 'lin') src.frequency.linearRampToValueAtTime(hz, t0 + t);
            else src.frequency.setValueAtTime(hz, t0 + t);
        });
        if (o.vibrato && src.detune) {
            const lfo = ctx.createOscillator(), depth = ctx.createGain();
            lfo.frequency.value = o.vibrato.rate;
            depth.gain.setValueAtTime(0, t0);
            depth.gain.linearRampToValueAtTime(o.vibrato.cents, t0 + (o.vibrato.at || 0) + 0.05);
            lfo.connect(depth);
            depth.connect(src.detune);
            lfo.start(t0);
            lfo.stop(t0 + o.dur);
        }

        const g = gain.gain, attack = o.attack || 0.004;
        g.setValueAtTime(0.0001, t0);
        g.exponentialRampToValueAtTime(o.peak, t0 + attack);
        if (o.hold) g.setValueAtTime(o.peak, t0 + attack + o.hold);
        g.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
        src.start(t0);
        src.stop(t0 + o.dur + 0.02);
    }

    // NES-style pulse wave with the given duty cycle (0.125, 0.25, 0.5).
    pulseWave(duty) {
        this.waves = this.waves || {};
        if (!this.waves[duty]) {
            const n = 64, real = new Float32Array(n), imag = new Float32Array(n);
            for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
            this.waves[duty] = this.ctx.createPeriodicWave(real, imag);
        }
        return this.waves[duty];
    }

    noiseBuffer() {
        if (!this.noiseBuf) {
            const len = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, len, len), d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            this.noiseBuf = buf;
        }
        return this.noiseBuf;
    }

    // A descending staircase of 'set' pitch points, for a stepped 8-bit fall.
    steps(from, to, t0, t1, n) {
        const out = [];
        for (let i = 0; i <= n; i++) out.push([t0 + (t1 - t0) * i / n, from * Math.pow(to / from, i / n), 'set']);
        return out;
    }
}

// Create global instance
const sounds = new SoundManager();
