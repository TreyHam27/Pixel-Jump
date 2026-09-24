const { setupMocks, loadGameSource, failIfUnfinished } = require('./test_helpers');

setupMocks({ realTimers: true });
failIfUnfinished();

const { installMpFakes } = require('./mp_fakes');
installMpFakes();

eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
try {
    // ---------- NetworkManager: host accepts 3 guests, rejects a 4th ----------
    {
        const nm = new NetworkManager();
        nm.isHost = true;
        const joined = [], left = [];
        nm.onPeerJoined = id => joined.push(id);
        nm.onPeerLeft = id => left.push(id);
        const ready = nm.init('HOST01');
        lastPeer.emit('open', 'HOST01');
        await ready;

        const conns = ['a', 'b', 'c'].map(id => new FakeDataConn(id));
        conns.forEach(c => { lastPeer.emit('connection', c); c.openNow(); });
        assert(nm.conns.size === 3, "Host should hold 3 guest connections, has " + nm.conns.size);
        assert(joined.join() === 'a,b,c', "onPeerJoined should fire per guest");

        const fifth = new FakeDataConn('d');
        lastPeer.emit('connection', fifth);
        fifth.openNow();
        assert(!nm.conns.has('d'), "Fifth player must not be registered");
        assert(fifth.sent.some(d => d.type === 'party_full'), "Fifth player should be told the party is full");

        // Data from a guest carries its peer ID.
        let got = null;
        nm.onData = (data, from) => { got = { data, from }; };
        conns[1].emit('data', { type: 'sync', x: 1 });
        assert(got && got.from === 'b', "onData should report the sender");

        // Relay reaches everyone but the sender.
        nm.broadcastExcept('b', { type: 'sync' });
        assert(conns[0].sent.length === 1 && conns[2].sent.length === 1 && conns[1].sent.length === 0,
            "broadcastExcept should skip the sender");

        // A guest dropping fires onPeerLeft for just them.
        conns[0].close();
        assert(left.join() === 'a' && nm.conns.size === 2, "Guest close should fire onPeerLeft once");

        // Deliberate teardown must not report departures.
        nm.disconnect();
        assert(left.join() === 'a', "disconnect() should not fire onPeerLeft");
        nm.stopHeartbeat();
    }

    // ---------- Four Games in one party ----------
    const bus = new Bus();
    const ids = ['HOSTCD', 'g1', 'g2', 'g3', 'g4'];
    const games = {};
    ids.forEach(id => {
        window.network = new FakeNet(bus, id);
        const g = new Game();
        g.net = window.network;
        games[id] = g;
    });
    const as = (g, fn) => { window.network = g.net; return fn(); };
    const connect = (id) => {
        const g = games[id];
        g.net.links.add('HOSTCD');
        games.HOSTCD.net.links.add(id);
        g.net.friendId = 'HOSTCD';
        as(g, () => g.net.onConnected());
        bus.pump();
    };
    const H = games.HOSTCD, G1 = games.g1, G2 = games.g2, G3 = games.g3, G4 = games.g4;

    await as(H, () => H.ui.mpHostBtn.onclick());
    assert(H.state.isHost && H.party.length === 1 && H.party[0].isHost, "Host should lead a party of 1");
    assert(H.ui.mpStartBtn.style.display === 'none', "Start stays hidden until someone joins");

    G3.ui.mpNameInput.value = '<b>x</b>';
    connect('g1'); connect('g2'); connect('g3');
    assert(H.ui.mpPartyList.innerHTML.includes('&lt;b&gt;x&lt;/b&gt;') && !H.ui.mpPartyList.innerHTML.includes('<b>'),
        "Player names must be HTML-escaped in the party list");
    assert(H.party.length === 4, "Party should have 4 members, has " + H.party.length);
    for (const g of [G1, G2, G3]) {
        assert(g.party.length === 4, "Guests should mirror the full party");
        assert(!g.handshakeInterval, "Guest handshake retry should stop once acked");
    }
    assert(JSON.stringify(H.party.map(m => m.slot)) === '[0,1,2,3]', "Slots should be 0..3");
    assert(H.ui.mpStartBtn.style.display === 'block', "Host can start with a full party");

    // The party list renders leader first, escapes names, and has no empty rows when full.
    assert(G2.ui.mpPartyList.innerHTML.trim().startsWith('<li class="mp-party-row is-leader"'),
        "Leader row should render on top");
    assert((G2.ui.mpPartyList.innerHTML.match(/YOU/g) || []).length === 1, "Exactly one row is marked YOU");
    assert(H.ui.mpPartyList.innerHTML.indexOf('is-empty') === -1, "Full party has no empty rows");
    assert(H.ui.mpPartyCount.innerText === '4/4', "Party count should read 4/4");

    // A fifth player is turned away and returns to setup.
    connect('g4');
    assert(G4.party.length === 0, "Fifth player should be bounced out of the party");
    assert(H.party.length === 4, "Party stays at 4");

    // ---------- Run: all four start with each other ----------
    as(H, () => H.ui.mpStartBtn.onclick());
    bus.pump();
    for (const g of [H, G1, G2, G3]) {
        assert(g.state.running && g.state.multiplayer, "Everyone should be in the run");
        assert(g.remotePlayers.size === 3, "Each client sees 3 other players, got " + g.remotePlayers.size);
    }
    assert(H.state.seed === G1.state.seed && G1.state.seed === G3.state.seed, "Everyone shares the seed");

    // Guest-to-guest sync is relayed through the host.
    as(G1, () => G1.net.send({ type: 'sync', pid: 'g1', x: 42, y: -100, vx: 0, vy: 0, skinIndex: 0, activePowerId: null }));
    bus.pump();
    assert(G2.remotePlayers.get('g1').x === 42, "G2 should see G1's position via the host relay");

    // ---------- Deaths: the run continues while anyone is alive ----------
    as(G1, () => G1.die(true));
    bus.pump();
    assert(G1.player.isDead && G1.state.running, "G1 is dead but the run continues");
    assert(H.remotePlayers.get('g1').isDead && G3.remotePlayers.get('g1').isDead, "Everyone sees G1 dead");
    // Respawn timers are individual: only the dead player's is ticking.
    assert(G1.respawnInterval, "G1's own respawn countdown should be running");
    assert(!H.respawnInterval && !G2.respawnInterval, "Alive players have no countdown");

    as(G2, () => G2.die(true));
    bus.pump();
    assert(G2.respawnInterval && G1.respawnInterval && G1.respawnInterval !== G2.respawnInterval,
        "G1 and G2 each run their own countdown");
    assert(G2.state.deathCount === 1 && G1.state.deathCount === 1, "Death counts are per player");

    // G1 revives; others see it.
    as(G1, () => G1.mpRevive());
    bus.pump();
    assert(!G1.player.isDead && !H.remotePlayers.get('g1').isDead, "G1's revive should reach everyone");

    // ---------- G3 drops mid-run ----------
    bus.q.push({ to: 'HOSTCD', from: 'g3', close: true });
    bus.q.push({ to: 'g3', from: 'HOSTCD', close: true });
    bus.pump();
    assert(H.party.length === 3 && G1.party.length === 3, "G3 should be removed from everyone's party");
    assert(!G2.remotePlayers.has('g3'), "G3's player should be removed from the run");
    assert(!G3.state.running && G3.party.length === 0, "G3 lost the host: run over, back to setup");
    assert(H.state.running, "Run continues for the rest");

    // ---------- Last players fall: run ends for everyone ----------
    as(H, () => H.die(true));
    bus.pump();
    assert(G1.state.running, "G1 still alive, run continues");
    as(G1, () => G1.die(true));
    bus.pump();
    for (const g of [H, G1, G2]) {
        assert(!g.state.running, "Run should end once everyone is dead");
        assert(!g.respawnInterval, "Countdowns are cancelled when the run ends");
    }
    assert(H.ui.mpStartBtn.style.display === 'block' && H.ui.mpStartBtn.innerText === 'PLAY AGAIN',
        "Leader gets PLAY AGAIN with the party intact");
    assert(G1.party.length === 3, "Party survives the game over");

    // ---------- Leader closes the party ----------
    as(H, () => H.leaveParty("LEFT THE PARTY"));
    bus.pump();
    for (const g of [H, G1, G2]) assert(g.party.length === 0, "Everyone is back at setup after the leader leaves");
    assert(!H.state.isHost, "Leader is no longer hosting");

    console.log("MP party test passed");
    process.exit(0);
} catch (e) {
    console.error("Test Failed:", e);
    process.exit(1);
}
})();
`);
