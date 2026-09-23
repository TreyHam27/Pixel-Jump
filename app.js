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
        this.achievements = JSON.parse(localStorage.getItem('lp_achievements')) || [];

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
            boughtBoost: localStorage.getItem('lp_boughtBoost') === '1',
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
            menuShards: document.getElementById("menu-shards"),
            shopBoostBtn: document.getElementById("shop-boost-btn"),

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

        this.bindEvents();
        this.updateSkinUI();
        this.updateFameUI();

        if (this.state.boughtBoost && this.ui.shopBoostBtn) {
            this.ui.shopBoostBtn.innerText = "BOOST ACTIVE!";
            this.ui.shopBoostBtn.style.color = "#00ffaa";
        }

        this.ui.menuScore.innerText = "HIGH SCORE: " + this.state.highScore + "m";

        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    bindEvents() {
        this.ui.prev.onclick = (e) => { e.stopPropagation(); this.changeSkin(-1); };
        this.ui.next.onclick = (e) => { e.stopPropagation(); this.changeSkin(1); };

        if (this.ui.shopBoostBtn) {
            this.ui.shopBoostBtn.onclick = (e) => {
                e.stopPropagation();
                if (this.state.shards >= 50 && !this.state.boughtBoost) {
                    this.state.shards -= 50;
                    this.state.boughtBoost = true;
                    localStorage.setItem('lp_shards', this.state.shards);
                    localStorage.setItem('lp_boughtBoost', '1');
                    this.ui.shopBoostBtn.innerText = "BOOST ACTIVE!";
                    this.ui.shopBoostBtn.style.color = "#00ffaa";
                    this.updateSkinUI();
                } else if (!this.state.boughtBoost) {
                    this.shakeUI();
                }
            };
        }

        this.ui.menu.onclick = (e) => {
            if (e.target.closest('#skin-container') || e.target.closest('#shop-container') || e.target.closest('.mode-switch-arrow')) return;
            if (this.isSkinLocked()) {
                this.shakeUI();
            } else {
                this.startGame();
            }
        };

        // Multiplayer UI Bindings
        if (this.ui.toMpBtn) {
            this.ui.toMpBtn.onclick = () => {
                this.ui.menuLayer1.style.transform = 'translateX(-100%)';
                this.ui.menuLayer2.style.transform = 'translateX(0)';
                let savedName = localStorage.getItem('lp_mp_name');
                if (savedName) this.ui.mpNameInput.value = savedName;
            };
            this.ui.toSpBtn.onclick = () => {
                this.ui.menuLayer1.style.transform = 'translateX(0)';
                this.ui.menuLayer2.style.transform = 'translateX(100%)';
            };

            this.ui.mpNameInput.addEventListener('input', (e) => {
                localStorage.setItem('lp_mp_name', e.target.value.trim());
            });

            this.ui.mpHostBtn.onclick = async () => {
                this.ui.mpHostBtn.disabled = true;
                this.ui.mpStatus.innerText = "GENERATING CODE...";
                this.ui.mpStatus.style.color = "#ffaa00";

                try {
                    let code = await window.network.host();
                    this.ui.mpHostCode.innerText = code;
                    this.ui.mpStatus.innerText = "WAITING FOR GUEST...";
                    this.ui.mpStatus.style.color = "#00ffaa";
                } catch (err) {
                    this.ui.mpStatus.innerText = "HOST FAILED — TRY AGAIN";
                    this.ui.mpStatus.style.color = "#ff3300";
                    this.ui.mpHostBtn.disabled = false;
                }
            };

            this.ui.mpJoinBtn.onclick = async () => {
                const code = this.ui.mpJoinInput.value.trim();
                if (code.length === 6) {
                    this.ui.mpJoinBtn.disabled = true;
                    this.ui.mpStatus.innerText = "CONNECTING...";
                    this.ui.mpStatus.style.color = "#ffaa00";
                    try {
                        await window.network.join(code);
                    } catch (err) {
                        this.ui.mpStatus.innerText = "CONNECTION FAILED — TRY AGAIN";
                        this.ui.mpStatus.style.color = "#ff3300";
                        this.ui.mpJoinBtn.disabled = false;
                    }
                } else {
                    this.ui.mpStatus.innerText = "INVALID CODE";
                    this.ui.mpStatus.style.color = "#ff3300";
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
                this.ui.mpStatus.innerText = "CONNECTED!";
                this.ui.mpStatus.style.color = "#00ffcc";

                let name = this.ui.mpNameInput.value.trim() || 'Player';

                if (window.network.isHost) {
                    this.state.isHost = true;
                    this.ui.mpStartBtn.style.display = 'block';
                } else {
                    this.state.isHost = false;
                    this.ui.mpStatus.innerText = "SYNCHRONIZING...";

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
                this.ui.mpStatus.innerText = "DISCONNECTED";
                this.ui.mpStatus.style.color = "#ff3300";
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
                this.ui.mpStatus.innerText = msg;
                this.ui.mpStatus.style.color = "#ff3300";
                this.ui.mpHostBtn.disabled = false;
                this.ui.mpJoinBtn.disabled = false;
            };

            window.network.onStatus = (msg) => {
                this.ui.mpStatus.innerText = msg;
                this.ui.mpStatus.style.color = "#ffaa00";
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
            this.ui.mpStatus.innerText = "READY TO START";
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

    isSkinLocked() {
        return this.state.highScore < SKINS[this.viewParams.skinIndex].unlock;
    }

    updateSkinUI() {
        let s = SKINS[this.viewParams.skinIndex];
        let locked = this.isSkinLocked();

        this.ui.preview.style.backgroundColor = s.color;
        this.ui.eyesL.style.backgroundColor = s.eye;
        this.ui.eyesR.style.backgroundColor = s.eye;
        this.ui.skinName.innerText = s.name;

        if (locked) {
            this.ui.skinStatus.innerText = "LOCKED (" + s.unlock + "m)";
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

        if (this.ui.menuShards) this.ui.menuShards.innerText = this.state.shards;
        if (this.ui.shardDisplay) this.ui.shardDisplay.innerText = "💎 " + this.state.shards;
    }

    shakeUI() {
        this.ui.startBtn.classList.remove('shake');
        void this.ui.startBtn.offsetWidth;
        this.ui.startBtn.classList.add('shake');
    }

    // Centralized system alert popup (run status, revive countdowns, loop rewards, etc).
    showAlert(text, type = 'info') {
        const icons = { info: '⚙', success: '✓', warning: '⏳', danger: '⚠', reward: '🏆', pulse: '⏱' };
        const el = this.ui.alert;
        el.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-danger', 'alert-reward', 'alert-pulse');
        el.classList.add('alert-' + type, 'alert-visible');
        this.ui.alertIcon.innerText = icons[type] || icons.info;
        this.ui.alertText.innerText = text;
    }

    hideAlert() {
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

    reset(seed = null) {
        this.state.score = 0;
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
        this.remotePlayer = null;

        this.ui.power.style.opacity = 0;
        this.showAlert("Initializing...", 'info');
    }

    spawnPlatform(y) {
        let rand = this.seededRandom();
        let w = 100 + rand * 80;
        let x = this.seededRandom() * (CONFIG.WIDTH - w);

        let vx = 0;
        let movingChance = Math.max(0, Math.min(0.4, (this.state.score - 5000) / 20000));
        if (this.state.score > 5000 && this.seededRandom() < movingChance) {
            vx = (this.seededRandom() > 0.5 ? 1 : -1) * (0.5 + this.seededRandom() * 1.5);
            w = Math.max(70, w - 30);
        }

        this.platforms.push({ x, y, w, h: 18, vx });

        let chance = 0.08 * (1 - (this.state.score / 8000));
        if (chance < 0) chance = 0;
        if (this.seededRandom() < chance) {
            this.powerups.push({
                x: x + w / 2 - 12,
                y: y - 40,
                startY: y - 40,
                w: 24, h: 24,
                isShard: false,
                markedForDeletion: false
            });
        } else if (this.seededRandom() < 0.25) { // 25% chance of a Shard
            this.powerups.push({
                x: x + w / 2 - 8,
                y: y - 30,
                startY: y - 30,
                w: 16, h: 16,
                isShard: true,
                markedForDeletion: false
            });
        }
    }

    startGame(isMp = false, mpSeed = null) {
        this.state.running = true;
        this.state.multiplayer = isMp;
        this.state.deathCount = 0;
        this.reset(isMp ? mpSeed : null);

        if (this.state.boughtBoost) {
            this.player.activePower = POWERS.SHIELD;
            this.player.powerTimer = POWERS.SHIELD.time;
            this.state.boughtBoost = false;
            localStorage.removeItem('lp_boughtBoost');
            if (this.ui.shopBoostBtn) {
                this.ui.shopBoostBtn.innerText = "BUY BOOST (50 💎)";
                this.ui.shopBoostBtn.style.color = "#00ffff";
            }
        }

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
            this.particles.spawn(this.player.x, CONFIG.HEIGHT, POWERS.SAFETY.color, 30);
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

        if (this.state.isNewBest && this.state.ghostRecord) {
            localStorage.setItem('lp_ghost', JSON.stringify(this.state.ghostRecord));
        }
        if (!this.state.multiplayer) {
            this.updateFame(Math.floor(this.state.score / 10));
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
                this.ui.mpStatus.innerText = "WAITING FOR HOST TO RESTART...";
            }
        }

        this.ui.hud.style.opacity = 0;
        this.ui.power.style.opacity = 0;
        this.hideAlert();

        let finalScore = Math.floor(this.state.score / 10);
        this.ui.menuLast.innerText = "LAST RUN: " + finalScore + "m";
        this.ui.menuScore.innerText = "HIGH SCORE: " + this.state.highScore + "m";
        this.updateFameUI();
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
        this.ui.fame.innerHTML = fame.map((f, i) => `<div>${i + 1}. ${f.score}m - ${f.skin}</div>`).join('');
    }

    checkAchievements() {
        const goals = [
            { id: '1km', name: 'Kilometer Club', condition: () => this.state.score >= 10000 },
            { id: '5km', name: 'Stratosphere', condition: () => this.state.score >= 50000 },
            { id: 'magnet', name: 'Attractive', condition: () => this.player.activePower && this.player.activePower.name === "MAGNET" },
            { id: 'pacifist', name: 'Pacifist Pilot', condition: () => this.state.score >= 50000 && this.state.powersCollected === 0 },
            { id: 'boss', name: 'Titan Slayer', condition: () => this.state.loops >= 1 },
            { id: 'rich', name: 'Data Hoarder', condition: () => this.state.shards >= 100 }
        ];

        goals.forEach(g => {
            if (g.condition() && !this.achievements.includes(g.id)) {
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

        if (this.state.frames % 5 === 0) {
            if (!this.state.ghostRecord) this.state.ghostRecord = [];
            this.state.ghostRecord.push({
                x: Math.round(this.player.x),
                y: Math.round(this.player.y - this.state.score)
            });
        }

        // Boss Fights & Loop Management
        if (this.state.score > 0) {
            let targetLoop = Math.floor(scoreMeters / 10000);
            if (targetLoop > (this.state.loops || 0)) {
                if (!this.state.bossActive) {
                    this.state.bossActive = true;
                    this.enemies.push(new BossDrone(this.player.y - 600));
                }
            }
        }

        // Spawn Enemies (only if Boss isn't active)
        if (!this.state.bossActive && scoreMeters > 200 && this.state.frames % Math.max(60, Math.floor(droneSpawnRate - (scoreMeters / 100))) === 0) {
            const difficulty = 1 + (scoreMeters / 2000) + (this.state.loops || 0);

            if (scoreMeters > 1000 && Math.random() < Math.min(0.5, (scoreMeters - 1000) / 4000)) {
                this.enemies.push(new ShooterDrone(this.player.y - 500, difficulty));
            } else {
                this.enemies.push(new Drone(this.player.y - 500, difficulty));
            }
        }

        let event = this.player.update(dt, this.input, this.platforms, this.powerups);

        // Invisible ceiling in multiplayer so the fast player doesn't go off screen
        if (this.state.multiplayer && this.remotePlayer && !this.player.isDead && !this.remotePlayer.isDead) {
            if (this.player.y < 0) {
                this.player.y = 0;
                if (this.player.vy < 0) this.player.vy = 0; // head bump
            }
        }

        // Environmental Hazards
        if (scoreMeters > 1000 && scoreMeters < 3000) {
            let wind = Math.sin(this.state.time * 0.05) * 0.3;
            this.player.vx += wind * dt;
            this.particles.particles.forEach(p => p.vx += wind * dt * 0.1);
        }
        if (scoreMeters > 6000 && this.state.frames % 90 === 0) {
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
            this.state.shards++;
            localStorage.setItem('lp_shards', this.state.shards);
            if (this.ui.shardDisplay) this.ui.shardDisplay.innerText = "💎 " + this.state.shards;
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
