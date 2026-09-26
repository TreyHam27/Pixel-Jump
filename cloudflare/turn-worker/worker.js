// Hands out short-lived Cloudflare Realtime TURN logins for co-op.
// The game's TURN_CREDENTIALS_URL (js/config.js) points here. The TURN key's
// API token must stay secret, so the browser asks this Worker, which asks
// Cloudflare, and returns a bare iceServers array (the shape
// sanitizeIceServers() in js/network.js expects).
//
// Secrets (wrangler secret put): TURN_KEY_ID, TURN_API_TOKEN.
// Vars (wrangler.toml): ALLOWED_ORIGINS, comma-separated; an entry may start
// with "*." to match any subdomain (Pages preview builds).

const CREDENTIAL_TTL_S = 86400; // outlives any co-op run; the game refetches every 30 min

function allowedOrigin(origin, list) {
    if (!origin) return false;
    let host;
    try { host = new URL(origin); } catch (e) { return false; }
    return list.split(',').map(s => s.trim()).filter(Boolean).some(entry => {
        if (!entry.includes('*.')) return entry === origin;
        const [scheme, rest] = entry.split('://');
        const suffix = rest.slice(1); // ".project.pages.dev"
        return host.protocol === scheme + ':' && host.host.endsWith(suffix);
    });
}

function reply(body, status, origin) {
    const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Vary': 'Origin'
    };
    if (origin) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    }
    return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        // Only the game's own pages get logins, so other sites can't spend
        // the free TURN allowance. (Not a lock against scripts that fake
        // the header; the monthly cap is the real backstop.)
        if (!allowedOrigin(origin, env.ALLOWED_ORIGINS || '')) return reply({ error: 'forbidden' }, 403, null);
        if (request.method === 'OPTIONS') return reply(null, 204, origin);
        if (request.method !== 'GET') return reply({ error: 'method' }, 405, origin);

        const res = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ttl: CREDENTIAL_TTL_S })
            }
        );
        if (!res.ok) return reply({ error: 'upstream' }, 502, origin);
        const data = await res.json();
        const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers].filter(Boolean);
        // Browsers refuse port 53, and trying it just slows ICE down.
        const servers = list.map(s => {
            const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(u => typeof u === 'string' && !/:53(\?|$)/.test(u));
            return { ...s, urls };
        }).filter(s => s.urls.length);
        return reply(servers, 200, origin);
    }
};
