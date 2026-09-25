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
    g.addGems(15);
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

    // ---- No story chatter: climbing past the old story heights says
    // nothing, but a new biome is still announced.
    g = new Game();
    g.startGame();
    let alerts = [];
    g.showAlert = (text) => alerts.push(text);
    g.state.score = 400; // 40m
    g.player.y = 400; g.player.vy = 0;
    g.update(1);
    assert(!alerts.some(t => /SYSTEM/.test(t)), "no story messages, got " + JSON.stringify(alerts));
    g.state.score = 6100; // 610m: Ionosphere
    g.update(1);
    const announced = alerts.concat(g.noticeQueue.map(n => n.text));
    assert(announced.includes("ENTERING IONOSPHERE"), "biome changes still announced, got " + JSON.stringify(announced));
    g.clearNotices();
    console.log("NO STORY SUCCESS");

    // ---- Notices take turns: a Pixel unlock and a biome change in the
    // same frame both show, in order.
    g = new Game();
    g.startGame();
    alerts = [];
    const realShow = g.showAlert.bind(g);
    g.showAlert = (text, type) => { alerts.push(text); realShow(text, type); };
    g.notify("ENTERING THE RIFT");
    g.notify("PIXEL UNLOCKED: Rift Diver", 'unlock');
    assert(alerts.length === 1 && g.noticeQueue.length === 1, "the second notice waits its turn");
    g.showNextNotice();
    assert(alerts[1] === "PIXEL UNLOCKED: Rift Diver", "then it shows");
    g.clearNotices();
    console.log("NOTICE QUEUE SUCCESS");

    // ---- Tips are painted onto the start of every run and scroll away;
    // SHOW TIPS turns them off.
    const tipTexts = (game) => {
        const drawn = [];
        const real = game.renderer.drawText.bind(game.renderer);
        game.renderer.drawText = (text, ...rest) => { drawn.push(text); real(text, ...rest); };
        game.draw();
        game.renderer.drawText = real;
        return drawn.join(' | ');
    };
    g = new Game();
    g.startGame();
    assert(/WRAP AROUND/.test(tipTexts(g)) && /TO MOVE/.test(tipTexts(g)), "tips on the starting screen");
    g.scrollCamera(1200);
    assert(!/WRAP AROUND|TO MOVE/.test(tipTexts(g)), "tips scroll away as you climb");
    g.gameOver();
    g.startGame();
    assert(/TO MOVE/.test(tipTexts(g)), "shown again on the next run");
    g.settings.showTips = false;
    assert(!/WRAP AROUND|TO MOVE/.test(tipTexts(g)), "SHOW TIPS off hides them");
    console.log("TIPS SUCCESS");

    // ---- Your high score is marked in the level and stays put.
    const bestTexts = (game) => {
        const drawn = [];
        const real = game.renderer.drawText.bind(game.renderer);
        game.renderer.drawText = (text, x, y, ...rest) => { drawn.push([text, y]); real(text, x, y, ...rest); };
        game.draw();
        game.renderer.drawText = real;
        return drawn.filter(([t]) => /^HIGH SCORE/.test(t));
    };
    g = new Game();
    g.state.highScore = 0;
    g.startGame();
    assert(bestTexts(g).length === 0, "no marker without a previous high score");
    g.state.highScore = 20;
    g.startGame();
    let marks = bestTexts(g);
    assert(marks.length === 1 && marks[0][0] === 'HIGH SCORE 20m', "marker at the previous high score, got " + JSON.stringify(marks));
    const y0 = marks[0][1];
    g.scrollCamera(100);
    g.state.highScore = 30; // climbing raises highScore; the marker stays at 20m
    marks = bestTexts(g);
    assert(marks.length === 1 && marks[0][0] === 'HIGH SCORE 20m' && marks[0][1] === y0 + 100, "marker is fixed in the level");
    g.state.bonusScore += 50; // score without height (SCORE x2, boss bonus) brings it closer
    marks = bestTexts(g);
    assert(marks.length === 1 && marks[0][1] === y0 + 150, "bonus score moves it with the score");
    g.scrollCamera(2000);
    assert(bestTexts(g).length === 0, "scrolls away once passed");
    console.log("BEST LINE SUCCESS");

    // ---- TOUCH BUTTONS only shows on touch screens.
    g = new Game();
    g.coarsePointer = false;
    g.openSettings();
    assert(g.ui.setTouchRow.hidden === true, "hidden on desktop");
    g.closeSettings();
    g.coarsePointer = true;
    g.openSettings();
    assert(g.ui.setTouchRow.hidden === false, "shown on touch screens");
    g.closeSettings();
    console.log("TOUCH SETTING ROW SUCCESS");

    // ---- Keyboard on the run card: Enter on a focused button is that
    // button (MENU means menu), otherwise Space/Enter is PLAY AGAIN.
    g = new Game();
    g.startGame();
    g.state.running = false;
    g.gameOver();
    const key = (code, target) => ({ code, repeat: false, target, preventDefault() {} });
    const onButton = { closest: sel => sel === 'button' ? {} : null };
    assert(g.handleRunCardKey(key('Enter', onButton)) === false && !g.state.running, "Enter on a focused MENU button isn't PLAY AGAIN");
    assert(g.handleRunCardKey({ ...key('Space', null), repeat: true }) === false, "a held key never restarts");
    assert(g.handleRunCardKey(key('Space', null)) === true && g.state.running, "Space with nothing focused plays again");
    console.log("RUN CARD KEYS SUCCESS");

    // ---- Paused time doesn't count as play time.
    let clock = 1000;
    performance.now = () => clock;
    g = new Game();
    g.startGame();
    clock += 10000;          // 10s of play
    g.pauseGame();
    clock += 600000;         // 10 minutes paused (tabbed out)
    g.resumeGame();
    clock += 5000;           // 5s more
    assert(Math.round(g.runSeconds()) === 15, "run time excludes the pause, got " + g.runSeconds());
    g.pauseGame();
    clock += 60000;
    g.quitRun();             // quit from the pause menu: that pause doesn't count either
    assert(g.ui.runCardStats.innerHTML.includes('0:15'), "run card shows 0:15");
    console.log("PAUSED TIME SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
