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
        this.ownedSkins = JSON.parse(localStorage.getItem('lp_owned_skins')) || [];

        this.state = {
            running: false,
            revived: false,
            multiplayer: false,
            isHost: false,
            score: 0,
            maxScore: 0,
            highScore: parseInt(localStorage.getItem('lp_best')) || 0,
            shards: parseInt(localStorage.getItem('lp_shards')) || 0,
            loops: parseInt(localStorage.getItem('lp_loops')) || 0,
            skinIndex: parseInt(localStorage.getItem('lp_skin')) || 0,
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
            mpHostCode: document.getElementById("mp-host-code"),
            mpStatus: document.getElementById("mp-status"),
            mpStartBtn: document.getElementById("mp-start-prompt")
        };
        this.remotePlayer = null;
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

        this.ui.menu.onclick = (e) => {
            if (e.target.closest('#skin-container') || e.target.closest('.mode-switch-arrow')) return;
            if (this.isSkinLocked()) {
                this.shakeUI();
            } else {
                this.startGame();
            }
        };

        // Keyboard-start: any movement/jump key starts the game from the SP
        // menu, same as clicking it (matches the on-screen "CLICK TO START").
        window.addEventListener('keydown', (e) => {
            if (this.activeMenuPanel !== 'sp' || this.state.running) return;
            const startKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', ' '];
            if (!startKeys.includes(e.key)) return;
            if (this.isSkinLocked()) {
                this.shakeUI();
            } else {
                this.startGame();
            }
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
                this.ui.mpHostBtn.disabled = true;
                this.setMpStatus("GENERATING CODE...", 'pending');

                try {
                    let code = await window.network.host();
                    this.ui.mpHostCode.innerText = code;
                    this.ui.mpHostCode.classList.add('has-code');
                    this.setMpStatus("WAITING FOR GUEST...", 'success');
                } catch (err) {
                    this.setMpStatus("HOST FAILED — TRY AGAIN", 'danger');
                    this.ui.mpHostBtn.disabled = false;
                }
            };

            this.ui.mpJoinBtn.onclick = async () => {
                const code = this.ui.mpJoinInput.value.trim();
                if (code.length === 6) {
                    this.ui.mpJoinBtn.disabled = true;
                    this.setMpStatus("CONNECTING...", 'pending');
                    try {
                        await window.network.join(code);
                    } catch (err) {
                        this.setMpStatus("CONNECTION FAILED — TRY AGAIN", 'danger');
                        this.ui.mpJoinBtn.disabled = false;
                    }
                } else {
                    this.setMpStatus("INVALID CODE", 'danger');
                }
            };

            this.ui.mpStartBtn.onclick = () => {
                if (this.state.isHost) {
                    let mpSeed = this.getDailySeed() + Math.floor(Math.random() * 10000);
                    window.network.send({ type: 'start', seed: mpSeed });
                    this.startMultiplayerGame(mpSeed);
                }
            };

            window.network.onConnected = () => {
                this.setMpStatus("CONNECTED!", 'success');

                let name = this.ui.mpNameInput.value.trim() || 'Player';

                if (window.network.isHost) {
                    this.state.isHost = true;
                    this.ui.mpStartBtn.style.display = 'block';
                } else {
                    this.state.isHost = false;
                    this.setMpStatus("SYNCHRONIZING...", 'pending');

                    // Handshake Retry Loop for Guest
                    // Ensures the host DEFINITELY gets the name even if the first packet is lost
                    if (this.handshakeInterval) clearInterval(this.handshakeInterval);
                    this.handshakeInterval = setInterval(() => {
                        console.log("MP: Sending Handshake...");
                        window.network.send({ type: 'handshake', name: name });
                    }, 1000);
                    window.network.send({ type: 'handshake', name: name });
                }
            };

            window.network.onData = (data) => {
                if (data.type === 'ping') return; // Silence internal heartbeats
                this.handleNetworkData(data);
            };

            window.network.onDisconnected = () => {
                if (this.handshakeInterval) clearInterval(this.handshakeInterval);
                if (this.state.running && this.state.multiplayer) {
                    this.die(true); // Disconnect kills
                }
                this.setMpStatus("DISCONNECTED", 'danger');
                this.ui.mpStartBtn.style.display = 'none';
                this.ui.mpHostBtn.disabled = false;
                this.ui.mpJoinBtn.disabled = false;
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
                this.ui.mpHostBtn.disabled = false;
                this.ui.mpJoinBtn.disabled = false;
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

    handleNetworkData(data) {
        if (data.type === 'handshake') {
            console.log("MP: Received Handshake from", data.name);
            this.remoteName = data.name;
            if (this.state.isHost) {
                window.network.send({ type: 'handshake_ack' });
            }
        } else if (data.type === 'handshake_ack') {
            console.log("MP: Received Handshake ACK");
            if (this.handshakeInterval) clearInterval(this.handshakeInterval);
            this.handshakeInterval = null;
            this.setMpStatus("READY TO START", 'success');
        } else if (data.type === 'start') {
            this.startMultiplayerGame(data.seed);
        } else if (data.type === 'sync') {
            if (!this.remotePlayer) {
                this.remotePlayer = new Player(data.x, data.y + this.state.score, data.skinIndex);
                this.remotePlayer.name = this.remoteName || "GUEST";
            }
            this.remotePlayer.x = data.x;
            this.remotePlayer.y = data.y + this.state.score;
            this.remotePlayer.vx = data.vx;
            this.remotePlayer.vy = data.vy;
            if (data.activePowerId) {
                this.remotePlayer.activePower = Object.values(POWERS).find(p => p.id === data.activePowerId);
            } else {
                this.remotePlayer.activePower = null;
            }
        } else if (data.type === 'die') {
            if (this.remotePlayer) this.remotePlayer.isDead = true;
            this.checkDoubleDeath();
        } else if (data.type === 'revive') {
            if (this.remotePlayer) {
                this.remotePlayer.isDead = false;
                this.remotePlayer.y = this.player.y - 100; // spawn above
                this.particles.spawn(this.remotePlayer.x, this.remotePlayer.y, "#00ffcc", 40, "blast");
            }
        }
    }

    startMultiplayerGame(seed) {
        this.ui.mpStartBtn.style.display = 'none';
        this.startGame(true, seed);
    }

    changeSkin(dir) {
        this.viewParams.skinIndex = (this.viewParams.skinIndex + dir + SKINS.length) % SKINS.length;
        this.updateSkinUI();
    }

    isSkinLocked(index = this.viewParams.skinIndex) {
        const s = SKINS[index];
        if (s.cost !== undefined) return !this.ownedSkins.includes(index);
        return this.state.highScore < s.unlock;
    }

    updateSkinUI() {
        let s = SKINS[this.viewParams.skinIndex];
        let locked = this.isSkinLocked();
        let masked = locked && s.secret;

        this.ui.preview.style.backgroundColor = masked ? "#222" : s.color;
        this.ui.eyesL.style.backgroundColor = masked ? "#000" : s.eye;
        this.ui.eyesR.style.backgroundColor = masked ? "#000" : s.eye;
        this.ui.skinName.innerText = masked ? "???" : s.name;

        if (locked) {
            if (masked) {
                this.ui.skinStatus.innerText = "LOCKED — ???";
            } else if (s.cost !== undefined) {
                this.ui.skinStatus.innerText = "LOCKED (" + s.cost + " 💎)";
            } else {
                this.ui.skinStatus.innerText = "LOCKED (" + s.unlock + "m)";
            }
            this.ui.skinStatus.style.color = "#888";
            this.ui.preview.style.opacity = "0.3";
            this.ui.startBtn.innerText = "LOCKED";
            this.ui.startBtn.style.opacity = "0.5";
            this.ui.startBtn.style.cursor = "default";
        } else {
            this.ui.skinStatus.innerText = "UNLOCKED";
            this.ui.skinStatus.style.color = "#00ffcc";
            this.ui.preview.style.opacity = "1";
            this.ui.startBtn.innerText = "CLICK TO START";
            this.ui.startBtn.style.opacity = "1";
            this.ui.startBtn.style.cursor = "pointer";
        }

        if (this.ui.shardDisplay) this.ui.shardDisplay.innerText = this.state.shards + " 💎";
        if (this.ui.skinAbility) this.ui.skinAbility.innerText = masked ? "" : this.describeAbility(s.ability);
    }

    // Turns an ability object into a short human-readable buff line, shared by
    // the skin carousel and the gem shop list.
    describeAbility(ability) {
        if (!ability) return "";
        const parts = [];
        if (ability.jumpMult && ability.jumpMult !== 1) {
            parts.push((ability.jumpMult > 1 ? "+" : "") + Math.round((ability.jumpMult - 1) * 100) + "% Jump Height");
        }
        if (ability.speedMult && ability.speedMult !== 1) {
            parts.push((ability.speedMult > 1 ? "+" : "") + Math.round((ability.speedMult - 1) * 100) + "% Move Speed");
        }
        if (ability.gravityMult && ability.gravityMult !== 1) {
            const pct = Math.round((ability.gravityMult - 1) * 100);
            parts.push(pct + "% Gravity" + (ability.gravityMult < 1 ? " (Floaty)" : ""));
        }
        if (ability.shardMagnetRadius) {
            parts.push("Shard Magnet");
        }
        if (ability.extraRevive) {
            parts.push("+" + ability.extraRevive + " Free Revive / Run");
        }
        if (ability.powerDurationMult && ability.powerDurationMult !== 1) {
            parts.push("+" + Math.round((ability.powerDurationMult - 1) * 100) + "% Power-Up Duration");
        }
        if (ability.startAtScore) {
            parts.push("Runs Start at The Rift");
        }
        return parts.join(" + ");
    }

    // Every shards-purchasable skin (anything in SKINS with a `cost`), paired
    // with its SKINS index so the carousel can address it.
    gemShopSkins() {
        return SKINS.map((s, i) => ({ s, i })).filter(({ s }) => s.cost !== undefined);
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
        const owned = this.ownedSkins.includes(i);
        const affordable = this.state.shards >= s.cost;

        this.ui.gemShop.innerHTML = `<div class="gem-skin-card">
            <div class="gem-skin-preview" style="background-color:${s.color}; opacity:${owned ? 1 : 0.35};">
                <div class="gem-skin-eye gem-skin-eye-l" style="background-color:${s.eye};"></div>
                <div class="gem-skin-eye gem-skin-eye-r" style="background-color:${s.eye};"></div>
            </div>
            <div class="gem-skin-name" style="color:${s.color};">${s.name}</div>
            <div class="gem-skin-status" style="color:${owned ? '#00ffcc' : '#888'};">${owned ? 'OWNED' : 'LOCKED'}</div>
            <div class="gem-skin-buff">${this.describeAbility(s.ability)}</div>
            <button class="gem-skin-buy-btn${owned || affordable ? '' : ' unaffordable'}" data-index="${i}" ${owned ? 'disabled' : ''}>
                <span class="btn-label">${owned ? 'OWNED' : 'BUY PIXEL'}</span>
                ${owned ? '' : `<span class="btn-cost">${s.cost} 💎</span>`}
            </button>
        </div>`;

        if (this.ui.gemDots) {
            this.ui.gemDots.innerHTML = rows.map(({ i: idx }, pos) => {
                const cls = ['gem-dot'];
                if (pos === this.gemShopIndex) cls.push('active');
                if (this.ownedSkins.includes(idx)) cls.push('owned');
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
                this.buyGemSkin(parseInt(btn.dataset.index, 10));
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

    buyGemSkin(index) {
        if (this.ownedSkins.includes(index)) return false;
        const s = SKINS[index];
        if (!s || s.cost === undefined || this.state.shards < s.cost) {
            this.shakeUI();
            return false;
        }
        this.state.shards -= s.cost;
        this.ownedSkins.push(index);
        localStorage.setItem('lp_shards', this.state.shards);
        localStorage.setItem('lp_owned_skins', JSON.stringify(this.ownedSkins));
        this.renderGemShop();
        this.updateExtraLifeUI();
        this.updateSkinUI();
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

        localStorage.setItem('lp_skin', this.viewParams.skinIndex);

        this.platforms = [{ x: 0, y: CONFIG.HEIGHT - 40, w: CONFIG.WIDTH, h: 40 }];
        let y = CONFIG.HEIGHT - 140;
        while (y > -CONFIG.HEIGHT) { this.spawnPlatform(y); y -= CONFIG.PLATFORM_BASE_GAP; }

        this.powerups = [];
        this.enemies = [];
        this.projectiles = [];
        this.particles = new ParticleSystem();
        this.safetyNet = this.makeSafetyNetState();
        this.remotePlayer = null;

        this.ui.power.style.opacity = 0;
        this.showAlert("Initializing...", 'info');
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
            this.powerups.push({
                x: x + w / 2 - 8,
                y: y - 30,
                startY: y - 30,
                w: 16, h: 16,
                isShard: true,
                shardValue: 1 + Math.floor(this.seededRandom() * 3), // 1-3
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
            this.showAlert("BACKUP LIFE ENGAGED", 'success');
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
            this.showAlert("EXTRA LIFE SPENT — " + this.state.extraLives + " LEFT", 'success');
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

        if (window.network && window.network.conn) {
            window.network.send({ type: 'die' });
        }

        this.checkDoubleDeath();

        if (this.state.running) {
            this.state.deathCount = (this.state.deathCount || 0) + 1;
            this.startRespawnTimer();
        }
    }

    checkDoubleDeath() {
        if (this.player.isDead && this.remotePlayer && this.remotePlayer.isDead) {
            this.state.running = false;
            this.gameOver();
        }
    }

    startRespawnTimer() {
        let baseTime = 15;
        let time = baseTime + ((this.state.deathCount - 1) * 10);

        this.showAlert(`RESPAWN IN ${time}s`, 'pulse');

        let interval = setInterval(() => {
            if (!this.state.running || !this.player.isDead) {
                clearInterval(interval);
                return;
            }
            time--;
            this.showAlert(`RESPAWN IN ${time}s`, 'pulse');

            if (time <= 0) {
                clearInterval(interval);
                this.showAlert("WATCH AD TO REVIVE", 'pulse');
                this.ads.showRevivePrompt(
                    () => { this.mpRevive(); },
                    () => { this.showAlert("SPECTATING", 'warning'); }
                );
            }
        }, 1000);
    }

    mpRevive() {
        this.player.isDead = false;
        if (this.remotePlayer && !this.remotePlayer.isDead) {
            this.player.y = this.remotePlayer.y - 100;
            this.player.x = this.remotePlayer.x;
        } else {
            this.player.y = CONFIG.HEIGHT - 200;
        }
        this.player.vy = 0;

        if (window.network) window.network.send({ type: 'revive' });
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

        this.showAlert("Life Systems Restored.", 'success');
    }

    gameOver() {
        // Skip the interstitial on the session's first game and on very
        // quick deaths, so restarting fast never turns into ad-spam.
        const isFirstGame = this.state.gamesPlayedThisSession <= 1;
        const isQuickDeath = (performance.now() - this.state.runStartTime) < 10000;
        if (!isFirstGame && !isQuickDeath) {
            this.ads.showInterstitialAd();
        }
        let finalScore = Math.floor(this.state.score / 10);

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
                this.ui.mpStartBtn.style.display = 'block';
                this.ui.mpStartBtn.innerText = "PLAY AGAIN";
            } else {
                this.setMpStatus("WAITING FOR HOST TO RESTART...", 'pending');
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
                this.showAchievement(g.name);
            }
        });
    }

    showAchievement(name) {
        this.ui.achievement.innerText = "🏅 " + name;
        this.ui.achievement.style.display = 'block';
        setTimeout(() => { this.ui.achievement.style.display = 'none'; }, 3000);
        sounds.play('powerup');
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
        const glitching = hazards.includes('glitch') && (this.state.time % 480) < 24;
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
        if (this.state.multiplayer && this.remotePlayer && !this.player.isDead && !this.remotePlayer.isDead) {
            if (this.player.y < 0) {
                this.player.y = 0;
                if (this.player.vy < 0) this.player.vy = 0; // head bump
            }
        }

        // Environmental Hazards (cumulative per-biome, see BIOMES[].hazards)
        if (hazards.includes('wind')) {
            let wind = Math.sin(this.state.time * 0.05) * 0.3;
            this.player.vx += wind * dt;
            this.particles.particles.forEach(p => p.vx += wind * dt * 0.1);
        }
        if (hazards.includes('gravityPulse')) {
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
            this.state.shards += event.value || 1;
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
            if (rectsIntersect(this.player, e)) {
                if (e.constructor.name === "BossDrone" && this.player.vy > 0 && this.player.y + this.player.h < e.y + 40) {
                    e.takeDamage(this.particles);
                    this.player.vy = CONFIG.BOUNCE_FORCE;
                    sounds.play('jump');
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
            if (rectsIntersect(this.player, p)) {
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
                x: this.player.x,
                y: this.player.y - this.state.score,
                vx: this.player.vx,
                vy: this.player.vy,
                skinIndex: this.viewParams.skinIndex,
                activePowerId: this.player.activePower ? this.player.activePower.id : null
            });
        }

        // Camera follows dead player's partner if needed, or lowest player in co-op
        let threshold = CONFIG.HEIGHT * CONFIG.SCROLL_THRESHOLD;
        let targetY = this.player.isDead ? threshold + 1 : this.player.y;

        if (this.state.multiplayer && this.remotePlayer) {
            if (this.player.isDead && !this.remotePlayer.isDead) {
                targetY = this.remotePlayer.y;
            } else if (!this.player.isDead && !this.remotePlayer.isDead) {
                // Both alive: camera follows the lowest player (highest Y coordinate)
                targetY = Math.max(this.player.y, this.remotePlayer.y);
            } else if (!this.player.isDead && this.remotePlayer.isDead) {
                targetY = this.player.y;
            } else {
                targetY = threshold + 1; // Both dead, no scroll
            }
        }

        if (targetY < threshold) {
            let diff = threshold - targetY;

            this.player.y += diff;
            if (this.remotePlayer) this.remotePlayer.y += diff;

            this.state.score += diff;
            this.state.bgOffset += diff * 0.5;

            this.platforms.forEach(p => p.y += diff);
            this.powerups.forEach(p => { p.y += diff; p.startY += diff; });
            this.enemies.forEach(p => p.y += diff);
            this.projectiles.forEach(p => p.y += diff);
            this.particles.particles.forEach(p => p.y += diff);

            this.platforms = this.platforms.filter(p => p.y < CONFIG.HEIGHT + 100);
            this.powerups = this.powerups.filter(p => p.y < CONFIG.HEIGHT + 100);

            let highest = CONFIG.HEIGHT;
            this.platforms.forEach(p => { if (p.y < highest) highest = p.y; });
            if (highest > 100) this.spawnPlatform(highest - CONFIG.PLATFORM_BASE_GAP);
        }

        if (!this.player.isDead && this.player.y > CONFIG.HEIGHT) {
            this.die();
        }

        let displayScore = Math.floor(this.state.score / 10);
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
            let pct = (this.player.powerTimer / this.player.activePower.time) * 100;
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
                let hue = 180 + Math.sin(this.state.time * 5) * 20; // cyan-ish pulsing
                this.renderer.drawRect(p.x, p.y, p.w, p.h, `hsl(${hue}, 100%, 60%)`, { blur: 10, color: `hsl(${hue}, 100%, 60%)` });
                this.renderer.drawText("💎", p.x + p.w / 2, p.y + p.h - 2, "12px Courier New", "#fff");
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

        if (this.state.multiplayer && this.remotePlayer && !this.remotePlayer.isDead) {
            this.remotePlayer.draw(this.renderer.ctx);
            // Draw Names
            this.renderer.drawText(this.ui.mpNameInput.value.trim() || 'P1', this.player.x + 13, this.player.y - 10, "10px Courier New", "#fff");
            this.renderer.drawText(this.remotePlayer.name || 'P2', this.remotePlayer.x + 13, this.remotePlayer.y - 10, "10px Courier New", "#00ffcc");
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
