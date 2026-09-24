// Reads a JSON save. A missing, corrupt or wrong-shaped value falls back
// instead of throwing, so one bad localStorage entry can't stop the game from
// starting.
function loadJSON(key, fallback, isValid = () => true) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) return fallback;
        const value = JSON.parse(raw);
        return isValid(value) ? value : fallback;
    } catch (e) {
        return fallback;
    }
}

const isStringArray = v => Array.isArray(v) && v.every(x => typeof x === 'string');

// 12345 -> "12,345" for the HUD and menus.
const fmtNum = n => Number(n).toLocaleString('en-US');

// 3725 -> "1h 2m", 95 -> "1m 35s".
function fmtDuration(totalSeconds) {
    const t = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

// A challenge link (?beat=1234&d=20260923) sets a target on that day's
// layout. Every solo run on a given day uses the same daily seed, so the
// target is fair; on any other day the link is ignored.
function parseChallenge(search, todaySeed) {
    let params;
    try { params = new URLSearchParams(search || ''); } catch (e) { return null; }
    const meters = parseInt(params.get('beat'), 10);
    const day = parseInt(params.get('d'), 10);
    if (!(meters > 0) || meters > 1e7 || day !== todaySeed) return null;
    return { meters };
}

const SITE_URL = 'https://treyham27.github.io/Pixel-Jump/';

// Lifetime totals shown on the Records screen (lp_stats).
const STAT_DEFAULTS = { runs: 0, meters: 0, gems: 0, powerups: 0, livesLost: 0, seconds: 0 };

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
        this.achievements = loadJSON('lp_achievements', [], isStringArray);
        this.migrateSkinSaves();
        // Owned gem-shop Pixels, by SKINS id.
        this.ownedSkins = loadJSON('lp_owned_skins', [], isStringArray);

        this.state = {
            running: false,
            revived: false,
            multiplayer: false,
            isHost: false,
            score: 0,
            maxScore: 0,
            bonusScore: 0,
            highScore: parseInt(localStorage.getItem('lp_best')) || 0,
            // Best real height reached, in meters. Distance-gated Pixels unlock
            // on this, not on highScore: the SCORE x2 perk and boss bonuses
            // inflate the score, and must not unlock them early. Older saves
            // only have lp_best, so they start from that.
            bestHeight: parseInt(localStorage.getItem('lp_best_height')) || parseInt(localStorage.getItem('lp_best')) || 0,
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

        this.settings = this.loadSettings();
        this.stats = this.loadStats();
        this.pauseMenuOpen = false;
        this.settingsOpen = false;
        this.runCardOpen = false;
        this.hintShowing = false;

        // Gameplay keys/touches are only intercepted during a run (including
        // while dead and spectating in co-op), and not while the pause menu
        // is up; the menus keep normal input.
        this.input.isActive = () => this.state.running && !this.pauseMenuOpen;

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
            mpLeaveBtn: document.getElementById("mp-leave-btn"),

            // Pause, settings, run card, records, first-run hint
            pauseBtn: document.getElementById("pause-btn"),
            pauseOverlay: document.getElementById("pause-overlay"),
            pauseNote: document.getElementById("pause-note"),
            pauseResumeBtn: document.getElementById("pause-resume-btn"),
            pauseSettingsBtn: document.getElementById("pause-settings-btn"),
            pauseQuitBtn: document.getElementById("pause-quit-btn"),
            settingsOpenBtn: document.getElementById("settings-open-btn"),
            settingsOverlay: document.getElementById("settings-overlay"),
            settingsCloseBtn: document.getElementById("settings-close-btn"),
            setVolume: document.getElementById("set-volume"),
            setMuted: document.getElementById("set-muted"),
            setGhost: document.getElementById("set-ghost"),
            setMotion: document.getElementById("set-motion"),
            runCard: document.getElementById("run-card"),
            runCardTitle: document.getElementById("run-card-title"),
            runCardDistance: document.getElementById("run-card-distance"),
            runCardBest: document.getElementById("run-card-best"),
            runCardStats: document.getElementById("run-card-stats"),
            runCardUnlocks: document.getElementById("run-card-unlocks"),
            runCardWait: document.getElementById("run-card-wait"),
            runAgainBtn: document.getElementById("run-again-btn"),
            runMenuBtn: document.getElementById("run-menu-btn"),
            recordsOpenBtn: document.getElementById("records-open-btn"),
            recordsBackBtn: document.getElementById("records-back-btn"),
            recordsLayer: document.getElementById("records-menu-layer"),
            recordsStats: document.getElementById("records-stats"),
            recordsList: document.getElementById("records-list"),
            recordsCount: document.getElementById("records-count"),
            controlsHint: document.getElementById("controls-hint"),

            // Phones, challenge links and sharing
            touchControls: document.getElementById("touch-controls"),
            setTouch: document.getElementById("set-touch"),
            challengeHud: document.getElementById("challenge-hud"),
            runShareBtn: document.getElementById("run-share-btn"),
            shareToast: document.getElementById("share-toast")
        };
        this.touchPads = this.ui.touchControls && this.ui.touchControls.querySelectorAll
            ? {
                left: this.ui.touchControls.querySelector('.touch-pad--left'),
                right: this.ui.touchControls.querySelector('.touch-pad--right'),
                jump: this.ui.touchControls.querySelector('.touch-pad--jump')
            }
            : {};
        // Touch pads follow the current primary pointer (a 2-in-1 can switch).
        const coarse = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
        this.coarsePointer = !!(coarse && coarse.matches);
        if (coarse && coarse.addEventListener) {
            coarse.addEventListener('change', (e) => {
                this.coarsePointer = e.matches;
                this.updateTouchControls();
            });
        }
        this.challenge = parseChallenge(typeof location !== 'undefined' ? location.search : '', this.getDailySeed());
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

        this.ui.menuScore.innerText = "HIGH SCORE: " + fmtNum(this.state.highScore) + "m";
        if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
            this.ui.startBtn.innerText = "TAP TO START";
        }
        this.setMenuPanel('sp');
        this.applySettings();
        this.gemSprite = this.makeGemSprite();
        this.renderer.onResize = () => {
            this.layoutTouchControls();
            this.gemSprite = this.makeGemSprite();
        };
        this.layoutTouchControls();

        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    bindEvents() {
        this.bindMetaEvents();
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
                this.setMenuPanel('shop');
            };
            this.ui.shopBackBtn.onclick = (e) => {
                e.stopPropagation();
                this.setMenuPanel('sp');
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
            if (e.target.closest('button, input, #skin-container, .mode-switch-arrow')) return;
            this.requestSoloStart();
        };

        // Keyboard on the solo menu: left/right browse the Pixel picker, and
        // Space / Enter / Up / W start a run (same as clicking the menu).
        window.addEventListener('keydown', (e) => {
            if (this.runCardOpen) {
                this.handleRunCardKey(e);
                return;
            }
            if (!this.canQuickStart(e)) return;
            const role = InputHandler.codeRole(e.code);
            if (role === 'left' || role === 'right') {
                e.preventDefault();
                this.changeSkin(role === 'left' ? -1 : 1);
            } else if (role === 'jump' || e.code === 'Enter' || e.code === 'NumpadEnter') {
                e.preventDefault();
                this.requestSoloStart();
            }
        });

        // Multiplayer UI Bindings
        if (this.ui.toMpBtn) {
            this.ui.toMpBtn.onclick = (e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                this.setMenuPanel('mp');
                let savedName = localStorage.getItem('lp_mp_name');
                if (savedName) this.ui.mpNameInput.value = savedName.toUpperCase();
            };
            this.ui.toSpBtn.onclick = (e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                this.setMenuPanel('sp');
            };

            // Names show in capitals everywhere (party list, name tags), so
            // store them that way too.
            this.ui.mpNameInput.addEventListener('input', (e) => {
                const upper = e.target.value.toUpperCase();
                if (upper !== e.target.value) e.target.value = upper;
                localStorage.setItem('lp_mp_name', upper.trim());
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
                    this.showSetupError(err, "HOST FAILED — TRY AGAIN");
                }
            };

            this.ui.mpJoinBtn.onclick = async () => {
                // Codes never contain 0/O, 1/I or L, so a typo is caught here
                // instead of after a minute of connection attempts.
                if (!normalizeRoomCode(this.ui.mpJoinInput.value)) {
                    this.setMpStatus("INVALID CODE", 'danger');
                    return;
                }
                this.setMpSetupBusy(true);
                this.setMpStatus("CONNECTING...", 'pending');
                try {
                    await window.network.join(this.ui.mpJoinInput.value);
                } catch (err) {
                    this.showSetupError(err, "CONNECTION FAILED — TRY AGAIN");
                }
            };
            this.ui.mpJoinInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.ui.mpJoinBtn.onclick();
            });

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

                // Resend the introduction every second until the host acks it,
                // giving up after 10 tries (the host drops silent joiners too).
                let tries = 0;
                const sendHandshake = () => {
                    if (++tries > 10) {
                        this.leaveParty("COULDN'T JOIN — TRY AGAIN", 'danger');
                        return;
                    }
                    window.network.send({ type: 'handshake', name: this.getMpName(), v: NET_PROTOCOL, build: GAME_VERSION });
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

            // Errors in a live session (host/join failures come back through
            // their own promises, see showSetupError).
            window.network.onError = (err) => {
                this.setMpStatus(this.netErrorMessage(err, "CONNECTION FAILED"), 'danger');
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
                    // Not while the shop/records cover the menu, or mid-run.
                    if (this.activeMenuPanel === 'shop' || this.activeMenuPanel === 'records' || this.state.running) { touchStartX = 0; return; }
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

    // Pause, settings, records and the run card.
    bindMetaEvents() {
        const on = (el, fn) => { if (el) el.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); fn(); }; };
        on(this.ui.pauseBtn, () => this.pauseGame());
        on(this.ui.pauseResumeBtn, () => this.resumeGame());
        on(this.ui.pauseSettingsBtn, () => this.openSettings());
        on(this.ui.pauseQuitBtn, () => this.quitRun());
        on(this.ui.settingsOpenBtn, () => this.openSettings());
        on(this.ui.settingsCloseBtn, () => this.closeSettings());
        on(this.ui.recordsOpenBtn, () => { this.renderRecords(); this.setMenuPanel('records'); });
        on(this.ui.recordsBackBtn, () => this.setMenuPanel('sp'));
        on(this.ui.runAgainBtn, () => this.runCardPlayAgain());
        on(this.ui.runMenuBtn, () => this.closeRunCard());

        const setting = (el, key, read) => {
            if (!el || !el.addEventListener) return;
            el.addEventListener('input', () => {
                this.settings[key] = read(el);
                this.saveSettings();
                this.applySettings();
            });
        };
        setting(this.ui.setVolume, 'volume', el => Number(el.value) / 100);
        setting(this.ui.setMuted, 'muted', el => el.checked);
        setting(this.ui.setGhost, 'showGhost', el => el.checked);
        setting(this.ui.setMotion, 'reducedMotion', el => el.checked);
        setting(this.ui.setTouch, 'touchControls', el => el.checked);
        on(this.ui.runShareBtn, () => this.shareRun());

        // Leaving the tab or window pauses a solo run.
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
        window.addEventListener('blur', () => this.autoPause());

        // Esc / P: close the topmost thing, or pause the run.
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Escape' && e.code !== 'KeyP') return;
            if (e.target && e.target.closest && e.target.closest('input')) return;
            const esc = e.code === 'Escape';
            if (this.settingsOpen) { if (esc) this.closeSettings(); return; }
            if (this.state.running) { e.preventDefault(); this.togglePause(); return; }
            if (this.runCardOpen) { if (esc) this.closeRunCard(); return; }
            if (esc && (this.activeMenuPanel === 'shop' || this.activeMenuPanel === 'records')) this.setMenuPanel('sp');
        });
    }

    // ---------------------------------------------------------------- pause
    // A solo run freezes under the pause screen. A co-op run can't stop for
    // one player, so there it's just a menu over the live game.
    pauseGame() {
        if (!this.state.running || this.pauseMenuOpen) return;
        this.pauseMenuOpen = true;
        this.state.paused = !this.state.multiplayer;
        if (this.state.paused) this.pauseStartedAt = performance.now();
        this.input.resetInput();
        this.ui.pauseNote.hidden = !this.state.multiplayer;
        this.ui.pauseQuitBtn.innerText = this.state.multiplayer ? "LEAVE PARTY" : "QUIT RUN";
        this.ui.pauseOverlay.hidden = false;
        this.updateTouchControls();
    }

    resumeGame() {
        if (!this.pauseMenuOpen) return;
        this.closePauseUI();
        // Restart the frame clock so the paused time isn't one giant step.
        this.lastTime = 0;
    }

    closePauseUI() {
        if (this.state.paused && this.pauseStartedAt) {
            this.state.pausedMs = (this.state.pausedMs || 0) + (performance.now() - this.pauseStartedAt);
        }
        this.pauseStartedAt = 0;
        this.pauseMenuOpen = false;
        this.state.paused = false;
        this.ui.pauseOverlay.hidden = true;
        this.closeSettings();
        this.updateTouchControls();
    }

    togglePause() {
        if (this.pauseMenuOpen) this.resumeGame();
        else this.pauseGame();
    }

    autoPause() {
        if (this.state.running && !this.state.multiplayer) this.pauseGame();
    }

    // Ends the run from the pause menu: straight to game over (no revive).
    // In co-op that means leaving the party.
    quitRun() {
        if (!this.state.running) return;
        this.closePauseUI();
        if (this.state.multiplayer) {
            this.endPartyRun();
            this.leaveParty("LEFT THE PARTY");
            return;
        }
        this.state.running = false;
        this.gameOver();
    }

    // ------------------------------------------------------------- settings
    loadSettings() {
        const prefersReduced = typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const saved = loadJSON('lp_settings', {}, isPlainObject);
        return {
            volume: Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.8,
            muted: saved.muted === true,
            showGhost: saved.showGhost !== false,
            reducedMotion: typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : prefersReduced,
            touchControls: saved.touchControls !== false
        };
    }

    saveSettings() {
        localStorage.setItem('lp_settings', JSON.stringify(this.settings));
    }

    applySettings() {
        sounds.setVolume(this.settings.volume);
        sounds.setMuted(this.settings.muted);
        if (document.body && document.body.classList) document.body.classList.toggle('reduce-motion', this.settings.reducedMotion);
        this.particles.scale = this.settings.reducedMotion ? 0.35 : 1;
        this.updateTouchControls();
    }

    openSettings() {
        const s = this.settings;
        this.ui.setVolume.value = Math.round(s.volume * 100);
        this.ui.setMuted.checked = s.muted;
        this.ui.setGhost.checked = s.showGhost;
        this.ui.setMotion.checked = s.reducedMotion;
        if (this.ui.setTouch) this.ui.setTouch.checked = s.touchControls;
        this.ui.settingsOverlay.hidden = false;
        this.settingsOpen = true;
    }

    closeSettings() {
        this.ui.settingsOverlay.hidden = true;
        this.settingsOpen = false;
    }

    // ---------------------------------------------------------------- stats
    loadStats() {
        const saved = loadJSON('lp_stats', {}, isPlainObject);
        const stats = { ...STAT_DEFAULTS };
        for (const k of Object.keys(STAT_DEFAULTS)) {
            if (Number.isFinite(saved[k]) && saved[k] >= 0) stats[k] = saved[k];
        }
        return stats;
    }

    recordRunStats(runMeters) {
        const st = this.stats;
        st.runs += 1;
        st.meters += runMeters;
        st.gems += this.state.runGems || 0;
        st.powerups += this.state.powersCollected || 0;
        st.livesLost += this.state.runDeaths || 0;
        st.seconds += this.runSeconds();
        localStorage.setItem('lp_stats', JSON.stringify(st));
    }

    // -------------------------------------------------------------- run card
    showRunCard(finalScore) {
        const s = this.state;
        const secs = Math.round(this.runSeconds());
        const stats = [
            [fmtNum(s.runGems || 0) + ' 💎', 'GEMS'],
            [fmtNum(s.powersCollected || 0), 'POWER-UPS'],
            [this.renderer.currentBiome.name.toUpperCase(), 'REACHED'],
            [Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), 'TIME']
        ];
        if (s.runLoops) stats.push([fmtNum(s.runLoops), s.runLoops === 1 ? 'BOSS BEATEN' : 'BOSSES BEATEN']);

        this.ui.runCardTitle.innerText = s.multiplayer ? "PARTY DOWN" : "RUN OVER";
        this.ui.runCardDistance.innerText = fmtNum(finalScore) + "m";
        this.ui.runCardBest.hidden = !s.isNewBest;
        this.ui.runCardStats.innerHTML = stats.map(([value, label]) =>
            `<div class="run-stat"><span class="run-stat-value">${this.escapeHtml(value)}</span>` +
            `<span class="run-stat-label">${label}</span></div>`).join('');
        this.ui.runCardUnlocks.innerHTML = (s.runUnlocks || []).map(u => `<div>${this.escapeHtml(u)}</div>`).join('');
        // In co-op only the leader restarts.
        const guest = s.multiplayer && !s.isHost;
        this.ui.runAgainBtn.hidden = guest;
        this.ui.runCardWait.hidden = !guest;
        this.ui.runCard.hidden = false;
        this.runCardOpen = true;
    }

    // Space/Enter on the end-of-run card: PLAY AGAIN, unless a button has
    // keyboard focus (tabbing to MENU and pressing Enter means MENU), and
    // never from a key still held from the run (that arrives as a repeat).
    handleRunCardKey(e) {
        const confirm = e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
        if (!confirm || e.repeat || this.settingsOpen || this.ui.runAgainBtn.hidden) return false;
        if (e.target && e.target.closest && e.target.closest('button')) return false;
        e.preventDefault();
        this.runCardPlayAgain();
        return true;
    }

    // Seconds of actual play in this run (time spent paused doesn't count).
    runSeconds() {
        let paused = this.state.pausedMs || 0;
        if (this.state.paused && this.pauseStartedAt) paused += performance.now() - this.pauseStartedAt;
        return Math.max(0, (performance.now() - this.state.runStartTime - paused) / 1000);
    }

    closeRunCard() {
        this.ui.runCard.hidden = true;
        this.runCardOpen = false;
    }

    runCardPlayAgain() {
        this.closeRunCard();
        if (this.state.multiplayer) {
            if (this.state.isHost) this.ui.mpStartBtn.onclick();
        } else {
            this.requestSoloStart();
        }
    }

    // --------------------------------------------------------------- records
    renderRecords() {
        const st = this.stats;
        const rows = [
            [fmtNum(st.runs), 'RUNS'],
            [fmtNum(this.state.bestHeight) + 'm', 'BEST HEIGHT'],
            [fmtNum(Math.round(st.meters)) + 'm', 'TOTAL CLIMBED'],
            [fmtNum(st.gems) + ' 💎', 'GEMS EARNED'],
            [fmtNum(this.state.loops || 0), 'BOSSES BEATEN'],
            [fmtNum(st.powerups), 'POWER-UPS'],
            [fmtNum(st.livesLost), 'LIVES LOST'],
            [fmtDuration(st.seconds), 'TIME PLAYED']
        ];
        this.ui.recordsStats.innerHTML = rows.map(([value, label]) =>
            `<div class="run-stat"><span class="run-stat-value">${this.escapeHtml(value)}</span>` +
            `<span class="run-stat-label">${label}</span></div>`).join('');

        const earned = ACHIEVEMENTS.filter(a => this.achievements.includes(a.id)).length;
        this.ui.recordsCount.innerText = `${earned} / ${ACHIEVEMENTS.length}`;
        // Secret Pixels stay a surprise until earned.
        this.ui.recordsList.innerHTML = ACHIEVEMENTS.map(a => {
            const got = this.achievements.includes(a.id);
            const masked = a.secret && !got;
            const name = masked ? '???' : a.name;
            const desc = masked ? 'A secret Pixel. Keep climbing.' : a.desc;
            return `<div class="achievement-row${got ? ' earned' : ''}">
                <span class="achievement-icon" aria-hidden="true">${a.skin ? '🎨' : '🏅'}</span>
                <div><span class="achievement-name">${this.escapeHtml(name)}</span>
                <span class="achievement-desc">${this.escapeHtml(desc || '')}</span></div>
            </div>`;
        }).join('');
    }

    // ------------------------------------------------------ first-run hint
    // The very first run gets a short how-to-play, in keyboard or touch
    // terms. It goes after a few seconds, or soon after the first jump.
    showControlsHint() {
        if (localStorage.getItem('lp_seen_hint')) return;
        localStorage.setItem('lp_seen_hint', '1');
        const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        this.ui.controlsHint.innerHTML = touch
            ? 'HOLD THE LEFT QUARTER TO GO ◀ · THE NEXT QUARTER TO GO ▶<br>TAP THE RIGHT HALF TO JUMP'
            : '← → OR A D TO MOVE · SPACE, ↑ OR W TO JUMP<br>ESC TO PAUSE';
        this.ui.controlsHint.hidden = false;
        this.hintShowing = true;
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => this.hideControlsHint(), 7000);
    }

    hideControlsHint() {
        clearTimeout(this.hintTimer);
        this.hintShowing = false;
        this.ui.controlsHint.hidden = true;
    }

    // Keyboard shortcuts only apply on the solo menu itself: never mid-run,
    // never from a held (auto-repeating) key left over from the last run,
    // never while typing, and never under the revive prompt.
    canQuickStart(e) {
        if (e.repeat || this.state.running) return false;
        if (this.activeMenuPanel !== 'sp' || this.runCardOpen || this.settingsOpen) return false;
        const revive = this.ads && this.ads.reviveOverlay;
        if (revive && revive.style.display === 'flex') return false;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select')) return false;
        return true;
    }

    // A solo start from the menu (click, tap or key). While in a co-op party
    // the party screen is the place to be, so go back there instead.
    requestSoloStart() {
        if (this.state.running) return;
        if (this.inParty()) {
            this.ui.toMpBtn.onclick();
            return;
        }
        this.startGame();
    }

    // Shows one top-level menu panel ('sp' | 'mp' | 'shop'). The others are
    // made inert, so Tab and screen readers can't wander into off-screen
    // pages (focusing one also scrolled the clipped wrapper).
    setMenuPanel(panel) {
        this.activeMenuPanel = panel;
        const sp = this.ui.menu, mp = this.ui.menuLayer2, shop = this.ui.shopLayer, records = this.ui.recordsLayer;
        if (sp) sp.style.transform = panel === 'mp' ? 'translateX(-100%)' : 'translateX(0)';
        if (mp) mp.style.transform = panel === 'mp' ? 'translateX(0)' : 'translateX(100%)';
        if (shop) shop.style.transform = panel === 'shop' ? 'translateY(0)' : 'translateY(100%)';
        if (records) records.style.transform = panel === 'records' ? 'translateY(0)' : 'translateY(100%)';
        if (sp) sp.inert = panel !== 'sp';
        if (mp) mp.inert = panel !== 'mp';
        if (shop) shop.inert = panel !== 'shop';
        if (records) records.inert = panel !== 'records';
    }

    // Co-op menu status pill. `state` is one of 'pending' | 'success' | 'danger'
    // (or omitted for idle); the colors live in style.css under #mp-status.
    setMpStatus(text, state) {
        this.ui.mpStatus.innerText = text;
        if (state) this.ui.mpStatus.dataset.state = state;
        else delete this.ui.mpStatus.dataset.state;
    }

    netErrorMessage(err, fallback) {
        const type = err && err.type;
        if (type === 'invalid-code') return "INVALID CODE";
        if (type === 'connection-timeout') return "TIMED OUT — CODE MAY BE INVALID";
        if (type === 'peer-unavailable') return "CODE NOT FOUND — CHECK & RETRY";
        if (type === 'signaling-timeout') return "CAN'T REACH SERVER — CHECK CONNECTION";
        if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) return "NETWORK ERROR — CHECK CONNECTION";
        return fallback;
    }

    // A host/join attempt failed. One that was cancelled (the player left or
    // started another attempt) says nothing: the newer action owns the UI.
    showSetupError(err, fallback) {
        if (err && err.type === 'cancelled') return;
        this.setMpStatus(this.netErrorMessage(err, fallback), 'danger');
        if (!this.inParty()) this.setMpSetupBusy(false);
    }

    // Disables both setup actions while a host/join attempt is in flight.
    setMpSetupBusy(busy) {
        this.ui.mpHostBtn.disabled = busy;
        this.ui.mpJoinBtn.disabled = busy;
    }

    getMpName() {
        return (this.ui.mpNameInput.value.trim() || 'PLAYER').toUpperCase().slice(0, 10);
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
        if (!SKINS[skinIndex]) skinIndex = 0;
        const rp = new Player(CONFIG.WIDTH / 2, CONFIG.HEIGHT - 150, skinIndex);
        rp.name = member.name;
        rp.slot = member.slot;
        rp.skinIndex = skinIndex;
        rp.lastSeenT = this.state.time;
        this.remotePlayers.set(member.pid, rp);
        return rp;
    }

    // Remote input is untrusted: keep only known fields, as finite numbers
    // in sane ranges. Returns null for a packet that's unusable.
    sanitizeSync(d) {
        const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : null;
        const x = num(d.x, -100, CONFIG.WIDTH + 100);
        const y = num(d.y, -1e8, 1e5);
        if (x === null || y === null) return null;
        const skinIndex = Number.isInteger(d.skinIndex) && SKINS[d.skinIndex] ? d.skinIndex : 0;
        const power = Object.values(POWERS).find(p => p.id === d.activePowerId);
        return {
            type: 'sync', x, y,
            vx: num(d.vx, -50, 50) || 0,
            vy: num(d.vy, -50, 50) || 0,
            skinIndex,
            activePowerId: power ? power.id : null
        };
    }

    // Host: a guest introduced themselves — seat them in the lowest free slot.
    handleHandshake(data, fromId) {
        if (!this.state.isHost) return;
        const net = window.network;

        // Different builds generate different levels (and may disagree on
        // the Pixel list), so they can't share a run.
        if (data.v !== NET_PROTOCOL) {
            net.sendTo(fromId, { type: 'version_mismatch', v: NET_PROTOCOL, build: GAME_VERSION });
            setTimeout(() => net.closePeer(fromId), 300);
            return;
        }

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

        net.sendTo(fromId, { type: 'handshake_ack', party: this.party, v: NET_PROTOCOL, build: GAME_VERSION });
        this.broadcastParty();
    }

    handleNetworkData(data, fromId) {
        const net = window.network;
        if (!data || typeof data.type !== 'string') return;

        // Trust boundaries: a host only takes introductions and gameplay
        // traffic from guests (never party control messages), and a guest
        // only listens to its host.
        if (this.state.isHost) {
            if (!['handshake', 'sync', 'die', 'revive'].includes(data.type)) return;
        } else if (net.friendId && fromId !== net.friendId) {
            return;
        }

        if (data.type === 'sync') {
            const clean = this.sanitizeSync(data);
            if (!clean) return;
            clean.pid = this.state.isHost ? fromId : String(data.pid);
            data = clean;
        } else if (data.type === 'die' || data.type === 'revive') {
            data = { type: data.type, pid: this.state.isHost ? fromId : String(data.pid) };
        }

        // The host is the hub: relay every guest's gameplay traffic to the
        // rest of the party (a clean copy, stamped with the sender's ID so it
        // can't be spoofed).
        if (this.state.isHost && (data.type === 'sync' || data.type === 'die' || data.type === 'revive')) {
            net.broadcastExcept(fromId, data);
        }

        if (data.type === 'handshake') {
            this.handleHandshake(data, fromId);
        } else if (data.type === 'handshake_ack') {
            if (this.state.isHost) return;
            if (this.handshakeInterval) clearInterval(this.handshakeInterval);
            this.handshakeInterval = null;
            if (data.v !== NET_PROTOCOL) {
                this.leaveParty("HOST IS ON AN OLDER VERSION — BOTH REFRESH", 'danger');
                return;
            }
            this.applyParty(data.party);
            this.enterPartyView(net.code || net.friendId);
            this.setMpStatus("WAITING FOR LEADER TO START...", 'success');
        } else if (data.type === 'party') {
            if (!this.state.isHost) this.applyParty(data.party);
        } else if (data.type === 'party_full') {
            this.leaveParty(`PARTY IS FULL (${MAX_PARTY_SIZE}/${MAX_PARTY_SIZE})`, 'danger');
        } else if (data.type === 'version_mismatch') {
            if (!this.state.isHost) this.leaveParty("VERSION MISMATCH — REFRESH THE PAGE", 'danger');
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
            if (rp.skinIndex !== data.skinIndex) {
                rp.setSkin(data.skinIndex);
                rp.skinIndex = data.skinIndex;
            }
            rp.x = data.x;
            rp.y = data.y + this.state.score;
            rp.vx = data.vx;
            rp.vy = data.vy;
            rp.lastSeenT = this.state.time;
            rp.activePower = data.activePowerId ? Object.values(POWERS).find(p => p.id === data.activePowerId) : null;
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
        return this.state.bestHeight < s.unlock;
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

        if (this.ui.shardDisplay) this.ui.shardDisplay.innerText = fmtNum(this.state.shards) + " 💎";
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
        // Tiers glow harder the higher they sit, and the top four (the
        // run-changing perks) get the premium frame, so the ladder reads at a
        // glance.
        const premium = rows.length - this.gemShopIndex <= 4;

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
                return `<button class="${cls.join(' ')}" data-pos="${pos}" aria-label="Tier ${pos + 1}: ${row.name}"></button>`;
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
                    this.buyGemSkin(index, btn);
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
            this.shakeUI(this.ui.shopLifeBtn);
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
    buyGemSkin(index, button) {
        const s = SKINS[index];
        if (!s || this.ownedSkins.includes(s.id)) return false;
        if (s.cost === undefined || this.state.shards < s.cost) {
            this.shakeUI(button);
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

    // "Can't do that" feedback on the control that was pressed.
    shakeUI(el) {
        if (!el || !el.classList) return;
        el.classList.remove('shake');
        void el.offsetWidth; // restart the animation
        el.classList.add('shake');
        if (el.addEventListener) el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
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

    // EMP perk: every N seconds, wipe every drone on screen (regular, shooter
    // and laser drones) and every bullet in flight. The boss and the biome's
    // meteors are immune. Solo only: in co-op every client runs its own
    // enemies, so one player's EMP would desync what the party sees.
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

    // The player the boss hovers over: the lowest one still alive (the one the
    // camera follows), so in co-op it never parks over someone's corpse.
    bossFocus() {
        let focus = this.player.isDead ? null : this.player;
        this.remotePlayers.forEach(rp => {
            if (!rp.isDead && (!focus || rp.y > focus.y)) focus = rp;
        });
        return focus || this.player;
    }

    // Touching the boss. Landing on top of it (falling, feet near its top edge,
    // or feet above it last frame so a fast fall can't tunnel through) deals a
    // hit and bounces you high. Otherwise a jetpack or HARD SHIELD absorbs the
    // crash (the boss survives: it can't be rammed to death), and while it's
    // exposed at your level a side bump only knocks you back. Anything else
    // is fatal.
    resolveBossContact(boss) {
        const p = this.player;
        const feet = p.y + p.h;
        const onTop = p.vy > 0 && (feet < boss.y + 40 || (p.prevBottom !== undefined && p.prevBottom <= boss.y + 12));
        if (onTop) {
            p.y = boss.y - p.h;
            if (boss.takeDamage(this.particles)) {
                p.vy = CONFIG.BOUNCE_FORCE;
                sounds.play('jump');
            } else {
                p.vy = CONFIG.JUMP_FORCE; // still flashing: a harmless hop
            }
            return;
        }
        if (p.activePower === POWERS.ROCKET || p.activePower === POWERS.SHIELD) {
            const color = p.activePower.color;
            p.activePower = null;
            p.powerTimer = 0;
            p.invuln = 45;
            this.knockBackFrom(boss);
            this.particles.spawn(p.x, p.y, color, 20, "blast");
            sounds.play('powerup');
            return;
        }
        if (boss.isExposed()) {
            p.invuln = 30;
            this.knockBackFrom(boss);
            sounds.play('hit');
            return;
        }
        this.die(true);
    }

    knockBackFrom(boss) {
        const p = this.player;
        p.vx = (p.x + p.w / 2 < boss.x + boss.w / 2) ? -9 : 9;
        p.vy = -6;
    }

    // Boss down: bonus distance on the scoreboard (not the camera, so
    // biomes don't skip and co-op stays aligned), a gem bounty, and the next
    // boss a full loop further on.
    onBossDefeated() {
        this.state.bossActive = false;
        this.state.runLoops = (this.state.runLoops || 0) + 1;
        this.state.loops = (this.state.loops || 0) + 1;
        localStorage.setItem('lp_loops', this.state.loops);
        this.state.bonusScore += BOSS_BONUS_METERS * 10;
        this.addShards(BOSS_GEM_BOUNTY);
        this.state.nextBossAt = Math.floor(this.state.score / 10) + CONFIG.BOSS_LOOP_DISTANCE;
        this.showAlert(`TITAN DOWN  +${BOSS_BONUS_METERS}m  +${BOSS_GEM_BOUNTY} 💎`, 'reward');
        sounds.play('powerup');
    }

    // Banks gems and pops the counter.
    addShards(n) {
        this.state.shards += n;
        if (this.state.running) this.state.runGems = (this.state.runGems || 0) + n;
        localStorage.setItem('lp_shards', this.state.shards);
        if (this.ui.shardDisplay) {
            this.ui.shardDisplay.innerText = fmtNum(this.state.shards) + " 💎";
            this.ui.shardDisplay.classList.remove('gem-pop');
            void this.ui.shardDisplay.offsetWidth; // restart animation on rapid pickups
            this.ui.shardDisplay.classList.add('gem-pop');
        }
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
        // Spawn/animation clocks in 60fps-frame units of game time (see
        // tick()), so pacing is the same at 60, 120 or 144Hz.
        this.state.timers = { drone: 0, laser: 0, meteor: 0, trail: 0, sync: 0 };
        this.state.revived = false;
        // Multiplayer passes an explicit shared seed so host/guest generate
        // identical platform layouts; single-player falls back to the daily seed.
        this.state.seed = seed !== null ? seed : this.getDailySeed();
        // state.seed is the running RNG state from here on; these two are
        // what identify the layout (for the ghost).
        this.state.runSeed = this.state.seed;
        this.state.startMeters = Math.floor(this.state.score / 10);
        // Bosses beaten this run (drives drone difficulty) and where the next
        // one appears. Measured from the start height, so a checkpoint start
        // (The Void, 5000m) doesn't open straight into a boss.
        this.state.runLoops = 0;
        this.state.nextBossAt = this.state.startMeters + CONFIG.BOSS_LOOP_DISTANCE;
        this.state.powersCollected = 0;
        this.state.isNewBest = false;
        this.state.paused = false;
        // Run summary counters (end-of-run card and lifetime stats).
        this.state.runGems = 0;
        this.state.runDeaths = 0;
        this.state.runUnlocks = [];
        // Solo runs race (and record) a ghost of the day's best run on this
        // exact layout; co-op has none.
        this.ghostRec = this.state.multiplayer ? null : { nextT: 0, pts: [] };
        this.ghostPlayback = this.state.multiplayer ? null : this.loadGhost();

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

        // Pickups are cleared *before* the first screen of platforms is built,
        // or the shards and power-ups spawned on it would be thrown away.
        this.powerups = [];
        this.enemies = [];
        this.projectiles = [];

        this.platforms = [{ x: 0, y: CONFIG.HEIGHT - 40, w: CONFIG.WIDTH, h: 40 }];
        // World y of the next platform to generate (screen y = wy + score).
        // An integer counter, so every co-op client derives identical heights.
        this.state.nextPlatWY = (CONFIG.HEIGHT - 140) - this.state.score;
        this.fillPlatforms();
        this.particles = new ParticleSystem();
        this.particles.scale = this.settings.reducedMotion ? 0.35 : 1;
        this.safetyNet = this.makeSafetyNetState();
        this.remotePlayers = new Map();

        this.ui.power.style.opacity = 0;
        this.hideAlert();
    }

    // Level generation. Everything a platform (and its pickup) gets is decided
    // by its own world height `wy` (screen y minus score; more negative is
    // higher) plus the seeded RNG, never by the camera. Co-op clients whose
    // cameras lag each other therefore still build identical levels.
    // seededRandom() is reserved for this: any other draw would desync them.
    spawnPlatform(wy) {
        const y = wy + this.state.score;
        let rand = this.seededRandom();
        let w = 100 + rand * 80;
        let x = this.seededRandom() * (CONFIG.WIDTH - w);
        let scoreMeters = Math.max(0, Math.floor(-wy / 10));
        let hazards = biomeAt(scoreMeters).hazards;

        let vx = 0;
        if (hazards.includes('moving')) {
            let movingChance = Math.max(0, Math.min(0.4, (scoreMeters - 1800) / 2000));
            if (this.seededRandom() < movingChance) {
                vx = (this.seededRandom() > 0.5 ? 1 : -1) * (0.5 + this.seededRandom() * 1.5);
                w = Math.max(70, w - 30);
            }
        }

        this.platforms.push({ x, y, w, h: 18, vx, wy });

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

    // Keeps platforms generated up to PLATFORM_LOOKAHEAD above the screen, so
    // none ever pops into view, in strict height order.
    fillPlatforms() {
        while (this.state.nextPlatWY + this.state.score > -PLATFORM_LOOKAHEAD) {
            this.spawnPlatform(this.state.nextPlatWY);
            this.state.nextPlatWY -= CONFIG.PLATFORM_BASE_GAP;
        }
    }

    // Game-time interval timer: true once per `every` frames' worth of dt
    // (60fps units) regardless of refresh rate. A long frame fires it once,
    // never as a burst of catch-up spawns.
    tick(name, dt, every) {
        const t = this.state.timers || (this.state.timers = {});
        t[name] = (t[name] || 0) + dt;
        if (t[name] < every) return false;
        t[name] = Math.min(t[name] - every, every);
        return true;
    }

    // Today's ghost for this exact layout, or null. A ghost recorded on
    // another day, from another start height or by an older level generator
    // would just wander through thin air.
    loadGhost() {
        const g = loadJSON('lp_ghost', null);
        if (!g || g.v !== 2 || g.gen !== PLATFORM_GEN_VERSION) return null;
        if (g.seed !== this.state.runSeed || g.start !== this.state.startMeters) return null;
        if (!Array.isArray(g.pts) || !(g.step > 0)) return null;
        return g;
    }

    // Samples the player on a fixed game-time cadence (every GHOST_STEP
    // frames of dt), so playback speed doesn't depend on the refresh rate.
    recordGhost() {
        const rec = this.ghostRec;
        if (!rec) return;
        while (this.state.time >= rec.nextT && rec.pts.length < GHOST_MAX_POINTS * 2) {
            rec.pts.push(Math.round(this.player.x), Math.round(this.player.y - this.state.score));
            rec.nextT += GHOST_STEP;
        }
    }

    // Keeps the best solo run of the day on this layout.
    saveGhost(finalScore) {
        const rec = this.ghostRec;
        if (!rec || this.state.multiplayer || rec.pts.length < 4) return;
        const stored = this.loadGhost();
        if (stored && stored.score >= finalScore) return;
        const ghost = {
            v: 2, gen: PLATFORM_GEN_VERSION, seed: this.state.runSeed, start: this.state.startMeters,
            score: finalScore, step: GHOST_STEP, pts: rec.pts
        };
        try { localStorage.setItem('lp_ghost', JSON.stringify(ghost)); } catch (e) { /* storage full: keep the old one */ }
    }

    drawGhost() {
        const g = this.ghostPlayback;
        if (!g) return;
        const f = this.state.time / g.step;
        const i = Math.floor(f);
        if (i * 2 + 3 >= g.pts.length) return; // the recorded run is over
        let x = g.pts[i * 2], y = g.pts[i * 2 + 1];
        const nx = g.pts[i * 2 + 2], ny = g.pts[i * 2 + 3];
        // Interpolate between samples, except across a screen wrap.
        if (Math.abs(nx - x) < 300) {
            x += (nx - x) * (f - i);
            y += (ny - y) * (f - i);
        }
        const screenY = y + this.state.score;
        if (screenY > -50 && screenY < CONFIG.HEIGHT + 50) {
            this.renderer.ctx.globalAlpha = 0.3;
            this.renderer.ctx.fillStyle = "#ffffff";
            this.renderer.ctx.fillRect(x, screenY, 26, 26);
            this.renderer.ctx.globalAlpha = 1;
        }
    }

    // Moves the camera up by `diff` px: everything on screen shifts down,
    // anything that fell far below is culled, and new platforms are generated.
    scrollCamera(diff, perks = this.player.skin.ability || {}) {
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
        this.enemies.forEach(e => { if (e.shiftY) e.shiftY(diff); else e.y += diff; });
        this.projectiles.forEach(p => p.y += diff);
        this.particles.particles.forEach(p => p.y += diff);

        this.platforms = this.platforms.filter(p => p.y < CONFIG.HEIGHT + 100);
        this.powerups = this.powerups.filter(p => p.y < CONFIG.HEIGHT + 100);
        // Drones circle back instead of leaving, so cull the ones left below.
        this.enemies = this.enemies.filter(e => e instanceof BossDrone || e.y < CONFIG.HEIGHT + 100);

        this.fillPlatforms();
    }

    startGame(isMp = false, mpSeed = null) {
        // Whatever menu button had focus must not catch the Space/Enter that
        // follows (buttons activate on keyup), and keys held in the menu
        // shouldn't carry into the run.
        if (typeof document !== 'undefined' && document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
        this.input.resetInput();
        this.closeRunCard();
        this.closeSettings();
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
        this.state.pausedMs = 0;
        this.pauseStartedAt = 0;
        this.showControlsHint();
        this.updateTouchControls();
        this.startChallenge();
    }

    // ------------------------------------------------------- touch controls
    // Lays the (visual-only) pads over the canvas, which is letterboxed
    // inside the screen.
    layoutTouchControls() {
        const tc = this.ui.touchControls;
        const canvas = this.renderer.canvas;
        if (!tc || !canvas || !canvas.getBoundingClientRect || !canvas.parentElement) return;
        const c = canvas.getBoundingClientRect();
        const box = canvas.parentElement.getBoundingClientRect();
        tc.style.left = (c.left - box.left) + 'px';
        tc.style.top = (c.top - box.top) + 'px';
        tc.style.width = c.width + 'px';
        tc.style.height = c.height + 'px';
    }

    // Pads show on touch screens during a live, unpaused run (unless turned
    // off in Settings; the invisible zones keep working either way).
    updateTouchControls() {
        if (!this.ui.touchControls) return;
        const show = this.coarsePointer && this.settings.touchControls && this.state.running && !this.pauseMenuOpen;
        this.ui.touchControls.hidden = !show;
        this.touchPadsShown = show;
    }

    // Lights up the pads being pressed.
    updateTouchPadStates() {
        if (!this.touchPadsShown) return;
        const keys = this.input.keys;
        const want = { left: keys.left, right: keys.right, jump: keys.buffer > 0 };
        const last = this.touchPadLast || (this.touchPadLast = {});
        for (const k of ['left', 'right', 'jump']) {
            const pad = this.touchPads[k];
            if (pad && last[k] !== want[k]) {
                pad.classList.toggle('is-active', want[k]);
                last[k] = want[k];
            }
        }
    }

    // --------------------------------------------------------- gem sprite
    // The pickup gem, drawn once (with its glow) into an offscreen canvas at
    // screen density. Drawing emoji text with shadowBlur every frame was the
    // most expensive thing on the screen for phones.
    makeGemSprite() {
        const size = 40;
        const dpr = this.renderer.dpr || 1;
        const c = document.createElement('canvas');
        c.width = size * dpr;
        c.height = size * dpr;
        const ctx = c.getContext && c.getContext('2d');
        if (!ctx) return null;
        if (ctx.scale) ctx.scale(dpr, dpr);
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#00ffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '18px sans-serif';
        ctx.fillText('💎', size / 2, size / 2);
        return { canvas: c, size };
    }

    // ---------------------------------------------------- challenge links
    startChallenge() {
        const ch = this.challenge;
        const active = this.challengeActive();
        this.state.challengeBeaten = false;
        if (!this.ui.challengeHud) return;
        this.ui.challengeHud.hidden = !active;
        if (active) {
            this.ui.challengeHud.classList.remove('beaten');
            this.ui.challengeHud.innerText = 'TARGET ' + fmtNum(ch.meters) + 'm';
        }
    }

    // Only a normal solo start on today's layout: a checkpoint start (The
    // Void begins at 5000m) is a different climb and would pass most targets
    // before the first jump.
    challengeActive() {
        return !!this.challenge && !this.state.multiplayer && this.state.runSeed === this.getDailySeed()
            && !this.state.startMeters;
    }

    // A dashed gold line at the height where the displayed score reaches
    // the target (the player crosses it at the camera line).
    drawChallengeLine() {
        if (!this.challengeActive() || this.state.challengeBeaten) return;
        const ctx = this.renderer.ctx;
        const y = CONFIG.HEIGHT * CONFIG.SCROLL_THRESHOLD - (this.challenge.meters * 10 - (this.state.score + (this.state.bonusScore || 0)));
        if (y < -20 || y > CONFIG.HEIGHT + 20) return;
        ctx.save();
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        if (ctx.setLineDash) ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CONFIG.WIDTH, y);
        ctx.stroke();
        ctx.restore();
        this.renderer.drawText('TARGET ' + fmtNum(this.challenge.meters) + 'm', CONFIG.WIDTH - 8, y - 6, 'bold 12px Orbitron, sans-serif', '#ffd700', 'right');
    }

    // ---------------------------------------------------------------- share
    // The link a shared run points at: today's challenge for a solo daily
    // run, the plain game otherwise.
    shareUrl(run) {
        const base = (typeof location !== 'undefined' && /^https?:$/.test(location.protocol || ''))
            ? location.origin + location.pathname
            : SITE_URL;
        if (!run.multiplayer && !run.start && run.seed === this.getDailySeed() && run.score > 0) {
            return base + '?beat=' + run.score + '&d=' + run.seed;
        }
        return base;
    }

    // Web Share with a score-card image where the platform supports files,
    // then plain Web Share, then copying the link.
    async shareRun() {
        const run = this.lastRun;
        if (!run) return;
        const url = this.shareUrl(run);
        const text = run.multiplayer
            ? `Our party climbed ${fmtNum(run.score)}m in Pixel Jump co-op!`
            : `I climbed ${fmtNum(run.score)}m in today's Pixel Jump. Can you beat it?`;
        const nav = typeof navigator !== 'undefined' ? navigator : {};
        try {
            if (nav.share && nav.canShare && typeof File !== 'undefined') {
                const blob = await this.renderShareImage(run);
                const file = blob && new File([blob], 'pixel-jump-run.png', { type: 'image/png' });
                if (file && nav.canShare({ files: [file] })) {
                    await nav.share({ files: [file], text: text + ' ' + url });
                    return;
                }
            }
            if (nav.share) {
                await nav.share({ title: 'Pixel Jump', text, url });
                return;
            }
            if (nav.clipboard && nav.clipboard.writeText) {
                await nav.clipboard.writeText(text + ' ' + url);
                this.showShareToast('LINK COPIED!');
                return;
            }
        } catch (e) {
            if (e && e.name === 'AbortError') return; // closed the share sheet
        }
        this.showShareToast(url);
    }

    showShareToast(text) {
        const t = this.ui.shareToast;
        if (!t) return;
        t.innerText = text;
        t.hidden = false;
        clearTimeout(this.shareToastTimer);
        this.shareToastTimer = setTimeout(() => { t.hidden = true; }, 4000);
    }

    // A 1080x1080 score card for sharing: title, distance, the Pixel, biome
    // and date. Resolves to a PNG blob (or null where canvases can't export).
    renderShareImage(run) {
        return new Promise(resolve => {
            const S = 1080;
            const c = document.createElement('canvas');
            c.width = S; c.height = S;
            const ctx = c.getContext && c.getContext('2d');
            if (!ctx || !c.toBlob) { resolve(null); return; }

            ctx.fillStyle = '#050505';
            ctx.fillRect(0, 0, S, S);
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i <= S; i += 60) {
                ctx.moveTo(i, 0); ctx.lineTo(i, S);
                ctx.moveTo(0, i); ctx.lineTo(S, i);
            }
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.shadowColor = '#c04dff';
            ctx.shadowBlur = 30;
            ctx.fillStyle = '#ffffff';
            ctx.font = '900 96px Orbitron, sans-serif';
            ctx.fillText('PIXEL JUMP', S / 2, 170);

            ctx.shadowColor = 'rgba(255,255,255,0.6)';
            ctx.shadowBlur = 24;
            ctx.font = '900 170px Orbitron, sans-serif';
            ctx.fillText(fmtNum(run.score) + 'm', S / 2, 430);
            ctx.shadowBlur = 0;

            ctx.font = '700 40px Orbitron, sans-serif';
            ctx.fillStyle = run.newBest ? '#ffd700' : '#8c8c8c';
            ctx.fillText(run.newBest ? '★ NEW BEST ★' : (run.multiplayer ? 'CO-OP RUN' : "TODAY'S DAILY RUN"), S / 2, 510);

            // The Pixel, at the in-game proportions (26px body, 5px eyes).
            const k = 8, px = S / 2 - 13 * k, py = 590;
            ctx.shadowColor = run.color;
            ctx.shadowBlur = 40;
            ctx.fillStyle = run.color;
            ctx.fillRect(px, py, 26 * k, 26 * k);
            ctx.shadowBlur = 0;
            ctx.fillStyle = run.eye;
            ctx.fillRect(px + 5 * k, py + 7 * k, 5 * k, 5 * k);
            ctx.fillRect(px + 16 * k, py + 7 * k, 5 * k, 5 * k);

            ctx.fillStyle = '#ffffff';
            ctx.font = '700 44px Orbitron, sans-serif';
            ctx.fillText(run.skinName.toUpperCase(), S / 2, 870);
            ctx.fillStyle = '#00ffff';
            ctx.font = '700 34px Orbitron, sans-serif';
            ctx.fillText(run.biome.toUpperCase() + ' · ' + run.date, S / 2, 930);
            ctx.fillStyle = '#8c8c8c';
            ctx.font = '700 30px Orbitron, sans-serif';
            ctx.fillText(SITE_URL.replace(/^https:\/\//, '').replace(/\/$/, ''), S / 2, 1030);

            c.toBlob(blob => resolve(blob), 'image/png');
        });
    }

    die(forceDie = false) {
        // Two hits in the same frame after the last life is spent must not
        // end the run twice (double Hall of Fame entry, two interstitials).
        if (!this.state.running) return;
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

        this.state.runDeaths = (this.state.runDeaths || 0) + 1;

        // Equipped Pixel's free revive: a bonus life on top of (not instead
        // of) the normal one-ad-revive-per-run flow below.
        const equippedAbility = this.player.skin.ability || {};
        if (equippedAbility.extraRevive && !this.state.usedExtraRevive) {
            this.state.usedExtraRevive = true;
            this.player.y = CONFIG.HEIGHT - 200;
            this.player.launch(CONFIG.BOUNCE_FORCE);
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
            this.player.launch(CONFIG.BOUNCE_FORCE);
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
        this.updateTouchControls(); // not over a revive prompt

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
        this.state.runDeaths = (this.state.runDeaths || 0) + 1;

        if (window.network) {
            window.network.send({ type: 'die', pid: window.network.myId });
        }

        this.checkAllDead();

        if (this.state.running) {
            this.state.deathCount = (this.state.deathCount || 0) + 1;
            this.startRespawnTimer();
        }
    }

    // A teammate whose updates stopped (tab in the background, frozen
    // browser) is "away": after REMOTE_AWAY_FRAMES they no longer steer the
    // camera or the invisible ceiling, and after REMOTE_GONE_FRAMES they count
    // as down, so a frozen avatar can't hold everyone else in place or keep a
    // finished run alive forever.
    remoteAway(rp) {
        return this.state.time - (rp.lastSeenT || 0) > REMOTE_AWAY_FRAMES;
    }

    remoteDown(rp) {
        return rp.isDead || this.state.time - (rp.lastSeenT || 0) > REMOTE_GONE_FRAMES;
    }

    // Anyone else still in the run (alive, and not gone quiet).
    anyRemoteAlive() {
        for (const rp of this.remotePlayers.values()) {
            if (!this.remoteDown(rp)) return true;
        }
        return false;
    }

    // Anyone else actively playing right now (for the camera and ceiling).
    anyRemoteActive() {
        for (const rp of this.remotePlayers.values()) {
            if (!rp.isDead && !this.remoteAway(rp)) return true;
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
        // Keys pressed while waiting (mashing through the prompt) must not
        // fire the moment play resumes.
        this.input.resetInput();
        this.player.isDead = false;
        const anchor = [...this.remotePlayers.values()].find(rp => !rp.isDead);
        if (anchor) {
            this.player.y = anchor.y - 100;
            this.player.x = anchor.x;
        } else {
            this.player.y = CONFIG.HEIGHT - 200;
        }
        this.player.launch(0);

        if (window.network) window.network.send({ type: 'revive', pid: window.network.myId });
        const boost = this.phoenixBoost();
        this.showAlert("LIFE RESTORED" + (boost ? " + " + boost : ""), 'success');
    }

    revive() {
        this.state.revived = true;
        this.state.running = true;
        // Keys pressed on the revive prompt (Space on WATCH AD, mashing)
        // must not turn into a jump that overrides the revive bounce.
        this.input.resetInput();
        this.lastTime = performance.now();

        this.player.y = CONFIG.HEIGHT - 200;
        this.player.launch(CONFIG.BOUNCE_FORCE);

        this.platforms.push({ x: 0, y: CONFIG.HEIGHT - 20, w: CONFIG.WIDTH, h: 20 });

        const boost = this.phoenixBoost();
        this.showAlert("LIFE RESTORED" + (boost ? " + " + boost : ""), 'success');
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
        this.closePauseUI();
        this.hideControlsHint();
        this.recordRunStats(Math.max(0, Math.floor(this.state.score / 10) - (this.state.startMeters || 0)));

        // Don't leave a half-retracted net hanging over the menu.
        this.safetyNet = this.makeSafetyNetState();

        this.saveGhost(finalScore);
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

        this.ui.menuLast.innerText = "LAST RUN: " + fmtNum(finalScore) + "m";
        this.ui.menuLast.hidden = false;
        this.ui.menuScore.innerText = "HIGH SCORE: " + fmtNum(this.state.highScore) + "m";
        this.updateFameUI();
        this.updateSkinUI();
        this.renderGemShop();
        this.updateExtraLifeUI();
        const skin = SKINS[this.viewParams.skinIndex] || SKINS[0];
        const seed = String(this.state.runSeed);
        this.lastRun = {
            score: finalScore,
            newBest: !!this.state.isNewBest,
            multiplayer: this.state.multiplayer,
            seed: this.state.runSeed,
            start: this.state.startMeters || 0,
            biome: this.renderer.currentBiome.name,
            skinName: skin.name, color: skin.color, eye: skin.eye,
            date: /^\d{8}$/.test(seed) ? `${seed.slice(0, 4)}-${seed.slice(4, 6)}-${seed.slice(6)}` : new Date().toISOString().slice(0, 10)
        };
        if (this.ui.shareToast) this.ui.shareToast.hidden = true;
        this.updateTouchControls();
        if (this.ui.challengeHud) this.ui.challengeHud.hidden = true;
        this.showRunCard(finalScore);
    }

    loadFame() {
        return loadJSON('lp_fame', [], v => Array.isArray(v))
            .filter(f => f && typeof f === 'object' && Number.isFinite(f.score));
    }

    updateFame(score) {
        let fame = this.loadFame();
        const skin = SKINS[this.viewParams.skinIndex];
        fame.push({ score, skin: skin.name, skinId: skin.id, date: new Date().toLocaleDateString() });
        fame.sort((a, b) => b.score - a.score);
        fame = fame.slice(0, 5);
        localStorage.setItem('lp_fame', JSON.stringify(fame));
    }

    updateFameUI() {
        let fame = this.loadFame();

        if (!fame.length) {
            this.ui.fame.innerHTML = `<div class="fame-empty">NO RUNS YET — SET A RECORD</div>`;
            return;
        }

        this.ui.fame.innerHTML = fame.map((f, i) => {
            // Newer entries store the skin id; older ones only its name. A
            // renamed or removed skin falls back to the neutral swatch colour.
            const skin = SKINS.find(s => s.id === f.skinId) || SKINS.find(s => s.name === f.skin);
            const swatch = skin ? ` style="background:${skin.color}"` : '';
            const name = skin ? skin.name : String(f.skin || '???');
            return `<div class="fame-row fame-row--${i + 1}">
                <div class="fame-rank">${i + 1}</div>
                <div class="fame-swatch"${swatch}></div>
                <div class="fame-skin">${this.escapeHtml(name)}</div>
                <div class="fame-date">${this.escapeHtml(f.date || '')}</div>
                <div class="fame-score">${fmtNum(Math.floor(f.score))}m</div>
            </div>`;
        }).join('');
    }

    checkAchievements() {
        ACHIEVEMENTS.forEach(g => {
            if (g.condition(this.state, this.player) && !this.achievements.includes(g.id)) {
                this.achievements.push(g.id);
                localStorage.setItem('lp_achievements', JSON.stringify(this.achievements));
                const label = g.skin ? "PIXEL UNLOCKED: " + g.name : g.name;
                if (this.state.running && this.state.runUnlocks) this.state.runUnlocks.push((g.skin ? "🎨 " : "🏅 ") + label);
                this.showAchievement(label, g.skin ? "🎨" : "🏅");
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
        if (!this.state.running || this.state.paused) return;

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

        this.recordGhost();

        // Boss fights: one every BOSS_LOOP_DISTANCE metres of this run. It
        // drops in from above the screen.
        if (!this.state.bossActive && scoreMeters >= this.state.nextBossAt) {
            this.state.bossActive = true;
            this.enemies.push(new BossDrone(-120));
        }

        // Spawn Enemies (only if Boss isn't active)
        if (!this.state.bossActive && scoreMeters > 60 && this.tick('drone', dt, Math.max(60, Math.floor(droneSpawnRate - (scoreMeters / 100))))) {
            const difficulty = 1 + (scoreMeters / 2000) + (this.state.runLoops || 0);

            if (scoreMeters > 300 && Math.random() < Math.min(0.5, (scoreMeters - 300) / 2400)) {
                this.enemies.push(new ShooterDrone(this.player.y - 500, difficulty));
            } else {
                this.enemies.push(new Drone(this.player.y - 500, difficulty));
            }
        }

        if (!this.state.bossActive && hazards.includes('laser') && this.tick('laser', dt, 240)) {
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

        this.player.prevBottom = this.player.y + this.player.h;
        // A dead co-op player's body is gone until they respawn: no physics,
        // no landing on platforms, no pickups.
        let event = this.player.isDead ? null : this.player.update(dt, this.input, this.platforms, this.powerups);

        if (glitching) {
            const tmp = this.input.keys.left;
            this.input.keys.left = this.input.keys.right;
            this.input.keys.right = tmp;
        }

        // Invisible ceiling in multiplayer so the fast player doesn't go off screen
        if (this.state.multiplayer && !this.player.isDead && this.anyRemoteActive()) {
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
        if (hazards.includes('meteor') && this.tick('meteor', dt, 90)) {
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
            // They've got the idea: let the first-run hint go shortly.
            if (this.hintShowing) {
                clearTimeout(this.hintTimer);
                this.hintTimer = setTimeout(() => this.hideControlsHint(), 2000);
            }
        } else if (event === "double_jump") {
            this.particles.spawn(this.player.x + 13, this.player.y + 26, POWERS.DOUBLE.color);
            sounds.play('jump');
        } else if (event === "trail") {
            if (this.tick('trail', dt, 2))
                this.particles.spawn(this.player.x + 13, this.player.y + 13, this.player.color, 1, "trail");
        } else if (event === "thrust") {
            this.particles.spawn(this.player.x + 13, this.player.y + 26, "#ff3300", 2, "blast");
        } else if (event && event.event === "shard") {
            this.addShards((event.value || 1) * (perks.shardMult || 1));
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
            } else if (e instanceof BossDrone) {
                e.update(enemyDt, this.bossFocus(), this.projectiles);
            } else {
                e.update(enemyDt);
            }

            if (e.markedForDeletion) {
                if (e instanceof BossDrone) this.onBossDefeated();
                this.enemies.splice(i, 1);
                continue;
            }
            if (e.hidden || this.player.invuln > 0 || this.player.isDead) continue;
            if (rectsIntersect(this.player, e)) {
                if (e instanceof BossDrone) {
                    this.resolveBossContact(e);
                    continue;
                }
                // Crashing with the jetpack just burns it out (and the drone).
                if (this.player.activePower === POWERS.ROCKET) {
                    this.player.activePower = null;
                    this.player.powerTimer = 0;
                    e.markedForDeletion = true;
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

        // Position sync at 30Hz of game time (not per rendered frame, which
        // would be 2.4x the traffic on a 144Hz screen).
        if (this.state.multiplayer && !this.player.isDead && this.tick('sync', dt, 2)) {
            const r = v => Math.round(v * 10) / 10;
            window.network.send({
                type: 'sync',
                pid: window.network.myId,
                x: r(this.player.x),
                y: r(this.player.y - this.state.score),
                vx: r(this.player.vx),
                vy: r(this.player.vy),
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
            this.remotePlayers.forEach(rp => { if (!rp.isDead && !this.remoteAway(rp)) aliveYs.push(rp.y); });
            targetY = aliveYs.length ? Math.max(...aliveYs) : threshold + 1; // everyone dead: no scroll
        }

        if (targetY < threshold) this.scrollCamera(threshold - targetY, perks);

        if (!this.player.isDead && this.player.y > CONFIG.HEIGHT) {
            this.die();
        }

        const heightMeters = Math.floor(this.state.score / 10);
        if (heightMeters > this.state.bestHeight) {
            this.state.bestHeight = heightMeters;
            localStorage.setItem('lp_best_height', heightMeters);
        }

        // Story beats: a short SYSTEM line as each height is first passed.
        if (this.storyIndex < STORY.length && heightMeters >= STORY[this.storyIndex].h) {
            this.showAlert(STORY[this.storyIndex].t, 'info');
            this.storyIndex++;
        }

        // Dead and waiting to respawn while the rest of the party went quiet:
        // end the run rather than wait forever.
        if (this.state.multiplayer && this.player.isDead && !this.anyRemoteAlive()) {
            this.checkAllDead();
            if (!this.state.running) return;
        }

        let displayScore = this.runScore();
        if (displayScore > this.state.maxScore) this.state.maxScore = displayScore;
        if (!this.state.challengeBeaten && this.challengeActive() && displayScore >= this.challenge.meters) {
            this.state.challengeBeaten = true;
            this.showAlert("TARGET BEATEN!", 'reward');
            if (this.ui.challengeHud) {
                this.ui.challengeHud.innerText = 'TARGET ' + fmtNum(this.challenge.meters) + 'm ✓';
                this.ui.challengeHud.classList.add('beaten');
            }
        }
        this.updateTouchPadStates();
        if (displayScore > this.state.highScore) {
            this.state.highScore = displayScore;
            localStorage.setItem('lp_best', this.state.highScore);
            this.state.isNewBest = true;
        }

        this.ui.score.innerText = fmtNum(displayScore) + "m";
        this.ui.best.innerText = "BEST: " + fmtNum(this.state.highScore) + "m";

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
                // Same 💎 as the gem counter, pre-rendered with its glow;
                // the pulse is just the sprite's opacity.
                const ctx = this.renderer.ctx;
                const sprite = this.gemSprite;
                if (sprite) {
                    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(this.state.time * 0.3);
                    ctx.drawImage(sprite.canvas, p.x + p.w / 2 - sprite.size / 2, p.y + p.h / 2 - sprite.size / 2, sprite.size, sprite.size);
                    ctx.globalAlpha = 1;
                } else {
                    ctx.save();
                    ctx.textBaseline = "middle";
                    this.renderer.drawText("💎", p.x + p.w / 2, p.y + p.h / 2, "18px sans-serif", "#fff");
                    ctx.restore();
                }
            } else {
                let hue = (this.state.time * 5) % 360;
                this.renderer.drawRect(p.x, p.y, p.w, p.h, `hsl(${hue}, 100%, 50%)`, { blur: 15, color: `hsl(${hue}, 100%, 50%)` });
                this.renderer.drawText("?", p.x + p.w / 2, p.y + p.h - 6, "bold 16px Courier New", "#000");
            }
        });

        this.enemies.forEach(e => e.draw(this.renderer.ctx));
        this.projectiles.forEach(p => p.draw(this.renderer.ctx));

        if (this.state.running && this.settings.showGhost) this.drawGhost();
        if (this.state.running) this.drawChallengeLine();

        this.renderer.drawSafetyNet(this.safetyNet, POWERS.SAFETY.color, this.state.time);

        if (!this.player.isDead) this.player.draw(this.renderer.ctx);

        if (this.state.multiplayer && this.remotePlayers.size > 0) {
            // Name tags in each player's party-slot colour.
            this.remotePlayers.forEach(rp => {
                if (rp.isDead) return;
                const away = this.remoteAway(rp);
                if (away) this.renderer.ctx.globalAlpha = 0.35;
                rp.draw(this.renderer.ctx);
                this.renderer.drawText((rp.name || 'PLAYER') + (away ? ' (AWAY)' : ''), rp.x + 13, rp.y - 10, "10px Courier New", PARTY_COLORS[rp.slot] || "#00ffcc");
                this.renderer.ctx.globalAlpha = 1;
            });
            if (!this.player.isDead) {
                const me = this.party.find(m => m.pid === window.network.myId);
                this.renderer.drawText(this.getMpName(), this.player.x + 13, this.player.y - 10, "10px Courier New", me ? PARTY_COLORS[me.slot] : "#fff");
            }
        }

        this.particles.draw(this.renderer.ctx);
    }

    loop(timestamp) {
        if (!this.lastTime || this.state.paused) this.lastTime = timestamp;
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        // performance.now() (reset on revive) and the rAF timestamp can
        // disagree by a hair, so clamp at 0 as well as capping long frames.
        let dt = Math.max(0, deltaTime) / (1000 / 60);
        if (dt > 4) dt = 4;

        this.update(dt);
        this.draw();
        requestAnimationFrame(this.loop);
    }
}

window.onload = () => {
    new Game();

    // Installable / offline play. Only on the live https site (or a local
    // server opened with ?sw), so local development never serves stale
    // cached files.
    const wantSW = location.protocol === 'https:' || new URLSearchParams(location.search).has('sw');
    if (wantSW && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
    }
};
