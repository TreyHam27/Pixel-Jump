const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Input regression tests: physical key codes, stuck keys, per-finger touch
// tracking, menu-start guards and the stale "grounded" re-jump.
// The container/canvas mocks record listeners so pointer events can be fired.
const listeners = {};
const realGet = document.getElementById;
document.getElementById = (id) => {
    const el = realGet(id);
    if (id === 'game-container') el.addEventListener = (type, fn) => { listeners[type] = fn; };
    if (id === 'gameCanvas') el.getBoundingClientRect = () => ({ left: 0, width: 400 });
    return el;
};

eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const key = (code, extra = {}) => Object.assign({ code, target: null, repeat: false, preventDefault() { this.prevented = true; } }, extra);
const ptr = (id, clientX, extra = {}) => Object.assign({ pointerId: id, pointerType: 'touch', clientX, target: { closest: () => null }, preventDefault() {} }, extra);

try {
    // Keys by physical code: Caps Lock / Shift ('A') and AZERTY don't matter.
    const input = new InputHandler();
    input.onKeyDown(key('KeyA'));
    assert(input.keys.left, "KeyA moves left");
    input.onKeyUp(key('KeyA'));
    assert(!input.keys.left, "releasing KeyA stops");
    input.onKeyDown(key('ArrowRight'));
    input.onKeyDown(key('KeyD'));
    input.onKeyUp(key('ArrowRight'));
    assert(input.keys.right, "still held by the other right key");
    input.resetInput();
    assert(!input.keys.right && input.keys.buffer === 0, "blur/tab-hide releases everything");
    input.onKeyDown(key('Space'));
    assert(input.keys.buffer > 0, "Space buffers a jump");
    const typing = key('KeyA', { target: { closest: () => ({}) } });
    input.resetInput();
    input.onKeyDown(typing);
    assert(!input.keys.left, "typing a name doesn't steer");

    // No usable e.code (IMEs, remote desktops): fall back to the character.
    input.resetInput();
    input.onKeyDown(key('', { key: 'A' }));
    assert(input.keys.left, "e.key 'A' moves left when e.code is empty");
    input.onKeyUp(key('', { key: 'a' }));
    assert(!input.keys.left, "...and releases on keyup");
    // AZERTY: the key labelled A is KeyQ; it moves left and lets go cleanly.
    input.onKeyDown(key('KeyQ', { key: 'a' }));
    assert(input.keys.left, "the key labelled A moves left on AZERTY");
    input.onKeyUp(key('KeyQ', { key: 'a' }));
    assert(!input.keys.left, "...and releases");

    // Shortcuts aren't moves, and letting go of Cmd releases everything
    // (macOS never sends the keyup of a key released under Cmd).
    input.onKeyDown(key('KeyD', { key: 'd', ctrlKey: true }));
    assert(!input.keys.right, "Ctrl+D is a shortcut, not a move");
    input.onKeyDown(key('KeyD', { key: 'd' }));
    input.onKeyUp(key('MetaLeft', { key: 'Meta' }));
    assert(!input.keys.right, "releasing Cmd releases held keys");

    // A focused checkbox or slider (left over from Settings) doesn't eat keys;
    // only text fields do.
    const checkbox = { closest: (sel) => sel === 'input, textarea, select' ? {} : null };
    input.onKeyDown(key('KeyA', { key: 'a', target: checkbox }));
    assert(input.keys.left, "a focused checkbox doesn't block movement");
    input.resetInput();
    console.log("KEY CODES SUCCESS");

    // preventDefault only mid-run (menus keep normal keyboard behaviour).
    const menuKey = key('Space');
    input.onKeyDown(menuKey);
    assert(!menuKey.prevented, "menu keys aren't swallowed");
    input.isActive = () => true;
    const runKey = key('Space');
    input.onKeyDown(runKey);
    assert(runKey.prevented, "Space is swallowed mid-run");
    console.log("PREVENT DEFAULT SUCCESS");

    // Touch: each finger is tracked; sliding between zones hands over, and
    // lifting releases exactly what that finger held.
    input.resetInput();
    listeners.pointerdown(ptr(1, 50));             // left quarter
    assert(input.keys.left && !input.keys.right, "finger 1 holds left");
    listeners.pointermove(ptr(1, 150));            // slides into the right-move zone
    assert(!input.keys.left && input.keys.right, "slide hands over to right");
    listeners.pointerup(ptr(1, 150));
    assert(!input.keys.left && !input.keys.right, "lift releases (no stuck left)");
    listeners.pointerdown(ptr(2, 60));
    listeners.pointerdown(ptr(3, 300));            // right half: jump
    assert(input.keys.left && input.keys.buffer > 0, "move and jump with two fingers");
    listeners.pointercancel(ptr(2, 60));
    assert(!input.keys.left, "cancel releases");
    input.resetInput();
    listeners.pointerdown(ptr(4, 50, { target: { closest: () => ({}) } }));
    assert(!input.keys.left, "touches on buttons/menus are left alone");
    input.isActive = () => false;
    listeners.pointerdown(ptr(5, 50));
    assert(!input.keys.left, "no gameplay touches outside a run");
    console.log("TOUCH TRACKING SUCCESS");

    // Menu start guards.
    const game = new Game();
    assert(game.canQuickStart(key('Space')), "Space starts from the solo menu");
    assert(!game.canQuickStart(key('Space', { repeat: true })), "a held key's auto-repeat never starts a run");
    game.activeMenuPanel = 'shop';
    assert(!game.canQuickStart(key('Space')), "not from the shop");
    game.activeMenuPanel = 'sp';
    game.ads.reviveOverlay = { style: { display: 'flex' } };
    assert(!game.canQuickStart(key('Space')), "not under the revive prompt");
    game.ads.reviveOverlay = { style: { display: 'none' } };
    let starts = 0;
    const origStart = game.startGame.bind(game);
    game.startGame = (...a) => { starts++; return origStart(...a); };
    game.requestSoloStart();
    game.requestSoloStart(); // a second click during the fade-out
    assert(starts === 1, "double start is ignored, started " + starts);
    assert(!game.canQuickStart(key('Space')), "no quick start mid-run");
    console.log("START GUARDS SUCCESS");

    // Arrow keys in the shop: browse the Pixels, Enter/Space buys or equips.
    const shop = new Game();
    shop.activeMenuPanel = 'shop';
    const tiers = shop.gemShopSkins().length;
    shop.gemShopIndex = 0;
    assert(shop.canMenuKey(key('ArrowRight'), 'shop') && !shop.canQuickStart(key('ArrowRight')), "shop keys, not solo keys");
    shop.handleShopKey(key('ArrowRight'));
    shop.handleShopKey(key('KeyD'));
    assert(shop.gemShopIndex === 2, "right / D step forward, at " + shop.gemShopIndex);
    shop.handleShopKey(key('ArrowLeft'));
    shop.handleShopKey(key('ArrowLeft'));
    shop.handleShopKey(key('ArrowLeft'));
    assert(shop.gemShopIndex === tiers - 1, "left wraps around to the top tier");
    let clicks = 0;
    const buyBtn = { disabled: false, click() { clicks++; } };
    shop.ui.gemShop.querySelector = (sel) => sel === '.gem-skin-buy-btn' ? buyBtn : null;
    const enter = key('Enter');
    shop.handleShopKey(enter);
    shop.handleShopKey(key('Space'));
    assert(clicks === 2 && enter.prevented, "Enter and Space press BUY");
    shop.handleShopKey(key('Enter', { target: { closest: (sel) => sel === 'button' ? {} : null } }));
    assert(clicks === 2, "a focused button handles its own Enter");
    buyBtn.disabled = true;
    shop.handleShopKey(key('Enter'));
    assert(clicks === 2, "EQUIPPED (disabled) isn't pressed");
    shop.activeMenuPanel = 'sp';
    assert(!shop.canMenuKey(key('ArrowRight'), 'shop'), "no shop keys off the shop");
    console.log("SHOP KEYS SUCCESS");

    // Holding jump can't chain re-jumps off a stale grounded flag.
    const p = new Player(100, 500);
    const floor = [{ x: 0, y: 526, w: 600, h: 20 }];
    const fake = { keys: { left: false, right: false, buffer: 0 } };
    p.vy = 1;
    p.update(1, fake, floor, []);
    assert(p.grounded, "standing on the floor");
    let top = p.y;
    for (let i = 0; i < 60; i++) {
        fake.keys.buffer = 6; // jump held down every single frame
        p.update(1, fake, floor, []);
        top = Math.min(top, p.y);
    }
    assert(500 - top < 200, "one jump's height (~145px), not a flight: rose " + Math.round(500 - top));
    console.log("NO REJUMP SUCCESS");

    // A jump pressed on the revive prompt can't weaken the revive bounce.
    const rg = new Game();
    rg.startGame();
    rg.player.grounded = true; rg.player.coyote = 8; // died standing on a platform
    rg.input.keys.buffer = 6;                        // Space on WATCH AD / mashing
    rg.revive();
    rg.update(1);
    assert(rg.player.vy < CONFIG.JUMP_FORCE, "revive keeps its bounce, vy " + rg.player.vy);
    // Same for a spent extra life mid-run (the key is really held then).
    const eg = new Game();
    eg.startGame();
    eg.state.extraLives = 1;
    eg.player.grounded = true; eg.player.coyote = 8;
    eg.die(true);
    eg.input.keys.buffer = 6;
    eg.update(1);
    assert(eg.player.vy < CONFIG.JUMP_FORCE, "extra-life launch isn't replaced by a hop, vy " + eg.player.vy);
    console.log("REVIVE BOUNCE SUCCESS");
} catch (e) {
    console.error("FAILED:", e.stack || e);
    process.exitCode = 1;
}
`);
