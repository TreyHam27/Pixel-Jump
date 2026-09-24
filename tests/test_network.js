const { setupMocks, loadGameSource, sleep, failIfUnfinished } = require('./test_helpers');
const { installMpFakes } = require('./mp_fakes');

setupMocks({ realTimers: true });
failIfUnfinished();
installMpFakes();
global.__sleep = sleep;

// Co-op robustness:
//  - a join that's still retrying must give up once the player hosts, leaves
//    or joins again (it used to later disconnect the new party);
//  - tearing a peer down must not reconnect it (PeerJS emits 'disconnected'
//    from destroy(), which used to reopen a signaling socket);
//  - a wrong or malformed code fails fast; joiners that never introduce
//    themselves lose their slot; simultaneous joiners don't knock each other
//    out;
//  - untrusted traffic: guests can't send party control messages, bad sync
//    packets are dropped, guests only listen to their host;
//  - a teammate who goes quiet stops steering the shared camera.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const tick = () => new Promise(r => setImmediate(r));

(async () => {
try {
    // ---- Malformed codes fail before any network work.
    {
        const nm = new NetworkManager();
        const peersBefore = FakePeer.all.length;
        let err = null;
        try { await nm.join('0OIL11'); } catch (e) { err = e; }
        assert(err && err.type === 'invalid-code', "codes with 0/O/1/I/L are rejected, got " + (err && err.type));
        assert(FakePeer.all.length === peersBefore, "no peer is created for an invalid code");
        assert(normalizeRoomCode(' ab cd ef ') === 'ABCDEF', "codes are trimmed and upper-cased");
        console.log("CODE VALIDATION SUCCESS");
    }

    // ---- A wrong code fails as soon as the server says so.
    {
        const nm = new NetworkManager();
        const p = nm.join('ABCDEF').then(() => null, e => e);
        await tick();
        assert(lastPeer.id === null, "joining uses a random peer id");
        lastPeer.emit('open', 'me');
        await tick();
        assert(lastPeer.outgoing.length === 1 && lastPeer.outgoing[0].peer === 'pixeljump-ABCDEF', "connects to the namespaced host id");
        lastPeer.emit('error', { type: 'peer-unavailable' });
        const err = await p;
        assert(err && err.type === 'peer-unavailable', "wrong code rejects right away, got " + (err && err.type));
        console.log("FAST PEER-UNAVAILABLE SUCCESS");
    }

    // ---- A stale join can't touch the party hosted after it.
    {
        const nm = new NetworkManager();
        const joining = nm.join('ABCDEF').then(() => null, e => e);
        await tick();
        lastPeer.emit('open', 'me');
        await tick();
        const joinPeer = lastPeer;
        const hosting = nm.host();
        await tick();
        const hostPeer = lastPeer;
        assert(hostPeer !== joinPeer && /^pixeljump-[A-Z2-9]{6}$/.test(hostPeer.id), "hosting mints a namespaced code, got " + hostPeer.id);
        hostPeer.emit('open', hostPeer.id);
        const code = await hosting;
        assert(code.length === 6 && nm.code === code, "host() returns the bare 6-character code");
        const err = await joining;
        assert(err && err.type === 'cancelled', "the old join is cancelled, got " + (err && err.type));
        assert(joinPeer.destroyed, "the old join's peer is torn down");
        // The stale connect attempt later "opens": it must not register or report.
        let connected = false;
        nm.onConnected = () => { connected = true; };
        joinPeer.outgoing[0].openNow();
        const guest = new FakeDataConn('pixeljump-guest1');
        hostPeer.emit('connection', guest);
        guest.openNow();
        await tick();
        assert(!connected && nm.peer === hostPeer && nm.isHost && nm.conns.has('pixeljump-guest1'), "the new party is untouched");
        nm.disconnect();
        console.log("STALE JOIN SUCCESS");
    }

    // ---- Teardown never reconnects; a real signaling drop does, with backoff.
    {
        const nm = new NetworkManager();
        nm.isHost = true;
        const ready = nm.init('pixeljump-HOSTAA');
        lastPeer.emit('open', 'pixeljump-HOSTAA');
        await ready;
        const peer = lastPeer;
        nm.disconnect();
        await __sleep(1100);
        assert(peer.destroyed && peer.reconnects === 0, "destroy() must not trigger a reconnect");

        const nm2 = new NetworkManager();
        const ready2 = nm2.init('pixeljump-HOSTBB');
        lastPeer.emit('open', 'pixeljump-HOSTBB');
        await ready2;
        const live = lastPeer;
        live.emit('disconnected');
        await __sleep(1100);
        assert(live.reconnects === 1, "a lost signaling connection is retried, got " + live.reconnects);
        nm2.disconnect();
        console.log("RECONNECT RULES SUCCESS");
    }

    // ---- The signaling timeout tears its half-open peer down.
    {
        const nm = new NetworkManager();
        nm.signalingTimeoutMs = 30;
        let err = null;
        const p = nm.init('pixeljump-SLOWWW');
        const peer = lastPeer;
        try { await p; } catch (e) { err = e; }
        assert(err && err.type === 'signaling-timeout', "times out");
        assert(peer.destroyed && nm.peer === null, "the half-open peer is destroyed");
        console.log("SIGNALING TIMEOUT SUCCESS");
    }

    // ---- Host: silent joiners lose their slot; simultaneous joiners coexist.
    {
        const nm = new NetworkManager();
        nm.isHost = true;
        nm.handshakeDeadlineMs = 40;
        const left = [];
        nm.onPeerLeft = id => left.push(id);
        const ready = nm.init('pixeljump-HOSTCC');
        lastPeer.emit('open', 'pixeljump-HOSTCC');
        await ready;
        const a = new FakeDataConn('a'), b = new FakeDataConn('b');
        lastPeer.emit('connection', a);
        lastPeer.emit('connection', b); // arrives before 'a' finished opening
        assert(nm.conns.has('a') && nm.conns.has('b'), "two joiners at once both stay registered");
        a.openNow(); b.openNow();
        a.emit('data', { type: 'handshake', name: 'A' });
        await __sleep(80);
        assert(nm.conns.has('a'), "a joiner who introduced themselves stays");
        assert(!nm.conns.has('b') && b.closed && left.includes('b'), "a silent joiner is dropped and frees the slot");
        nm.disconnect();
        console.log("HANDSHAKE DEADLINE SUCCESS");
    }

    // ---- Untrusted traffic in a real party.
    const bus = new Bus();
    const games = {};
    ['HOST', 'g1', 'g2'].forEach(id => {
        window.network = new FakeNet(bus, id);
        const g = new Game();
        g.net = window.network;
        games[id] = g;
    });
    const as = (g, fn) => { window.network = g.net; return fn(); };
    const connect = (id) => {
        const g = games[id];
        g.net.links.add('HOST');
        games.HOST.net.links.add(id);
        g.net.friendId = 'HOST';
        as(g, () => g.net.onConnected());
        bus.pump();
    };
    const H = games.HOST, G1 = games.g1, G2 = games.g2;
    await as(H, () => H.ui.mpHostBtn.onclick());
    connect('g1'); connect('g2');
    assert(H.party.length === 3, "party of 3");

    // A guest can't close the host's party (or any other control message).
    as(G1, () => G1.net.send({ type: 'party_closed' }));
    as(G1, () => G1.net.send({ type: 'start', seed: 1, party: [] }));
    bus.pump();
    assert(H.party.length === 3 && !H.state.running, "host ignores control messages from a guest");
    console.log("GUEST CONTROL MESSAGES IGNORED SUCCESS");

    as(H, () => H.ui.mpStartBtn.onclick());
    bus.pump();
    assert(G1.state.running && G2.state.running, "run started");

    // A malformed sync is dropped rather than relayed as NaN.
    const before = G2.remotePlayers.get('g1');
    const y0 = before.y;
    as(G1, () => G1.net.send({ type: 'sync', x: 10, vx: 0, vy: 0, skinIndex: 0 })); // no y
    bus.pump();
    assert(G2.remotePlayers.get('g1').y === y0 && Number.isFinite(G2.remotePlayers.get('g1').y), "bad sync ignored");
    // Out-of-range skins and junk fields are cleaned up; the relayed copy is whitelisted.
    as(G1, () => G1.net.send({ type: 'sync', x: 1e9, y: -50, vx: 0, vy: 0, skinIndex: 999, evil: '<b>', activePowerId: 42 }));
    bus.pump();
    const rp = G2.remotePlayers.get('g1');
    assert(rp.x <= CONFIG.WIDTH + 100 && rp.skinIndex === 0 && rp.activePower === null, "values clamped/validated");
    console.log("SYNC SANITIZING SUCCESS");

    // A guest ignores traffic that didn't come from its host.
    const hp = G2.party.length;
    as(G2, () => G2.handleNetworkData({ type: 'party', party: [] }, 'someone-else'));
    assert(G2.party.length === hp, "guest ignores non-host senders");
    console.log("GUEST LISTENS TO HOST ONLY SUCCESS");

    // A teammate who stops sending updates stops steering the camera.
    const rpA = H.remotePlayers.get('g1');
    const rpB = H.remotePlayers.get('g2');
    rpA.y = 700; rpB.y = 700; // both far below the host
    H.state.time = 1000;
    rpA.lastSeenT = 1000 - REMOTE_AWAY_FRAMES - 5; // g1 went quiet
    rpB.lastSeenT = 1000 - REMOTE_AWAY_FRAMES - 5; // so did g2
    H.player.y = 200; H.player.vy = -5;
    const score0 = H.state.score;
    as(H, () => H.update(1));
    assert(H.state.score > score0, "camera follows the active host instead of the frozen teammates");
    assert(H.player.y > 0, "no invisible ceiling from away teammates");
    // ...and after REMOTE_GONE_FRAMES they count as down for ending the run.
    as(H, () => H.die(true));
    bus.pump();
    assert(H.state.running, "the run continues while the others are merely away");
    H.state.time = 1000 + REMOTE_GONE_FRAMES + 10;
    as(H, () => H.update(1));
    assert(!H.state.running, "a dead player isn't left waiting on teammates who went quiet");
    console.log("AWAY TEAMMATES SUCCESS");

    console.log("NETWORK ROBUSTNESS PASSED");
    process.exit(0);
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exit(1);
}
})();
`);
