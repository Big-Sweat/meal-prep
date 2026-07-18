/* Mise — "Mise Plus": the $0.99/month remove-ads subscription.

   ─────────────────────────────────────────────────────────────────────────
   READ THIS BEFORE ASSUMING THIS TAKES MONEY. IT DOES NOT, YET.
   The SDK is wired (below), but the store side does not exist: no Play/App
   Store account, no products, and the keys are empty. With an empty key this
   file runs in DEMO MODE — the upgrade button grants the ad-free state
   locally, charges nothing, and says so on its face. Set a real key and the
   RevenueCat path below takes over. Demo mode is not a stub of the real path;
   it is the fallback for "no store to bill through" (which is always true on
   the web, and true in the apps until a key is set).
   ─────────────────────────────────────────────────────────────────────────

   WHAT PLUS UNLOCKS (all of it, bought either way):
     - printing a recipe and the weekly plan
     - downloading a recipe PDF
     - the weekly plan + combined shopping list
     - your goals + a daily calorie target
     - no sponsored tickets on the board
   Free forever: browsing, every filter, search, ratings, reviews, favorites,
   and making an account. Accounts are how a purchase finds its way back to a
   person on a new phone — never put them behind the paywall.

   ─── HOW THE REAL PATH IS WIRED ───────────────────────────────────────────
   Billing is RevenueCat's Capacitor plugin (`@revenuecat/purchases-capacitor`,
   a dependency in app/package.json). We call it through the Capacitor bridge —
   `Capacitor.Plugins.Purchases`, the same way native.js reaches Filesystem and
   Share — so this file stays a plain <script> with no build step and no import,
   and is a total no-op on the web (no key, no plugin, `platform() === "web"`).

   Why RevenueCat and not raw Play Billing / StoreKit: a purchase must be
   verified server-side or a rooted device can spoof it, and a static site has
   no server. RevenueCat does that validation and covers both stores behind one
   entitlement check. A raw-billing provider *could* slot in at the same seam
   (findProvider below), but it would reintroduce exactly that spoofing risk, so
   it is deliberately not shipped.

   The one entitlement, `PLUS_ENTITLEMENT_ID`, is what everything reads. Both
   products attach to it in the RevenueCat dashboard, so monthly and lifetime
   grant the identical unlock — matching the two-products-one-entitlement design.

   isPlus() must stay SYNCHRONOUS — the whole app gates on it inline — but
   RevenueCat's customerInfo is async. So the truth is kept in a synchronous
   local cache (ENTITLEMENT_KEY), seeded from the last known state on load and
   reconciled against RevenueCat as its async callbacks land (via notify(), the
   same channel a demo purchase already uses). RevenueCat is the source of
   truth; the cache just lets the first paint be right and survive a cold start.

   TO GO LIVE (order matters — the SDK wiring, step 4, is already done):
   1. Google Play Console account ($25 one-time) + a Google payments/merchant
      profile (separate step — without it you cannot price anything). Add
      App Store Connect ($99/year) if you want iOS too.
   2. Add a build to a track (internal testing is enough) that contains the Play
      Billing Library — `cap sync` links it in once the plugin dependency is
      installed. Play Console will not let you create a product until a build
      with billing exists.
   3. Create BOTH products, set each ACTIVE, and in RevenueCat attach both to a
      single entitlement whose identifier is `PLUS_ENTITLEMENT_ID` below:
        `mise_plus_monthly`  — subscription, $0.99/month
        `mise_plus_lifetime` — one-time / non-consumable, $4.99
      An inactive product makes queries return an EMPTY LIST with no error —
      the classic time-waster. Wrap both in a RevenueCat Offering so
      getOfferings() returns them.
   4. DONE — the SDK is wired behind isPlus/purchase/restore/manage below.
   5. Set the key(s) below to your RevenueCat PUBLIC SDK keys (NOT the Play
      license key). Non-empty key => real billing, demo mode off.

   TESTING IS EASIER THAN THE FOLKLORE SUGGESTS. It is widely repeated that you
   must install from Play to test billing. Not so — Google's testing doc says
   license testers "can sideload apps for testing, even for apps using debug
   builds with debug signatures". So once steps 1-3 are done, a plain
   `adb install` of a debug APK can complete a real (free) test purchase,
   provided: the package name matches the Play Console app, your Google account
   is added under Play Console > Settings > License testing, and the device has
   the Play Store app and is signed in as that tester. Allow a few hours after
   a first upload for propagation — before that it looks exactly like a bug.

   ACCOUNTS AND CROSS-DEVICE RESTORE: we configure() anonymously, so restore
   works by store account (Play/Apple) on the same device out of the box. To
   make a purchase follow a Mise *account* to a new phone, call
   Purchases.logIn({ appUserID: <mise user id> }) on sign-in and logOut() on
   sign-out — verify that exact shape against the RevenueCat Capacitor docs at
   go-live before wiring it to MiseAuth.onChange. Left out here on purpose: it
   is untested against a live project and store-account restore already covers
   the common case.
*/

