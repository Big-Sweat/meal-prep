/* Mise — "Mise Plus": the $0.99/month remove-ads subscription.

   ─────────────────────────────────────────────────────────────────────────
   READ THIS BEFORE ASSUMING THIS TAKES MONEY. IT DOES NOT, YET.
   There is no Play Console account, so there is no subscription product to
   buy. This file therefore runs in DEMO MODE: the upgrade button grants the
   ad-free state locally, charges nothing, and says so on its face. That makes
   the experience demonstrable today without pretending to charge anyone.
   ─────────────────────────────────────────────────────────────────────────

   WHAT PLUS UNLOCKS (all of it, bought either way):
     - printing a recipe and the weekly plan
     - downloading a recipe PDF
     - the weekly plan + combined shopping list
     - no sponsored tickets on the board
   Free forever: browsing, every filter, search, ratings, reviews, favorites,
   and making an account. Accounts are how a purchase finds its way back to a
   person on a new phone — never put them behind the paywall.

   TO GO LIVE (order matters):
   1. Google Play Console account ($25 one-time) + a Google payments/merchant
      profile (separate step — without it you cannot price anything). Add
      App Store Connect ($99/year) if you want iOS too.
   2. Add a billing plugin and upload ONE build containing the Play Billing
      Library to a track (internal testing is enough). Play Console will not
      let you create a product until a build with billing exists.
   3. Create BOTH products and set each ACTIVE:
        `mise_plus_monthly`  — subscription, $0.99/month
        `mise_plus_lifetime` — one-time / non-consumable, $4.99
      An inactive product makes queries return an EMPTY LIST with no error —
      the classic time-waster.
   4. Wire the SDK behind the interface below. isPlus/purchase/restore is the
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

/* Two ways to buy the same entitlement. Create BOTH in each store: a
   subscription and a one-time (non-consumable) product. Same unlock either way.
   Prices here are display labels only — the store is the source of truth once
   billing is live, so keep these in step with the console. */
var SUB_MONTHLY_ID = "mise_plus_monthly";
var SUB_LIFETIME_ID = "mise_plus_lifetime";
var SUB_MONTHLY_PRICE = "$0.99/month";
var SUB_LIFETIME_PRICE = "$4.99 once";

var MiseSub = (function () {
  "use strict";

  var ENTITLEMENT_KEY = "mise-plus";     // demo-mode entitlement store
  var KIND_KEY = "mise-plus-kind";       // 'monthly' | 'lifetime', demo only
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
    var s = api.isPlus();
    listeners.forEach(function (fn) { fn(s); });
  }

  var api = {
    // True when this device has the real key set. Everything else is demo.
    isLive: billingConfigured,

    monthlyPrice: function () { return SUB_MONTHLY_PRICE; },
    lifetimePrice: function () { return SUB_LIFETIME_PRICE; },

    /* THE gate. One entitlement, bought either way, unlocks everything paid:
       print, PDF download, the weekly plan, and no ads. */
    isPlus: function () {
      return lsGet(ENTITLEMENT_KEY, false) === true;
    },

    // Ads are removed by the same entitlement; kept as its own name because
    // that is what the ad code is asking about.
    isAdFree: function () { return api.isPlus(); },

    // 'monthly' | 'lifetime' | null
    kind: function () { return api.isPlus() ? lsGet(KIND_KEY, null) : null; },

    /* DEMO: flips the entitlement locally and charges nothing. When a billing
       key is set, replace this body with the SDK's purchase call for
       SUB_MONTHLY_ID / SUB_LIFETIME_ID and let its entitlement callback drive
       notify(). */
    purchase: function (kind) {
      if (billingConfigured()) {
        return Promise.reject(new Error(
          "Billing key is set but no SDK is wired yet — see subscription.js step 4."
        ));
      }
      lsSet(ENTITLEMENT_KEY, true);
      lsSet(KIND_KEY, kind === "lifetime" ? "lifetime" : "monthly");
      notify();
      return Promise.resolve({ demo: true, kind: kind });
    },

    /* Stores require a visible "restore purchases" path. In demo mode there is
       nothing to restore from, so this only re-reads local state. */
    restore: function () {
      notify();
      return Promise.resolve({ plus: api.isPlus(), demo: !billingConfigured() });
    },

    cancel: function () {
      lsSet(ENTITLEMENT_KEY, false);
      lsSet(KIND_KEY, null);
      notify();
      return Promise.resolve();
    },

    onChange: function (fn) { listeners.push(fn); }
  };

  return api;
})();
