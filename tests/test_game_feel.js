const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Pause, settings, the end-of-run card, lifetime stats, the Records screen,
// story beats and the first-run controls hint.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

try {
    // ---- Pause freezes a solo run; auto-pause on leaving the tab.
    let g = new Game();
    g.startGame();
    g.update(1);
    const t0 = g.state.time;
    g.pauseGame();
    assert(g.state.paused && g.pauseMenuOpen && !g.ui.pauseOverlay.hidden, "pause screen up, run frozen");
    assert(!g.input.isActive(), "gameplay input is released while paused");
    g.update(1); g.update(1);
    assert(g.state.time === t0, "no game time passes while paused");
    g.resumeGame();
    g.update(1);
    assert(g.state.time > t0 && !g.state.paused, "resume continues the run");
    g.autoPause();
    assert(g.state.paused, "leaving the tab pauses a solo run");
    g.togglePause();
    assert(!g.state.paused, "Esc/P toggles back");
    console.log("PAUSE SUCCESS");

    // ---- Co-op: the menu opens but the run keeps going.
    window.network = { myId: 'me', send() {} };
    const mp = new Game();
    mp.startMultiplayerGame(5);
    mp.autoPause();
    assert(!mp.pauseMenuOpen, "no auto-pause in co-op");
    mp.pauseGame();
    const m0 = mp.state.time;
    mp.update(1);
    assert(mp.pauseMenuOpen && !mp.state.paused && mp.state.time > m0, "co-op keeps running under the menu");
    assert(mp.ui.pauseQuitBtn.innerText === 'LEAVE PARTY', "co-op offers leaving the party");
    console.log("COOP PAUSE SUCCESS");

    // ---- Quit ends the run straight away, with stats and the run card.
    localStorage.removeItem('lp_stats');
    g = new Game();
    g.startGame();
    g.addShards(15);
    g.state.powersCollected = 2;
    g.state.score = 12000;
    g.player.y = 400; g.player.vy = 0;
    g.update(1); // the frame that notices the new best
    g.pauseGame();
    g.quitRun();
    assert(!g.state.running && !g.pauseMenuOpen, "quit ends the run");
    assert(g.runCardOpen && !g.ui.runCard.hidden, "run card shown");
    assert(g.ui.runCardDistance.innerText === '1,200m', "distance on the card, got " + g.ui.runCardDistance.innerText);
    assert(g.ui.runCardStats.innerHTML.includes('15 💎') && g.ui.runCardStats.innerHTML.includes('>2<'), "gems and power-ups this run");
    assert(g.ui.runCardBest.hidden === false, "new best flagged");
    const stats = JSON.parse(localStorage.getItem('lp_stats'));
    assert(stats.runs === 1 && stats.gems === 15 && stats.powerups === 2 && stats.meters === 1200, "lifetime stats saved: " + JSON.stringify(stats));
    assert(!g.canQuickStart({ code: 'Space', repeat: false, target: null }), "menu quick-start waits for the card");
    g.runCardPlayAgain();
    assert(g.state.running && !g.runCardOpen, "PLAY AGAIN starts a new run");
    console.log("RUN CARD SUCCESS");

    // ---- Lives lost are counted, revives included.
    g.die(true);          // free continue (ads off)
    g.die(true);          // game over
    assert(g.stats.livesLost === 2, "two lives lost, got " + g.stats.livesLost);
    console.log("DEATH STATS SUCCESS");

    // ---- Settings persist and apply.
    g.openSettings();
    assert(g.settingsOpen && Number(g.ui.setVolume.value) === 80, "settings open with current values");
    g.settings.volume = 0.3; g.settings.showGhost = false; g.settings.reducedMotion = true;
    g.saveSettings(); g.applySettings();
    g.closeSettings();
    assert(sounds.volume === 0.3, "volume applied");
    const g2 = new Game();
    assert(g2.settings.volume === 0.3 && g2.settings.showGhost === false && g2.settings.reducedMotion === true, "settings reload");
    g2.startGame();
    let ghostDrawn = false;
    g2.drawGhost = () => { ghostDrawn = true; };
    g2.draw();
    assert(!ghostDrawn, "ghost hidden when turned off");
    assert(g2.particles.scale < 1, "reduced motion thins particles");
    g2.particles.spawn(0, 0, '#fff', 40, 'blast');
    assert(g2.particles.particles.length < 40, "fewer particles per burst");
    localStorage.setItem('lp_settings', '{broken');
    assert(new Game().settings.volume === 0.8, "corrupt settings fall back to defaults");
    console.log("SETTINGS SUCCESS");

    // ---- Records: stats and achievements, secret Pixels masked.
    localStorage.removeItem('lp_settings');
    g = new Game();
    g.renderRecords();
    const list = g.ui.recordsList.innerHTML;
    assert(list.includes('Kilometer Club') && list.includes('Climb to 1,000m'), "achievements listed with descriptions");
    assert(!list.includes('Rift Diver') && list.includes('???'), "unearned secret Pixels stay hidden");
    assert(/\\d+ \\/ \\d+/.test(g.ui.recordsCount.innerText), "earned count shown");
    assert(g.ui.recordsStats.innerHTML.includes('RUNS'), "lifetime stats shown");
    g.achievements.push('skin:Rift Diver');
    g.renderRecords();
    assert(g.ui.recordsList.innerHTML.includes('Rift Diver'), "earned secret Pixel revealed");
    console.log("RECORDS SUCCESS");

    // ---- Story beats appear as heights are passed.
    g = new Game();
    g.startGame();
    let alerts = [];
    g.showAlert = (text) => alerts.push(text);
    g.state.score = 400; // 40m
    g.player.y = 400; g.player.vy = 0;
    g.update(1);
    assert(alerts.some(t => /baseline altitude/.test(t)), "first story beat at 30m, got " + JSON.stringify(alerts));
    console.log("STORY SUCCESS");

    // ---- The controls hint shows on the very first run only.
    localStorage.removeItem('lp_seen_hint');
    g = new Game();
    g.startGame();
    assert(g.hintShowing && g.ui.controlsHint.hidden === false, "hint on the first run");
    g.gameOver();
    assert(!g.hintShowing, "hint cleared at game over");
    g.startGame();
    assert(!g.hintShowing, "not shown again");
    console.log("HINT SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
