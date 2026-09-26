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

// On phones and tablets the game only runs as an installed app (full screen,
// no browser bars). installPlatform() says which install steps to show:
// 'ios' (iPhone, iPad, iPod; iPadOS Safari poses as a Mac, but Macs have no touch),
// 'android' (phones and tablets), or null for desktops.
function installPlatform(nav) {
    const ua = (nav && nav.userAgent) || '';
    if (/iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 0)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return null;
}

// True for a phone or tablet browser tab; false once running as the app.
function needsHomeScreenInstall(nav, win) {
    if (!installPlatform(nav) || nav.standalone) return false;
    try {
        if (win && typeof win.matchMedia === 'function' &&
            (win.matchMedia('(display-mode: standalone)').matches || win.matchMedia('(display-mode: fullscreen)').matches)) return false;
    } catch (e) { /* no matchMedia: treat as a tab */ }
    return true;
}

// Only Safari offers Add to Home Screen reliably; Chrome, Firefox and the
// browsers inside other apps (no "Safari/" token) are sent to Safari first.
function isIOSNonSafari(ua) {
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua || '') || !/Safari\//.test(ua || '');
}

// Browsers inside other apps (Instagram, Facebook, TikTok, Snapchat, other
// WebViews) can't install anything, so Android players are sent to Chrome.
function isAndroidInAppBrowser(ua) {
    return /; wv\)|FBAN|FBAV|Instagram|musical_ly|Bytedance|Snapchat|Line\/|Twitter/.test(ua || '');
}

