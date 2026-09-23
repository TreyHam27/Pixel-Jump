/**
 * AdManager handles both placeholder and future official AdSense H5 Game API integration.
 * Learn more: https://support.google.com/adsense/answer/10731454
 */
class AdManager {
    constructor() {
        this.adLeft = document.getElementById('ad-left');
        this.adRight = document.getElementById('ad-right');
        this.videoMock = document.getElementById('ad-video-mock');
        this.countdown = document.getElementById('ad-countdown');
        this.reviveOverlay = document.getElementById('revive-overlay');
        this.reviveBtn = document.getElementById('revive-btn');
        this.reviveSkip = document.getElementById('revive-skip');

        // Check screen size for side ads
        this.checkSideAds();
        window.addEventListener('resize', () => this.checkSideAds());

        // --- AdSense H5 Game API Initialization Placeholder ---
        // window.adsbygoogle = window.adsbygoogle || [];
        // const adBreak = function(o) { adsbygoogle.push(o); }
    }

    checkSideAds() {
        if (window.innerWidth > 800) {
            this.adLeft.style.opacity = 1;
            this.adRight.style.opacity = 1;
            this.adLeft.style.display = 'flex';
            this.adRight.style.display = 'flex';
        } else {
            this.adLeft.style.opacity = 0;
            this.adRight.style.opacity = 0;
            if (window.innerWidth <= 800) {
                this.adLeft.style.display = 'none';
                this.adRight.style.display = 'none';
            }
        }
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
     * Plays a rewarded video ad.
     * Future Integration: Use AdSense 'rewarded' ad format.
     */
    playRewardedVideo(onComplete) {
        // --- AdSense Integration Placeholder ---
        /*
        adBreak({
            type: 'rewarded',
            name: 'revive_reward',
            beforeAd: () => { pauseGame(); },
            afterAd: () => { resumeGame(); },
            adDismissed: () => { onSkip(); },
            adViewed: () => { onComplete(); }
        });
        */

        // CURRENT MOCK IMPLEMENTATION
        this.reviveOverlay.style.display = 'none';
        this.videoMock.style.display = 'flex';

        let timeLeft = 3;
        this.countdown.innerText = "0:0" + timeLeft;

        let timer = setInterval(() => {
            timeLeft--;
            this.countdown.innerText = "0:0" + timeLeft;

            if (timeLeft <= 0) {
                clearInterval(timer);
                this.videoMock.style.display = 'none';
                onComplete();
            }
        }, 1000);
    }

    /**
     * Shows an interstitial ad between game sessions.
     * Future Integration: Use AdSense 'next' or 'start' ad format.
     */
    showInterstitialAd() {
        // adBreak({ type: 'next', name: 'restart_game' });
        console.log("Interstitial ad placeholder");
    }
}
