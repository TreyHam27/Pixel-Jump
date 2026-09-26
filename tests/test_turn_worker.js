const fs = require('fs');
const path = require('path');

// The Cloudflare TURN Worker (cloudflare/turn-worker/worker.js): only the
// game's own origins get logins, the secret token stays server-side, and the
// reply is the bare iceServers array js/network.js expects, minus port 53.
const src = fs.readFileSync(path.join(__dirname, '..', 'cloudflare/turn-worker/worker.js'), 'utf8')
    .replace('export default', 'const worker =') + '\nmodule.exports = worker;';
const m = { exports: {} };
new Function('module', 'fetch', 'Response', 'URL', src)(m, (...a) => global.__upstream(...a), Response, URL);
const worker = m.exports;

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const env = {
    TURN_KEY_ID: 'kid', TURN_API_TOKEN: 'secret-token',
    ALLOWED_ORIGINS: 'https://pixeljump.example, https://*.pixel-jump.pages.dev, http://localhost:8765'
};
const req = (origin, method = 'GET') => new Request('https://turn.example/', { method, headers: origin ? { Origin: origin } : {} });

let upstreamCalls = [];
function upstream(body, ok = true) {
    upstreamCalls = [];
    global.__upstream = (url, opts) => {
        upstreamCalls.push({ url, opts });
        return Promise.resolve({ ok, json: () => Promise.resolve(body) });
    };
}
const CF_BODY = {
    iceServers: [{
        urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53',
            'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'u', credential: 'c'
    }]
};

(async () => {
    // ---- Allowed origins get the array; the token went to Cloudflare only.
    for (const origin of ['https://pixeljump.example', 'https://abc123.pixel-jump.pages.dev', 'http://localhost:8765']) {
        upstream(CF_BODY);
        const res = await worker.fetch(req(origin), env);
        assert(res.status === 200, origin + " allowed, got " + res.status);
        assert(res.headers.get('Access-Control-Allow-Origin') === origin, "CORS echoes " + origin);
        assert(res.headers.get('Cache-Control') === 'no-store', "never cached");
        const body = await res.json();
        assert(Array.isArray(body) && body.length === 1, "bare array");
        assert(body[0].urls.length === 3 && !body[0].urls.some(u => /:53/.test(u)), "port 53 dropped: " + body[0].urls);
        assert(body[0].username === 'u' && body[0].credential === 'c', "login kept");
        assert(!JSON.stringify(body).includes('secret-token'), "token never returned");
        const call = upstreamCalls[0];
        assert(call.url === 'https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers', "right endpoint");
        assert(call.opts.headers.Authorization === 'Bearer secret-token', "token sent upstream");
    }
    console.log("ALLOWED SUCCESS");

    // ---- Everyone else is refused without touching Cloudflare.
    for (const origin of [null, 'https://evil.example', 'https://pixeljump.example.evil.com', 'http://pixeljump.example',
        'https://pixel-jump.pages.dev.evil.com', 'https://abc.other.pages.dev', 'not a url']) {
        upstream(CF_BODY);
        const res = await worker.fetch(req(origin), env);
        assert(res.status === 403, origin + " refused, got " + res.status);
        assert(!res.headers.get('Access-Control-Allow-Origin'), "no CORS for " + origin);
        assert(upstreamCalls.length === 0, "no upstream call for " + origin);
    }
    console.log("REFUSED SUCCESS");

    // ---- Preflight and other methods.
    upstream(CF_BODY);
    let res = await worker.fetch(req('https://pixeljump.example', 'OPTIONS'), env);
    assert(res.status === 204 && upstreamCalls.length === 0, "preflight answered locally");
    res = await worker.fetch(req('https://pixeljump.example', 'POST'), env);
    assert(res.status === 405, "POST refused");
    console.log("METHODS SUCCESS");

    // ---- Older single-object shape, and upstream failure.
    upstream({ iceServers: { urls: 'turn:t:3478', username: 'u', credential: 'c' } });
    res = await worker.fetch(req('https://pixeljump.example'), env);
    const body = await res.json();
    assert(body.length === 1 && body[0].urls[0] === 'turn:t:3478', "single object normalized");
    upstream({}, false);
    res = await worker.fetch(req('https://pixeljump.example'), env);
    assert(res.status === 502, "upstream failure is a 502 (game falls back to STUN)");
    console.log("SHAPES SUCCESS");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
