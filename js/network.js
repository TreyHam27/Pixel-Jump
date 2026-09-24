// Room codes: 6 characters from an alphabet without the look-alikes
// 0/O, 1/I/L. On the public PeerJS server the peer ID is the code with a
// game prefix, so another app's IDs can never collide with ours.
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const PEER_ID_PREFIX = 'pixeljump-';

// Spaces removed and upper-cased; null unless it's a well-formed code.
function normalizeRoomCode(input) {
    const code = String(input || '').replace(/\s+/g, '').toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH) return null;
    for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
    return code;
}

class NetworkManager {
    constructor() {
        this.peer = null;
        // Hub-and-spoke: the host holds one connection per guest, a guest
        // holds exactly one (to the host). Keyed by remote peer ID.
        this.conns = new Map();
        this.isHost = false;
        this.myId = null;
        this.friendId = null;
        this.code = null;            // the room code being hosted/joined (no prefix)

        // Host + up to 3 guests = 4 players.
        this.maxGuests = 3;

        // Heartbeat state: one shared ping loop, one watchdog per connection
        // so a single silent guest can't take the whole party down.
        this.heartbeatInterval = null;
        this.watchdogs = new Map();
        // Host: a new connection must open and send its first message (the
        // handshake) within this long, or it's dropped and frees its slot.
        this.handshakeDeadlineMs = 10000;
        // How long host()/join() wait for the signaling server.
        this.signalingTimeoutMs = 10000;
        this.handshakeTimers = new Map();

        // Bumped by every host/join/leave. A join still retrying in the
        // background checks it after every await and quietly gives up once a
        // newer action has superseded it.
        this.joinGen = 0;
        this.rejectAttempt = null;   // fails the in-flight connect attempt

        this.reconnectAttempts = 0;
        this.reconnectTimer = null;

        this.onConnected = null;     // guest: data channel to the host is open
        this.onPeerJoined = null;    // host: a guest's data channel opened (id)
        this.onPeerLeft = null;      // host: a guest's connection closed (id)
        this.onData = null;          // (data, fromId)
        this.onDisconnected = null;  // guest: lost the host
        this.onError = null;         // errors in a live session
        this.onStatus = null;
    }

