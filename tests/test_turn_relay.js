const { setupMocks, loadGameSource, sleep, failIfUnfinished } = require('./test_helpers');
const { installMpFakes } = require('./mp_fakes');

setupMocks({ realTimers: true });
failIfUnfinished();
installMpFakes();
global.__sleep = sleep;

// Co-op on strict networks goes through a TURN relay. host() and join()
// fetch relay logins (TURN_CREDENTIALS_URL) and hand them to PeerJS after the
// STUN servers. The response is untrusted, a slow or failed fetch never
// blocks co-op, logins are cached, and leaving mid-fetch cancels cleanly.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const tick = () => new Promise(r => setImmediate(r));
const URL = 'https://pixeljump.metered.live/api/v1/turn/credentials?apiKey=k';
const RELAY = [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'u', credential: 'c' },
    { urls: ['turns:global.relay.metered.ca:443?transport=tcp'], username: 'u', credential: 'c' }
];
let calls = 0;
const respondWith = (body) => { global.fetch = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve(body) }); }; };
const relayNm = () => { const nm = new NetworkManager(); nm.relayUrl = URL; return nm; };
// Hosts and returns the Peer it created (after the relay step).
async function hostOnce(nm) {
    const before = FakePeer.all.length;
    const p = nm.host();
    await tick();
    assert(FakePeer.all.length === before + 1, "host() created a peer");
    const peer = lastPeer;
    peer.emit('open', peer.id);
    await p;
    return peer;
}
const urlsOf = peer => peer.opts.config.iceServers.map(s => JSON.stringify(s.urls));