// Chrome, Edge and Samsung Internet offer a one-tap install through
// beforeinstallprompt. It can fire before the game exists, so it's caught
// here and handed over. Desktop browsers keep their own install UI.
const installPrompt = { event: null, onReady: null, onInstalled: null };
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeinstallprompt', (e) => {
        if (!needsHomeScreenInstall(typeof navigator !== 'undefined' ? navigator : null, window)) return;
        e.preventDefault();
        installPrompt.event = e;
        if (installPrompt.onReady) installPrompt.onReady();
    });
    window.addEventListener('appinstalled', () => {
        installPrompt.event = null;
        if (installPrompt.onInstalled) installPrompt.onInstalled();
    });
}

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
            gems: parseInt(localStorage.getItem('lp_gems') ?? localStorage.getItem('lp_shards')) || 0,
            loops: parseInt(localStorage.getItem('lp_loops')) || 0,
            skinIndex: Math.max(0, skinIndexById(localStorage.getItem('lp_skin'))),
            hearts: parseInt(localStorage.getItem('lp_hearts')) || 0,
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
        this.noticeQueue = [];
        this.noticeTimer = null;

        this.seedSkinAchievements();

        this.settings = this.loadSettings();
        this.stats = this.loadStats();
        this.pauseMenuOpen = false;
        this.settingsOpen = false;
        this.runCardOpen = false;

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
            gemDisplay: document.getElementById("gem-display"),
            lifeDisplay: document.getElementById("life-display"),
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

            // Pause, settings, run card, records
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

            // Phones, challenge links and sharing
            touchControls: document.getElementById("touch-controls"),
            installGate: document.getElementById("install-gate"),
            installGateSafari: document.getElementById("install-gate-safari"),
            installGateChrome: document.getElementById("install-gate-chrome"),
            installGateIOS: document.getElementById("install-gate-ios"),
            installGateAndroid: document.getElementById("install-gate-android"),
            installGateBtn: document.getElementById("install-gate-btn"),
            installGateDone: document.getElementById("install-gate-done"),
            setTouch: document.getElementById("set-touch"),
            setTouchRow: document.getElementById("set-touch-row"),
            setTips: document.getElementById("set-tips"),
            challengeHud: document.getElementById("challenge-hud"),
            runShareBtn: document.getElementById("run-share-btn"),
            shareToast: document.getElementById("share-toast"),
            spectateHud: document.getElementById("spectate-hud"),
            mpCodeCopyBtn: document.getElementById("mp-code-copy-btn")
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
                this.updateTouchSettingRow();
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

        // Migration: gems were once called shards and saved as lp_shards.
        if (localStorage.getItem('lp_shards') !== null) {
            if (localStorage.getItem('lp_gems') === null) localStorage.setItem('lp_gems', this.state.gems);
            localStorage.removeItem('lp_shards');
        }

        // Migration: the shop used to sell a one-shot HARD SHIELD boost at the
        // same price as a heart. Anyone still holding an unspent boost
        // gets it converted rather than silently losing what they paid for.
        if (localStorage.getItem('lp_boughtBoost') === '1') {
            localStorage.removeItem('lp_boughtBoost');
            if (this.state.hearts < MAX_HEARTS) {
                this.state.hearts++;
                localStorage.setItem('lp_hearts', this.state.hearts);
            }
        }

        this.applyInstallGate();
        this.bindEvents();
        this.updateSkinUI();
        this.updateFameUI();
        this.renderGemShop();
        this.updateHeartUI();

        this.ui.menuScore.innerText = "HIGH SCORE: " + fmtNum(this.state.highScore) + "m";
        if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
            this.ui.startBtn.innerText = "TAP TO START";
        }
        this.setMenuPanel('sp');
        this.applySettings();
        this.makePickupSprites();
        this.renderer.onResize = () => {
            this.layoutTouchControls();
            this.makePickupSprites();
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
                this.buyHeart();
            };
        }

        // Shop pixel carousel — same left/right stepping as the main-menu skin
        // picker, over just the gems-purchasable skins.
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
            if (this.canMenuKey(e, 'shop')) {
                this.handleShopKey(e);
                return;
            }
            if (!this.canQuickStart(e)) return;
            const role = InputHandler.eventRole(e);
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
                // Warm the relay logins so HOST/JOIN don't wait on them.
                if (window.network && window.network.prefetchRelay) window.network.prefetchRelay();
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

            if (this.ui.mpCodeCopyBtn) {
                this.ui.mpCodeCopyBtn.onclick = (e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    this.shareRoomCode();
                };
            }

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
        // Tapping beside the card closes it, like MENU. A short grace period
        // stops a tap still landing from the run from dismissing it unseen.
        if (this.ui.runCard) this.ui.runCard.onclick = (e) => {
            if (!e || e.target !== this.ui.runCard) return;
            if (performance.now() - (this.runCardOpenedAt || 0) < RUN_CARD_TAP_GRACE_MS) return;
            this.closeRunCard();
        };

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
        setting(this.ui.setTips, 'showTips', el => el.checked);
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
        this.blurFocus();
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
            touchControls: saved.touchControls !== false,
            showTips: saved.showTips !== false
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
        if (this.ui.setTips) this.ui.setTips.checked = s.showTips;
        this.updateTouchSettingRow();
        this.ui.settingsOverlay.hidden = false;
        this.settingsOpen = true;
    }

    // TOUCH BUTTONS only means anything on a touch screen.
    updateTouchSettingRow() {
        if (this.ui.setTouchRow) this.ui.setTouchRow.hidden = !this.coarsePointer;
    }

    closeSettings() {
        this.ui.settingsOverlay.hidden = true;
        this.settingsOpen = false;
        // A slider or checkbox left focused must not swallow the run's keys.
        if (this.state.running) this.blurFocus();
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
        this.runCardOpenedAt = performance.now();
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

    // Keyboard shortcuts only apply on the solo menu itself: never mid-run,
    // never from a held (auto-repeating) key left over from the last run,
    // never while typing, and never under the revive prompt.
    canQuickStart(e) {
        return this.canMenuKey(e, 'sp');
    }

    // The same rules for any menu panel's keys (the solo menu, the shop).
    canMenuKey(e, panel) {
        if (e.repeat || this.state.running) return false;
        if (this.activeMenuPanel !== panel || this.runCardOpen || this.settingsOpen) return false;
        const revive = this.ads && this.ads.reviveOverlay;
        if (revive && revive.style.display === 'flex') return false;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select')) return false;
        return true;
    }

    // Keyboard in the shop: left/right browse the Pixels, Space / Enter
    // presses the framed card's BUY / EQUIP. A focused button handles its own
    // Space / Enter, so that isn't doubled.
    handleShopKey(e) {
        const role = InputHandler.eventRole(e);
        if (role === 'left' || role === 'right') {
            e.preventDefault();
            this.changeGemShopSkin(role === 'left' ? -1 : 1);
            return;
        }
        const press = e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
        const t = e.target;
        if (!press || (t && t.closest && t.closest('button'))) return;
        e.preventDefault();
        const buy = this.ui.gemShop && this.ui.gemShop.querySelector && this.ui.gemShop.querySelector('.gem-skin-buy-btn');
        if (buy && !buy.disabled) buy.click();
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
        // A wrong code comes back quickly as peer-unavailable, so a timeout
        // means the host was found but no direct connection could be made:
        // usually a school or office firewall.
        if (type === 'connection-timeout') return "COULDN'T CONNECT — THIS NETWORK MAY BLOCK CO-OP";
        if (type === 'peer-unavailable') return "CODE NOT FOUND — CHECK & RETRY";
        if (type === 'signaling-timeout') return "CAN'T REACH CO-OP SERVER — NETWORK MAY BLOCK IT";
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

    // COPY CODE: the share sheet on phones, the clipboard elsewhere.
    async shareRoomCode() {
        const code = (window.network && window.network.code) || this.ui.mpPartyCode.innerText;
        const nav = typeof navigator !== 'undefined' ? navigator : {};
        try {
            if (this.coarsePointer && nav.share) {
                await nav.share({ title: 'Pixel Jump', text: `Join my Pixel Jump party! Room code: ${code}`, url: SITE_URL });
                return;
            }
            if (nav.clipboard && nav.clipboard.writeText) {
                await nav.clipboard.writeText(code);
                this.setMpStatus("CODE COPIED — SEND IT TO A FRIEND", 'success');
                return;
            }
        } catch (e) {
            if (e && e.name === 'AbortError') return;
        }
        this.setMpStatus("ROOM CODE: " + code, 'success');
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
            this.notify(`${rp.name || 'A PLAYER'} LEFT`, 'warning');
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
        // World heights (wy) of the pickups they've taken, so a spectator
        // sees the level the way they do.
        rp.picked = new Set();
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
            activePowerId: power ? power.id : null,
            // Share of the power-up's time left (0-1), for the spectate HUD.
            pf: power ? (num(d.pf, 0, 1) || 0) : 0,
            // Hearts banked (decides whether hearts show in their view).
            hl: Number.isInteger(d.hl) ? Math.max(0, Math.min(MAX_HEARTS, d.hl)) : 0
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

        let name = String(data.name || 'PLAYER').toUpperCase().slice(0, 10);
        // Two players called PLAYER become PLAYER and PLAYER 2.
        const taken = new Set(this.party.filter(m => m.pid !== fromId).map(m => m.name));
        for (let n = 2; taken.has(name); n++) {
            const suffix = ' ' + n;
            name = String(data.name || 'PLAYER').toUpperCase().slice(0, 10 - suffix.length) + suffix;
        }
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
            if (!['handshake', 'sync', 'die', 'revive', 'hit', 'stomp', 'pick'].includes(data.type)) return;
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
        } else if (data.type === 'pick') {
            if (!Number.isInteger(data.wy) || Math.abs(data.wy) > 1e8) return;
            data = { type: 'pick', pid: this.state.isHost ? fromId : String(data.pid), wy: data.wy };
        }

        // The host is the hub: relay every guest's gameplay traffic to the
        // rest of the party (a clean copy, stamped with the sender's ID so it
        // can't be spoofed).
        if (this.state.isHost && ['sync', 'die', 'revive', 'pick'].includes(data.type)) {
            net.broadcastExcept(fromId, data);
        }

        if (data.type === 'handshake') {
            this.handleHandshake(data, fromId);
        } else if (data.type === 'handshake_ack') {
            if (this.state.isHost) return;
            if (this.handshakeInterval) clearInterval(this.handshakeInterval);
            this.handshakeInterval = null;
            if (data.v !== NET_PROTOCOL) {
                this.leaveParty(`HOST IS ON AN OLDER VERSION (${data.build || 'OLD'}, YOU ${GAME_VERSION}) — BOTH REFRESH`, 'danger');
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
            if (!this.state.isHost) this.leaveParty(`VERSION MISMATCH (HOST ${data.build || '?'}, YOU ${GAME_VERSION}) — REFRESH THE PAGE`, 'danger');
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
            // Remote players glide toward their latest reported position
            // (see followRemote) instead of jumping 30 times a second; the
            // first update after spawning or reviving places them at once.
            rp.net = { x: data.x, wy: data.y, vx: data.vx, vy: data.vy, t: this.state.time };
            if (rp.snapNext !== false) {
                rp.x = data.x;
                rp.y = data.y + this.state.score;
                rp.snapNext = false;
            }
            rp.vx = data.vx;
            rp.vy = data.vy;
            rp.lastSeenT = this.state.time;
            rp.activePower = data.activePowerId ? Object.values(POWERS).find(p => p.id === data.activePowerId) : null;
            rp.powerFrac = data.pf || 0;
            rp.hearts = data.hl || 0;
        } else if (data.type === 'pick') {
            this.applyRemotePick(data);
        } else if (data.type === 'die') {
            const rp = this.remotePlayers.get(data.pid);
            if (rp) rp.isDead = true;
            this.checkAllDead();
        } else if (data.type === 'revive') {
            const rp = this.remotePlayers.get(data.pid);
            if (rp) {
                rp.isDead = false;
                rp.y = this.player.y - 100; // spawn above
                rp.snapNext = true;
                this.particles.spawn(rp.x, rp.y, PARTY_COLORS[rp.slot] || "#00ffcc", 40, "blast");
            }
        } else if (data.type === 'snap') {
            if (!this.state.isHost) this.applySnapshot(data);
        } else if (data.type === 'ps') {
            if (!this.state.isHost) this.applyProjectileSpawn(data);
        } else if (data.type === 'hit') {
            if (this.state.isHost) this.applyHitRequest(data);
        } else if (data.type === 'stomp') {
            if (this.state.isHost) this.applyStompRequest(data);
        } else if (data.type === 'boss_down') {
            if (!this.state.isHost && this.state.running && this.state.multiplayer) this.onBossDefeated();
        }
    }

    // ------------------------------------------------------ co-op enemies
    // Solo, or the co-op host: this client runs the enemies. Guests mirror
    // the host's (drawn and collided with locally, but spawned, moved and
    // killed only by the host), so the whole party faces the same drones.
    isAuthority() {
        return !this.state.multiplayer || this.state.isHost;
    }

    // Every living player (this one and the others), for enemy targeting.
    livingPlayers() {
        const list = [];
        if (!this.player.isDead) list.push({ p: this.player, slot: this.mySlot() });
        this.remotePlayers.forEach(rp => {
            if (!rp.isDead && !this.remoteAway(rp)) list.push({ p: rp, slot: rp.slot || 0 });
        });
        return list;
    }

    mySlot() {
        const me = this.party.find(m => window.network && m.pid === window.network.myId);
        return me ? me.slot : 0;
    }

    // Shooter drones aim at the closest living player.
    nearestPlayer(e) {
        let best = this.player, bestD = Infinity;
        for (const { p } of this.livingPlayers()) {
            const d = Math.hypot(p.x - e.x, p.y - e.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        return best;
    }

    // The boss takes turns diving at each living player, by party slot.
    nextDiveTarget() {
        const list = this.livingPlayers().sort((a, b) => a.slot - b.slot);
        if (!list.length) return this.player;
        const pick = list[this.state.diveTurn % list.length].p;
        this.state.diveTurn++;
        return pick;
    }

    // TIME WARP slows every enemy for the whole party while anyone has it.
    partyTimeWarp() {
        const warped = p => p && !p.isDead && p.activePower === POWERS.TIME_WARP;
        if (warped(this.player)) return true;
        if (!this.state.multiplayer) return false;
        for (const rp of this.remotePlayers.values()) if (warped(rp)) return true;
        return false;
    }

    // Host: number anything new, announce new projectiles (guests fly them
    // on their own), and send an enemy snapshot 15 times a second.
    broadcastEnemies(dt) {
        const net = window.network;
        for (const e of this.enemies) if (e.nid === undefined) e.nid = ++this.nextNid;
        this.announceProjectiles();
        if (this.tick('snap', dt, NET_SNAPSHOT_FRAMES)) net.send(this.buildSnapshot());
    }

    // Host: number and announce every new bullet/meteor. Called before the
    // projectile loop too, so one that's gone in its first frame (off screen,
    // or absorbed by the host's shield) still reached the guests.
    announceProjectiles() {
        const r1 = v => Math.round(v * 10) / 10;
        for (const q of this.projectiles) {
            if (q.nid !== undefined) continue;
            q.nid = ++this.nextNid;
            window.network.send({ type: 'ps', nid: q.nid, k: q instanceof Meteor ? 1 : 0, x: r1(q.x), wy: r1(q.y - this.state.score), vx: r1(q.vx), vy: r1(q.vy) });
        }
    }

    // Enemy rows are positional arrays to keep packets small:
    //   drone/shooter [nid, 0|1, x, wy, v, hidden, warning]
    //   laser         [nid, 2, x, wy, phase, w, h]
    //   boss          [nid, 3, x, wy, state, hp, invuln, laneX, anchorWy, warning]
    // plus the ids of every live projectile (anything missing is gone).
    buildSnapshot() {
        const score = this.state.score;
        const r1 = v => Math.round(v * 10) / 10;
        const e = [];
        for (const en of this.enemies) {
            if (en.markedForDeletion || en.nid === undefined) continue;
            const wy = Math.round(en.y - score);
            if (en instanceof BossDrone) {
                e.push([en.nid, 3, r1(en.x), wy, BOSS_STATES.indexOf(en.state), en.hp, en.invuln > 0 ? 1 : 0, r1(en.laneX), Math.round(en.anchorY - score),
                    en.shootTimer < 20 ? 1 : 0]);
            } else if (en instanceof LaserDrone) {
                e.push([en.nid, 2, r1(en.x), wy, LASER_PHASES.indexOf(en.phase), en.w, en.h]);
            } else {
                e.push([en.nid, en instanceof ShooterDrone ? 1 : 0, r1(en.x), wy, r1(en.v), en.hidden ? 1 : 0,
                    en.shootTimer !== undefined && en.shootTimer < 20 ? 1 : 0]);
            }
        }
        const p = this.projectiles.filter(q => q.nid !== undefined && !q.markedForDeletion).map(q => q.nid);
        return { type: 'snap', e, p };
    }

    // Guest: bring the mirrored enemies in line with a host snapshot.
    applySnapshot(d) {
        if (!this.state.running || !this.state.multiplayer || !Array.isArray(d.e) || !Array.isArray(d.p)) return;
        const now = this.state.time;
        for (const [nid, until] of this.tombstones) if (until < now) this.tombstones.delete(nid);

        const seen = new Set();
        for (const row of d.e) {
            if (!Array.isArray(row) || !Number.isInteger(row[0]) || !row.slice(2, 4).every(Number.isFinite)) continue;
            const [nid, kind] = row;
            if (this.tombstones.has(nid)) continue;
            seen.add(nid);
            let en = this.netEnemies.get(nid);
            if (!en) {
                en = kind === 3 ? new BossDrone(row[3] + this.state.score)
                    : kind === 2 ? new LaserDrone(row[3] + this.state.score)
                    : kind === 1 ? new ShooterDrone(row[3] + this.state.score)
                    : new Drone(row[3] + this.state.score);
                en.nid = nid;
                en.x = row[2];
                this.netEnemies.set(nid, en);
                this.enemies.push(en);
                if (en instanceof BossDrone) this.state.bossActive = true;
            }
            en.net = { x: row[2], wy: row[3], v: 0, t: now };
            if (en instanceof BossDrone) {
                en.state = BOSS_STATES[row[4]] || 'hover';
                en.hp = Number.isFinite(row[5]) ? row[5] : en.hp;
                en.invuln = row[6] ? Math.max(en.invuln, 1) : 0;
                en.laneX = Number.isFinite(row[7]) ? row[7] : en.laneX;
                en.anchorY = (Number.isFinite(row[8]) ? row[8] : row[3]) + this.state.score;
                en.shootTimer = row[9] ? 10 : BOSS.VOLLEY; // the volley warning light
            } else if (en instanceof LaserDrone) {
                en.phase = LASER_PHASES[row[4]] || 'cooldown';
                en.w = Number.isFinite(row[5]) ? row[5] : en.bodyW;
                en.h = Number.isFinite(row[6]) ? row[6] : en.bodyH;
            } else {
                en.net.v = Number.isFinite(row[4]) ? row[4] : 0;
                en.v = en.net.v || en.v;
                en.hidden = !!row[5];
                if (en instanceof ShooterDrone) en.shootTimer = row[6] ? 10 : 60;
            }
        }
        for (const [nid, en] of this.netEnemies) {
            if (!seen.has(nid)) { en.markedForDeletion = true; this.netEnemies.delete(nid); }
        }
        const live = new Set(d.p);
        for (const q of this.projectiles) if (q.nid !== undefined && !live.has(q.nid)) q.markedForDeletion = true;
    }

    // Guest: a bullet or meteor the host just fired; it flies straight, so
    // the guest simulates it from here.
    applyProjectileSpawn(d) {
        if (!this.state.running || !this.state.multiplayer) return;
        if (!Number.isInteger(d.nid) || this.tombstones.has(d.nid)) return;
        if (![d.x, d.wy, d.vx, d.vy].every(Number.isFinite)) return;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const Kind = d.k === 1 ? Meteor : Projectile;
        const q = new Kind(clamp(d.x, -100, CONFIG.WIDTH + 100), d.wy + this.state.score, clamp(d.vx, -20, 20), clamp(d.vy, -20, 20));
        q.nid = d.nid;
        this.projectiles.push(q);
    }

    // Guest: ease a mirrored enemy toward where the host last had it (drones
    // are carried forward along their flight line between snapshots).
    followNetEnemy(e, dt) {
        const n = e.net;
        if (e.t !== undefined) e.t += dt;
        if (e.localInvuln > 0) e.localInvuln -= dt;
        if (!n) return;
        const ahead = Math.min(this.state.time - n.t, 8);
        const tx = n.x + (n.v || 0) * ahead;
        const ty = n.wy + this.state.score;
        if (Math.abs(tx - e.x) > 80 || Math.abs(ty - e.y) > 80) {
            e.x = tx;
            e.y = ty;
        } else {
            const k = 1 - Math.pow(0.7, dt);
            e.x += (tx - e.x) * k;
            e.y += (ty - e.y) * k;
        }
    }

    // Guest: ease a teammate toward their last reported position, carried a
    // few frames forward by their velocity.
    followRemote(rp, dt) {
        const n = rp.net;
        if (!n || rp.isDead) return;
        const ahead = Math.min(this.state.time - n.t, 6);
        const tx = n.x + n.vx * ahead;
        const ty = n.wy + this.state.score + n.vy * ahead;
        if (Math.abs(tx - rp.x) > 120 || Math.abs(ty - rp.y) > 120) {
            rp.x = tx; // screen wraps and big corrections snap
            rp.y = ty;
        } else {
            const k = 1 - Math.pow(0.6, dt);
            rp.x += (tx - rp.x) * k;
            rp.y += (ty - rp.y) * k;
        }
    }

    // A jetpack or shield took something out. On a guest the host decides:
    // hide it now (with a tombstone) and ask the host to remove it.
    destroyHostile(obj) {
        obj.markedForDeletion = true;
        if (this.isAuthority() || obj.nid === undefined) return;
        this.tombstones.set(obj.nid, this.state.time + NET_TOMBSTONE_FRAMES);
        this.netEnemies.delete(obj.nid);
        window.network.send({ type: 'hit', nid: obj.nid });
    }

    // Host: a guest's jetpack/shield kill (never the boss).
    applyHitRequest(d) {
        if (!this.state.running || !Number.isInteger(d.nid)) return;
        const target = this.enemies.find(e => e.nid === d.nid && !(e instanceof BossDrone))
            || this.projectiles.find(q => q.nid === d.nid);
        if (target) target.markedForDeletion = true;
    }

    // Host: a guest landed on the boss. Its own invulnerability window
    // de-duplicates stomps from several players at once.
    applyStompRequest(d) {
        if (!this.state.running || !Number.isInteger(d.nid)) return;
        const boss = this.enemies.find(e => e instanceof BossDrone && e.nid === d.nid);
        if (boss) boss.takeDamage(this.particles);
    }

    // Dead in co-op: the camera follows whoever is lowest; say who (and
    // keep them, so the power-up HUD can show theirs).
    updateSpectateHud() {
        const hud = this.ui.spectateHud;
        if (!hud) return;
        let name = null;
        let lowest = null;
        if (this.state.multiplayer && this.player.isDead) {
            this.remotePlayers.forEach(rp => {
                if (!rp.isDead && !this.remoteAway(rp) && (!lowest || rp.y > lowest.y)) lowest = rp;
            });
            if (lowest) name = lowest.name || 'PLAYER';
        }
        this.spectatingPlayer = lowest;
        if (name === this.spectating) return;
        this.spectating = name;
        hud.hidden = !name;
        if (name) hud.innerText = 'SPECTATING ' + name;
    }

    // Share of the local player's power-up time left (0-1). Measured
    // against the stretched duration, or long-lasting power Pixels would
    // start with an overflowing bar.
    powerFraction(perks) {
        const power = this.player.activePower;
        if (!power) return 0;
        const fullTime = power.time * (perks.powerDurationMult || 1);
        return Math.max(0, Math.min(1, this.player.powerTimer / fullTime));
    }

    // The power-up bar: your own, or while you're down in co-op, the
    // teammate you're spectating (a dead player's own power is frozen).
    updatePowerHud(perks) {
        let power = this.player.activePower;
        let frac = this.powerFraction(perks);
        let owner = '';
        if (this.state.multiplayer && this.player.isDead) {
            const rp = this.spectatingPlayer;
            power = rp ? rp.activePower : null;
            frac = rp ? rp.powerFrac || 0 : 0;
            owner = rp ? (rp.name || 'PLAYER') + ': ' : '';
        }
        if (!power) {
            this.ui.power.style.opacity = 0;
            return;
        }
        this.ui.power.style.opacity = 1;
        this.ui.powerText.innerText = owner + power.name;
        this.ui.powerText.style.color = power.color;
        this.ui.powerFill.style.backgroundColor = power.color;
        this.ui.powerFill.style.width = (frac * 100) + "%";
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

        if (this.ui.gemDisplay) this.ui.gemDisplay.innerText = fmtNum(this.state.gems) + " 💎";
        this.updateShopBadge();
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

    // Every gems-purchasable skin (anything in SKINS with a `cost`), paired
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
        const affordable = this.state.gems >= s.cost;
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
            ${this.pixelPreviewHTML(s, 'gem-skin-preview', `opacity:${owned ? 1 : 0.35};`)}
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

    // Something in the shop you could buy right now: a Pixel you don't own
    // yet, or a heart with room in the stock.
    shopHasAffordable() {
        const gems = this.state.gems;
        if (this.state.hearts < MAX_HEARTS && gems >= HEART_COST) return true;
        return this.gemShopSkins().some(({ s }) => !this.ownedSkins.includes(s.id) && gems >= s.cost);
    }

    updateShopBadge() {
        const btn = this.ui.shopOpenBtn;
        if (!btn || !btn.classList) return;
        const can = this.shopHasAffordable();
        btn.classList.toggle('can-buy', can);
        const badge = btn.querySelector && btn.querySelector('.shop-badge');
        if (badge) badge.hidden = !can;
    }

    // Hearts are stock rather than a one-shot toggle: the card shows how
    // many are banked, and the button locks at MAX_HEARTS.
    updateHeartUI() {
        if (this.ui.shopLifeCount) this.ui.shopLifeCount.innerText = this.state.hearts;
        const hearts = this.ui.lifeDisplay;
        if (hearts) {
            const text = this.state.hearts + " ❤️";
            if (hearts.innerText !== text && hearts.classList) {
                hearts.classList.remove('life-pop');
                void hearts.offsetWidth; // restart the animation
                hearts.classList.add('life-pop');
            }
            hearts.innerText = text;
            if (hearts.classList) hearts.classList.toggle('empty', this.state.hearts <= 0);
        }
        if (!this.ui.shopLifeBtn) return;

        const full = this.state.hearts >= MAX_HEARTS;
        const affordable = this.state.gems >= HEART_COST;
        const label = this.ui.shopLifeBtn.querySelector('.btn-label');
        const cost = this.ui.shopLifeBtn.querySelector('.btn-cost');

        if (label) label.innerText = full ? "STOCK FULL" : "BUY HEART";
        if (cost) cost.innerText = HEART_COST + " 💎";
        this.ui.shopLifeBtn.classList.toggle('maxed', full);
        this.ui.shopLifeBtn.classList.toggle('unaffordable', !full && !affordable);
        this.ui.shopLifeBtn.disabled = full;
        this.updateShopBadge();
    }

    buyHeart() {
        if (this.state.hearts >= MAX_HEARTS || this.state.gems < HEART_COST) {
            this.shakeUI(this.ui.shopLifeBtn);
            return false;
        }
        this.state.gems -= HEART_COST;
        this.state.hearts++;
        localStorage.setItem('lp_gems', this.state.gems);
        localStorage.setItem('lp_hearts', this.state.hearts);
        this.updateHeartUI();
        this.renderGemShop();
        this.updateSkinUI();
        return true;
    }

    // Spends one banked heart. Returns false when the bank is empty.
    consumeHeart() {
        if (this.state.hearts <= 0) return false;
        this.setHearts(this.state.hearts - 1);
        return true;
    }

    setHearts(n) {
        this.state.hearts = Math.max(0, Math.min(MAX_HEARTS, n));
        localStorage.setItem('lp_hearts', this.state.hearts);
        this.updateHeartUI();
    }

    // Buying a Pixel also equips it — that's why you bought it.
    buyGemSkin(index, button) {
        const s = SKINS[index];
        if (!s || this.ownedSkins.includes(s.id)) return false;
        if (s.cost === undefined || this.state.gems < s.cost) {
            this.shakeUI(button);
            return false;
        }
        this.state.gems -= s.cost;
        this.ownedSkins.push(s.id);
        localStorage.setItem('lp_gems', this.state.gems);
        localStorage.setItem('lp_owned_skins', JSON.stringify(this.ownedSkins));
        this.equipSkin(index);
        this.renderGemShop();
        this.updateHeartUI();
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
    // `icon` (markup, e.g. from pixelPreviewHTML) replaces the type's emoji.
    showAlert(text, type = 'info', { icon = null } = {}) {
        const icons = { info: '⚙', success: '✓', warning: '⏳', danger: '⚠', reward: '🏆', pulse: '⏱', unlock: '🎨', life: '💔', heart: '❤️' };
        const el = this.ui.alert;
        el.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-danger', 'alert-reward', 'alert-pulse', 'alert-unlock', 'alert-life', 'alert-heart');
        el.classList.add('alert-' + type, 'alert-visible');
        if (icon) {
            this.ui.alertIcon.innerHTML = icon;
        } else {
            this.ui.alertIcon.innerText = icons[type] || icons.info;
        }
        this.ui.alertText.innerText = text;

        if (this.alertHideTimer) clearTimeout(this.alertHideTimer);
        this.alertHideTimer = setTimeout(() => this.hideAlert(), 4000);
    }

    // One-shot notices (biome changes, unlocks, rewards) take turns in the
    // alert box instead of overwriting each other: a secret Pixel unlocks on
    // the very frame its biome is entered.
    notify(text, type = 'info', opts = {}) {
        this.noticeQueue.push({ text, type, opts });
        if (!this.noticeTimer) this.showNextNotice();
    }

    showNextNotice() {
        const next = this.noticeQueue.shift();
        if (!next) { this.noticeTimer = null; return; }
        this.showAlert(next.text, next.type, next.opts);
        this.noticeTimer = setTimeout(() => this.showNextNotice(), 2200);
    }

    // A Pixel drawn in DOM squares, its colour plus two eyes, for the gem
    // shop and unlock notices. `cls` sizes it; `style` adds inline CSS.
    pixelPreviewHTML(skin, cls, style = '') {
        return `<span class="${cls}" style="background-color:${skin.color};${style}">
            <span class="pixel-eye pixel-eye-l" style="background-color:${skin.eye};"></span>
            <span class="pixel-eye pixel-eye-r" style="background-color:${skin.eye};"></span>
        </span>`;
    }

    clearNotices() {
        this.noticeQueue = [];
        if (this.noticeTimer) clearTimeout(this.noticeTimer);
        this.noticeTimer = null;
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
        return { deploy: 0, impact: 0, impactX: CONFIG.WIDTH / 2, phase: 0, expiring: false, rescue: false };
    }

    updateSafetyNet(dt) {
        const net = this.safetyNet;
        const power = this.player.activePower === POWERS.SAFETY;
        if (this.state.rescueNetT > 0) this.state.rescueNetT = Math.max(0, this.state.rescueNetT - dt);
        // The power's own (purple) net takes over from a red rescue net.
        if (power) net.rescue = false;
        const active = power || this.state.rescueNetT > 0;

        net.deploy = active
            ? Math.min(1, net.deploy + 0.08 * dt)
            : Math.max(0, net.deploy - 0.06 * dt);
        // Warn over the last ~2.5 seconds. A fixed window rather than a fraction
        // of the timer, since skin abilities can stretch the power's duration.
        net.expiring = power && this.player.powerTimer < 150;

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
    // meteors are immune. Solo only: in co-op the host owns every enemy and
    // guests only draw mirrors of them, so a guest's pulse would just hide
    // drones that are still there for everyone else.
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
        if (hits) sounds.play('reward');
    }

    // The player the boss hovers over: the lowest one still alive (the one the
    // camera follows), so in co-op it never parks over someone's corpse.
    bossFocus() {
        let focus = this.player.isDead ? null : this.player;
        this.remotePlayers.forEach(rp => {
            if (!rp.isDead && !this.remoteAway(rp) && (!focus || rp.y > focus.y)) focus = rp;
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
            if (!this.isAuthority()) {
                // Co-op guest: the host owns the boss's health. Bounce now,
                // report the stomp, and don't re-report during its flash.
                if (boss.invuln > 0 || boss.localInvuln > 0) {
                    p.vy = CONFIG.JUMP_FORCE;
                    return;
                }
                boss.localInvuln = BOSS.HIT_INVULN;
                window.network.send({ type: 'stomp', nid: boss.nid });
                this.particles.spawn(boss.x + boss.w / 2, boss.y + boss.h / 2, "#fff", 30, "blast");
                p.vy = CONFIG.BOUNCE_FORCE;
                sounds.play('jump');
                return;
            }
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
            sounds.play('reward');
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
        this.addGems(BOSS_GEM_BOUNTY);
        this.setHearts(MAX_HEARTS);
        this.state.nextBossAt = Math.floor(this.state.score / 10) + CONFIG.BOSS_LOOP_DISTANCE;
        this.notify(`TITAN DOWN  +${BOSS_BONUS_METERS}m  +${BOSS_GEM_BOUNTY} 💎  HEARTS FULL`, 'reward');
        sounds.play('reward');
    }

    // Banks gems and pops the counter.
    addGems(n) {
        this.state.gems += n;
        if (this.state.running) this.state.runGems = (this.state.runGems || 0) + n;
        localStorage.setItem('lp_gems', this.state.gems);
        if (this.ui.gemDisplay) {
            this.ui.gemDisplay.innerText = fmtNum(this.state.gems) + " 💎";
            this.ui.gemDisplay.classList.remove('gem-pop');
            void this.ui.gemDisplay.offsetWidth; // restart animation on rapid pickups
            this.ui.gemDisplay.classList.add('gem-pop');
        }
    }

    // A spent life or revive: a red safety net springs up for a second and
    // bounces the player back in from the bottom of the screen.
    deployRescueNet() {
        this.state.rescueNetT = RESCUE_NET_FRAMES;
        this.safetyNet.rescue = true;
        this.player.y = CONFIG.HEIGHT - 60;
        this.player.launch(CONFIG.BOUNCE_FORCE);
        this.bounceSafetyNet();
    }

    // A fall onto a deployed net (the SAFETY NET power, or a rescue net still
    // up) bounces instead of killing. Enemy hits aren't caught. True if caught.
    catchWithNet(forceDie) {
        if (forceDie || !(this.player.activePower === POWERS.SAFETY || this.state.rescueNetT > 0)) return false;
        this.player.y = CONFIG.HEIGHT - 60;
        this.player.vy = CONFIG.BOUNCE_FORCE;
        this.bounceSafetyNet();
        this.particles.spawn(this.player.x, CONFIG.HEIGHT, this.safetyNet.rescue ? RESCUE_NET_COLOR : POWERS.SAFETY.color, 30);
        return true;
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
        this.state.frames = 0;
        this.state.time = 0;
        // Spawn/animation clocks in 60fps-frame units of game time (see
        // tick()), so pacing is the same at 60, 120 or 144Hz.
        this.state.timers = { drone: 0, laser: 0, meteor: 0, trail: 0, sync: 0, snap: 0 };
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

        const startDisplayScore = Math.floor(this.state.score / 10);
        this.renderer.updateBiome(startDisplayScore);
        this.lastBiomeName = this.renderer.currentBiome.name;

        this.lastTime = performance.now();

        this.player = new Player(CONFIG.WIDTH / 2, CONFIG.HEIGHT - 150, this.viewParams.skinIndex);

        localStorage.setItem('lp_skin', SKINS[this.viewParams.skinIndex].id);

        // Pickups are cleared *before* the first screen of platforms is built,
        // or the gems and power-ups spawned on it would be thrown away.
        this.powerups = [];
        this.enemies = [];
        this.projectiles = [];

        this.platforms = [{ x: 0, y: CONFIG.HEIGHT - 40, w: CONFIG.WIDTH, h: 40 }];
        // World y of the next platform to generate (screen y = wy + score).
        // An integer counter, so every co-op client derives identical heights.
        this.state.nextPlatWY = (CONFIG.HEIGHT - 140) - this.state.score;
        this.state.lastHeartWY = null;
        this.state.heartBlockWY = null;
        this.state.rescueNetT = 0;
        // The high score before this run, marked in the level so you can see
        // yourself pass it (highScore itself climbs along with you).
        this.state.bestMarkerScore = this.state.highScore || 0;
        // Beginner tips are painted onto the starting screen (world space), so
        // they scroll away as you climb past them.
        this.state.tipAnchorWY = -this.state.score;
        this.fillPlatforms();
        this.particles = new ParticleSystem();
        this.particles.scale = this.settings.reducedMotion ? 0.35 : 1;
        this.safetyNet = this.makeSafetyNetState();
        this.remotePlayers = new Map();
        // Co-op enemies: the host numbers everything it spawns; guests keep
        // mirrored copies by that number, plus tombstones for their own kills.
        this.nextNid = 0;
        this.netEnemies = new Map();
        this.tombstones = new Map();
        this.state.diveTurn = 0;
        this.spectating = null;
        this.spectatingPlayer = null;

        this.ui.power.style.opacity = 0;
        this.clearNotices();
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

        // Power-ups get more common the higher you climb.
        const ramp = Math.min(1, scoreMeters / POWERUP_RAMP_METERS);
        const chance = POWERUP_CHANCE_MIN + (POWERUP_CHANCE_MAX - POWERUP_CHANCE_MIN) * ramp;
        if (this.seededRandom() < chance) {
            this.powerups.push({
                x: x + w / 2 - 12,
                y: y - 40,
                startY: y - 40,
                w: 24, h: 24,
                isGem: false,
                wy,
                markedForDeletion: false
            });
        } else if (this.heartAllowedAt(wy, scoreMeters)) {
            // Always generated (so every client builds the same level), but
            // only shown to a player with no hearts left.
            this.state.lastHeartWY = wy;
            this.powerups.push({
                x: x + w / 2 - 14,
                y: y - 40,
                startY: y - 40,
                w: 28, h: 28,
                isGem: false,
                isHeart: true,
                wy,
                markedForDeletion: false
            });
        } else if (this.seededRandom() < GEM_CHANCE) {
            // Worth more the higher the biome (by the platform's own height,
            // so every client agrees).
            const tier = biomeIndexAt(scoreMeters);
            this.powerups.push({
                x: x + w / 2 - 8,
                y: y - 30,
                startY: y - 30,
                w: 16, h: 16,
                isGem: true,
                gemValue: BIOMES[tier].gem.value,
                tier,
                wy,
                markedForDeletion: false
            });
        }
    }

    // Rolls for a heart on the platform at `wy`: never within HEART_MIN_GAP
    // of the last one (generation runs in height order, so this is the same
    // on every client), and rarer the higher it is.
    heartAllowedAt(wy, meters) {
        const last = this.state.lastHeartWY;
        if (last !== null && last !== undefined && last - wy < HEART_MIN_GAP) return false;
        const ramp = Math.min(1, meters / HEART_RAMP_METERS);
        return this.seededRandom() < HEART_CHANCE_START + (HEART_CHANCE_END - HEART_CHANCE_START) * ramp;
    }

    // Keeps platforms generated up to PLATFORM_LOOKAHEAD above the screen, so
    // none ever pops into view, in strict height order.
    fillPlatforms() {
        while (this.state.nextPlatWY + this.state.score > -PLATFORM_LOOKAHEAD) {
            this.spawnPlatform(this.state.nextPlatWY);
            this.state.nextPlatWY -= CONFIG.PLATFORM_BASE_GAP;
        }
    }

    // How many drones may be out at once at this height.
    droneCap(meters) {
        return Math.min(CONFIG.DRONE_CAP_MAX, CONFIG.DRONE_CAP_BASE + Math.floor(meters / CONFIG.DRONE_CAP_STEP));
    }

    // Live enemies of a class (subclasses count: a ShooterDrone is a Drone),
    // including drones waiting off-screen to swing back in.
    countEnemies(cls) {
        let n = 0;
        for (const e of this.enemies) if (e instanceof cls && !e.markedForDeletion) n++;
        return n;
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

    // Keeps the latest solo run on today's layout, so the ghost is always
    // your previous run (loadGhost drops it once the day's seed changes).
    saveGhost(finalScore) {
        const rec = this.ghostRec;
        if (!rec || this.state.multiplayer || rec.pts.length < 4) return;
        const ghost = {
            v: 2, gen: PLATFORM_GEN_VERSION, seed: this.state.runSeed, start: this.state.startMeters,
            score: finalScore, step: GHOST_STEP, pts: rec.pts,
            skin: (SKINS[this.viewParams.skinIndex] || SKINS[0]).id
        };
        try { localStorage.setItem('lp_ghost', JSON.stringify(ghost)); } catch (e) { /* storage full: keep the old one */ }
    }

    // The ghost is the recorded Pixel, dimmed, following a smooth curve
    // (Catmull-Rom) through the samples rather than straight lines, so jump
    // arcs stay round. It snaps across a screen wrap.
    drawGhost() {
        const g = this.ghostPlayback;
        if (!g) return;
        const f = this.state.time / g.step;
        const i = Math.floor(f);
        if (i * 2 + 3 >= g.pts.length) return; // the recorded run is over
        const pt = (k) => {
            const j = Math.max(0, Math.min(k, g.pts.length / 2 - 1));
            return [g.pts[j * 2], g.pts[j * 2 + 1]];
        };
        const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
        const t = f - i;
        let x = p1[0], y = p1[1];
        const wraps = [p0, p1, p2, p3].some((p, k, a) => k > 0 && Math.abs(p[0] - a[k - 1][0]) >= 300);
        if (!wraps) {
            const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
            x = cr(p0[0], p1[0], p2[0], p3[0]);
            y = cr(p0[1], p1[1], p2[1], p3[1]);
        } else if (Math.abs(p2[0] - p1[0]) < 300) {
            x += (p2[0] - p1[0]) * t;
            y += (p2[1] - p1[1]) * t;
        }
        const screenY = y + this.state.score;
        if (screenY > this.renderer.viewTop - 50 && screenY < CONFIG.HEIGHT + 50) {
            const skin = SKINS[skinIndexById(g.skin)] || SKINS[0];
            const dx = p2[0] - p1[0];
            const look = Math.abs(dx) >= 300 ? 0 : (dx > 3 ? 4 : (dx < -3 ? -4 : 0));
            const ctx = this.renderer.ctx;
            ctx.globalAlpha = 0.4;
            drawPixel(ctx, x, screenY, skin, look);
            if (x > CONFIG.WIDTH - 26) drawPixel(ctx, x - CONFIG.WIDTH, screenY, skin, look);
            ctx.globalAlpha = 1;
        }
    }

    // The beginner tips, fixed to the run's starting screen: how to move and
    // jump just above the floor, and the screen wrap a little higher. Every
    // run shows them (SHOW TIPS in Settings turns them off). Drawn under the
    // platforms, like signs painted on the background.
    drawTips() {
        const ctx = this.renderer.ctx;
        const base = this.state.tipAnchorWY + this.state.score; // screen y of the run's start
        const touch = this.coarsePointer;
        const tips = [
            { y: base + CONFIG.HEIGHT - 190, lines: touch
                ? ['HOLD ◀ ▶ TO MOVE', 'TAP THE RIGHT HALF TO JUMP']
                : ['← → / A D TO MOVE', 'SPACE / ↑ / W TO JUMP · ESC TO PAUSE'] },
            { y: base + CONFIG.HEIGHT - 360, lines: ['THE SIDES WRAP AROUND'], edges: true }
        ];
        for (const tip of tips) {
            const h = tip.lines.length * 22 + 14;
            if (tip.y + h < this.renderer.viewTop || tip.y - h > CONFIG.HEIGHT) continue;
            ctx.save();
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, tip.y - h / 2, CONFIG.WIDTH, h);
            ctx.globalAlpha = 0.75;
            ctx.textBaseline = 'middle';
            tip.lines.forEach((line, k) => {
                const ly = tip.y - (tip.lines.length - 1) * 11 + k * 22;
                this.renderer.drawText(line, CONFIG.WIDTH / 2, ly, 'bold 15px Orbitron, "Courier New", monospace', '#00ffcc');
            });
            if (tip.edges) {
                this.renderer.drawText('◀', 16, tip.y, 'bold 20px sans-serif', '#00ffcc');
                this.renderer.drawText('▶', CONFIG.WIDTH - 16, tip.y, 'bold 20px sans-serif', '#00ffcc');
            }
            ctx.restore();
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
        // Forget teammates' pickups once they're below the screen.
        if (this.state.multiplayer) {
            this.remotePlayers.forEach(rp => {
                if (rp.picked) rp.picked.forEach(wy => { if (wy + this.state.score > CONFIG.HEIGHT + 100) rp.picked.delete(wy); });
            });
        }
        // Drones circle back instead of leaving, so cull the ones left below.
        this.enemies = this.enemies.filter(e => e instanceof BossDrone || e.y < CONFIG.HEIGHT + 100);

        this.fillPlatforms();
    }

    // Drops focus from whatever menu control has it, so it can't catch the
    // game's keys (buttons activate on Space/Enter keyup).
    blurFocus() {
        if (typeof document !== 'undefined' && document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }

    // Phone and tablet browser tabs get install steps instead of the game.
    applyInstallGate() {
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        this.installGated = needsHomeScreenInstall(nav, typeof window !== 'undefined' ? window : null);
        if (!this.installGated || !this.ui.installGate) return;
        const android = installPlatform(nav) === 'android';
        this.ui.installGate.hidden = false;
        this.ui.installGateIOS.hidden = android;
        this.ui.installGateAndroid.hidden = !android;
        this.ui.installGateSafari.hidden = android || !isIOSNonSafari(nav.userAgent);
        this.ui.installGateChrome.hidden = !android || !isAndroidInAppBrowser(nav.userAgent);
        const container = document.getElementById('game-container');
        if (container) container.inert = true;
        if (!android) return;

        // The one-tap button appears once the browser says it can install.
        const showButton = () => { this.ui.installGateBtn.hidden = !installPrompt.event; };
        installPrompt.onReady = showButton;
        installPrompt.onInstalled = () => {
            this.ui.installGateBtn.hidden = true;
            this.ui.installGateDone.hidden = false;
        };
        this.ui.installGateBtn.onclick = async () => {
            const e = installPrompt.event;
            if (!e) return;
            installPrompt.event = null;
            e.prompt();
            let accepted = false;
            try { accepted = (await e.userChoice).outcome === 'accepted'; } catch (err) { /* treat as dismissed */ }
            if (accepted) installPrompt.onInstalled();
            else showButton();
        };
        showButton();
    }

    startGame(isMp = false, mpSeed = null) {
        if (this.installGated) return;
        // Whatever menu button had focus must not catch the Space/Enter that
        // follows, and keys held in the menu shouldn't carry into the run.
        this.blurFocus();
        this.input.resetInput();
        this.closeRunCard();
        this.closeSettings();
        this.state.running = true;
        this.state.multiplayer = isMp;
        this.state.deathCount = 0;
        this.reset(isMp ? mpSeed : null);
        // Every run starts with at least one heart: the free life each round
        // lives in the hearts meter rather than behind a hidden revive.
        if (this.state.hearts < 1) this.setHearts(1);
        if ((this.player.skin.ability || {}).startShield) this.player.grantPower(POWERS.SHIELD);

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

    // ------------------------------------------------------ pickup sprites
    // A pickup emoji, drawn once (with its glow) into an offscreen canvas at
    // screen density. Drawing emoji text with shadowBlur every frame was the
    // most expensive thing on the screen for phones.
    makePickupSprite(emoji, glow, fontSize = 18) {
        const size = Math.round(fontSize * 2.2);
        const dpr = this.renderer.dpr || 1;
        const c = document.createElement('canvas');
        c.width = size * dpr;
        c.height = size * dpr;
        const ctx = c.getContext && c.getContext('2d');
        if (!ctx) return null;
        if (ctx.scale) ctx.scale(dpr, dpr);
        ctx.shadowBlur = 12;
        ctx.shadowColor = glow;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = fontSize + 'px sans-serif';
        ctx.fillText(emoji, size / 2, size / 2);
        return { canvas: c, size };
    }

    // A gem in its biome's colour: a cut diamond (flat crown, pointed
    // base) with a lighter crown and a glint, drawn once with its glow.
    makeGemSprite(color) {
        const size = 40;
        const dpr = this.renderer.dpr || 1;
        const c = document.createElement('canvas');
        c.width = size * dpr;
        c.height = size * dpr;
        const ctx = c.getContext && c.getContext('2d');
        if (!ctx || !ctx.beginPath) return null;
        if (ctx.scale) ctx.scale(dpr, dpr);
        const x = size / 2 - 10, y = size / 2 - 9;
        const shape = (pts) => {
            ctx.beginPath();
            pts.forEach(([px, py], i) => i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py));
            ctx.closePath();
            ctx.fill();
        };
        ctx.shadowBlur = 12;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        shape([[4, 0], [16, 0], [20, 6], [10, 18], [0, 6]]);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        shape([[4, 0], [16, 0], [20, 6], [0, 6]]);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        shape([[10, 6], [20, 6], [10, 18]]);
        ctx.fillStyle = '#fff';
        shape([[5, 1], [8, 1], [6, 5], [3, 5]]);
        return { canvas: c, size };
    }

    makePickupSprites() {
        this.gemSprites = BIOMES.map(b => this.makeGemSprite(b.gem.color));
        this.heartSprite = this.makePickupSprite('❤️', '#ff3366', 28);
    }

    // Draws a pre-rendered pickup sprite centred on pickup `p`.
    drawSprite(sprite, p, alpha) {
        if (!sprite) return;
        const ctx = this.renderer.ctx;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite.canvas, p.x + p.w / 2 - sprite.size / 2, p.y + p.h / 2 - sprite.size / 2, sprite.size, sprite.size);
        ctx.globalAlpha = 1;
    }

    // The pickups this player can see and collect. Hearts are part of every
    // client's level, but only exist for a player with no hearts left:
    // picking one up hides the rest, and spending that life brings them back
    // (except any near where it was spent: see useSpareLife).
    // In co-op, pickups you took stay in the level (flagged `mine`) so a
    // spectating view can still show them for a teammate who hasn't.
    visiblePickups() {
        const hearts = this.state.hearts <= 0;
        const block = this.state.heartBlockWY;
        const blocked = p => block !== null && block !== undefined && p.wy >= block;
        return this.powerups.filter(p => !p.mine && (!p.isHeart || (hearts && !blocked(p))));
    }

    // While you're down: the level as the teammate you're watching sees it,
    // without what they've taken, and hearts only if they have none left.
    spectatePickups(rp) {
        const hearts = (rp.hearts || 0) <= 0;
        return this.powerups.filter(p => !(rp.picked && rp.picked.has(p.wy)) && (hearts || !p.isHeart));
    }

    // While you're down, the teammate you're watching pulls pickups in with
    // their MAGNET (or a gem-magnet Pixel) just as on their own screen.
    pullForSpectated(rp, dt) {
        const ability = (rp.skin && rp.skin.ability) || {};
        const magnet = rp.activePower === POWERS.MAGNET;
        if (!magnet && !ability.gemMagnetRadius) return;
        this.spectatePickups(rp).forEach(p => {
            if (magnet) rp.pullPickup(p, 200, dt);
            if (p.isGem && ability.gemMagnetRadius) rp.pullPickup(p, ability.gemMagnetRadius, dt);
        });
    }

    // A teammate took a pickup. If we're watching them, show it go.
    applyRemotePick(d) {
        const rp = this.remotePlayers.get(d.pid);
        if (!rp || !rp.picked) return;
        rp.picked.add(d.wy);
        if (!this.player.isDead || this.spectatingPlayer !== rp) return;
        const p = this.powerups.find(q => q.wy === d.wy);
        if (!p) return;
        const color = p.isGem ? BIOMES[p.tier || 0].gem.color : p.isHeart ? "#ff3366" : (rp.activePower ? rp.activePower.color : "#ffffff");
        this.particles.spawn(p.x + p.w / 2, p.y + p.h / 2, color, p.isGem ? 10 : 20);
    }

    collectHeart(event) {
        if (this.state.hearts < MAX_HEARTS) this.setHearts(this.state.hearts + 1);
        this.particles.spawn(event.x + 14, event.y + 14, "#ff3366", 20);
        sounds.play('heart');
        this.notify("HEART +1", 'heart');
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
    // Screen y where the displayed score reaches `meters`: the line meets
    // the player exactly as the score passes it.
    scoreLineY(meters) {
        return CONFIG.HEIGHT * CONFIG.SCROLL_THRESHOLD - (meters * 10 - (this.state.score + (this.state.bonusScore || 0)));
    }

    // A dashed line across the level at your high score from before this run.
    // It stays put as you climb (it slides toward you only when score comes
    // without height: SCORE x2, a boss bonus), meets your Pixel exactly as
    // you set a new high score, then scrolls away below. Not shown on a first
    // run or from a checkpoint start already above it.
    drawBestLine() {
        const best = this.state.bestMarkerScore;
        if (!(best > 0) || best <= (this.state.startMeters || 0)) return;
        const y = this.scoreLineY(best);
        if (y < this.renderer.viewTop - 20 || y > CONFIG.HEIGHT + 20) return;
        const ctx = this.renderer.ctx;
        ctx.save();
        ctx.strokeStyle = '#ff3366';
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 2;
        if (ctx.setLineDash) ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CONFIG.WIDTH, y);
        ctx.stroke();
        // The label sits on a dark tab so platforms behind it can't swallow it.
        const label = 'HIGH SCORE ' + fmtNum(best) + 'm';
        const font = 'bold 15px Orbitron, sans-serif';
        ctx.font = font;
        const w = (ctx.measureText ? ctx.measureText(label).width : label.length * 10) + 16;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#0a0a0e';
        ctx.fillRect(4, y - 24, w, 22);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff3366';
        ctx.fillRect(4, y - 24, 3, 22);
        ctx.restore();
        this.renderer.drawText(label, 12, y - 8, font, '#ff3366', 'left');
    }

    drawChallengeLine() {
        if (!this.challengeActive() || this.state.challengeBeaten) return;
        const ctx = this.renderer.ctx;
        const y = this.scoreLineY(this.challenge.meters);
        if (y < this.renderer.viewTop - 20 || y > CONFIG.HEIGHT + 20) return;
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

        if (this.catchWithNet(forceDie)) return;

        this.state.runDeaths = (this.state.runDeaths || 0) + 1;
        if (this.useSpareLife()) return;

        sounds.play('death');
        this.particles.spawn(this.player.x + 13, this.player.y + 13, this.player.color, 40, "blast");

        this.state.running = false;
        this.updateTouchControls(); // not over a revive prompt

        // With ads off there is no revive offer: hearts are the only lives.
        if (ADS_ENABLED && !this.state.revived) {
            this.ads.showRevivePrompt(
                () => { this.revive(); },
                () => { this.gameOver(); }
            );
        } else {
            this.gameOver();
        }
    }

    // A fall or hit that would end the run (solo) or knock you out (co-op)
    // spends a heart instead, if there is one. Returns true if the player was
    // saved.
    useSpareLife() {
        if (this.consumeHeart()) {
            // Hearts only show at 0 lives, so one already on screen would
            // appear now and could be grabbed on the rebound. Hide any heart
            // from this screen and the next one up.
            this.state.heartBlockWY = -this.state.score - CONFIG.HEIGHT;
            this.rescuePlayer("#ff3366", "HEART SPENT — " + this.state.hearts + " LEFT");
            return true;
        }
        return false;
    }

    // Bounces the player back in on a red rescue net, behind a fresh HARD
    // SHIELD, with a red notice (a life is gone).
    rescuePlayer(color, text) {
        this.deployRescueNet();
        this.player.grantPower(POWERS.SHIELD);
        sounds.play('heart_lost');
        this.particles.spawn(this.player.x + 13, this.player.y + 13, color, 30, "blast");
        this.showAlert(text, 'life');
    }

    handleMultiplayerDeath(forceDie) {
        if (this.player.isDead) return;
        if (this.catchWithNet(forceDie)) return;

        this.state.runDeaths = (this.state.runDeaths || 0) + 1;
        if (this.useSpareLife()) return;

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
        this.player.grantPower(POWERS.SHIELD);

        if (window.network) window.network.send({ type: 'revive', pid: window.network.myId });
        this.showAlert("LIFE RESTORED", 'success');
    }

    revive() {
        this.state.revived = true;
        this.state.running = true;
        // Keys pressed on the revive prompt (Space on WATCH AD, mashing)
        // must not turn into a jump that overrides the revive bounce.
        this.input.resetInput();
        this.lastTime = performance.now();

        this.deployRescueNet();
        this.player.grantPower(POWERS.SHIELD);

        this.showAlert("LIFE RESTORED", 'success');
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
        this.clearNotices();
        this.hideAlert();

        this.ui.menuLast.innerText = "LAST RUN: " + fmtNum(finalScore) + "m";
        this.ui.menuLast.hidden = false;
        this.ui.menuScore.innerText = "HIGH SCORE: " + fmtNum(this.state.highScore) + "m";
        this.updateFameUI();
        this.updateSkinUI();
        this.renderGemShop();
        this.updateHeartUI();
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
        if (this.ui.spectateHud) this.ui.spectateHud.hidden = true;
        this.spectating = null;
        this.spectatingPlayer = null;
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
                // New Pixels are announced like the game's other notices;
                // everything else gets the achievement badge.
                if (g.skin) this.notify(label, 'unlock', { icon: this.pixelPreviewHTML(g.skin, 'alert-pixel') });
                else this.showAchievement(label, "🏅");
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
        sounds.play('reward');
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
        const hazards = this.renderer.currentBiome.hazards;
        const perks = this.player.skin.ability || {};
        // SHIELDED perk: the biome's environmental forces (wind, gravity
        // pulses, control glitches) pass the player by. Physical obstacles —
        // meteors, lasers, moving platforms — still count.
        const envImmune = !!perks.biomeImmune;

        if (this.renderer.currentBiome.name !== this.lastBiomeName) {
            if (this.lastBiomeName) { // skip the callout on the very first frame of a run
                this.notify("ENTERING " + this.renderer.currentBiome.name.toUpperCase(), 'info');
            }
            this.lastBiomeName = this.renderer.currentBiome.name;
        }

        this.recordGhost();

        // Boss fights: one every BOSS_LOOP_DISTANCE metres of this run. It
        // drops in from above the screen.
        const authority = this.isAuthority();
        if (authority && !this.state.bossActive && scoreMeters >= this.state.nextBossAt) {
            this.state.bossActive = true;
            this.enemies.push(new BossDrone(-120));
        }

        // Spawn Enemies (only if Boss isn't active). The spawn clock keeps
        // ticking at the cap; only the spawn itself is skipped.
        const droneEvery = Math.max(CONFIG.DRONE_MIN_SPAWN_RATE, Math.floor(CONFIG.DRONE_SPAWN_RATE - scoreMeters / 50));
        if (authority && !this.state.bossActive && scoreMeters > 60 && this.tick('drone', dt, droneEvery)
            && this.countEnemies(Drone) < this.droneCap(scoreMeters)) {
            const difficulty = 1 + (scoreMeters / 2000) + (this.state.runLoops || 0);

            // Spawned relative to the camera's player (the lowest living one
            // in co-op), so everyone sees them arrive.
            const spawnY = this.bossFocus().y - 500;
            if (scoreMeters > 300 && Math.random() < Math.min(0.5, (scoreMeters - 300) / 2400)) {
                this.enemies.push(new ShooterDrone(spawnY, difficulty));
            } else {
                this.enemies.push(new Drone(spawnY, difficulty));
            }
        }

        if (authority && !this.state.bossActive && hazards.includes('laser') && this.tick('laser', dt, 240)
            && this.countEnemies(LaserDrone) < CONFIG.LASER_CAP) {
            this.enemies.push(new LaserDrone(this.bossFocus().y - 500));
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
        let event = this.player.isDead ? null : this.player.update(dt, this.input, this.platforms, this.visiblePickups());
        if (this.state.multiplayer && this.player.isDead && this.spectatingPlayer) this.pullForSpectated(this.spectatingPlayer, dt);

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
        if (authority && hazards.includes('meteor') && this.tick('meteor', dt, 90)) {
            let startX = Math.random() * CONFIG.WIDTH;
            let vx = (Math.random() - 0.5) * 4;
            let vy = 4 + Math.random() * 5;
            this.projectiles.push(new Meteor(startX, this.bossFocus().y - 800, vx, vy));
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
            if (this.tick('trail', dt, 2))
                this.particles.spawn(this.player.x + 13, this.player.y + 13, this.player.color, 1, "trail");
        } else if (event === "thrust") {
            this.particles.spawn(this.player.x + 13, this.player.y + 26, "#ff3300", 2, "blast");
        } else if (event && event.event === "gem") {
            this.addGems((event.value || 1) * (perks.gemMult || 1));
            this.particles.spawn(event.x + 8, event.y + 8, event.color || "#00ffff", 10);
            sounds.play('reward');
        } else if (event && event.event === "heart") {
            this.collectHeart(event);
        } else if (event && event.event === "powerup") {
            this.state.powersCollected++;
            this.particles.spawn(event.x + 12, event.y + 12, this.player.activePower.color, 20);
            sounds.play('powerup');
        }

        this.updateDronePulse(dt, perks);

        let enemyDt = dt;
        if (this.partyTimeWarp()) enemyDt *= 0.3;

        if (this.state.multiplayer) this.remotePlayers.forEach(rp => this.followRemote(rp, dt));

        // Enemy Update
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            let e = this.enemies[i];

            if (!authority) {
                this.followNetEnemy(e, enemyDt);
            } else if (e instanceof ShooterDrone) {
                e.update(enemyDt, this.nearestPlayer(e), this.projectiles);
            } else if (e instanceof BossDrone) {
                e.update(enemyDt, this.bossFocus(), this.projectiles, this.state.multiplayer ? () => this.nextDiveTarget() : undefined);
            } else {
                e.update(enemyDt);
            }

            if (e.markedForDeletion) {
                if (e instanceof BossDrone) {
                    if (authority) {
                        this.onBossDefeated();
                        if (this.state.multiplayer) window.network.send({ type: 'boss_down' });
                    } else {
                        this.state.bossActive = false;
                    }
                }
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
                    this.destroyHostile(e);
                    this.particles.spawn(this.player.x, this.player.y, POWERS.ROCKET.color, 20, "blast");
                    sounds.play('reward');
                    continue;
                }
                if (this.player.activePower && this.player.activePower.name === "HARD SHIELD") {
                    this.player.activePower = null;
                    this.destroyHostile(e);
                    this.particles.spawn(this.player.x, this.player.y, "#00ffaa", 20, "blast");
                    sounds.play('reward');
                    continue;
                }
                this.die(true);
            }
        }

        // Projectile Update
        if (authority && this.state.multiplayer) this.announceProjectiles();
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            let p = this.projectiles[i];
            p.update(enemyDt);
            if (p.markedForDeletion) {
                this.projectiles.splice(i, 1);
                continue;
            }
            if (this.player.invuln > 0 || this.player.isDead) continue;
            if (rectsIntersect(this.player, p)) {
                if (this.player.activePower === POWERS.ROCKET) {
                    this.player.activePower = null;
                    this.player.powerTimer = 0;
                    this.destroyHostile(p);
                    this.particles.spawn(this.player.x, this.player.y, POWERS.ROCKET.color, 20, "blast");
                    sounds.play('reward');
                    continue;
                }
                if (this.player.activePower && this.player.activePower.name === "HARD SHIELD") {
                    this.player.activePower = null;
                    this.destroyHostile(p);
                    this.particles.spawn(this.player.x, this.player.y, "#00ffaa", 20, "blast");
                    sounds.play('reward');
                    continue;
                }
                this.die(true); // Projectiles are deadly
            }
        }

        this.particles.update(dt);
        this.updateSafetyNet(dt);
        if (this.state.multiplayer) {
            if (authority) this.broadcastEnemies(dt);
            this.updateSpectateHud();
        }

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
                activePowerId: this.player.activePower ? this.player.activePower.id : null,
                pf: Math.round(this.powerFraction(perks) * 100) / 100,
                hl: this.state.hearts
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
            this.notify("TARGET BEATEN!", 'reward');
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

        this.updatePowerHud(perks);

        if (this.state.multiplayer) {
            // Co-op: a pickup you took is only gone for you (see
            // visiblePickups); the party hears so spectators see it go.
            this.powerups.forEach(p => {
                if (!p.markedForDeletion) return;
                p.markedForDeletion = false;
                if (p.mine) return;
                p.mine = true;
                if (window.network && Number.isInteger(p.wy)) window.network.send({ type: 'pick', pid: window.network.myId, wy: p.wy });
            });
        } else {
            this.powerups = this.powerups.filter(p => !p.markedForDeletion);
        }
    }

    draw() {
        this.renderer.clear(this.state.bgOffset);
        this.renderer.drawGrid(this.state.bgOffset);
        if (this.state.running && this.settings.showTips) this.drawTips();

        this.platforms.forEach(p => {
            this.renderer.ctx.fillStyle = "#333";
            this.renderer.ctx.fillRect(p.x, p.y, p.w, p.h);
            this.renderer.ctx.fillStyle = this.renderer.currentBiome.platform;
            this.renderer.ctx.fillRect(p.x, p.y, p.w, 3);
            this.renderer.ctx.fillStyle = "rgba(0, 255, 204, 0.1)";
            this.renderer.ctx.fillRect(p.x, p.y, 3, p.h);
            this.renderer.ctx.fillRect(p.x + p.w - 3, p.y, 3, p.h);
        });

        const shownPickups = this.state.multiplayer && this.player.isDead && this.spectatingPlayer
            ? this.spectatePickups(this.spectatingPlayer)
            : this.visiblePickups();
        shownPickups.forEach(p => {
            p.y = p.startY + Math.sin(this.state.time * 0.1) * 5;
            if (p.isHeart) {
                this.drawSprite(this.heartSprite, p, 0.85 + 0.15 * Math.sin(this.state.time * 0.15));
            } else if (p.isGem) {
                // Pre-rendered in the gem's biome colour, with its glow; the
                // pulse is just the sprite's opacity.
                const ctx = this.renderer.ctx;
                const sprite = this.gemSprites && this.gemSprites[p.tier || 0];
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

        this.enemies.forEach(e => this.drawFadingIn(e));
        this.projectiles.forEach(p => this.drawFadingIn(p));

        if (this.state.running && this.settings.showGhost) this.drawGhost();
        if (this.state.running) this.drawBestLine();
        if (this.state.running) this.drawChallengeLine();

        this.renderer.drawSafetyNet(this.safetyNet, this.safetyNet.rescue ? RESCUE_NET_COLOR : POWERS.SAFETY.color, this.state.time);
        if (this.state.running && !this.player.isDead) this.renderer.drawWrapEdges(this.player.x, this.player.w);

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

    // Spawns aimed just off the top of the 800-tall frame (meteors, the boss,
    // drones) can land inside the extra sky of a tall view. Anything that
    // first shows up there fades in over SPAWN_FADE_FRAMES instead of popping
    // into existence. Purely cosmetic: spawn timing is the same everywhere.
    drawFadingIn(e) {
        const ctx = this.renderer.ctx;
        if (e.shownAt === undefined) {
            const inSky = e.y < 0 && e.y + (e.h || 0) > this.renderer.viewTop;
            e.shownAt = inSky ? this.state.time : -Infinity;
        }
        const a = (this.state.time - e.shownAt) / SPAWN_FADE_FRAMES;
        if (a >= 1) { e.draw(ctx); return; }
        ctx.globalAlpha = Math.max(0, a);
        e.draw(ctx);
        ctx.globalAlpha = 1;
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
    // Before Game reads any save: leave the old host, or unpack saves that
    // just arrived from it.
    const transfer = runSaveTransfer();
    if (transfer === 'redirect') return;
    const game = new Game();
    if (transfer === 'imported') game.notify('PROGRESS TRANSFERRED', 'success');

    // Installable / offline play. Only on the live https site (or a local
    // server opened with ?sw), so local development never serves stale
    // cached files.
    const wantSW = location.protocol === 'https:' || new URLSearchParams(location.search).has('sw');
    if (wantSW && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
    }
};
