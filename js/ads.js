/**
 * AdManager - real ad network integration points behind a small, stable seam:
 * showRevivePrompt(), showInterstitialAd(), and the side ad rails.
 *
 * Rollout plan (see the approved plan for full context):
 *  - Rewarded revive: AppLixir (https://www.applixir.com). Once the account
 *    is approved, add their SDK script tag to index.html and fill in the
 *    marked block inside playRewardedVideo() with the real call - the exact
 *    method names come from AppLixir's integration docs, not guessed here.
 *  - Interstitial + side skin: GameDistribution or AdInPlay, once approved -
 *    fill in showInterstitialAd() and the network branch of renderSideSkin().
 *  - Google AdSense (H5 Games Ads): optional blended demand layer if/when
 *    approved, slots into the same two methods alongside the above.
 *
 * Until a given network is live, its slot degrades gracefully instead of
 * blocking or looking broken - see each method below.
 */
class AdManager {
    constructor() {
        this.reviveOverlay = document.getElementById('revive-overlay');
        this.reviveBtn = document.getElementById('revive-btn');
        this.reviveSkip = document.getElementById('revive-skip');
        this.videoMock = document.getElementById('ad-video-mock');
        this.countdown = document.getElementById('ad-countdown');
        this.railLeft = document.getElementById('ad-rail-left');
        this.railRight = document.getElementById('ad-rail-right');

        this.isDev = ['localhost', '127.0.0.1', ''].includes(location.hostname);
        this.rewardedNetworkReady = this.detectRewardedNetwork();

        this.renderSideSkin();
    }

    /** Is a real rewarded-ad SDK present on the page? */
    detectRewardedNetwork() {
        // return typeof window.Applixir !== 'undefined';
        return false; // no network wired in yet - see class docblock
    }

    showRevivePrompt(onWatch, onSkip) {
        this.reviveOverlay.style.display = 'flex';

        this.reviveBtn.onclick = () => {
            this.playRewardedVideo(onWatch);
        };

        this.reviveSkip.onclick = () => {
            this.reviveOverlay.style.display = 'none';
            onSkip();
        };
    }

    /**
     * Plays a rewarded video ad and calls onComplete once the reward is
     * earned. If no rewarded network is wired in yet, the player is never
     * left stuck on a dead "watch ad" button: dev keeps a visual mock so the
     * revive flow can still be exercised locally, production just grants the
     * revive outright.
     */
    playRewardedVideo(onComplete) {
        this.reviveOverlay.style.display = 'none';

        if (this.rewardedNetworkReady) {
            // --- AppLixir integration goes here once approved ---
            // Call onComplete() on adViewed/earned. On error/no-fill, also
            // call onComplete() (not a skip/fail path) - a failed ad load
            // should never block a revive the player already asked for.
            onComplete();
            return;
        }

        if (this.isDev) {
            this.playMockVideo(onComplete);
            return;
        }

        onComplete();
    }

    /** Local-only stand-in so the revive UI/timing can be tested without a live ad account. */
    playMockVideo(onComplete) {
        this.videoMock.style.display = 'flex';

        let timeLeft = 3;
        this.countdown.innerText = '0:0' + timeLeft;

        const timer = setInterval(() => {
            timeLeft--;
            this.countdown.innerText = '0:0' + Math.max(timeLeft, 0);

            if (timeLeft <= 0) {
                clearInterval(timer);
                this.videoMock.style.display = 'none';
                onComplete();
            }
        }, 1000);
    }

    /**
     * Shows an interstitial ad on restart (see app.js gameOver()). No-ops
     * until GameDistribution/AdInPlay is wired in - see class docblock.
     */
    showInterstitialAd() {
        console.log('[ads] interstitial placeholder - no network wired in yet');
    }

    /**
     * Fills the side rails beside the game: a real network's skin/wallpaper
     * tag once one is live, a lightweight house ad in the meantime. Never
     * falls back to empty space or placeholder "AD SPACE" text.
     */
    renderSideSkin() {
        const houseAd = () => {
            const el = document.createElement('div');
            el.className = 'ad-rail-house';
            el.innerHTML = `
                <div class="ad-rail-house-logo">PIXEL JUMP</div>
                <div class="ad-rail-house-text">Climb higher. Beat your best.</div>
            `;
            return el;
        };

        if (this.railLeft) this.railLeft.appendChild(houseAd());
        if (this.railRight) this.railRight.appendChild(houseAd());
    }
}
