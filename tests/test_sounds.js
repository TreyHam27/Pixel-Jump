const fs = require('fs');
const path = require('path');

// Every sound runs against a strict fake Web Audio graph: exponential ramps
// must target positive values, every node must reach the master bus, and
// every source must be scheduled to stop.
function assert(cond, msg) { if (!cond) throw new Error(msg); }

class Param {
    constructor(v = 0) { this.value = v; this.events = []; }
    setValueAtTime(v, t) { assert(isFinite(v) && isFinite(t), 'setValueAtTime finite'); this.events.push(['set', v, t]); }
    linearRampToValueAtTime(v, t) { assert(isFinite(v) && isFinite(t), 'linear ramp finite'); this.events.push(['lin', v, t]); }
    exponentialRampToValueAtTime(v, t) {
        assert(v > 0 && isFinite(t), 'exponential ramp needs a positive target, got ' + v);
        this.events.push(['exp', v, t]);
    }
    reaches() { return false; } // a vibrato LFO modulates a param, it isn't heard
}
const nodes = [];
class Node {
    constructor(ctx) { this.ctx = ctx; this.out = []; nodes.push(this); }
    connect(n) { this.out.push(n); return n; }
    reaches(master) { return this === master || this.out.some(n => n.reaches(master)); }
}
class Source extends Node {
    start(t) { this.started = t; }
    stop(t) { assert(t >= this.started, 'stop after start'); this.stopped = t; }
}
class Osc extends Source {
    constructor(c) { super(c); this.frequency = new Param(440); this.detune = new Param(0); this.type = 'sine'; }
    setPeriodicWave(w) { assert(w && w.periodic, 'real periodic wave'); this.type = 'custom'; }
}
class FakeCtx {
    constructor() { this.currentTime = 1; this.sampleRate = 8000; this.state = 'running'; this.destination = new Node(this); }
    createGain() { const n = new Node(this); n.gain = new Param(1); return n; }
    createOscillator() { return new Osc(this); }
    createBufferSource() { const n = new Source(this); n.detune = new Param(0); return n; }
    createBiquadFilter() { const n = new Node(this); n.frequency = new Param(350); n.Q = new Param(1); return n; }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createPeriodicWave(re, im) { assert(re.length === im.length, 'wave arrays match'); return { periodic: true }; }
    resume() {}
}

global.window = { AudioContext: FakeCtx, addEventListener() {} };
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'sounds.js'), 'utf8') + `
sounds.unlock();
for (const type of ['jump', 'death', 'reward', 'heart', 'heart_lost', 'powerup', 'hit']) {
    nodes.length = 0;
    sounds.play(type);
    const sources = nodes.filter(n => n.start);
    assert(sources.length > 0, type + ' makes sound');
    for (const s of sources)
        assert(s.started !== undefined && s.stopped !== undefined, type + ': every source starts and stops');
    const audible = sources.filter(s => s.reaches(sounds.master));
    assert(audible.length > 0, type + ' reaches the master bus');
}

// The new jump stays short (it plays on every bounce) and the death has a tail.
nodes.length = 0;
sounds.play('jump');
const jumpEnd = Math.max(...nodes.filter(n => n.stop).map(n => n.stopped)) - 1;
assert(jumpEnd < 0.2, 'jump is under 200ms, got ' + jumpEnd);
nodes.length = 0;
sounds.play('death');
const deathEnd = Math.max(...nodes.filter(n => n.stop).map(n => n.stopped)) - 1;
assert(deathEnd > 0.8 && deathEnd < 1.5, 'death lasts about a second, got ' + deathEnd);

nodes.length = 0;
sounds.play('hit');
const hitEnd = Math.max(...nodes.filter(n => n.stop).map(n => n.stopped)) - 1;
assert(hitEnd < 0.3, 'boss bump stays short, got ' + hitEnd);

// Muted means silent.
sounds.setMuted(true);
nodes.length = 0;
sounds.play('death');
assert(nodes.length === 0, 'muted plays nothing');
console.log('SOUNDS SUCCESS');
`);
