# Vendored libraries

## peerjs.min.js

- **What:** PeerJS 1.5.2 (WebRTC data channels for co-op), MIT License, https://github.com/peers/peerjs
- **Source:** `https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js`
  - upstream SHA-256: `29e6ad48ce4552a35a348dc55ee7a5657db89cf9de229dbc56292d1be35867e8`
- **Local change:** only the trailing `//# sourceMappingURL=peerjs.min.js.map` line was removed, because the map isn't shipped.
  - local SHA-256: `6782de98f4339c1d7664275b0e8c13e1e6a95259951c64994c04883d535f5ee8`

It's served locally, not from the CDN, for three reasons:
- the service worker can cache it for offline play;
- the page no longer waits on a third-party script;
- the exact code is pinned.

To upgrade: download the new `dist/peerjs.min.js`, remove its source-map comment, update both hashes above, and bump `NET_PROTOCOL` in `js/config.js` if the upgrade changes the wire format.
