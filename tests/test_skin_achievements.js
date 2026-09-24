const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Regression test for skin unlocks surfacing as achievements: crossing a skin's
// high-score threshold records a badge, pops it once, queues simultaneous
// unlocks instead of clobbering them, and back-fills silently for players who
// already passed those thresholds before the feature existed.
eval(loadGameSource() + `
try {
    const earnedSkins = SKINS.filter(s => s.unlock > 0);
    const gemSkins = SKINS.filter(s => s.cost !== undefined);

    // Every distance-gated skin should have an achievement; bought ones should not.
    earnedSkins.forEach(s => {
        if (!ACHIEVEMENTS.some(a => a.skin && a.name === s.name)) {
            throw new Error("No achievement for distance-gated skin: " + s.name);
        }
    });
    gemSkins.forEach(s => {
        if (ACHIEVEMENTS.some(a => a.skin && a.name === s.name)) {
            throw new Error("Gem-shop skin should not be an achievement: " + s.name);
        }
    });
    if (ACHIEVEMENTS.some(a => a.skin && a.name === SKINS[0].name)) {
        throw new Error("The starter skin (unlock: 0) should not be an achievement");
    }
    console.log("ACHIEVEMENT PER EARNED SKIN SUCCESS");

    // A fresh player has earned nothing and the carousel agrees.
    const game = new Game();
    const first = earnedSkins[0];
    const firstId = 'skin:' + first.name;
    if (game.achievements.includes(firstId)) {
        throw new Error("A brand-new player should not start with skin achievements");
    }

    // Cross the first skin's threshold: badge recorded, popped, and persisted.
    game.state.bestHeight = first.unlock;
    game.checkAchievements();
    if (!game.achievements.includes(firstId)) {
        throw new Error("Reaching the unlock distance did not record the skin achievement");
    }
    if (game.isSkinLocked(SKINS.indexOf(first))) {
        throw new Error("Skin should be unlocked at its threshold");
    }
    const popped = game.ui.achievement.innerText;
    if (!popped.includes(first.name) || !popped.includes("SKIN UNLOCKED")) {
        throw new Error("Popup should name the unlocked skin, got: " + popped);
    }
    const stored = JSON.parse(localStorage.getItem('lp_achievements'));
    if (!stored.includes(firstId)) throw new Error("Skin achievement was not persisted");
    console.log("UNLOCK POPS AND PERSISTS SUCCESS");

    // Re-checking at the same score must not re-award or re-pop it.
    game.ui.achievement.innerText = '';
    game.checkAchievements();
    if (game.achievements.filter(id => id === firstId).length !== 1) {
        throw new Error("Skin achievement was awarded twice");
    }
    if (game.ui.achievement.innerText !== '') {
        throw new Error("An already-earned achievement popped a second time");
    }
    console.log("NO DUPLICATE AWARD SUCCESS");

    // Two unlocks in one frame: the first shows, the rest wait their turn.
    const second = earnedSkins[1];
    const third = earnedSkins[2];
    game.achievementQueue = [];
    game.achievementShowing = false;
    game.state.bestHeight = third.unlock;
    game.checkAchievements();
    if (!game.achievements.includes('skin:' + second.name) ||
        !game.achievements.includes('skin:' + third.name)) {
        throw new Error("Skipping past several thresholds should award every skin passed");
    }
    if (!game.ui.achievement.innerText.includes(second.name)) {
        throw new Error("First of the batch should be on screen, got: " + game.ui.achievement.innerText);
    }
    if (!game.achievementQueue.some(t => t.includes(third.name))) {
        throw new Error("Simultaneous unlock was dropped instead of queued");
    }
    console.log("SIMULTANEOUS UNLOCKS QUEUE SUCCESS");

    // A returning player mid-climb: skins already earned are back-filled
    // silently, and the next one still pops normally.
    localStorage.removeItem('lp_achievements');
    localStorage.removeItem('lp_skin_achievements_seeded');
    localStorage.setItem('lp_best', String(third.unlock));

    const returning = new Game();
    if (!returning.achievements.includes('skin:' + third.name)) {
        throw new Error("Already-earned skins should be back-filled on load");
    }
    if (returning.achievementQueue.length !== 0 || returning.achievementShowing) {
        throw new Error("Back-filled skins should not pop popups");
    }
    const laterSkin = earnedSkins.find(s => s.unlock > third.unlock);
    if (returning.achievements.includes('skin:' + laterSkin.name)) {
        throw new Error("Back-fill awarded a skin the player has not reached");
    }
    returning.state.bestHeight = laterSkin.unlock;
    returning.checkAchievements();
    if (!returning.ui.achievement.innerText.includes(laterSkin.name)) {
        throw new Error("A new unlock after back-fill should still pop");
    }
    console.log("BACKFILL IS SILENT SUCCESS");

    // Seeding runs once: a later load must not re-seed over earned history.
    const third2 = new Game();
    if (!third2.achievements.includes('skin:' + laterSkin.name)) {
        throw new Error("Earned achievements should survive a reload");
    }
    console.log("SEED RUNS ONCE SUCCESS");
} catch (e) {
    console.error("CRASH:", e.stack);
    process.exitCode = 1;
}
`);