    generateCode() {
        let code = '';
        for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
            code += ROOM_CODE_ALPHABET.charAt(Math.floor(Math.random() * ROOM_CODE_ALPHABET.length));
        }
        return code;
    }

    getIceServers() {
        // Google's public STUN servers. The free "openrelay" TURN relay and
        // stun.services.mozilla.com no longer answer (checked 2026-09), so
        // they only slowed ICE down. Players behind strict NATs need a TURN
        // relay: add one (with your own credentials) to EXTRA_ICE_SERVERS.
        const base = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ];
        return base.concat(typeof EXTRA_ICE_SERVERS !== 'undefined' ? EXTRA_ICE_SERVERS : []);
    }

    init(id = null) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const peer = new Peer(id, {
                debug: 1, // errors only
                config: {
                    'iceServers': this.getIceServers()
                }
            });
            this.peer = peer;

            // Without this, a slow/unreachable signaling server leaves host()/join()
            // pending forever with no error ever surfaced to the UI.
            const openTimeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                const err = new Error("Could not reach the signaling server.");
                err.type = 'signaling-timeout';
                this.retirePeer(peer);
                reject(err);
            }, this.signalingTimeoutMs);

            peer.on('open', (assignedId) => {
                clearTimeout(openTimeout);
                if (peer !== this.peer) return;
                // Also fires after a signaling reconnect.
                this.reconnectAttempts = 0;
                if (settled) return;
                settled = true;
                console.log("PeerJS: Signaling channel open. ID:", assignedId);
                this.myId = assignedId;
                resolve(assignedId);
            });

            peer.on('connection', (connection) => {
                if (peer !== this.peer) return;
                if (!this.isHost) {
                    connection.on('open', () => connection.close());
                    return;
                }

                // A reconnect from the same peer replaces its old connection.
                if (this.conns.has(connection.peer)) this.dropConn(connection.peer);

                if (this.conns.size >= this.maxGuests) {
                    connection.on('open', () => {
                        try { connection.send({ type: 'party_full' }); } catch (e) { }
                        // Give the message a moment to flush before closing.
                        setTimeout(() => { try { connection.close(); } catch (e) { } }, 500);
                    });
                    return;
                }

                this.addConn(connection);
                this.armHandshakeDeadline(connection.peer);
                connection.on('open', () => {
                    if (this.conns.get(connection.peer) !== connection) return;
                    this.startHeartbeat();
                    this.resetWatchdog(connection.peer);
                    if (this.onPeerJoined) this.onPeerJoined(connection.peer);
                });
            });

            peer.on('error', (err) => {
                if (peer !== this.peer) return;
                if (!settled) {
                    // host()/join() report these through their own promise.
                    clearTimeout(openTimeout);
                    settled = true;
                    this.retirePeer(peer);
                    reject(err);
                    return;
                }
                // A wrong room code surfaces here (not on the connection), so
                // fail the connect attempt now instead of waiting it out.
                if (err && err.type === 'peer-unavailable' && this.rejectAttempt) {
                    this.rejectAttempt(err);
                    return;
                }
                console.error("PeerJS:", err);
                if (this.onError) this.onError(err);
            });

            peer.on('disconnected', () => {
                // PeerJS emits this from inside destroy() too; only a live
                // peer that lost the signaling server should reconnect.
                if (peer !== this.peer || peer.destroyed || peer.retired) return;
                this.scheduleReconnect(peer);
            });
        });
    }

    // Losing the signaling server doesn't break open data channels, but the
    // room code stops working for new joiners until it's back. Retry with
    // backoff: 1, 2, 4, 8, 16s.
    scheduleReconnect(peer) {
        if (this.reconnectTimer) return;
        this.reconnectAttempts++;
        if (this.reconnectAttempts > 5) {
            console.warn("PeerJS: giving up on the signaling server");
            return;
        }
        const delay = 1000 * Math.pow(2, this.reconnectAttempts - 1);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (peer !== this.peer || peer.destroyed || peer.retired) return;
            try { peer.reconnect(); } catch (e) { }
        }, delay);
    }

    // Tears a peer down for good. Marked first, so the 'disconnected' event
    // destroy() emits doesn't trigger a reconnect (which used to reopen a
    // signaling socket that kept holding the old room code).
    retirePeer(peer) {
        if (!peer) return;
        peer.retired = true;
        if (this.peer === peer) this.peer = null;
        try { peer.destroy(); } catch (e) { }
    }

    // Registers a connection and wires its data/close/error handlers. Every
    // handler first checks the connection is still the registered one, so a
    // connection we deliberately dropped (leave, retry, replacement) closes
    // silently instead of firing onPeerLeft/onDisconnected.
    addConn(connection) {
        const id = connection.peer;
        this.conns.set(id, connection);
        const isCurrent = () => this.conns.get(id) === connection;
        // A connection that dies mid-handshake is a failed attempt (join()
        // retries it), not a departure — only opened ones report leaving.
        let wasOpen = false;
        connection.on('open', () => { wasOpen = true; });

        connection.on('data', (data) => {
            if (!isCurrent()) return;
            this.resetWatchdog(id);
            if (data && data.type === 'ping') return;
            this.clearHandshakeDeadline(id);
            if (this.onData) this.onData(data, id);
        });

        connection.on('error', (err) => {
            if (!isCurrent()) return;
            console.error("PeerJS: Connection Error:", id, err);
            // Before it opens, a failure belongs to the join attempt, which
            // reports (or retries) on its own.
            if (wasOpen && this.onError) this.onError(err);
        });

        connection.on('close', () => {
            if (!isCurrent()) return;
            this.forgetConn(id);
            if (!wasOpen) return;
            if (this.isHost) {
                if (this.onPeerLeft) this.onPeerLeft(id);
            } else if (this.onDisconnected) {
                this.onDisconnected();
            }
        });
    }

    armHandshakeDeadline(id) {
        this.clearHandshakeDeadline(id);
        this.handshakeTimers.set(id, setTimeout(() => {
            this.handshakeTimers.delete(id);
            console.warn("PeerJS: no handshake from", id);
            this.closePeer(id);
        }, this.handshakeDeadlineMs));
    }

    clearHandshakeDeadline(id) {
        const t = this.handshakeTimers.get(id);
        if (t) clearTimeout(t);
        this.handshakeTimers.delete(id);
    }

    // Removes a connection from the registry (without closing it).
    forgetConn(id) {
        this.conns.delete(id);
        this.clearWatchdog(id);
        this.clearHandshakeDeadline(id);
        if (this.conns.size === 0) this.stopHeartbeat();
    }

    // Deliberately closes one connection without firing leave callbacks.
    dropConn(id) {
        const c = this.conns.get(id);
        this.forgetConn(id);
        if (c) { try { c.close(); } catch (e) { } }
    }

    // Host: remove a single guest (went silent, never handshook, or joined
    // mid-run). Fires onPeerLeft so the app's party bookkeeping stays in one
    // place.
    closePeer(id) {
        if (!this.conns.has(id)) return;
        this.dropConn(id);
        if (this.isHost && this.onPeerLeft) this.onPeerLeft(id);
    }

    async host() {
        this.disconnect(); // Clear any existing peer before hosting fresh
        const gen = this.joinGen;
        this.isHost = true;
        const maxRetries = 5;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const code = this.generateCode();
            try {
                await this.init(PEER_ID_PREFIX + code);
            } catch (err) {
                if (gen !== this.joinGen) {
                    const cancelled = new Error("Hosting was cancelled.");
                    cancelled.type = 'cancelled';
                    throw cancelled;
                }
                if (attempt < maxRetries - 1 && (err.type === 'unavailable-id' || err.type === 'invalid-id')) continue;
                this.isHost = false;
                throw err;
            }
            if (gen !== this.joinGen) {
                // Left (or started something else) while the code was minted.
                const err = new Error("Hosting was cancelled.");
                err.type = 'cancelled';
                throw err;
            }
            this.code = code;
            return code;
        }
    }

    // Resolves once connected to the host; rejects with a typed error
    // ('invalid-code', 'peer-unavailable', 'connection-timeout', ...) or
    // 'cancelled' if a newer host/join/leave superseded it.
    async join(hostCode) {
        this.disconnect(); // Clean old state
        const gen = this.joinGen;
        this.isHost = false;

        const code = normalizeRoomCode(hostCode);
        if (!code) {
            const err = new Error("Not a room code.");
            err.type = 'invalid-code';
            throw err;
        }
        this.code = code;
        this.friendId = PEER_ID_PREFIX + code;

        const cancelled = () => {
            const err = new Error("Join was cancelled.");
            err.type = 'cancelled';
            return err;
        };

        await this.init();
        if (gen !== this.joinGen) throw cancelled();

        const maxAttempts = 3;
        const attemptTimeout = 20000; // slow NATs can take a while to negotiate

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.attemptConnect(attempt, attemptTimeout, gen);
                return;
            } catch (err) {
                if (gen !== this.joinGen) throw cancelled();
                this.dropConn(this.friendId);
                // A code nobody is hosting won't start working on a retry.
                if (err.type === 'peer-unavailable' || attempt === maxAttempts) {
                    this.disconnect();
                    if (err.type === 'peer-unavailable') throw err;
                    const finalErr = new Error("Could not connect after " + maxAttempts + " attempts.");
                    finalErr.type = 'connection-timeout';
                    throw finalErr;
                }
                if (this.onStatus) this.onStatus(`RETRYING... (${attempt + 1}/${maxAttempts})`);
                await new Promise(r => setTimeout(r, 1000));
                if (gen !== this.joinGen) throw cancelled();
            }
        }
    }

    attemptConnect(attempt, timeout, gen) {
        return new Promise((resolve, reject) => {
            let done = false;
            let timer = null;
            const finish = (err) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (this.rejectAttempt === fail) this.rejectAttempt = null;
                if (err) reject(err); else resolve();
            };
            const fail = (err) => finish(err || new Error(`Attempt ${attempt} failed`));
            this.rejectAttempt = fail;

            const conn = this.peer.connect(this.friendId, {
                reliable: true,
                serialization: 'json',
                metadata: { attempt: attempt }
            });

            timer = setTimeout(() => fail(new Error(`Attempt ${attempt} timed out`)), timeout);

            // Register handlers IMMEDIATELY, don't wait for 'open'
            this.addConn(conn);

            conn.on('open', () => {
                if (gen !== this.joinGen || this.conns.get(this.friendId) !== conn) {
                    try { conn.close(); } catch (e) { }
                    return;
                }
                this.startHeartbeat();
                this.resetWatchdog(conn.peer);
                finish();
                if (this.onConnected) this.onConnected();
            });

            conn.on('error', (err) => fail(err));
            conn.on('close', () => fail(new Error("Connection closed during handshake")));
        });
    }

    startHeartbeat() {
        if (this.heartbeatInterval) return;
        // PING every 2 seconds
        this.heartbeatInterval = setInterval(() => {
            this.send({ type: 'ping' });
        }, 2000);
    }

    // WATCHDOG: If no packet (ping or data) from a peer for 15 seconds,
    // assume that connection is dead.
    resetWatchdog(id) {
        this.clearWatchdog(id);
        this.watchdogs.set(id, setTimeout(() => {
            console.warn("PeerJS: Connection timed out (Watchdog):", id);
            if (this.isHost) {
                // One guest went silent — drop just them.
                this.closePeer(id);
            } else {
                // Lost the host — the party is over for us.
                this.disconnect();
                if (this.onDisconnected) this.onDisconnected();
            }
        }, 15000));
    }

    clearWatchdog(id) {
        const t = this.watchdogs.get(id);
        if (t) clearTimeout(t);
        this.watchdogs.delete(id);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
        for (const t of this.watchdogs.values()) clearTimeout(t);
        this.watchdogs.clear();
    }

    isConnected() {
        for (const c of this.conns.values()) if (c.open) return true;
        return false;
    }

    sendTo(id, data) {
        const c = this.conns.get(id);
        if (c && c.open) {
            try {
                c.send(data);
            } catch (e) {
                console.error("PeerJS: Send failed", e);
            }
        }
    }

    // Everyone we're directly connected to (all guests for the host; just the
    // host for a guest).
    send(data) {
        for (const id of [...this.conns.keys()]) this.sendTo(id, data);
    }

    // Host relay: forward a guest's message to every other guest.
    broadcastExcept(exceptId, data) {
        for (const id of [...this.conns.keys()]) {
            if (id !== exceptId) this.sendTo(id, data);
        }
    }

    // Voluntarily leave the party. A host closing down tells every guest
    // first, then gives the message a beat to flush before tearing down.
    leave() {
        if (this.isHost && this.conns.size > 0) {
            this.send({ type: 'party_closed' });
            this.joinGen++;
            const peer = this.peer;
            const conns = [...this.conns.values()];
            this.stopHeartbeat();
            for (const id of [...this.handshakeTimers.keys()]) this.clearHandshakeDeadline(id);
            this.conns = new Map();
            if (peer) peer.retired = true;
            this.peer = null;
            setTimeout(() => {
                conns.forEach(c => { try { c.close(); } catch (e) { } });
                this.retirePeer(peer);
            }, 300);
        } else {
            this.disconnect();
        }
        this.isHost = false;
        this.code = null;
    }

    disconnect() {
        this.joinGen++;
        if (this.rejectAttempt) this.rejectAttempt(new Error("Disconnected"));
        this.stopHeartbeat();
        for (const id of [...this.handshakeTimers.keys()]) this.clearHandshakeDeadline(id);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        // Swap the registry out first so the close events these trigger are
        // recognised as deliberate and don't fire leave callbacks.
        const conns = [...this.conns.values()];
        this.conns = new Map();
        conns.forEach(c => { try { c.close(); } catch (e) { } });
        this.retirePeer(this.peer);
        this.peer = null;
    }
}

window.network = new NetworkManager();
