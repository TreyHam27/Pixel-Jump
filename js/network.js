class NetworkManager {
    constructor() {
        this.peer = null;
        // Hub-and-spoke: the host holds one connection per guest, a guest
        // holds exactly one (to the host). Keyed by remote peer ID.
        this.conns = new Map();
        this.isHost = false;
        this.myId = null;
        this.friendId = null;

        // Host + up to 3 guests = 4 players.
        this.maxGuests = 3;

        // Heartbeat state: one shared ping loop, one watchdog per connection
        // so a single silent guest can't take the whole party down.
        this.heartbeatInterval = null;
        this.watchdogs = new Map();

        this.onConnected = null;     // guest: data channel to the host is open
        this.onPeerJoined = null;    // host: a guest's data channel opened (id)
        this.onPeerLeft = null;      // host: a guest's connection closed (id)
        this.onData = null;          // (data, fromId)
        this.onDisconnected = null;  // guest: lost the host
        this.onError = null;
        this.onStatus = null;
    }

    generateCode() {
        // Exclude 0, O, I, 1, L to avoid visual confusion
        const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        return code;
    }

    getIceServers() {
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun.services.mozilla.com' },
            {
                // UDP, TCP, and TLS variants so the relay still works behind
                // firewalls that block plain UDP (common on cellular/corporate
                // networks) — this is the fallback path when direct P2P fails.
                urls: [
                    'turn:openrelay.metered.ca:80',
                    'turn:openrelay.metered.ca:80?transport=tcp',
                    'turn:openrelay.metered.ca:443',
                    'turn:openrelay.metered.ca:443?transport=tcp',
                    'turns:openrelay.metered.ca:443?transport=tcp'
                ],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ];
    }

    init(id = null) {
        return new Promise((resolve, reject) => {
            let settled = false;
            this.peer = new Peer(id, {
                debug: 2,
                config: {
                    'iceServers': this.getIceServers()
                }
            });

            // Without this, a slow/unreachable signaling server leaves host()/join()
            // pending forever with no error ever surfaced to the UI.
            const openTimeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                const err = new Error("Could not reach the signaling server.");
                err.type = 'signaling-timeout';
                reject(err);
            }, 10000);

            this.peer.on('open', (assignedId) => {
                clearTimeout(openTimeout);
                if (settled) return;
                settled = true;
                console.log("PeerJS: Signaling channel open. ID:", assignedId);
                this.myId = assignedId;
                resolve(assignedId);
            });

            this.peer.on('connection', (connection) => {
                console.log("PeerJS: Incoming connection from", connection.peer);
                if (!this.isHost) {
                    console.log("PeerJS: Rejecting connection (not host)");
                    connection.on('open', () => connection.close());
                    return;
                }

                // Drop stale entries that never finished opening.
                for (const [id, c] of [...this.conns]) {
                    if (!c.open) this.dropConn(id);
                }
                // A reconnect from the same peer replaces its old connection.
                if (this.conns.has(connection.peer)) this.dropConn(connection.peer);

                if (this.conns.size >= this.maxGuests) {
                    console.log("PeerJS: Rejecting connection (party full)");
                    connection.on('open', () => {
                        try { connection.send({ type: 'party_full' }); } catch (e) { }
                        // Give the message a moment to flush before closing.
                        setTimeout(() => { try { connection.close(); } catch (e) { } }, 500);
                    });
                    return;
                }

                this.addConn(connection);
                connection.on('open', () => {
                    if (this.conns.get(connection.peer) !== connection) return;
                    console.log("PeerJS: Connection accepted and open:", connection.peer);
                    this.startHeartbeat();
                    this.resetWatchdog(connection.peer);
                    if (this.onPeerJoined) this.onPeerJoined(connection.peer);
                });
            });

            this.peer.on('error', (err) => {
                clearTimeout(openTimeout);
                console.error("PeerJS: Global Error:", err);
                if (this.onError) this.onError(err);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                console.log("PeerJS: Disconnected from signaling server.");
                // Attempt to reconnect to signaling server
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
                }
            });
        });
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
            if (this.onData) this.onData(data, id);
        });

        connection.on('error', (err) => {
            if (!isCurrent()) return;
            console.error("PeerJS: Connection Error:", id, err);
            if (this.onError) this.onError(err);
        });

        connection.on('close', () => {
            if (!isCurrent()) return;
            console.log("PeerJS: Connection closed:", id);
            this.forgetConn(id);
            if (!wasOpen) return;
            if (this.isHost) {
                if (this.onPeerLeft) this.onPeerLeft(id);
            } else if (this.onDisconnected) {
                this.onDisconnected();
            }
        });
    }

    // Removes a connection from the registry (without closing it).
    forgetConn(id) {
        this.conns.delete(id);
        this.clearWatchdog(id);
        if (this.conns.size === 0) this.stopHeartbeat();
    }

    // Deliberately closes one connection without firing leave callbacks.
    dropConn(id) {
        const c = this.conns.get(id);
        this.forgetConn(id);
        if (c) { try { c.close(); } catch (e) { } }
    }

    // Host: remove a single guest (went silent, or joined mid-run). Fires
    // onPeerLeft so the app's party bookkeeping stays in one place.
    closePeer(id) {
        if (!this.conns.has(id)) return;
        this.dropConn(id);
        if (this.isHost && this.onPeerLeft) this.onPeerLeft(id);
    }

    async host() {
        this.disconnect(); // Clear any existing peer before hosting fresh
        this.isHost = true;
        const maxRetries = 5;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const code = this.generateCode();
                console.log("PeerJS: Attempting to host with code:", code);
                await this.init(code);
                return code;
            } catch (err) {
                if (attempt < maxRetries - 1 && (err.type === 'unavailable-id' || err.type === 'invalid-id')) {
                    console.log("PeerJS: ID unavailable or invalid, retrying...");
                    if (this.peer) { this.peer.destroy(); this.peer = null; }
                    continue;
                }
                throw err;
            }
        }
    }

    async join(hostCode) {
        this.disconnect(); // Clean old state
        this.isHost = false;

        // Clean up code: Uppercase and resolve ambiguous characters
        // Mapping 0 -> O, 1 -> I, L -> I just in case the user types them
        this.friendId = hostCode.trim().toUpperCase()
            .replace(/0/g, 'O')
            .replace(/1/g, 'I')
            .replace(/L/g, 'I');

        console.log("PeerJS: Joining host", this.friendId);
        await this.init();

        const maxAttempts = 3;
        const attemptTimeout = 20000; // Increased timeout for slower network negotiation

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`PeerJS: Connection attempt ${attempt}/${maxAttempts}...`);
                await this.attemptConnect(attempt, attemptTimeout);
                return;
            } catch (err) {
                console.warn(`PeerJS: Attempt ${attempt} failed:`, err);
                this.dropConn(this.friendId);
                if (!this.peer) return; // left while connecting
                if (attempt < maxAttempts) {
                    if (this.onStatus) this.onStatus(`RETRYING... (${attempt + 1}/${maxAttempts})`);
                    // Small delay before retry to let sockets settle
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    const finalErr = new Error("Could not connect after " + maxAttempts + " attempts.");
                    finalErr.type = 'connection-timeout';
                    if (this.onError) this.onError(finalErr);
                    this.disconnect();
                }
            }
        }
    }

    attemptConnect(attempt, timeout) {
        return new Promise((resolve, reject) => {
            const conn = this.peer.connect(this.friendId, {
                reliable: true,
                serialization: 'json',
                metadata: { attempt: attempt }
            });
            let opened = false;

            const timer = setTimeout(() => {
                reject(new Error(`Attempt ${attempt} timed out`));
            }, timeout);

            // Register handlers IMMEDIATELY, don't wait for 'open'
            this.addConn(conn);

            conn.on('open', () => {
                clearTimeout(timer);
                if (this.conns.get(this.friendId) !== conn) return;
                opened = true;
                console.log("PeerJS: Data channel open with", conn.peer);

                this.startHeartbeat();
                this.resetWatchdog(conn.peer);

                if (this.onConnected) this.onConnected();
                resolve();
            });

            conn.on('error', (err) => {
                clearTimeout(timer);
                if (!opened) reject(err);
            });

            conn.on('close', () => {
                clearTimeout(timer);
                if (!opened) reject(new Error("Connection closed during handshake"));
            });
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
                if (this.onError) {
                    const err = new Error("Connection lost (Timeout)");
                    err.type = "connection-timeout";
                    this.onError(err);
                }
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
            const peer = this.peer;
            const conns = [...this.conns.values()];
            this.stopHeartbeat();
            this.conns = new Map();
            this.peer = null;
            setTimeout(() => {
                conns.forEach(c => { try { c.close(); } catch (e) { } });
                if (peer) { try { peer.destroy(); } catch (e) { } }
            }, 300);
        } else {
            this.disconnect();
        }
        this.isHost = false;
    }

    disconnect() {
        console.log("PeerJS: Performing full cleanup...");
        this.stopHeartbeat();
        // Swap the registry out first so the close events these trigger are
        // recognised as deliberate and don't fire leave callbacks.
        const conns = [...this.conns.values()];
        this.conns = new Map();
        conns.forEach(c => { try { c.close(); } catch (e) { } });
        if (this.peer) {
            try { this.peer.destroy(); } catch (e) { }
        }
        this.peer = null;
    }
}

window.network = new NetworkManager();
