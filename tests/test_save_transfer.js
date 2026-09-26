const { setupMocks, loadGameSource } = require('./test_helpers');

setupMocks();

// Moving hosts: the old host packs lp_ saves into the new URL's #hash and
// redirects; the new host unpacks them once, never over real progress, and
// clears the hash. With NEW_ORIGIN empty nothing happens at all.
eval(loadGameSource() + `
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// A Storage-like fake with length/key(), like the browser's.
function makeStorage(init = {}) {
    const m = new Map(Object.entries(init));
    return {
        get length() { return m.size; },
        key: i => [...m.keys()][i] ?? null,
        getItem: k => m.has(k) ? m.get(k) : null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        dump: () => Object.fromEntries(m)
    };
}
function makeLoc(hostname, search = '', hash = '') {
    return { hostname, search, hash, pathname: '/', replaced: null, replace(u) { this.replaced = u; } };
}
function makeHist(loc) {
    return { calls: 0, replaceState(_s, _t, url) { this.calls++; loc.hash = ''; loc.url = url; } };
}
const NEW = 'https://pixeljump.example/';
const OLD_SAVE = {
    lp_best: '4200', lp_best_height: '3900', lp_gems: '75', lp_hearts: '2',
    lp_skin: 'neon', lp_owned_skins: '["neon"]', lp_achievements: '["a1","a2"]',
    lp_settings: '{"sound":false}', lp_mp_name: 'Zoë 🚀', lp_ghost: '[1,2,3]',
    other_site_key: 'x'
};

// ---- Bridge off: NEW_ORIGIN empty does nothing, even on the old host.
{
    const loc = makeLoc('treyham27.github.io');
    assert(NEW_ORIGIN === '', "the bridge ships switched off");
    assert(runSaveTransfer(loc, makeStorage(OLD_SAVE), makeHist(loc)) === null, "no transfer while off");
    assert(loc.replaced === null, "no redirect while off");
    console.log("BRIDGE OFF SUCCESS");
}

// ---- Old host: redirect with every lp_ save except the ghost, keeping ?query.
let redirectUrl;
{
    const loc = makeLoc('treyham27.github.io', '?c=abc');
    const r = runSaveTransfer(loc, makeStorage(OLD_SAVE), makeHist(loc), NEW);
    assert(r === 'redirect', "old host redirects, got " + r);
    redirectUrl = loc.replaced;
    assert(redirectUrl.startsWith(NEW + '?c=abc#pjsave='), "query kept, save in hash: " + redirectUrl);
    const data = JSON.parse(fromBase64Url(redirectUrl.split('#pjsave=')[1]));
    assert(data.v === 1, "versioned payload");
    assert(!('lp_ghost' in data.d), "ghost left behind");
    assert(!('other_site_key' in data.d), "only lp_ keys");
    assert(data.d.lp_mp_name === 'Zoë 🚀', "unicode survives");
    assert(Object.keys(data.d).length === 9, "9 saves packed, got " + Object.keys(data.d).length);
    console.log("EXPORT SUCCESS");
}

// ---- Old host with no saves: plain redirect.
{
    const loc = makeLoc('treyham27.github.io');
    runSaveTransfer(loc, makeStorage({}), makeHist(loc), NEW);
    assert(loc.replaced === NEW, "empty save redirects bare, got " + loc.replaced);
    console.log("EMPTY EXPORT SUCCESS");
}

// ---- New host, fresh: import round-trips exactly, hash cleared, game reads it.
{
    const hash = redirectUrl.slice(redirectUrl.indexOf('#'));
    const loc = makeLoc('pixeljump.example', '?c=abc', hash);
    const hist = makeHist(loc);
    // A first load already wrote these; they aren't progress.
    const store = makeStorage({ lp_achievements: '[]', lp_skin_achievements_seeded: '1' });
    const r = runSaveTransfer(loc, store, hist, NEW);
    assert(r === 'imported', "fresh origin imports, got " + r);
    assert(hist.calls === 1 && loc.url === '/?c=abc', "hash cleared, query kept: " + loc.url);
    const got = store.dump();
    for (const [k, v] of Object.entries(OLD_SAVE)) {
        if (k === 'lp_ghost' || k === 'other_site_key') assert(!(k in got), k + " not imported");
        else assert(got[k] === v, k + " round-trips: " + got[k]);
    }
    // The game starts from the transferred save.
    const real = localStorage;
    global.localStorage = store;
    try {
        const g = new Game();
        assert(g.state.gems === 75 && g.state.bestHeight === 3900 && g.state.hearts === 2, "game reads transferred save");
    } finally { global.localStorage = real; }
    console.log("IMPORT SUCCESS");
}

// ---- New host with real progress: never overwritten, hash still cleared.
{
    const hash = redirectUrl.slice(redirectUrl.indexOf('#'));
    const loc = makeLoc('pixeljump.example', '', hash);
    const hist = makeHist(loc);
    const store = makeStorage({ lp_gems: '5' });
    const r = runSaveTransfer(loc, store, hist, NEW);
    assert(r === null, "existing progress blocks import");
    assert(store.getItem('lp_gems') === '5' && store.getItem('lp_best') === null, "nothing overwritten");
    assert(hist.calls === 1, "hash cleared anyway");
    console.log("NO OVERWRITE SUCCESS");
}

// ---- Untrusted payloads are refused whole.
{
    const pack = obj => toBase64Url(JSON.stringify(obj));
    const bad = [
        '!!!not-base64',
        toBase64Url('not json'),
        pack({ v: 2, d: { lp_gems: '1' } }),
        pack({ v: 1, d: [] }),
        pack({ v: 1, d: {} }),
        pack({ v: 1, d: { lp_gems: '1', evil_key: 'x' } }),
        pack({ v: 1, d: { 'lp_Gems': '1' } }),
        pack({ v: 1, d: { lp_gems: 99 } }),
        pack({ v: 1, d: { lp_ghost: '[]' } }),
        pack({ v: 1, d: { lp_stats: 'x'.repeat(SAVE_TRANSFER_MAX_VALUE + 1) } }),
        pack({ v: 1, d: { lp_a: 'x'.repeat(60000), lp_b: 'x'.repeat(60000), lp_c: 'x'.repeat(60000), lp_d: 'x'.repeat(60000), lp_e: 'x'.repeat(60000) } })
    ];
    for (const p of bad) {
        const store = makeStorage();
        assert(importSaves(store, p) === false, "refused: " + p.slice(0, 40));
        assert(store.length === 0, "nothing written for a refused payload");
    }
    console.log("UNTRUSTED SUCCESS");
}

// ---- New host with no hash, or an unrelated hash: nothing happens.
{
    for (const hash of ['', '#top']) {
        const loc = makeLoc('pixeljump.example', '', hash);
        const hist = makeHist(loc);
        assert(runSaveTransfer(loc, makeStorage(), hist, NEW) === null, "no-op for " + JSON.stringify(hash));
        assert(hist.calls === 0 && loc.replaced === null, "URL untouched");
    }
    console.log("NO HASH SUCCESS");
}
`);
