// Shared multiplayer test doubles.
//
// FakePeer / FakeDataConn stand in for PeerJS so NetworkManager's connection
// bookkeeping can run without WebRTC. Like real PeerJS, destroy() emits
// 'disconnected' before the peer counts as destroyed.
//
// Bus / FakeNet stand in for the whole host-relay network, so several Game
// instances can play one multiplayer session in a single process. Each Game
// talks to its own FakeNet through window.network, which the bus swaps in
// before delivering anything to that Game.

class FakeEmitter {
    constructor() { this.handlers = {}; }
    on(evt, cb) { (this.handlers[evt] = this.handlers[evt] || []).push(cb); }
    emit(evt, ...args) { (this.handlers[evt] || []).forEach(cb => cb(...args)); }
}

class FakeDataConn extends FakeEmitter {
    constructor(peer) { super(); this.peer = peer; this.open = false; this.sent = []; this.closed = false; }
    openNow() { this.open = true; this.emit('open'); }
    send(d) { this.sent.push(d); }
    close() { if (this.closed) return; this.closed = true; this.open = false; this.emit('close'); }
}

class FakePeer extends FakeEmitter {
    constructor(id, opts) {
        super();
        this.id = id;
        this.opts = opts;
        this.destroyed = false;
        this.reconnects = 0;
        this.outgoing = [];
        FakePeer.all.push(this);
        global.lastPeer = this;
    }
    connect(id) { const c = new FakeDataConn(id); this.outgoing.push(c); return c; }
    destroy() {
        if (this.destroyed) return;
        this.emit('disconnected', this.id);
        this.destroyed = true;
        this.emit('close');
    }
    reconnect() { this.reconnects++; }
}
FakePeer.all = [];

class Bus {
    constructor() { this.nets = new Map(); this.q = []; }
    pump() {
        let guard = 0;
        while (this.q.length) {
            if (++guard > 10000) throw new Error("Message storm");
            const m = this.q.shift();
            const net = this.nets.get(m.to);
            if (!net || !net.links.has(m.from)) continue;
            window.network = net;
            if (m.close) {
                net.links.delete(m.from);
                if (net.isHost) { if (net.onPeerLeft) net.onPeerLeft(m.from); }
                else if (net.onDisconnected) net.onDisconnected();
            } else if (net.onData) {
                net.onData(JSON.parse(JSON.stringify(m.data)), m.from);
            }
        }
    }
}

class FakeNet {
    constructor(bus, id) {
        this.bus = bus; this.myId = id; this.isHost = false; this.friendId = null;
        this.links = new Set();
        bus.nets.set(id, this);
    }
    async host() { this.isHost = true; return this.myId; }
    push(to, data) { this.bus.q.push({ to, from: this.myId, data }); }
    send(d) { for (const to of this.links) this.push(to, d); }
    sendTo(to, d) { if (this.links.has(to)) this.push(to, d); }
    broadcastExcept(ex, d) { for (const to of this.links) if (to !== ex) this.push(to, d); }
    closePeer(id) {
        if (!this.links.has(id)) return;
        this.links.delete(id);
        this.bus.q.push({ to: id, from: this.myId, close: true });
        if (this.onPeerLeft) this.onPeerLeft(id);
    }
    leave() {
        if (this.isHost) this.send({ type: 'party_closed' });
        for (const to of [...this.links]) {
            this.links.delete(to);
            this.bus.q.push({ to, from: this.myId, close: true });
        }
        this.isHost = false;
    }
}

function installMpFakes() {
    global.Peer = FakePeer;
    global.FakePeer = FakePeer;
    global.FakeDataConn = FakeDataConn;
    global.Bus = Bus;
    global.FakeNet = FakeNet;
}

module.exports = { installMpFakes, FakePeer, FakeDataConn, Bus, FakeNet };