(async () => {
try {
    // ---- No relay configured: no fetch, STUN only (today's behaviour).
    {
        calls = 0; respondWith(RELAY);
        const nm = new NetworkManager();
        nm.relayUrl = '';
        assert(nm.prefetchRelay() === null, "nothing to wait for without a URL");
        const peer = await hostOnce(nm);
        assert(calls === 0, "no fetch without a URL");
        const servers = peer.opts.config.iceServers;
        assert(servers.length === 3 && servers.every(s => /^stun:stun[0-9]?\\.l\\.google\\.com/.test(s.urls)), "Google STUN only");
        assert(!('iceTransportPolicy' in peer.opts.config), "direct links allowed");
        nm.disconnect();
        console.log("NO RELAY SUCCESS");
    }

    // ---- A good response: STUN first, then the relay entries in order;
    //      a second host within the cache window doesn't refetch.
    {
        calls = 0; respondWith(RELAY);
        const nm = relayNm();
        const peer = await hostOnce(nm);
        assert(calls === 1, "fetched once, got " + calls);
        const servers = peer.opts.config.iceServers;
        assert(servers.length === 6, "3 STUN + 3 relay, got " + servers.length);
        assert(JSON.stringify(servers.slice(3)) === JSON.stringify(RELAY), "relay entries follow STUN unchanged");
        nm.disconnect();
        const again = await hostOnce(nm);
        assert(calls === 1, "cached logins are reused, fetches: " + calls);
        assert(again.opts.config.iceServers.length === 6, "cached relay still used");
        nm.disconnect();
        console.log("RELAY SERVERS SUCCESS");
    }

    // ---- Untrusted response: bad entries are dropped, good ones kept.
    {
        assert(sanitizeIceServers({ urls: 'turn:x' }).length === 0, "a non-array body is ignored");
        assert(sanitizeIceServers('nope').length === 0, "a string body is ignored");
        const clean = sanitizeIceServers([
            { urls: 'javascript:alert(1)' },
            { urls: 'https://evil.example' },
            { urls: ['turn:ok:80', 'http://x'] },
            { urls: 'turn:a:80', username: 'u', credential: 42 },
            { urls: 'turn:b:80', username: {}, credential: 'c' },
            null, 7, { urls: [] },
            { urls: 'turn:good:80', username: 'u', credential: 'c', extra: 'dropped' },
            { urls: 'stun:good:3478' }
        ]);
        assert(clean.length === 2, "only the two good entries survive, got " + JSON.stringify(clean));
        assert(JSON.stringify(clean[0]) === JSON.stringify({ urls: 'turn:good:80', username: 'u', credential: 'c' }), "unknown fields are stripped");
        const many = Array.from({ length: 30 }, (_, i) => ({ urls: 'stun:s' + i }));
        assert(sanitizeIceServers(many).length === 12, "capped at 12 entries");

        calls = 0; respondWith([{ urls: 'javascript:alert(1)' }]);
        const nm = relayNm();
        const peer = await hostOnce(nm);
        assert(peer.opts.config.iceServers.length === 3, "an all-bad response leaves STUN only");
        assert(nm.relayFetchedAt === 0, "an unusable response isn't cached");
        nm.disconnect();
        console.log("SANITIZE SUCCESS");
    }

    // ---- Cloudflare Realtime TURN (via cloudflare/turn-worker): one entry
    //      mixing stun:, turn: and turns: urls under one login.
    {
        const CF = [{
            urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'],
            username: 'u', credential: 'c'
        }];
        assert(JSON.stringify(sanitizeIceServers(CF)) === JSON.stringify(CF), "Cloudflare entry passes unchanged");
        calls = 0; respondWith(CF);
        const nm = new NetworkManager();
        nm.relayUrl = 'https://pixel-jump-turn.example.workers.dev/';
        const peer = await hostOnce(nm);
        assert(calls === 1 && peer.opts.config.iceServers.length === 4, "3 STUN + the Cloudflare entry");
        nm.disconnect();
        console.log("CLOUDFLARE SHAPE SUCCESS");
    }

    // ---- A relay that never answers, or fails, never blocks hosting.
    {
        calls = 0;
        global.fetch = (url, opts) => { calls++; return new Promise((_, reject) => {
            if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }); };
        const nm = relayNm();
        nm.relayTimeoutMs = 30;
        const before = FakePeer.all.length;
        const p = nm.host();
        await tick();
        assert(FakePeer.all.length === before, "host() waits for the relay first");
        await __sleep(60);
        assert(FakePeer.all.length === before + 1, "then gives up and hosts anyway");
        lastPeer.emit('open', lastPeer.id);
        const code = await p;
        assert(code && code.length === 6, "a code was minted");
        assert(lastPeer.opts.config.iceServers.length === 3, "STUN only after a timeout");
        assert(nm.relayPending === null, "the pending fetch is cleared");
        nm.disconnect();

        global.fetch = () => { calls++; return Promise.reject(new Error('offline')); };
        const nm2 = relayNm();
        const peer = await hostOnce(nm2);
        assert(peer.opts.config.iceServers.length === 3, "STUN only after a failed fetch");
        nm2.disconnect();

        global.fetch = () => { calls++; return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve(RELAY) }); };
        const nm3 = relayNm();
        const peer3 = await hostOnce(nm3);
        assert(peer3.opts.config.iceServers.length === 3, "an HTTP error (e.g. quota used up) leaves STUN only");
        nm3.disconnect();
        console.log("RELAY FAILURE SUCCESS");
    }

    // ---- Leaving while the logins load cancels host() and join() cleanly.
    {
        let release = null;
        global.fetch = () => new Promise(r => { release = () => r({ ok: true, json: () => Promise.resolve(RELAY) }); });
        const nm = relayNm();
        const before = FakePeer.all.length;
        const hosting = nm.host().then(() => null, e => e);
        await tick();
        nm.leave();
        release();
        const err = await hosting;
        assert(err && err.type === 'cancelled', "host() is cancelled, got " + (err && err.type));
        assert(FakePeer.all.length === before && nm.peer === null && !nm.isHost, "no peer was created");
        assert(nm.relayServers.length === 3, "the fetched logins are still cached for next time");

        const nm2 = relayNm();
        const joining = nm2.join('ABCDEF').then(() => null, e => e);
        await tick();
        nm2.disconnect();
        release();
        const err2 = await joining;
        assert(err2 && err2.type === 'cancelled', "join() is cancelled, got " + (err2 && err2.type));
        assert(FakePeer.all.length === before, "no peer was created for the join");
        console.log("CANCEL SUCCESS");
    }

    // ---- Joining uses the relay too.
    {
        calls = 0; respondWith(RELAY);
        const nm = relayNm();
        nm.signalingTimeoutMs = 30; // the fake server never opens; don't wait 10s
        const joining = nm.join('ABCDEF').then(() => null, e => e);
        await tick();
        assert(calls === 1 && lastPeer.opts.config.iceServers.length === 6, "the joiner's peer has the relay");
        nm.disconnect();
        await joining;
        console.log("JOIN RELAY SUCCESS");
    }

    // ---- ?relay forces relay-only connections (for testing at home).
    {
        respondWith(RELAY);
        const nm = relayNm();
        nm.relayOnly = true;
        const peer = await hostOnce(nm);
        assert(peer.opts.config.iceTransportPolicy === 'relay', "relay-only policy is set");
        nm.disconnect();
        console.log("RELAY ONLY SUCCESS");
    }

    // ---- Opening the co-op menu warms the logins, once.
    {
        calls = 0;
        let release = null;
        global.fetch = () => { calls++; return new Promise(r => { release = () => r({ ok: true, json: () => Promise.resolve(RELAY) }); }); };
        const g = new Game();
        window.network.relayUrl = URL;
        g.ui.toMpBtn.onclick();
        g.ui.toMpBtn.onclick();
        assert(calls === 1, "one request while the first is in flight, got " + calls);
        release();
        await tick();
        assert(window.network.relayServers.length === 3, "logins cached before HOST/JOIN");
        g.ui.toMpBtn.onclick();
        assert(calls === 1, "no refetch within the cache window");
        console.log("MENU PREFETCH SUCCESS");
    }

    process.exit(0);
} catch (e) {
    console.error(e);
    process.exit(1);
}
})();
`);
