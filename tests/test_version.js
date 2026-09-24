const fs = require('fs');
const path = require('path');
const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// GitHub Pages serves main directly, so players can have an old build cached
// while others load the new one. Two checks guard against that:
//  1. every local asset URL in index.html carries ?v=GAME_VERSION, so one
//     deploy's files are never mixed with another's;
//  2. co-op refuses to pair clients built with a different NET_PROTOCOL
//     (they would generate different levels).
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
global.__indexHtml = html;

eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

try {
    const refs = [...__indexHtml.matchAll(/(?:src|href)="([^"]+\\.(?:js|css)(?:\\?[^"]*)?)"/g)]
        .map(m => m[1])
        .filter(u => !/^https?:/.test(u));
    assert(refs.length >= 10, "expected the local scripts and stylesheet, found " + refs.length);
    for (const u of refs) {
        assert(u.endsWith('?v=' + GAME_VERSION), u + " should end with ?v=" + GAME_VERSION);
    }
    console.log("ASSET VERSION SUCCESS");

    // Host side: a guest without (or with another) protocol version is sent
    // away before it takes a seat.
    const sent = [];
    const closed = [];
    window.network = {
        myId: 'HOST', send() {}, broadcastExcept() {},
        sendTo: (id, d) => sent.push([id, d]),
        closePeer: id => closed.push(id)
    };
    const host = new Game();
    host.state.isHost = true;
    host.party = [{ pid: 'HOST', name: 'H', slot: 0, isHost: true }];
    host.handleHandshake({ type: 'handshake', name: 'OLD' }, 'g-old');
    assert(sent.some(([id, d]) => id === 'g-old' && d.type === 'version_mismatch'), "old guest gets version_mismatch");
    assert(host.party.length === 1, "old guest is not seated");
    host.handleHandshake({ type: 'handshake', name: 'NEW', v: NET_PROTOCOL }, 'g-new');
    assert(host.party.length === 2, "matching guest is seated");
    const ack = sent.find(([id, d]) => id === 'g-new' && d.type === 'handshake_ack');
    assert(ack && ack[1].v === NET_PROTOCOL, "ack carries the protocol version");
    console.log("HOST VERSION GATE SUCCESS");

    // Guest side: an ack without a version means an older host.
    let left = null;
    window.network = { myId: 'G', friendId: 'HOST', send() {}, sendTo() {}, leave() {} };
    const guest = new Game();
    guest.leaveParty = (msg) => { left = msg; };
    guest.handleNetworkData({ type: 'handshake_ack', party: [] }, 'HOST');
    assert(left && /OLDER VERSION/.test(left), "guest leaves an older host, got " + left);
    left = null;
    guest.handleNetworkData({ type: 'version_mismatch', v: 99 }, 'HOST');
    assert(left && /REFRESH/.test(left), "guest told to refresh on mismatch");
    console.log("GUEST VERSION GATE SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
