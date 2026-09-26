// Moving hosts. Saves live in localStorage, which browsers keep per origin, so
// a new domain would start every player from scratch. On the old host
// (OLD_HOSTS) the page packs the lp_ saves into the new URL's #hash and
// redirects; the new host unpacks them once, before Game reads any save.
// The hash never reaches a server. NEW_ORIGIN empty = the bridge is off.

const SAVE_TRANSFER_PREFIX = '#pjsave=';
// The daily ghost is large and only good for today; everything else moves.
const SAVE_TRANSFER_SKIP = ['lp_ghost'];
const SAVE_TRANSFER_MAX_VALUE = 64 * 1024;
const SAVE_TRANSFER_MAX_TOTAL = 256 * 1024;

function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function exportSaves(storage) {
    const d = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith('lp_') && !SAVE_TRANSFER_SKIP.includes(key)) d[key] = storage.getItem(key);
    }
    return Object.keys(d).length ? toBase64Url(JSON.stringify({ v: 1, d })) : '';
}

// A save that has actually been played. A fresh origin writes a few keys on
// its first load (achievements, flags), which don't count.
function hasProgress(storage) {
    return ['lp_best_height', 'lp_best', 'lp_gems'].some(k => (parseInt(storage.getItem(k)) || 0) > 0);
}

// Returns true if saves were written. Never overwrites a save with progress,
// so a stale link or a second trip through the old host can't roll anyone back.
function importSaves(storage, payload) {
    let data;
    try { data = JSON.parse(fromBase64Url(payload)); } catch (e) { return false; }
    if (!data || data.v !== 1 || !data.d || typeof data.d !== 'object' || Array.isArray(data.d)) return false;
    const entries = Object.entries(data.d);
    let total = 0;
    for (const [k, v] of entries) {
        if (!/^lp_[a-z_]+$/.test(k) || SAVE_TRANSFER_SKIP.includes(k)) return false;
        if (typeof v !== 'string' || v.length > SAVE_TRANSFER_MAX_VALUE) return false;
        total += v.length;
    }
    if (!entries.length || total > SAVE_TRANSFER_MAX_TOTAL) return false;
    if (hasProgress(storage)) return false;
    try {
        for (const [k, v] of entries) storage.setItem(k, v);
    } catch (e) { return false; }
    return true;
}

// Runs before new Game(). Returns 'redirect' (old host: leave, don't start),
// 'imported' (saves arrived, tell the player) or null.
function runSaveTransfer(loc = location, storage = localStorage, hist = history, target = NEW_ORIGIN) {
    if (!target) return null;
    try {
        if (OLD_HOSTS.includes(loc.hostname)) {
            const payload = exportSaves(storage);
            // Keep ?challenge links working across the move.
            loc.replace(target + (loc.search || '') + (payload ? SAVE_TRANSFER_PREFIX + payload : ''));
            return 'redirect';
        }
        const hash = loc.hash || '';
        if (!hash.startsWith(SAVE_TRANSFER_PREFIX)) return null;
        // Take the save out of the address bar either way, so it isn't
        // bookmarked or shared.
        hist.replaceState(null, '', loc.pathname + (loc.search || ''));
        return importSaves(storage, hash.slice(SAVE_TRANSFER_PREFIX.length)) ? 'imported' : null;
    } catch (e) {
        console.warn('Save transfer skipped:', e && e.message);
        return null;
    }
}
