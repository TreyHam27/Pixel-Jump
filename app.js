class Game {
    constructor() {
        this.input = new InputHandler();
        this.renderer = new Renderer();
        this.particles = new ParticleSystem();
        this.ads = new AdManager();
        this.player = new Player(CONFIG.WIDTH / 2, CONFIG.HEIGHT - 150);

        this.platforms = [];
        this.powerups = [];
        this.enemies = [];
        this.projectiles = [];
        this.safetyNet = this.makeSafetyNetState();
        this.achievements = JSON.parse(localStorage.getItem('lp_achievements')) || [];
        this.migrateSkinSaves();
        // Owned gem-shop Pixels, by SKINS id.
        this.ownedSkins = JSON.parse(localStorage.getItem('lp_owned_skins')) || [];

        this.state = {
            running: false,
            revived: false,
            multiplayer: false,
            isHost: false,
            score: 0,
            maxScore: 0,
            bonusScore: 0,
            highScore: parseInt(localStorage.getItem('lp_best')) || 0,
            shards: parseInt(localStorage.getItem('lp_shards')) || 0,
            loops: parseInt(localStorage.getItem('lp_loops')) || 0,
            skinIndex: Math.max(0, skinIndexById(localStorage.getItem('lp_skin'))),
            extraLives: parseInt(localStorage.getItem('lp_extraLives')) || 0,
            frames: 0,
            bgOffset: 0,
            time: 0,
            seed: this.getDailySeed(),
            powersCollected: 0,
            ghostRecord: [],
            gamesPlayedThisSession: 0,
            runStartTime: 0
        };

        // Badges pop one at a time: a single frame can earn several at once
        // (5000m clears both "Stratosphere" and the Rift Diver skin), and
        // without a queue each new one would overwrite the last mid-display.
        this.achievementQueue = [];
        this.achievementShowing = false;

        this.seedSkinAchievements();

        this.ui = {
            menu: document.getElementById("menu-layer"),
            startBtn: document.getElementById("start-prompt"),
            hud: document.getElementById("hud"),
            score: document.getElementById("score-display"),
            best: document.getElementById("best-display-hud"),
            power: document.getElementById("power-hud"),
            powerFill: document.getElementById("power-bar-fill"),
            powerText: document.getElementById("power-text"),
            alert: document.getElementById("system-alert"),
            alertIcon: document.getElementById("system-alert-icon"),
            alertText: document.getElementById("system-alert-text"),
            achievement: document.getElementById("achievement-pop"),
            menuScore: document.getElementById("menu-highscore"),
            menuLast: document.getElementById("menu-lastscore"),
            skinDisplay: document.getElementById("skin-display"),
            skinName: document.getElementById("skin-name"),
            skinStatus: document.getElementById("skin-status"),
            preview: document.getElementById("skin-preview-box"),
            eyesL: document.getElementById("skin-eyes-l"),
            eyesR: document.getElementById("skin-eyes-r"),
            prev: document.getElementById("prev-btn"),
            next: document.getElementById("next-btn"),
            fame: document.getElementById("fame-list"),
            shardDisplay: document.getElementById("shard-display"),
            shopLifeBtn: document.getElementById("shop-life-btn"),
            shopLifeCount: document.getElementById("shop-life-count"),
            gemShop: document.getElementById("gem-skin-shop"),
            gemPrev: document.getElementById("gem-prev-btn"),
            gemNext: document.getElementById("gem-next-btn"),
            gemDots: document.getElementById("gem-shop-dots"),
            skinAbility: document.getElementById("skin-ability"),
            shopOpenBtn: document.getElementById("shop-open-btn"),
            shopBackBtn: document.getElementById("shop-back-btn"),
            shopLayer: document.getElementById("shop-menu-layer"),

            // Multiplayer UI
            menusWrapper: document.getElementById("menus-wrapper"),
            menuLayer1: document.getElementById("menu-layer"),
            menuLayer2: document.getElementById("mp-menu-layer"),
            toMpBtn: document.getElementById("to-mp-btn"),
            toSpBtn: document.getElementById("to-sp-btn"),
            mpNameInput: document.getElementById("mp-name-input"),
            mpJoinInput: document.getElementById("mp-join-input"),
            mpJoinBtn: document.getElementById("mp-join-btn"),
            mpHostBtn: document.getElementById("mp-host-btn"),
            mpStatus: document.getElementById("mp-status"),
            mpStartBtn: document.getElementById("mp-start-prompt"),
            mpPartyList: document.getElementById("mp-party-list"),
            mpPartyCount: document.getElementById("mp-party-count"),
            mpPartyCode: document.getElementById("mp-party-code"),
            mpLeaveBtn: document.getElementById("mp-leave-btn")
        };
        // Everyone else in the run, keyed by peer ID (pid).
        this.remotePlayers = new Map();
        // Current party: [{ pid, name, slot, isHost }]. The host owns the
        // authoritative copy and broadcasts it; guests mirror it. Empty when
        // not in a party.
        this.party = [];
        this.viewParams = { skinIndex: this.state.skinIndex };
        this.lastTime = 0;
        // Which top-level menu panel is showing: 'sp' | 'mp' | 'shop'.
        // Gates keyboard-start (only from 'sp') and is updated by every
        // panel-switch handler below.
        this.activeMenuPanel = 'sp';

        // Position within the shop's pixel carousel — an index into
        // gemShopSkins(), not into SKINS.
        this.gemShopIndex = 0;

        // Migration: the shop used to sell a one-shot HARD SHIELD boost at the
        // same price as an extra life. Anyone still holding an unspent boost
        // gets it converted rather than silently losing what they paid for.
        if (localStorage.getItem('lp_boughtBoost') === '1') {
            localStorage.removeItem('lp_boughtBoost');
            if (this.state.extraLives < MAX_EXTRA_LIVES) {
                this.state.extraLives++;
                localStorage.setItem('lp_extraLives', this.state.extraLives);
            }
        }

        this.bindEvents();
        this.updateSkinUI();
        this.updateFameUI();
        this.renderGemShop();
        this.updateExtraLifeUI();

        this.ui.menuScore.innerText = "HIGH SCORE: " + this.state.highScore + "m";

        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    bindEvents() {
        this.ui.prev.onclick = (e) => { e.stopPropagation(); this.changeSkin(-1); };
        this.ui.next.onclick = (e) => { e.stopPropagation(); this.changeSkin(1); };

        if (this.ui.shopLifeBtn) {
            this.ui.shopLifeBtn.onclick = (e) => {
                e.stopPropagation();
                this.buyExtraLife();
            };
        }

        // Shop pixel carousel — same left/right stepping as the main-menu skin
        // picker, over just the shards-purchasable skins.
        if (this.ui.gemPrev) {
            this.ui.gemPrev.onclick = (e) => { e.stopPropagation(); this.changeGemShopSkin(-1); };
        }
        if (this.ui.gemNext) {
            this.ui.gemNext.onclick = (e) => { e.stopPropagation(); this.changeGemShopSkin(1); };
        }

        // Shop screen open/close (slides up on its own vertical axis, see CSS)
        if (this.ui.shopOpenBtn) {
            this.ui.shopOpenBtn.onclick = (e) => {
                e.stopPropagation();
                this.activeMenuPanel = 'shop';
                this.ui.shopLayer.style.transform = 'translateY(0)';
            };
            this.ui.shopBackBtn.onclick = (e) => {
                e.stopPropagation();
                this.activeMenuPanel = 'sp';
                this.ui.shopLayer.style.transform = 'translateY(100%)';
            };
        }

        // Perk tags: hover shows the full stats via CSS; tapping one toggles it
        // (touch has no hover) and closes any other open tag. Delegated, since
        // the menu and shop re-render their tags on every change.
        if (this.ui.menusWrapper) {
            this.ui.menusWrapper.addEventListener('click', (e) => {
                const tag = e.target.closest('.perk-tag');
                this.ui.menusWrapper.querySelectorAll('.perk-tag.open').forEach(t => {
                    if (t !== tag) t.classList.remove('open');
                });
                if (tag) {
                    e.stopPropagation();
                    tag.classList.toggle('open');
                }
            }, true);
        }

        // The picker only ever holds unlocked Pixels, so a click anywhere else
        // on the menu always starts a run.
        this.ui.menu.onclick = (e) => {
            if (e.target.closest('#skin-container') || e.target.closest('.mode-switch-arrow')) return;
            this.startGame();
        };

        // Keyboard-start: any movement/jump key starts the game from the SP
        // menu, same as clicking it (matches the on-screen "CLICK TO START").
        window.addEventListener('keydown', (e) => {
            if (this.activeMenuPanel !== 'sp' || this.state.running) return;
            const startKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', ' '];
            if (!startKeys.includes(e.key)) return;
            this.startGame();
        });

        // Multiplayer UI Bindings
        if (this.ui.toMpBtn) {
            this.ui.toMpBtn.onclick = () => {
                this.activeMenuPanel = 'mp';
                this.ui.menuLayer1.style.transform = 'translateX(-100%)';
                this.ui.menuLayer2.style.transform = 'translateX(0)';
                let savedName = localStorage.getItem('lp_mp_name');
                if (savedName) this.ui.mpNameInput.value = savedName;
            };
            this.ui.toSpBtn.onclick = () => {
                this.activeMenuPanel = 'sp';
                this.ui.menuLayer1.style.transform = 'translateX(0)';
                this.ui.menuLayer2.style.transform = 'translateX(100%)';
            };

            this.ui.mpNameInput.addEventListener('input', (e) => {
                localStorage.setItem('lp_mp_name', e.target.value.trim());
            });

            this.ui.mpHostBtn.onclick = async () => {
                this.setMpSetupBusy(true);
                this.setMpStatus("GENERATING CODE...", 'pending');

                try {
                    let code = await window.network.host();
                    this.state.isHost = true;
                    this.party = [{ pid: window.network.myId, name: this.getMpName(), slot: 0, isHost: true }];
                    this.ui.mpStartBtn.innerText = "START RUN";
                    this.enterPartyView(code);
                    this.setMpStatus("WAITING FOR PLAYERS...", 'success');
                } catch (err) {
                    this.setMpStatus("HOST FAILED — TRY AGAIN", 'danger');
                    this.setMpSetupBusy(false);
                }
            };

            this.ui.mpJoinBtn.onclick = async () => {
                const code = this.ui.mpJoinInput.value.trim();
                if (code.length === 6) {
                    this.setMpSetupBusy(true);
                    this.setMpStatus("CONNECTING...", 'pending');
                    try {
                        await window.network.join(code);
                    } catch (err) {
                        this.setMpStatus("CONNECTION FAILED — TRY AGAIN", 'danger');
                        this.setMpSetupBusy(false);
                    }
                } else {
                    this.setMpStatus("INVALID CODE", 'danger');
                }
            };

            this.ui.mpStartBtn.onclick = () => {
                if (this.state.isHost && this.party.length >= 2 && !this.state.running) {
                    let mpSeed = this.getDailySeed() + Math.floor(Math.random() * 10000);
                    window.network.send({ type: 'start', seed: mpSeed, party: this.party });
                    this.startMultiplayerGame(mpSeed);
                }
            };

            this.ui.mpLeaveBtn.onclick = () => {
                this.leaveParty("LEFT THE PARTY");
            };

            // Guest: data channel to the host is open — introduce ourselves.
            window.network.onConnected = () => {
                this.state.isHost = false;
                this.setMpStatus("SYNCHRONIZING...", 'pending');

                // Handshake Retry Loop for Guest
                // Ensures the host DEFINITELY gets the name even if the first packet is lost
                const sendHandshake = () => {
                    console.log("MP: Sending Handshake...");
                    window.network.send({ type: 'handshake', name: this.getMpName() });
                };
                if (this.handshakeInterval) clearInterval(this.handshakeInterval);
                this.handshakeInterval = setInterval(sendHandshake, 1000);
                sendHandshake();
            };

            window.network.onData = (data, fromId) => {
                if (!data || data.type === 'ping') return; // Silence internal heartbeats
                this.handleNetworkData(data, fromId);
            };

            // Host: a guest dropped or left.
            window.network.onPeerLeft = (pid) => {
                this.removePartyMember(pid);
            };

            // Guest: lost the host — the party (and any run) is over.
            window.network.onDisconnected = () => {
                this.endPartyRun();
                this.leaveParty("LOST CONNECTION TO HOST", 'danger');
            };

            window.network.onError = (err) => {
                let msg = "CONNECTION FAILED";
                if (err.type === 'connection-timeout') {
                    msg = "TIMED OUT — CODE MAY BE INVALID";
                } else if (err.type === 'peer-unavailable') {
                    msg = "CODE NOT FOUND — CHECK & RETRY";
                } else if (err.type === 'signaling-timeout') {
                    msg = "CAN'T REACH SERVER — CHECK CONNECTION";
                } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                    msg = "NETWORK ERROR — CHECK CONNECTION";
                }
                this.setMpStatus(msg, 'danger');
                // Only a failed host/join attempt should unlock the setup
                // cards; errors inside a live party just update the status.
                if (!this.inParty()) this.setMpSetupBusy(false);
            };

            window.network.onStatus = (msg) => {
                this.setMpStatus(msg, 'pending');
            };

            // Two-finger swipe gesture for menu transition
            if (this.ui.menusWrapper) {
                let touchStartX = 0;
                this.ui.menusWrapper.addEventListener('touchstart', (e) => {
                    if (e.touches.length === 2) {
                        touchStartX = e.touches[0].clientX;
                    }
                }, { passive: true });

                this.ui.menusWrapper.addEventListener('touchend', (e) => {
                    if (e.changedTouches.length > 0 && touchStartX !== 0) {
                        let touchEndX = e.changedTouches[0].clientX;
                        let diffX = touchEndX - touchStartX;

                        if (diffX < -50) { // Swipe left (Go to MP)
                            this.ui.toMpBtn.onclick();
                        } else if (diffX > 50) { // Swipe right (Go to Single Player)
                            this.ui.toSpBtn.onclick();
                        }
                        touchStartX = 0;
                    }
                }, { passive: true });
            }
        }
    }

    // Co-op menu status pill. `state` is one of 'pending' | 'success' | 'danger'
    // (or omitted for idle); the colors live in style.css under #mp-status.
    setMpStatus(text, state) {
        this.ui.mpStatus.innerText = text;
        if (state) this.ui.mpStatus.dataset.state = state;
        else delete this.ui.mpStatus.dataset.state;
    }

    // Disables both setup actions while a host/join attempt is in flight.
    setMpSetupBusy(busy) {
        this.ui.mpHostBtn.disabled = busy;
        this.ui.mpJoinBtn.disabled = busy;
    }

    getMpName() {
        return (this.ui.mpNameInput.value.trim() || 'Player').slice(0, 10);
    }

    inParty() {
        return this.party.length > 0;
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // Evaporates the name/join/host cards and reveals the party panel
    // (the animation itself lives in style.css under .in-party).
    enterPartyView(code) {
        this.ui.mpPartyCode.innerText = code || '------';
        this.ui.menuLayer2.classList.add('in-party');
        this.renderParty();
    }

    // Leaves (or, for the host, closes) the party and brings the setup
    // cards back. Safe to call when not in a party.
    leaveParty(message, state) {
        if (this.handshakeInterval) clearInterval(this.handshakeInterval);
        this.handshakeInterval = null;
        window.network.leave();
        this.party = [];
        this.state.isHost = false;
        this.ui.menuLayer2.classList.remove('in-party');
        this.setMpSetupBusy(false);
        this.updateMpStartBtn();
        this.setMpStatus(message || "READY", state);
    }

    renderParty() {
        const myId = window.network.myId;
        // Leader on top, everyone else under them in join order.
        const members = [...this.party].sort((a, b) => (b.isHost - a.isHost) || (a.slot - b.slot));

        const rows = members.map(m => {
            const tags = [];
            if (m.isHost) tags.push('★ LEADER');
            if (m.pid === myId) tags.push('YOU');
            return `<li class="mp-party-row${m.isHost ? ' is-leader' : ''}" style="--slot:${PARTY_COLORS[m.slot] || '#555'}">
                <span class="mp-party-chip"></span>
                <span class="mp-party-name">${this.escapeHtml(m.name)}</span>
                <span class="mp-party-tag">${tags.join(' · ')}</span>
            </li>`;
        });
        for (let i = members.length; i < MAX_PARTY_SIZE; i++) {
            rows.push(`<li class="mp-party-row is-empty">
                <span class="mp-party-chip"></span>
                <span class="mp-party-name">WAITING FOR PLAYER…</span>
            </li>`);
        }

        this.ui.mpPartyList.innerHTML = rows.join('');
        this.ui.mpPartyCount.innerText = `${members.length}/${MAX_PARTY_SIZE}`;
        this.updateMpStartBtn();
    }

    // Only the leader can start, and only with at least one other player.
    updateMpStartBtn() {
        const canStart = this.state.isHost && this.party.length >= 2 && !this.state.running;
        this.ui.mpStartBtn.style.display = canStart ? 'block' : 'none';
    }

    // Host: push the authoritative party list to every guest.
    broadcastParty() {
        window.network.send({ type: 'party', party: this.party });
        this.renderParty();
        if (!this.state.running) {
            if (this.party.length >= 2) this.setMpStatus("READY TO START", 'success');
            else this.setMpStatus("WAITING FOR PLAYERS...", 'success');
        }
    }

    // Guest: adopt the host's party list (sanitised — it's remote input).
    applyParty(list) {
        if (!Array.isArray(list)) return;
        this.party = list.slice(0, MAX_PARTY_SIZE).map(m => ({
            pid: String(m.pid),
            name: String(m.name || 'Player').slice(0, 10),
            slot: Math.max(0, Math.min(MAX_PARTY_SIZE - 1, parseInt(m.slot) || 0)),
            isHost: !!m.isHost
        }));
        for (const pid of [...this.remotePlayers.keys()]) {
            const member = this.party.find(m => m.pid === pid);
            if (!member) this.dropRemotePlayer(pid);
        }
        this.renderParty();
    }

    // Host: someone left the party (or their connection died).
    removePartyMember(pid) {
        this.party = this.party.filter(m => m.pid !== pid);
        this.dropRemotePlayer(pid);
        if (this.inParty()) this.broadcastParty();
    }

    dropRemotePlayer(pid) {
        const rp = this.remotePlayers.get(pid);
        if (!rp) return;
        this.remotePlayers.delete(pid);
        if (this.state.running && this.state.multiplayer) {
            this.showAlert(`${rp.name || 'A PLAYER'} LEFT`, 'warning');
            // They may have been the last one standing.
            this.checkAllDead();
        }
    }

    addRemotePlayer(member, skinIndex = 0) {
        const rp = new Player(CONFIG.WIDTH / 2, CONFIG.HEIGHT - 150, skinIndex);
        rp.name = member.name;
        rp.slot = member.slot;
        rp.skinIndex = skinIndex;
        this.remotePlayers.set(member.pid, rp);
        return rp;
    }

    // Host: a guest introduced themselves — seat them in the lowest free slot.
    handleHandshake(data, fromId) {
        if (!this.state.isHost) return;
        const net = window.network;
        console.log("MP: Received Handshake from", data.name);

        if (this.state.running) {
            net.sendTo(fromId, { type: 'party_busy' });
            setTimeout(() => net.closePeer(fromId), 300);
            return;
        }

        const name = String(data.name || 'Player').slice(0, 10);
        let member = this.party.find(m => m.pid === fromId);
        if (!member) {
            if (this.party.length >= MAX_PARTY_SIZE) {
                net.sendTo(fromId, { type: 'party_full' });
                setTimeout(() => net.closePeer(fromId), 300);
                return;
            }
            const used = new Set(this.party.map(m => m.slot));
            let slot = 1;
            while (used.has(slot)) slot++;
            member = { pid: fromId, name, slot, isHost: false };
            this.party.push(member);
        } else {
            // Handshake retry — just refresh the name and re-ack.
            member.name = name;
        }

        net.sendTo(fromId, { type: 'handshake_ack', party: this.party });
        this.broadcastParty();
    }

    handleNetworkData(data, fromId) {
        const net = window.network;

        // The host is the hub: relay every guest's gameplay traffic to the
        // rest of the party, stamped with the sender's ID so it can't be spoofed.
        if (this.state.isHost && (data.type === 'sync' || data.type === 'die' || data.type === 'revive')) {
            data.pid = fromId;
            net.broadcastExcept(fromId, data);
        }

        if (data.type === 'handshake') {
            this.handleHandshake(data, fromId);
        } else if (data.type === 'handshake_ack') {
            if (this.state.isHost) return;
            console.log("MP: Received Handshake ACK");
            if (this.handshakeInterval) clearInterval(this.handshakeInterval);
            this.handshakeInterval = null;
            this.applyParty(data.party);
            this.enterPartyView(net.friendId);
            this.setMpStatus("WAITING FOR LEADER TO START...", 'success');
        } else if (data.type === 'party') {
            if (!this.state.isHost) this.applyParty(data.party);
        } else if (data.type === 'party_full') {
            this.leaveParty(`PARTY IS FULL (${MAX_PARTY_SIZE}/${MAX_PARTY_SIZE})`, 'danger');
        } else if (data.type === 'party_busy') {
            this.leaveParty("RUN IN PROGRESS — TRY AGAIN SOON", 'danger');
        } else if (data.type === 'party_closed') {
            this.endPartyRun();
            this.leaveParty("LEADER CLOSED THE PARTY", 'danger');
        } else if (data.type === 'start') {
            if (this.state.isHost || !this.inParty()) return;
            this.applyParty(data.party);
            this.startMultiplayerGame(data.seed);
        } else if (data.type === 'sync') {
            // Ignore stragglers from a previous run or before 'start' lands.
            if (!this.state.running || !this.state.multiplayer) return;
            let rp = this.remotePlayers.get(data.pid);
            if (!rp) {
                const member = this.party.find(m => m.pid === data.pid);
                if (!member) return;
                rp = this.addRemotePlayer(member, data.skinIndex);
            }
            if (SKINS[data.skinIndex] && rp.skinIndex !== data.skinIndex) {
                rp.setSkin(data.skinIndex);
                rp.skinIndex = data.skinIndex;
            }
            rp.x = data.x;
            rp.y = data.y + this.state.score;
            rp.vx = data.vx;
            rp.vy = data.vy;
            if (data.activePowerId) {
                rp.activePower = Object.values(POWERS).find(p => p.id === data.activePowerId);
            } else {
                rp.activePower = null;
            }
        } else if (data.type === 'die') {
            const rp = this.remotePlayers.get(data.pid);
            if (rp) rp.isDead = true;
            this.checkAllDead();
        } else if (data.type === 'revive') {
            const rp = this.remotePlayers.get(data.pid);
            if (rp) {
                rp.isDead = false;
                rp.y = this.player.y - 100; // spawn above
                this.particles.spawn(rp.x, rp.y, PARTY_COLORS[rp.slot] || "#00ffcc", 40, "blast");
            }
        }
    }

    startMultiplayerGame(seed) {
        this.ui.mpStartBtn.style.display = 'none';
        this.startGame(true, seed);
        // Every other party member starts at the spawn point; their first
        // sync packet moves them to wherever they really are.
        const myId = window.network.myId;
        this.party.forEach(m => {
            if (m.pid !== myId) this.addRemotePlayer(m);
        });
    }

    // Saves used to store Pixels by SKINS position; they now store SKINS ids so
    // the roster can change shape. Converts old saves once, via the order the
    // list had back then (numbers are only ever written by the old format).
    migrateSkinSaves() {
        const LEGACY_SKIN_IDS = [
            'unit734', 'ghost', 'matrix', 'deepvoid', 'golden', 'glitch', 'theend',
            'nebula', 'chrome', 'solarflare', 'obsidian', 'prism',
            'riftdiver', 'neonghost', 'staticking', 'thevoid'
        ];
        let owned;
        try { owned = JSON.parse(localStorage.getItem('lp_owned_skins')); } catch (e) { owned = null; }
        if (Array.isArray(owned) && owned.some(v => typeof v === 'number')) {
            const ids = owned.map(v => typeof v === 'number' ? LEGACY_SKIN_IDS[v] : v).filter(Boolean);
            localStorage.setItem('lp_owned_skins', JSON.stringify([...new Set(ids)]));
        }
        const equipped = localStorage.getItem('lp_skin');
        if (equipped !== null && /^\d+$/.test(equipped)) {
            localStorage.setItem('lp_skin', LEGACY_SKIN_IDS[parseInt(equipped, 10)] || SKINS[0].id);
        }
    }

    isSkinLocked(index = this.viewParams.skinIndex) {
        const s = SKINS[index];
        if (!s) return true;
        if (s.cost !== undefined) return !this.ownedSkins.includes(s.id);
        return this.state.highScore < s.unlock;
    }

    // The menu picker only ever offers Pixels the player can actually use:
    // locked gem Pixels live in the shop, and locked distance/secret ones stay
    // a surprise until they're earned.
    unlockedSkinIndexes() {
        return SKINS.map((s, i) => i).filter(i => !this.isSkinLocked(i));
    }

    // Selecting a Pixel equips it straight away (and survives a reload even
    // if no run is started with it).
    equipSkin(index) {
        this.viewParams.skinIndex = index;
        localStorage.setItem('lp_skin', SKINS[index].id);
        this.updateSkinUI();
    }

    changeSkin(dir) {
        const unlocked = this.unlockedSkinIndexes();
        const pos = unlocked.indexOf(this.viewParams.skinIndex);
        const next = unlocked[(Math.max(0, pos) + dir + unlocked.length) % unlocked.length];
        this.equipSkin(next);
    }

    updateSkinUI() {
        // A saved Pixel can go missing (e.g. a cleared shop save); never show
        // or start a run with one the player doesn't have.
        if (this.isSkinLocked()) this.viewParams.skinIndex = 0;

        const s = SKINS[this.viewParams.skinIndex];
        const unlockedCount = this.unlockedSkinIndexes().length;

        this.ui.preview.style.backgroundColor = s.color;
        this.ui.eyesL.style.backgroundColor = s.eye;
        this.ui.eyesR.style.backgroundColor = s.eye;
        this.ui.skinName.innerText = s.name;
        this.ui.skinStatus.innerText = "PIXELS " + unlockedCount + " / " + SKINS.length;

        const showArrows = unlockedCount > 1 ? 'visible' : 'hidden';
        this.ui.prev.style.visibility = showArrows;
        this.ui.next.style.visibility = showArrows;

        if (this.ui.shardDisplay) this.ui.shardDisplay.innerText = this.state.shards + " 💎";
        if (this.ui.skinAbility) this.ui.skinAbility.innerHTML = this.renderPerkTags(s.ability);
    }

    // Short, colour-coded perk chips shared by the menu picker and the shop.
    // The full stat text sits in a tooltip that opens on hover (CSS) or on tap
    // (the delegated handler in bindEvents), since the game runs on touch too.
    renderPerkTags(ability) {
        const perks = skinPerks(ability);
        if (!perks.length) return '<span class="perk-none">NO PERK</span>';
        return perks.map(({ perk, value }) =>
            `<span class="perk-tag" style="--perk:${perk.color};" tabindex="0">${perk.label}` +
            `<span class="perk-tip">${perk.describe(value)}</span></span>`
        ).join('');
    }

    // Every shards-purchasable skin (anything in SKINS with a `cost`), paired
    // with its SKINS index so the carousel can address it, cheapest first so
    // the carousel reads as a tier ladder.
    gemShopSkins() {
        return SKINS.map((s, i) => ({ s, i }))
            .filter(({ s }) => s.cost !== undefined)
            .sort((a, b) => a.s.cost - b.s.cost);
    }

    // Steps the shop's pixel carousel, wrapping at both ends exactly like the
    // main-menu skin picker.
    changeGemShopSkin(dir) {
        const total = this.gemShopSkins().length;
        if (!total) return;
        this.gemShopIndex = (this.gemShopIndex + dir + total) % total;
        this.renderGemShop();
    }

    // Renders the one currently-framed card of the shop's pixel carousel (plus
    // its position dots) straight from SKINS data. Only one card exists in the
    // DOM at a time — the arrows/dots swap which skin it shows.
    renderGemShop() {
        if (!this.ui.gemShop) return;

        const rows = this.gemShopSkins();
        if (!rows.length) {
            this.ui.gemShop.innerHTML = '';
            if (this.ui.gemDots) this.ui.gemDots.innerHTML = '';
            return;
        }

        if (!(this.gemShopIndex >= 0 && this.gemShopIndex < rows.length)) this.gemShopIndex = 0;
        const { s, i } = rows[this.gemShopIndex];
        const tier = this.gemShopIndex + 1;
        const owned = this.ownedSkins.includes(s.id);
        const equipped = owned && this.viewParams.skinIndex === i;
        const affordable = this.state.shards >= s.cost;
        // Tiers glow harder the higher they sit, and anything past the plain
        // stat perks gets the premium frame, so the ladder reads at a glance.
        const premium = skinPerks(s.ability).some(({ perk }) => !['speedMult', 'jumpMult', 'gravityMult'].includes(perk.key));

        let btnLabel = 'BUY';
        if (equipped) btnLabel = 'EQUIPPED';
        else if (owned) btnLabel = 'EQUIP';
        const btnCls = ['gem-skin-buy-btn'];
        if (owned) btnCls.push('owned');
        else if (!affordable) btnCls.push('unaffordable');

        this.ui.gemShop.innerHTML = `<div class="gem-skin-card${premium ? ' premium' : ''}" style="--skin:${s.color}; --tier:${tier / rows.length};">
            <div class="gem-skin-tier">TIER ${tier} / ${rows.length}</div>
            <div class="gem-skin-preview" style="background-color:${s.color}; opacity:${owned ? 1 : 0.35};">
                <div class="gem-skin-eye gem-skin-eye-l" style="background-color:${s.eye};"></div>
                <div class="gem-skin-eye gem-skin-eye-r" style="background-color:${s.eye};"></div>
            </div>
            <div class="gem-skin-name" style="color:${s.color};">${s.name}</div>
            <div class="gem-skin-perks">${this.renderPerkTags(s.ability)}</div>
            <button class="${btnCls.join(' ')}" data-index="${i}" ${equipped ? 'disabled' : ''}>
                <span class="btn-label">${btnLabel}</span>
                ${owned ? '' : `<span class="btn-cost">${s.cost.toLocaleString()} 💎</span>`}
            </button>
        </div>`;

        if (this.ui.gemDots) {
            this.ui.gemDots.innerHTML = rows.map(({ s: row }, pos) => {
                const cls = ['gem-dot'];
                if (pos === this.gemShopIndex) cls.push('active');
                if (this.ownedSkins.includes(row.id)) cls.push('owned');
                return `<span class="${cls.join(' ')}" data-pos="${pos}"></span>`;
            }).join('');

            this.ui.gemDots.querySelectorAll('.gem-dot').forEach(dot => {
                dot.onclick = (e) => {
                    e.stopPropagation();
                    this.gemShopIndex = parseInt(dot.dataset.pos, 10);
                    this.renderGemShop();
                };
            });
        }

        this.ui.gemShop.querySelectorAll('.gem-skin-buy-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index, 10);
                if (this.ownedSkins.includes(SKINS[index].id)) {
                    this.equipSkin(index);
                    this.renderGemShop();
                } else {
                    this.buyGemSkin(index);
                }
            };
        });
    }

    // Extra lives are stock rather than a one-shot toggle: the card shows how
    // many are banked, and the button locks at MAX_EXTRA_LIVES.
    updateExtraLifeUI() {
        if (this.ui.shopLifeCount) this.ui.shopLifeCount.innerText = this.state.extraLives;
        if (!this.ui.shopLifeBtn) return;

        const full = this.state.extraLives >= MAX_EXTRA_LIVES;
        const affordable = this.state.shards >= EXTRA_LIFE_COST;
        const label = this.ui.shopLifeBtn.querySelector('.btn-label');
        const cost = this.ui.shopLifeBtn.querySelector('.btn-cost');

        if (label) label.innerText = full ? "STOCK FULL" : "BUY EXTRA LIFE";
        if (cost) cost.innerText = EXTRA_LIFE_COST + " 💎";
        this.ui.shopLifeBtn.classList.toggle('maxed', full);
        this.ui.shopLifeBtn.classList.toggle('unaffordable', !full && !affordable);
        this.ui.shopLifeBtn.disabled = full;
    }

    buyExtraLife() {
        if (this.state.extraLives >= MAX_EXTRA_LIVES || this.state.shards < EXTRA_LIFE_COST) {
            this.shakeUI();
            return false;
        }
        this.state.shards -= EXTRA_LIFE_COST;
        this.state.extraLives++;
        localStorage.setItem('lp_shards', this.state.shards);
        localStorage.setItem('lp_extraLives', this.state.extraLives);
        this.updateExtraLifeUI();
        this.renderGemShop();
        this.updateSkinUI();
        return true;
    }

    // Spends one banked extra life. Returns false when the bank is empty so
    // die() falls through to the normal ad-revive flow.
    consumeExtraLife() {
        if (this.state.extraLives <= 0) return false;
        this.state.extraLives--;
        localStorage.setItem('lp_extraLives', this.state.extraLives);
        this.updateExtraLifeUI();
        return true;
    }

    // Buying a Pixel also equips it — that's why you bought it.
    buyGemSkin(index) {
        const s = SKINS[index];
        if (!s || this.ownedSkins.includes(s.id)) return false;
        if (s.cost === undefined || this.state.shards < s.cost) {
            this.shakeUI();
            return false;
        }
        this.state.shards -= s.cost;
        this.ownedSkins.push(s.id);
        localStorage.setItem('lp_shards', this.state.shards);
        localStorage.setItem('lp_owned_skins', JSON.stringify(this.ownedSkins));
        this.equipSkin(index);
        this.renderGemShop();
        this.updateExtraLifeUI();
        return true;
    }

    shakeUI() {
        this.ui.startBtn.classList.remove('shake');
        void this.ui.startBtn.offsetWidth;
        this.ui.startBtn.classList.add('shake');
    }

    // Centralized system alert popup (run status, revive countdowns, loop rewards, etc).
    // Auto-hides 4s after the *last* call, so it always reads as fresh
    // information rather than stale text left on screen — a countdown that
    // calls this every second just keeps resetting the timer, so it stays up
    // continuously and disappears 4s after the final update.
    showAlert(text, type = 'info') {
        const icons = { info: '⚙', success: '✓', warning: '⏳', danger: '⚠', reward: '🏆', pulse: '⏱' };
        const el = this.ui.alert;
        el.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-danger', 'alert-reward', 'alert-pulse');
        el.classList.add('alert-' + type, 'alert-visible');
        this.ui.alertIcon.innerText = icons[type] || icons.info;
        this.ui.alertText.innerText = text;

        if (this.alertHideTimer) clearTimeout(this.alertHideTimer);
        this.alertHideTimer = setTimeout(() => this.hideAlert(), 4000);
    }

    hideAlert() {
        if (this.alertHideTimer) {
            clearTimeout(this.alertHideTimer);
            this.alertHideTimer = null;
        }
        this.ui.alert.classList.remove('alert-visible');
    }

    getDailySeed() {
        const d = new Date();
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }

    seededRandom() {
        this.state.seed = (this.state.seed * 9301 + 49297) % 233280;
        return this.state.seed / 233280;
    }

    // Visual state for the SAFETY NET trampoline drawn across the bottom of the
    // screen. `deploy` eases the net in and out with the power-up; `impact`,
    // `impactX` and `phase` drive the decaying wobble after each bounce.
    makeSafetyNetState() {
        return { deploy: 0, impact: 0, impactX: CONFIG.WIDTH / 2, phase: 0, expiring: false };
    }

    updateSafetyNet(dt) {
        const net = this.safetyNet;
        const active = this.player.activePower === POWERS.SAFETY;

        net.deploy = active
            ? Math.min(1, net.deploy + 0.08 * dt)
            : Math.max(0, net.deploy - 0.06 * dt);
        // Warn over the last ~2.5 seconds. A fixed window rather than a fraction
        // of the timer, since skin abilities can stretch the power's duration.
        net.expiring = active && this.player.powerTimer < 150;

        if (net.impact > 0) {
            net.phase += 0.5 * dt;
            net.impact *= Math.pow(0.94, dt);
            if (net.impact < 0.01) { net.impact = 0; net.phase = 0; }
        }
    }

    // The run's score in meters: real height climbed plus any SCORE x2 bonus.
    runScore() {
        return Math.floor((this.state.score + (this.state.bonusScore || 0)) / 10);
    }

    // EMP perk: every N seconds, wipe every regular drone on screen (and the
    // shots they've fired). The boss is immune, and so are meteors/lasers-in-
    // flight that belong to the biome. Solo only: in co-op every client runs
    // its own enemies, so one player's EMP would desync what the party sees.
    updateDronePulse(dt, perks) {
        if (!perks.dronePulseSec || this.state.multiplayer) return;
        this.state.pulseTimer = (this.state.pulseTimer || 0) + dt;
        if (this.state.pulseTimer < perks.dronePulseSec * 60) return;
        this.state.pulseTimer = 0;

        let hits = 0;
        this.enemies.forEach(e => {
            if (!(e instanceof Drone || e instanceof LaserDrone) || e.hidden) return;
            if (e.y + e.h < 0 || e.y > CONFIG.HEIGHT) return;
            e.markedForDeletion = true;
            this.particles.spawn(e.x + e.w / 2, e.y + e.h / 2, "#00ff99", 15, "blast");
            hits++;
        });
        this.projectiles.forEach(p => { if (p instanceof Projectile) p.markedForDeletion = true; });
        if (hits) sounds.play('powerup');
    }

    // PHOENIX perk: coming back from a fall also hands out a random power-up.
    // Returns the power's name for the revive alert, or '' without the perk.
    phoenixBoost() {
        if (!(this.player.skin.ability || {}).lifePowerUp) return '';
        this.player.activePower = null;
        this.player.activatePower();
        return this.player.activePower.name;
    }

    // Kick the trampoline into its bounce wobble, centred on where the player
    // hit it.
    bounceSafetyNet() {
        this.safetyNet.deploy = 1;
        this.safetyNet.impactX = this.player.x + 13;
        this.safetyNet.impact = 1;
        this.safetyNet.phase = 0;
        sounds.play('jump');
    }

    reset(seed = null) {
        this.state.score = 0;
        // The Void's exclusive ability lets equipped runs start already at The
        // Rift, skipping the early game — single-player only, never in co-op.
        const equippedAbility = (SKINS[this.viewParams.skinIndex] && SKINS[this.viewParams.skinIndex].ability) || {};
        if (seed === null && equippedAbility.startAtScore) {
            this.state.score = equippedAbility.startAtScore;
        }
        this.state.bonusScore = 0;
        this.state.pulseTimer = 0;
        this.state.maxScore = Math.floor(this.state.score / 10);
        this.state.bossActive = false;
        this.state.usedExtraRevive = false;
        this.state.frames = 0;
        this.state.time = 0;
        this.state.revived = false;
        // Multiplayer passes an explicit shared seed so host/guest generate
        // identical platform layouts; single-player falls back to the daily seed.
        this.state.seed = seed !== null ? seed : this.getDailySeed();
        this.state.powersCollected = 0;
        this.state.isNewBest = false;
        this.state.ghostRecord = [];
        let savedGhost = localStorage.getItem('lp_ghost');
        if (savedGhost) {
            try { this.ghostPlayback = JSON.parse(savedGhost); } catch (e) { this.ghostPlayback = []; }
        } else {
            this.ghostPlayback = [];
        }

        // Skip past any story beats already covered by a checkpoint start
        // (normal 0m starts just find index 0, since STORY[0].h > 0).
        let startDisplayScore = Math.floor(this.state.score / 10);
        this.storyIndex = STORY.findIndex(s => s.h > startDisplayScore);
        if (this.storyIndex === -1) this.storyIndex = STORY.length;

        this.renderer.updateBiome(startDisplayScore);
        this.lastBiomeName = this.renderer.currentBiome.name;

        this.lastTime = performance.now();

        this.player = new Player(CONFIG.WIDTH / 2, CONFIG.HEIGHT - 150, this.viewParams.skinIndex);

        localStorage.setItem('lp_skin', SKINS[this.viewParams.skinIndex].id);

        this.platforms = [{ x: 0, y: CONFIG.HEIGHT - 40, w: CONFIG.WIDTH, h: 40 }];
        let y = CONFIG.HEIGHT - 140;
        while (y > -CONFIG.HEIGHT) { this.spawnPlatform(y); y -= CONFIG.PLATFORM_BASE_GAP; }

        this.powerups = [];
        this.enemies = [];
        this.projectiles = [];
        this.particles = new ParticleSystem();
        this.safetyNet = this.makeSafetyNetState();
        this.remotePlayers = new Map();

        this.ui.power.style.opacity = 0;
        this.hideAlert();
    }

    spawnPlatform(y) {
        let rand = this.seededRandom();
        let w = 100 + rand * 80;
        let x = this.seededRandom() * (CONFIG.WIDTH - w);
        let scoreMeters = Math.floor(this.state.score / 10);
        let hazards = this.renderer.currentBiome.hazards;

        let vx = 0;
        if (hazards.includes('moving')) {
            let movingChance = Math.max(0, Math.min(0.4, (scoreMeters - 1800) / 2000));
            if (this.seededRandom() < movingChance) {
                vx = (this.seededRandom() > 0.5 ? 1 : -1) * (0.5 + this.seededRandom() * 1.5);
                w = Math.max(70, w - 30);
            }
        }

        this.platforms.push({ x, y, w, h: 18, vx });

        let chance = 0.08 * (1 - scoreMeters / 8000);
        chance = Math.max(0.015, chance);
        if (this.seededRandom() < chance) {
            this.powerups.push({
                x: x + w / 2 - 12,
                y: y - 40,
                startY: y - 40,
                w: 24, h: 24,
                isShard: false,
                markedForDeletion: false
            });
        } else if (this.seededRandom() < 0.4) { // gems are common — 40% chance of a Shard
            // Shards used to roll a 1-3 value; keep consuming that draw so
            // seeded (daily / co-op) layouts stay identical.
            this.seededRandom();
            this.powerups.push({
                x: x + w / 2 - 8,
                y: y - 30,
                startY: y - 30,
                w: 16, h: 16,
                isShard: true,
                shardValue: 5,
                markedForDeletion: false
            });
        }
    }

    startGame(isMp = false, mpSeed = null) {
        this.state.running = true;
        this.state.multiplayer = isMp;
        this.state.deathCount = 0;
        this.reset(isMp ? mpSeed : null);

        this.ui.menu.style.opacity = 0;
        if (this.ui.menusWrapper) this.ui.menusWrapper.style.opacity = 0;

        setTimeout(() => {
            this.ui.menu.style.display = 'none';
            if (this.ui.menusWrapper) this.ui.menusWrapper.style.display = 'none';
        }, 300);
        this.ui.hud.style.opacity = 1;

        this.state.gamesPlayedThisSession++;
        this.state.runStartTime = performance.now();
    }

    die(forceDie = false) {
        if (this.state.multiplayer) {
            this.handleMultiplayerDeath(forceDie);
            return;
        }

        if (!forceDie && this.player.activePower === POWERS.SAFETY) {
            this.player.y = CONFIG.HEIGHT - 60;
            this.player.vy = CONFIG.BOUNCE_FORCE;
            this.bounceSafetyNet();
            this.particles.spawn(this.player.x, CONFIG.HEIGHT, POWERS.SAFETY.color, 30);
            return;
        }

        // Equipped Pixel's free revive: a bonus life on top of (not instead
        // of) the normal one-ad-revive-per-run flow below.
        const equippedAbility = this.player.skin.ability || {};
        if (equippedAbility.extraRevive && !this.state.usedExtraRevive) {
            this.state.usedExtraRevive = true;
            this.player.y = CONFIG.HEIGHT - 200;
            this.player.vy = CONFIG.BOUNCE_FORCE;
            this.player.vx = 0;
            this.platforms.push({ x: 0, y: CONFIG.HEIGHT - 20, w: CONFIG.WIDTH, h: 20 });
            sounds.play('powerup');
            this.particles.spawn(this.player.x + 13, this.player.y + 13, "#00ffaa", 30, "blast");
            const boost = this.phoenixBoost();
            this.showAlert("BACKUP LIFE ENGAGED" + (boost ? " + " + boost : ""), 'success');
            return;
        }

        // Shop-bought extra lives: banked stock, spent one per fall, after the
        // Pixel's own free revive (that one refreshes every run, so it's the
        // cheaper thing to burn first).
        if (this.consumeExtraLife()) {
            this.player.y = CONFIG.HEIGHT - 200;
            this.player.vy = CONFIG.BOUNCE_FORCE;
            this.player.vx = 0;
            this.platforms.push({ x: 0, y: CONFIG.HEIGHT - 20, w: CONFIG.WIDTH, h: 20 });
            sounds.play('powerup');
            this.particles.spawn(this.player.x + 13, this.player.y + 13, "#ff3366", 30, "blast");
            const boost = this.phoenixBoost();
            this.showAlert("EXTRA LIFE SPENT — " + this.state.extraLives + " LEFT" + (boost ? " + " + boost : ""), 'success');
            return;
        }

        sounds.play('death');
        this.particles.spawn(this.player.x + 13, this.player.y + 13, this.player.color, 40, "blast");

        this.state.running = false;

        if (!this.state.revived) {
            this.ads.showRevivePrompt(
                () => { this.revive(); },
                () => { this.gameOver(); }
            );
        } else {
            this.gameOver();
        }
    }

    handleMultiplayerDeath(forceDie) {
        if (this.player.isDead) return;

        if (!forceDie && this.player.activePower === POWERS.SAFETY) {
            this.player.y = CONFIG.HEIGHT - 60;
            this.player.vy = CONFIG.BOUNCE_FORCE;
            this.bounceSafetyNet();
            this.particles.spawn(this.player.x, CONFIG.HEIGHT, POWERS.SAFETY.color, 30);
            return;
        }

        sounds.play('death');
        this.particles.spawn(this.player.x + 13, this.player.y + 13, this.player.color, 40, "blast");
        this.player.isDead = true;

        if (window.network) {
            window.network.send({ type: 'die', pid: window.network.myId });
        }

        this.checkAllDead();

        if (this.state.running) {
            this.state.deathCount = (this.state.deathCount || 0) + 1;
            this.startRespawnTimer();
        }
    }

    anyRemoteAlive() {
        for (const rp of this.remotePlayers.values()) {
            if (!rp.isDead) return true;
        }
        return false;
    }

    // The run keeps going while anyone in the party is alive; it ends for
    // everybody the moment the last player falls (or leaves).
    checkAllDead() {
        if (!this.state.running || !this.state.multiplayer) return;
        if (!this.player.isDead || this.anyRemoteAlive()) return;
        this.state.running = false;
        this.stopRespawnTimer();
        // A revive prompt still open from a countdown is moot now.
        if (this.ads.reviveOverlay) this.ads.reviveOverlay.style.display = 'none';
        this.gameOver();
    }

    // Ends an in-progress multiplayer run immediately (host gone / party
    // closed), going through the normal everyone-is-dead path.
    endPartyRun() {
        if (!this.state.running || !this.state.multiplayer) return;
        this.player.isDead = true;
        this.remotePlayers.forEach(rp => { rp.isDead = true; });
        this.checkAllDead();
    }

    // Each player's respawn countdown runs on their own client, independent of
    // everyone else's, and lengthens with their own death count. It keeps
    // ticking only while the run is alive (i.e. someone is still standing).
    startRespawnTimer() {
        let baseTime = 15;
        let time = baseTime + ((this.state.deathCount - 1) * 10);

        this.showAlert(`RESPAWN IN ${time}s`, 'pulse');

        this.stopRespawnTimer();
        this.respawnInterval = setInterval(() => {
            if (!this.state.running || !this.player.isDead) {
                this.stopRespawnTimer();
                return;
            }
            time--;
            this.showAlert(`RESPAWN IN ${time}s`, 'pulse');

            if (time <= 0) {
                this.stopRespawnTimer();
                this.showAlert("WATCH AD TO REVIVE", 'pulse');
                this.ads.showRevivePrompt(
                    () => { this.mpRevive(); },
                    () => { this.showAlert("SPECTATING", 'warning'); }
                );
            }
        }, 1000);
    }

    stopRespawnTimer() {
        if (this.respawnInterval) clearInterval(this.respawnInterval);
        this.respawnInterval = null;
    }

    mpRevive() {
        // The run may have ended while the revive ad was playing.
        if (!this.state.running) return;
        this.player.isDead = false;
        const anchor = [...this.remotePlayers.values()].find(rp => !rp.isDead);
        if (anchor) {
            this.player.y = anchor.y - 100;
            this.player.x = anchor.x;
        } else {
            this.player.y = CONFIG.HEIGHT - 200;
        }
        this.player.vy = 0;

        if (window.network) window.network.send({ type: 'revive', pid: window.network.myId });
        this.showAlert("LIFE RESTORED", 'success');
    }

    revive() {
        this.state.revived = true;
        this.state.running = true;
        this.lastTime = performance.now();

        this.player.y = CONFIG.HEIGHT - 200;
        this.player.vy = CONFIG.BOUNCE_FORCE;
        this.player.vx = 0;

        this.platforms.push({ x: 0, y: CONFIG.HEIGHT - 20, w: CONFIG.WIDTH, h: 20 });

        const boost = this.phoenixBoost();
        this.showAlert("Life Systems Restored." + (boost ? " + " + boost : ""), 'success');
    }

    gameOver() {
        // Skip the interstitial on the session's first game and on very
        // quick deaths, so restarting fast never turns into ad-spam.
        const isFirstGame = this.state.gamesPlayedThisSession <= 1;
        const isQuickDeath = (performance.now() - this.state.runStartTime) < 10000;
        if (!isFirstGame && !isQuickDeath) {
            this.ads.showInterstitialAd();
        }
        let finalScore = this.runScore();

        // Don't leave a half-retracted net hanging over the menu.
        this.safetyNet = this.makeSafetyNetState();

        if (this.state.isNewBest && this.state.ghostRecord) {
            localStorage.setItem('lp_ghost', JSON.stringify(this.state.ghostRecord));
        }
        if (!this.state.multiplayer) {
            this.updateFame(finalScore);
        }

        this.ui.menu.style.display = 'flex';
        this.ui.menu.style.opacity = 1;
        if (this.ui.menusWrapper) {
            this.ui.menusWrapper.style.display = 'block';
            this.ui.menusWrapper.style.opacity = 1;
        }

        if (this.state.multiplayer) {
            if (this.state.isHost) {
                this.ui.mpStartBtn.innerText = "PLAY AGAIN";
                this.updateMpStartBtn();
                if (this.party.length >= 2) this.setMpStatus("READY TO START", 'success');
                else this.setMpStatus("WAITING FOR PLAYERS...", 'success');
            } else if (this.inParty()) {
                this.setMpStatus("WAITING FOR LEADER TO RESTART...", 'pending');
            }
        }

        this.ui.hud.style.opacity = 0;
        this.ui.power.style.opacity = 0;
        this.hideAlert();

        this.ui.menuLast.innerText = "LAST RUN: " + finalScore + "m";
        this.ui.menuScore.innerText = "HIGH SCORE: " + this.state.highScore + "m";
        this.updateFameUI();
        this.updateSkinUI();
        this.renderGemShop();
        this.updateExtraLifeUI();
    }

    updateFame(score) {
        let fame = JSON.parse(localStorage.getItem('lp_fame')) || [];
        fame.push({ score, skin: SKINS[this.viewParams.skinIndex].name, date: new Date().toLocaleDateString() });
        fame.sort((a, b) => b.score - a.score);
        fame = fame.slice(0, 5);
        localStorage.setItem('lp_fame', JSON.stringify(fame));
    }

    updateFameUI() {
        let fame = JSON.parse(localStorage.getItem('lp_fame')) || [];

        if (!fame.length) {
            this.ui.fame.innerHTML = `<div class="fame-empty">NO RUNS YET — SET A RECORD</div>`;
            return;
        }

        this.ui.fame.innerHTML = fame.map((f, i) => {
            // Entries store the skin by name, so a renamed/removed skin just
            // falls back to the neutral swatch colour from the stylesheet.
            const skin = SKINS.find(s => s.name === f.skin);
            const swatch = skin ? ` style="background:${skin.color}"` : '';
            return `<div class="fame-row fame-row--${i + 1}">
                <div class="fame-rank">${i + 1}</div>
                <div class="fame-swatch"${swatch}></div>
                <div class="fame-skin">${f.skin}</div>
                <div class="fame-date">${f.date || ''}</div>
                <div class="fame-score">${f.score}m</div>
            </div>`;
        }).join('');
    }

    checkAchievements() {
        ACHIEVEMENTS.forEach(g => {
            if (g.condition(this.state, this.player) && !this.achievements.includes(g.id)) {
                this.achievements.push(g.id);
                localStorage.setItem('lp_achievements', JSON.stringify(this.achievements));
                this.showAchievement(g.skin ? "SKIN UNLOCKED: " + g.name : g.name, g.skin ? "🎨" : "🏅");
            }
        });
    }

    // Skin unlocks only became achievements after launch, so a returning player
    // has already earned every skin their high score covers. Record those once,
    // silently, rather than burying them under a stack of popups on the next
    // run — only genuinely new unlocks should announce themselves.
    seedSkinAchievements() {
        if (localStorage.getItem('lp_skin_achievements_seeded')) return;

        ACHIEVEMENTS.forEach(g => {
            if (g.skin && g.condition(this.state) && !this.achievements.includes(g.id)) {
                this.achievements.push(g.id);
            }
        });

        localStorage.setItem('lp_achievements', JSON.stringify(this.achievements));
        localStorage.setItem('lp_skin_achievements_seeded', '1');
    }

    showAchievement(name, icon = "🏅") {
        this.achievementQueue.push(icon + " " + name);
        if (!this.achievementShowing) this.showNextAchievement();
    }

    showNextAchievement() {
        const text = this.achievementQueue.shift();
        if (text === undefined) {
            this.achievementShowing = false;
            return;
        }

        this.achievementShowing = true;
        this.ui.achievement.innerText = text;
        this.ui.achievement.style.display = 'block';
        sounds.play('powerup');
        setTimeout(() => {
            this.ui.achievement.style.display = 'none';
            // A beat of clear air so back-to-back badges read as two separate
            // pops (and replay the slide-in) rather than one flickering line.
            setTimeout(() => this.showNextAchievement(), 250);
        }, 3000);
    }

    update(dt) {
        if (!this.state.running) return;

        this.state.frames++;
        this.state.time += dt;

        if (!this.player.isDead) {
            this.input.update(dt);
        }

        this.renderer.updateBiome(this.state.score / 10);
        this.checkAchievements();

        const scoreMeters = Math.floor(this.state.score / 10);
        const droneSpawnRate = CONFIG.DRONE_SPAWN_RATE;
        const hazards = this.renderer.currentBiome.hazards;
        const perks = this.player.skin.ability || {};
        // SHIELDED perk: the biome's environmental forces (wind, gravity
        // pulses, control glitches) pass the player by. Physical obstacles —
        // meteors, lasers, moving platforms — still count.
        const envImmune = !!perks.biomeImmune;

        if (this.renderer.currentBiome.name !== this.lastBiomeName) {
            if (this.lastBiomeName) { // skip the callout on the very first frame of a run
                this.showAlert("ENTERING " + this.renderer.currentBiome.name.toUpperCase(), 'info');
            }
            this.lastBiomeName = this.renderer.currentBiome.name;
        }

        if (this.state.frames % 5 === 0) {
            if (!this.state.ghostRecord) this.state.ghostRecord = [];
            this.state.ghostRecord.push({
                x: Math.round(this.player.x),
                y: Math.round(this.player.y - this.state.score)
            });
        }

        // Boss Fights & Loop Management
        if (this.state.score > 0) {
            let targetLoop = Math.floor(scoreMeters / CONFIG.BOSS_LOOP_DISTANCE);
            if (targetLoop > (this.state.loops || 0)) {
                if (!this.state.bossActive) {
                    this.state.bossActive = true;
                    this.enemies.push(new BossDrone(this.player.y - 600));
                }
            }
        }

        // Spawn Enemies (only if Boss isn't active)
        if (!this.state.bossActive && scoreMeters > 60 && this.state.frames % Math.max(60, Math.floor(droneSpawnRate - (scoreMeters / 100))) === 0) {
            const difficulty = 1 + (scoreMeters / 2000) + (this.state.loops || 0);

            if (scoreMeters > 300 && Math.random() < Math.min(0.5, (scoreMeters - 300) / 2400)) {
                this.enemies.push(new ShooterDrone(this.player.y - 500, difficulty));
            } else {
                this.enemies.push(new Drone(this.player.y - 500, difficulty));
            }
        }

        if (hazards.includes('laser') && this.state.frames % 240 === 0) {
            this.enemies.push(new LaserDrone(this.player.y - 500));
        }

        // Glitch hazard: briefly invert left/right for this frame's input read only
        // (swap-and-restore around the call, no permanent state mutation).
        const glitching = !envImmune && hazards.includes('glitch') && (this.state.time % 480) < 24;
        if (glitching) {
            const tmp = this.input.keys.left;
            this.input.keys.left = this.input.keys.right;
            this.input.keys.right = tmp;
        }

        let event = this.player.update(dt, this.input, this.platforms, this.powerups);

        if (glitching) {
            const tmp = this.input.keys.left;
            this.input.keys.left = this.input.keys.right;
            this.input.keys.right = tmp;
        }

        // Invisible ceiling in multiplayer so the fast player doesn't go off screen
        if (this.state.multiplayer && !this.player.isDead && this.anyRemoteAlive()) {
            if (this.player.y < 0) {
                this.player.y = 0;
                if (this.player.vy < 0) this.player.vy = 0; // head bump
            }
        }

        // Environmental Hazards (cumulative per-biome, see BIOMES[].hazards)
        if (hazards.includes('wind')) {
            let wind = Math.sin(this.state.time * 0.05) * 0.3;
            if (!envImmune) this.player.vx += wind * dt;
            this.particles.particles.forEach(p => p.vx += wind * dt * 0.1);
        }
        if (hazards.includes('gravityPulse') && !envImmune) {
            let pulse = Math.sin(this.state.time * 0.05) * 0.3;
            this.player.vy += pulse * dt;
        }
        if (hazards.includes('meteor') && this.state.frames % 90 === 0) {
            let startX = Math.random() * CONFIG.WIDTH;
            let vx = (Math.random() - 0.5) * 4;
            let vy = 4 + Math.random() * 5;
            this.projectiles.push(new Meteor(startX, this.player.y - 800, vx, vy));
        }

        // Platform Update
        this.platforms.forEach(p => {
            if (p.vx) {
                p.x += p.vx * dt;
                if (p.x < 0) { p.x = 0; p.vx *= -1; }
                if (p.x + p.w > CONFIG.WIDTH) { p.x = CONFIG.WIDTH - p.w; p.vx *= -1; }
            }
        });

        if (event === "jump") {
            this.particles.spawn(this.player.x + 13, this.player.y + 26, "#fff");
            sounds.play('jump');
        } else if (event === "double_jump") {
            this.particles.spawn(this.player.x + 13, this.player.y + 26, POWERS.DOUBLE.color);
            sounds.play('jump');
        } else if (event === "trail") {
            if (this.state.frames % 2 === 0)
                this.particles.spawn(this.player.x + 13, this.player.y + 13, this.player.color, 1, "trail");
        } else if (event === "thrust") {
            this.particles.spawn(this.player.x + 13, this.player.y + 26, "#ff3300", 2, "blast");
        } else if (event && event.event === "shard") {
            this.state.shards += (event.value || 1) * (perks.shardMult || 1);
            localStorage.setItem('lp_shards', this.state.shards);
            if (this.ui.shardDisplay) {
                this.ui.shardDisplay.innerText = this.state.shards + " 💎";
                this.ui.shardDisplay.classList.remove('gem-pop');
                void this.ui.shardDisplay.offsetWidth; // restart animation on rapid pickups
                this.ui.shardDisplay.classList.add('gem-pop');
            }
            this.particles.spawn(event.x + 8, event.y + 8, "#00ffff", 10);
            sounds.play('powerup');
        } else if (event && event.event === "powerup") {
            this.state.powersCollected++;
            this.particles.spawn(event.x + 12, event.y + 12, this.player.activePower.color, 20);
            sounds.play('powerup');
        }

        this.updateDronePulse(dt, perks);

        let enemyDt = dt;
        if (this.player.activePower && this.player.activePower.name === "TIME WARP") enemyDt *= 0.3;

        // Enemy Update
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            let e = this.enemies[i];

            if (e instanceof ShooterDrone) {
                e.update(enemyDt, this.player, this.projectiles);
            } else if (e.constructor.name === "BossDrone") {
                e.update(enemyDt, this.player, this.projectiles);
            } else {
                e.update(enemyDt);
            }

            if (e.markedForDeletion) {
                if (e.constructor.name === "BossDrone") {
                    this.state.bossActive = false;
                    this.state.loops = (this.state.loops || 0) + 1;
                    localStorage.setItem('lp_loops', this.state.loops);
                    this.showAlert(`LOOP ${this.state.loops} SECURED`, 'reward');
                    this.state.score += 50000; // 5000m bonus
                }
                this.enemies.splice(i, 1);
                continue;
            }
            if (e.hidden || this.player.invuln > 0) continue;
            if (rectsIntersect(this.player, e)) {
                if (e.constructor.name === "BossDrone" && this.player.vy > 0 && this.player.y + this.player.h < e.y + 40) {
                    e.takeDamage(this.particles);
                    this.player.vy = CONFIG.BOUNCE_FORCE;
                    sounds.play('jump');
                    continue;
                }
                // Crashing with the jetpack just burns it out; the boss can't be
                // rammed to death, so it grants a moment of immunity instead.
                if (this.player.activePower === POWERS.ROCKET) {
                    this.player.activePower = null;
                    this.player.powerTimer = 0;
                    if (e.constructor.name === "BossDrone") this.player.invuln = 45;
                    else e.markedForDeletion = true;
                    this.particles.spawn(this.player.x, this.player.y, POWERS.ROCKET.color, 20, "blast");
                    sounds.play('powerup');
                    continue;
                }
                if (this.player.activePower && this.player.activePower.name === "HARD SHIELD") {
                    this.player.activePower = null;
                    e.markedForDeletion = true;
                    this.particles.spawn(this.player.x, this.player.y, "#00ffaa", 20, "blast");
                    sounds.play('powerup');
                    continue;
                }
                this.die(true);
            }
        }

        // Projectile Update
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            let p = this.projectiles[i];
            p.update(enemyDt);
            if (p.markedForDeletion) {
                this.projectiles.splice(i, 1);
                continue;
            }
            if (this.player.invuln > 0) continue;
            if (rectsIntersect(this.player, p)) {
                if (this.player.activePower === POWERS.ROCKET) {
                    this.player.activePower = null;
                    this.player.powerTimer = 0;
                    p.markedForDeletion = true;
                    this.particles.spawn(this.player.x, this.player.y, POWERS.ROCKET.color, 20, "blast");
                    sounds.play('powerup');
                    continue;
                }
                if (this.player.activePower && this.player.activePower.name === "HARD SHIELD") {
                    this.player.activePower = null;
                    p.markedForDeletion = true;
                    this.particles.spawn(this.player.x, this.player.y, "#00ffaa", 20, "blast");
                    sounds.play('powerup');
                    continue;
                }
                this.die(true); // Projectiles are deadly
            }
        }

        this.particles.update(dt);
        this.updateSafetyNet(dt);

        if (this.state.multiplayer && this.state.frames % 2 === 0 && !this.player.isDead) {
            window.network.send({
                type: 'sync',
                pid: window.network.myId,
                x: this.player.x,
                y: this.player.y - this.state.score,
                vx: this.player.vx,
                vy: this.player.vy,
                skinIndex: this.viewParams.skinIndex,
                activePowerId: this.player.activePower ? this.player.activePower.id : null
            });
        }

        // Camera follows the lowest living player in multiplayer (so nobody is
        // scrolled off the bottom); a dead player's view rides along with them.
        let threshold = CONFIG.HEIGHT * CONFIG.SCROLL_THRESHOLD;
        let targetY = this.player.isDead ? threshold + 1 : this.player.y;

        if (this.state.multiplayer) {
            const aliveYs = [];
            if (!this.player.isDead) aliveYs.push(this.player.y);
            this.remotePlayers.forEach(rp => { if (!rp.isDead) aliveYs.push(rp.y); });
            targetY = aliveYs.length ? Math.max(...aliveYs) : threshold + 1; // everyone dead: no scroll
        }

        if (targetY < threshold) {
            let diff = threshold - targetY;

            this.player.y += diff;
            this.remotePlayers.forEach(rp => { rp.y += diff; });

            this.state.score += diff;
            // SCORE x2 perk: state.score is the camera's real height (it drives
            // biomes, spawns and boss loops), so the extra distance is banked
            // separately and only added to the score the player sees.
            this.state.bonusScore += diff * ((perks.scoreMult || 1) - 1);
            this.state.bgOffset += diff * 0.5;

            this.platforms.forEach(p => p.y += diff);
            this.powerups.forEach(p => { p.y += diff; p.startY += diff; });
            this.enemies.forEach(p => p.y += diff);
            this.projectiles.forEach(p => p.y += diff);
            this.particles.particles.forEach(p => p.y += diff);

            this.platforms = this.platforms.filter(p => p.y < CONFIG.HEIGHT + 100);
            this.powerups = this.powerups.filter(p => p.y < CONFIG.HEIGHT + 100);
            // Drones now circle back instead of leaving, so cull the ones left below.
            this.enemies = this.enemies.filter(e => e.constructor.name === "BossDrone" || e.y < CONFIG.HEIGHT + 100);

            let highest = CONFIG.HEIGHT;
            this.platforms.forEach(p => { if (p.y < highest) highest = p.y; });
            if (highest > 100) this.spawnPlatform(highest - CONFIG.PLATFORM_BASE_GAP);
        }

        if (!this.player.isDead && this.player.y > CONFIG.HEIGHT) {
            this.die();
        }

        let displayScore = this.runScore();
        if (displayScore > this.state.maxScore) this.state.maxScore = displayScore;
        if (displayScore > this.state.highScore) {
            this.state.highScore = displayScore;
            localStorage.setItem('lp_best', this.state.highScore);
            this.state.isNewBest = true;
        }

        this.ui.score.innerText = displayScore + "m";
        this.ui.best.innerText = "BEST: " + this.state.highScore + "m";

        if (this.player.activePower) {
            this.ui.power.style.opacity = 1;
            this.ui.powerText.innerText = this.player.activePower.name;
            this.ui.powerText.style.color = this.player.activePower.color;
            this.ui.powerFill.style.backgroundColor = this.player.activePower.color;
            // Measured against the stretched duration, or long-lasting power
            // Pixels would start with an overflowing bar.
            const fullTime = this.player.activePower.time * (perks.powerDurationMult || 1);
            let pct = (this.player.powerTimer / fullTime) * 100;
            this.ui.powerFill.style.width = pct + "%";
        } else {
            this.ui.power.style.opacity = 0;
        }

        this.powerups = this.powerups.filter(p => !p.markedForDeletion);
    }

    draw() {
        this.renderer.clear(this.state.bgOffset);
        this.renderer.drawGrid(this.state.bgOffset);

        this.platforms.forEach(p => {
            this.renderer.ctx.fillStyle = "#333";
            this.renderer.ctx.fillRect(p.x, p.y, p.w, p.h);
            this.renderer.ctx.fillStyle = this.renderer.currentBiome.platform;
            this.renderer.ctx.fillRect(p.x, p.y, p.w, 3);
            this.renderer.ctx.fillStyle = "rgba(0, 255, 204, 0.1)";
            this.renderer.ctx.fillRect(p.x, p.y, 3, p.h);
            this.renderer.ctx.fillRect(p.x + p.w - 3, p.y, 3, p.h);
        });

        this.powerups.forEach(p => {
            p.y = p.startY + Math.sin(this.state.time * 0.1) * 5;
            if (p.isShard) {
                // Same 💎 as the shard counter, with a pulsing cyan glow.
                const ctx = this.renderer.ctx;
                ctx.save();
                ctx.shadowBlur = 10 + Math.sin(this.state.time * 5) * 4;
                ctx.shadowColor = "#00ffff";
                ctx.textBaseline = "middle";
                this.renderer.drawText("💎", p.x + p.w / 2, p.y + p.h / 2, "18px sans-serif", "#fff");
                ctx.restore();
            } else {
                let hue = (this.state.time * 5) % 360;
                this.renderer.drawRect(p.x, p.y, p.w, p.h, `hsl(${hue}, 100%, 50%)`, { blur: 15, color: `hsl(${hue}, 100%, 50%)` });
                this.renderer.drawText("?", p.x + p.w / 2, p.y + p.h - 6, "bold 16px Courier New", "#000");
            }
        });

        this.enemies.forEach(e => e.draw(this.renderer.ctx));
        this.projectiles.forEach(p => p.draw(this.renderer.ctx));

        if (this.ghostPlayback && this.ghostPlayback.length > 0) {
            let idx = Math.floor(this.state.frames / 5);
            if (idx < this.ghostPlayback.length) {
                let pos = this.ghostPlayback[idx];
                let screenY = pos.y + this.state.score;
                if (screenY > -50 && screenY < CONFIG.HEIGHT + 50) {
                    this.renderer.ctx.globalAlpha = 0.3;
                    this.renderer.ctx.fillStyle = "#ffffff";
                    this.renderer.ctx.fillRect(pos.x, screenY, 26, 26);
                    this.renderer.ctx.globalAlpha = 1;
                }
            }
        }

        this.renderer.drawSafetyNet(this.safetyNet, POWERS.SAFETY.color, this.state.time);

        if (!this.player.isDead) this.player.draw(this.renderer.ctx);

        if (this.state.multiplayer && this.remotePlayers.size > 0) {
            // Name tags in each player's party-slot colour.
            this.remotePlayers.forEach(rp => {
                if (rp.isDead) return;
                rp.draw(this.renderer.ctx);
                this.renderer.drawText(rp.name || 'PLAYER', rp.x + 13, rp.y - 10, "10px Courier New", PARTY_COLORS[rp.slot] || "#00ffcc");
            });
            if (!this.player.isDead) {
                const me = this.party.find(m => m.pid === window.network.myId);
                this.renderer.drawText(this.getMpName(), this.player.x + 13, this.player.y - 10, "10px Courier New", me ? PARTY_COLORS[me.slot] : "#fff");
            }
        }

        this.particles.draw(this.renderer.ctx);
    }

    loop(timestamp) {
        if (!this.lastTime) this.lastTime = timestamp;
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        let dt = deltaTime / (1000 / 60);
        if (dt > 4) dt = 4;

        this.update(dt);
        this.draw();
        requestAnimationFrame(this.loop);
    }
}

window.onload = () => {
    new Game();
};