var BILLING_ANDROID_KEY = "";   // RevenueCat PUBLIC SDK key for Android (goog_…)
var BILLING_IOS_KEY = "";       // RevenueCat PUBLIC SDK key for iOS   (appl_…)

/* Two ways to buy the same entitlement. Create BOTH in each store: a
   subscription and a one-time (non-consumable) product, both attached to the
   ONE entitlement below. Same unlock either way. Prices here are display labels
   only — the store is the source of truth once billing is live, so keep these
   in step with the console. */
var SUB_MONTHLY_ID = "mise_plus_monthly";
var SUB_LIFETIME_ID = "mise_plus_lifetime";
var SUB_MONTHLY_PRICE = "$0.99/month";
var SUB_LIFETIME_PRICE = "$4.99 once";

/* The RevenueCat entitlement identifier both products grant. This string must
   match the entitlement you create in the RevenueCat dashboard exactly. */
var PLUS_ENTITLEMENT_ID = "plus";

/* Capacitor app id — used only to deep-link into the store's own subscription
   management screen from manage(). Keep in step with app/capacitor.config. */
var APP_PACKAGE_ID = "com.deadliftdigital.mise";

var MiseSub = (function () {
  "use strict";

  var ENTITLEMENT_KEY = "mise-plus";     // synchronous entitlement cache
  var KIND_KEY = "mise-plus-kind";       // 'monthly' | 'lifetime', cached
  var listeners = [];

  function log() {
    // Kept in release on purpose: a WebView forwards console.log to logcat even
    // in a release build, and this billing path can only be watched on a real
    // phone. Same rationale as recipe-sync.js.
    try { console.log.apply(console, ["[mise-billing]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  /* Platform without depending on native.js load order (it loads after this
     file): read MiseNative if it happens to be up, else Capacitor directly. */
  function platform() {
    if (window.MiseNative && window.MiseNative.platform) return window.MiseNative.platform;
    var Cap = window.Capacitor;
    return (Cap && Cap.getPlatform && Cap.getPlatform()) || "web";
  }

  function activeKey() {
    var p = platform();
    if (p === "android") return BILLING_ANDROID_KEY;
    if (p === "ios") return BILLING_IOS_KEY;
    return "";                             // the web has no app store to bill through
  }

  function billingConfigured() { return !!activeKey(); }

  // The RevenueCat plugin, or null if it isn't linked into this build.
  function rc() {
    var Cap = window.Capacitor;
    return (Cap && Cap.Plugins && Cap.Plugins.Purchases) || null;
  }

  function lsGet(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }

  function notify() {
    var s = api.isPlus();
    listeners.forEach(function (fn) { fn(s); });
  }

  /* Write the synchronous cache and tell everyone. The only place entitlement
     state changes — demo purchase, a RevenueCat callback, and reconciliation
     all funnel through here so the app never sees two different truths. */
  function applyEntitlement(active, kind) {
    lsSet(ENTITLEMENT_KEY, !!active);
    lsSet(KIND_KEY, active ? (kind === "lifetime" ? "lifetime" : "monthly") : null);
    notify();
  }

  // ── RevenueCat helpers ──────────────────────────────────────────────────
  function activeEntitlement(info) {
    return (info && info.entitlements && info.entitlements.active &&
            info.entitlements.active[PLUS_ENTITLEMENT_ID]) || null;
  }
  function kindFrom(info) {
    var ent = activeEntitlement(info);
    if (!ent) return null;
    return ent.productIdentifier === SUB_LIFETIME_ID ? "lifetime" : "monthly";
  }
  function syncFrom(info) {
    var ent = activeEntitlement(info);
    applyEntitlement(!!ent, kindFrom(info));
    return !!ent;
  }

  // Find the RevenueCat Package for a product id across every offering.
  function findPackage(offerings, productId) {
    if (!offerings) return null;
    var pools = [];
    if (offerings.current && offerings.current.availablePackages) pools.push(offerings.current.availablePackages);
    if (offerings.all) {
      Object.keys(offerings.all).forEach(function (k) {
        var o = offerings.all[k];
        if (o && o.availablePackages) pools.push(o.availablePackages);
      });
    }
    for (var i = 0; i < pools.length; i++) {
      var pkgs = pools[i];
      for (var j = 0; j < pkgs.length; j++) {
        var p = pkgs[j];
        var prod = p && (p.product || p.storeProduct);
        if (prod && prod.identifier === productId) return p;
      }
    }
    return null;
  }

  /* One-time setup on the real path: configure, subscribe to entitlement
     changes (a store-side refund/expiry arrives here on its own), then read the
     current state and reconcile the cache. No-op in demo mode and on the web.
     Runs once the DOM is ready so the plugin is registered. */
  function initLiveBilling() {
    if (!billingConfigured()) return;                 // demo — nothing to configure
    var Purchases = rc();
    if (!Purchases) { log("key set but @revenuecat/purchases-capacitor isn't linked — run npm i in app/ and cap sync"); return; }

    Purchases.configure({ apiKey: activeKey() })
      .then(function () {
        // Live changes (renewal, refund, expiry) land here without a user action.
        try { Purchases.addCustomerInfoUpdateListener(function (info) { syncFrom(info); }); }
        catch (e) { log("customer-info listener unavailable", e); }
        return Purchases.getCustomerInfo();
      })
      .then(function (res) { syncFrom(res && res.customerInfo); log("configured; plus =", api.isPlus()); })
      .catch(function (e) { log("configure/getCustomerInfo failed", e); });
  }

  function openExternal(url) {
    var Cap = window.Capacitor;
    var Browser = Cap && Cap.Plugins && Cap.Plugins.Browser;
    if (Browser && Browser.open) return Browser.open({ url: url });
    try { window.open(url, "_blank"); } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  // Where the OS lets a user manage/cancel what they bought.
  function manageUrl() {
    var p = platform();
    if (p === "android") {
      if (api.kind() === "lifetime") return "https://play.google.com/store/account";
      return "https://play.google.com/store/account/subscriptions?sku=" +
        encodeURIComponent(SUB_MONTHLY_ID) + "&package=" + encodeURIComponent(APP_PACKAGE_ID);
    }
    if (p === "ios") return "https://apps.apple.com/account/subscriptions";
    return "";
  }

  var api = {
    // True when this device has a real key set. Everything else is demo.
    isLive: billingConfigured,

    monthlyPrice: function () { return SUB_MONTHLY_PRICE; },
    lifetimePrice: function () { return SUB_LIFETIME_PRICE; },

    /* THE gate. One entitlement, bought either way, unlocks everything paid:
       print, PDF download, the weekly plan, the calorie target, and no ads.
       Synchronous by contract — reads the cache that RevenueCat reconciles. */
    isPlus: function () {
      return lsGet(ENTITLEMENT_KEY, false) === true;
    },

    // Ads are removed by the same entitlement; kept as its own name because
    // that is what the ad code is asking about.
    isAdFree: function () { return api.isPlus(); },

    // 'monthly' | 'lifetime' | null
    kind: function () { return api.isPlus() ? lsGet(KIND_KEY, null) : null; },

    /* Buy. DEMO (no key): flips the entitlement locally, charges nothing.
       LIVE: find the package for the chosen product, hand it to RevenueCat, and
       let the returned customerInfo drive the cache. A user cancel rejects with
       err.userCancelled = true so the dialog can bow out quietly. */
    purchase: function (kind) {
      if (!billingConfigured()) {
        applyEntitlement(true, kind);
        return Promise.resolve({ demo: true, kind: kind });
      }
      var Purchases = rc();
      if (!Purchases) {
        return Promise.reject(new Error(
          "Billing key is set but the store plugin isn't installed — run npm i in app/ and cap sync. See subscription.js."
        ));
      }
      var productId = kind === "lifetime" ? SUB_LIFETIME_ID : SUB_MONTHLY_ID;
      return Purchases.getOfferings()
        .then(function (offerings) {
          var pkg = findPackage(offerings, productId);
          if (!pkg) throw new Error("That plan isn't available from the store yet — check back shortly.");
          return Purchases.purchasePackage({ aPackage: pkg });
        })
        .then(function (res) {
          syncFrom(res && res.customerInfo);
          if (!api.isPlus()) throw new Error("The purchase went through but didn't unlock Plus. Please contact support.");
          return { demo: false, kind: api.kind() };
        })
        .catch(function (e) {
          if (e && e.userCancelled) { var c = new Error("cancelled"); c.userCancelled = true; throw c; }
          log("purchase failed", e);
          throw e;
        });
    },

    /* Stores require a visible "restore purchases" path. DEMO: nothing to
       restore, just re-reads local state. LIVE: asks RevenueCat to restore and
       reconciles the cache from the result. */
    restore: function () {
      if (!billingConfigured()) {
        notify();
        return Promise.resolve({ plus: api.isPlus(), demo: true });
      }
      var Purchases = rc();
      if (!Purchases) {
        return Promise.reject(new Error(
          "Billing key is set but the store plugin isn't installed — see subscription.js."
        ));
      }
      return Purchases.restorePurchases().then(function (res) {
        syncFrom(res && res.customerInfo);
        return { plus: api.isPlus(), demo: false };
      });
    },

    /* Send the user to the store's own management screen. Real subscriptions
       can only be cancelled there, not from inside the app. DEMO callers use
       cancel() instead. */
    manage: function () {
      var url = manageUrl();
      if (url) openExternal(url);
      return Promise.resolve();
    },

    /* DEMO ONLY: drop the local entitlement. Refuses on the live path — a real
       entitlement can't be revoked locally (RevenueCat would just re-grant it
       on the next sync), so live callers must use manage() instead. */
    cancel: function () {
      if (billingConfigured()) return api.manage();
      applyEntitlement(false, null);
      return Promise.resolve();
    },

    onChange: function (fn) { listeners.push(fn); }
  };

  // Kick off the real path once the plugin is registered; harmless otherwise.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLiveBilling);
  } else {
    initLiveBilling();
  }

  return api;
})();
