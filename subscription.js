/* Mise — "Mise Plus": the $0.99/month remove-ads subscription.

   ─────────────────────────────────────────────────────────────────────────
   READ THIS BEFORE ASSUMING THIS TAKES MONEY. IT DOES NOT, YET.
   There is no Play Console account, so there is no subscription product to
   buy. This file therefore runs in DEMO MODE: the upgrade button grants the
   ad-free state locally, charges nothing, and says so on its face. That makes
   the experience demonstrable today without pretending to charge anyone.
   ─────────────────────────────────────────────────────────────────────────

   TO GO LIVE (order matters):
   1. Google Play Console account ($25 one-time) + a Google payments/merchant
      profile (separate step — without it you cannot price anything). Add
      App Store Connect ($99/year) if you want iOS too.
   2. Add a billing plugin and upload ONE build containing the Play Billing
      Library to a track (internal testing is enough). Play Console will not
      let you create a subscription product until a build with billing exists.
   3. Create the product: id `mise_plus_monthly`, $0.99, monthly, and set it
      ACTIVE. An inactive product makes queries return an EMPTY LIST with no
      error — the classic time-waster.
   4. Wire the SDK behind the interface below. isAdFree/purchase/restore is the
      only surface the rest of the app touches, so nothing else changes.
   5. Set the key(s) below. Non-empty key => real billing, demo mode off.

   TESTING IS EASIER THAN THE FOLKLORE SUGGESTS. It is widely repeated that you
   must install from Play to test billing. Not so — Google's testing doc says
   license testers "can sideload apps for testing, even for apps using debug
   builds with debug signatures". So once steps 1-3 are done, a plain
   `adb install` of a debug APK can complete a real (free) test purchase,
   provided: the package name matches the Play Console app, your Google account
   is added under Play Console > Settings > License testing, and the device has
   the Play Store app and is signed in as that tester. Allow a few hours after
   a first upload for propagation — before that it looks exactly like a bug.

   WHY GOOGLE PLAY BILLING AND NOT STRIPE: since the Epic v. Google settlement
   Google no longer *requires* Play Billing, so an external checkout is now
   allowed. It is still the wrong call at this price: Play takes 15% all-in on
   a $0.99 subscription (~$0.15), while Stripe's fixed $0.30 per-transaction fee
   alone eats ~30% — before Google's own external-link service fee on top.

   WHY A BILLING SERVICE (RevenueCat et al.) RATHER THAN RAW PLAY BILLING:
   purchases must be verified server-side or a rooted device can spoof them, and
   a static site has no server. A billing service does that validation and
   covers both stores with one entitlement check.
*/

var BILLING_ANDROID_KEY = "";   // e.g. RevenueCat public SDK key for Android
var BILLING_IOS_KEY = "";       // e.g. RevenueCat public SDK key for iOS
var SUB_PRODUCT_ID = "mise_plus_monthly";
var SUB_PRICE_LABEL = "$0.99/month";

var MiseSub = (function () {
  "use strict";

  var ENTITLEMENT_KEY = "mise-plus";     // demo-mode entitlement store
  var listeners = [];

  function billingConfigured() {
    var p = (window.MiseNative && window.MiseNative.platform) || "web";
    if (p === "android") return !!BILLING_ANDROID_KEY;
    if (p === "ios") return !!BILLING_IOS_KEY;
    return false; // the web has no app store to bill through
  }

  function lsGet(k, d) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }

  function notify() {
    var s = api.isAdFree();
    listeners.forEach(function (fn) { fn(s); });
  }

  var api = {
    // True when this device has the real key set. Everything else is demo.
    isLive: billingConfigured,

    priceLabel: function () { return SUB_PRICE_LABEL; },

    isAdFree: function () {
      return lsGet(ENTITLEMENT_KEY, false) === true;
    },

    /* DEMO: flips the entitlement locally and charges nothing. When a billing
       key is set, replace this body with the SDK's purchase call and let its
       entitlement callback drive notify(). */
    purchase: function () {
      if (billingConfigured()) {
        return Promise.reject(new Error(
          "Billing key is set but no SDK is wired yet — see subscription.js step 3."
        ));
      }
      lsSet(ENTITLEMENT_KEY, true);
      notify();
      return Promise.resolve({ demo: true });
    },

    /* Stores require a visible "restore purchases" path. In demo mode there is
       nothing to restore from, so this only re-reads local state. */
    restore: function () {
      notify();
      return Promise.resolve({ adFree: api.isAdFree(), demo: !billingConfigured() });
    },

    cancel: function () {
      lsSet(ENTITLEMENT_KEY, false);
      notify();
      return Promise.resolve();
    },

    onChange: function (fn) { listeners.push(fn); }
  };

  return api;
})();
