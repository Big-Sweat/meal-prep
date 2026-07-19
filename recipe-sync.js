/* Myse — keep an installed app's recipe data current without a new release.
 *
 * The apps ship recipes.js baked in at build time, so browsing works with no
 * signal at all — see CLAUDE.md. The cost of that is the one this file exists
 * to pay off: the website is always live, but an already-installed app has no
 * way to find out the library grew, short of Jake rebuilding and reinstalling
 * it by hand.
 *
 * WHAT THIS DOES NOT DO: it never fetches or executes recipes.js. It fetches
 * recipes.json — data only, JSON.parse, never eval — because this is the
 * app's first-ever runtime fetch of remote content, and running code that
 * arrived over the network is a materially different risk than parsing data
 * that arrived over the network. If big-sweat.github.io were ever compromised,
 * this design limits the blast radius to "wrong recipe data," never
 * arbitrary code running inside the app.
 *
 * TIMING, on purpose: updates are applied only at the START of the NEXT app
 * open, never mid-session. A background check runs quietly and, if the data
 * is newer, caches it — but the board someone is already looking at can never
 * change out from under them. See CLAUDE.md for why this is the chosen
 * behavior over a live swap or a manual button.
 *
 * Native only. The website already gets fresh recipes.js on every load, via
 * its own cache-busted <script> tag — running this there would just be a
 * second, redundant ~430KB download for no benefit.
 */
(function () {
  "use strict";

  if (typeof MiseNative === "undefined" || !MiseNative.isNative) return;
  if (typeof RECIPES === "undefined") return;   // a page that doesn't load recipe data

  var CACHE_KEY = "mise-recipes-cache";
  var LIVE_URL = "https://big-sweat.github.io/meal-prep/recipes.json";
  var TIMEOUT_MS = 8000;
  var MAX_BYTES = 2000000;   // recipes.json is ~430KB today; past ~2MB it isn't our data

  /* Fingerprint of the data this BUILD shipped with. Captured once, before
     applyCachedIfNewer() can reassign RECIPES, and stored inside every cache
     entry. If a later launch finds the entry's fingerprint differs from its
     own bundle, the app updated since the cache was fetched — meaning the
     cache may be OLDER than the bundle, and "newer" is this file's whole
     contract — so the cache is dropped instead of applied. (The fetched data
     itself carries no version stamp; count + id-hash + serialized length is a
     cheap, honest proxy for "the bundled library changed".) */
  function bundleFingerprint() {
    var ids = "";
    for (var i = 0; i < RECIPES.length; i++) ids += RECIPES[i].id + ",";
    var h = 5381;
    for (var j = 0; j < ids.length; j++) h = ((h * 33) ^ ids.charCodeAt(j)) >>> 0;
    var len = 0;
    try { len = JSON.stringify(RECIPES).length; } catch (e) { /* len stays 0 */ }
    return RECIPES.length + ":" + h.toString(36) + ":" + len;
  }
  var BUNDLE_FP = bundleFingerprint();

  // Cheap shape check, not a full schema audit — tools/add-recipes.js already
  // validated this data before it was ever published. This just guards
  // against trusting a truncated download or an error page served as 200.
  function parseAndValidate(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return null; }
    if (!Array.isArray(parsed) || !parsed.length) return null;
    for (var i = 0; i < parsed.length; i++) {
      var r = parsed[i];
      if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !Array.isArray(r.ingredients)) {
        return null;
      }
    }
    return parsed;
  }

  /* Runs once, synchronously, before app.js/profile.js build their search
     index or render anything: if a PRIOR session already fetched something
     newer, this launch opens with it. This is the only place RECIPES is ever
     reassigned — nothing here touches it again once the page has started
     reading it, which is what keeps a launch from changing mid-session. */
  function dropCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
  }

  function applyCachedIfNewer() {
    var raw;
    try { raw = localStorage.getItem(CACHE_KEY); } catch (e) { return; }
    if (!raw) return;
    var entry = null;
    try { entry = JSON.parse(raw); } catch (e) { /* handled below */ }
    // Junk, or the pre-fingerprint cache format (a bare recipes array): remove
    // it rather than re-parsing a dead entry every launch. The next successful
    // online check re-fills the cache in the current format.
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.data !== "string") {
      dropCache();
      return;
    }
    if (entry.bundle !== BUNDLE_FP) {
      dropCache();
      console.log("[Myse recipe-sync] bundled data changed since this was cached — dropped, will re-check");
      return;
    }
    var parsed = parseAndValidate(entry.data);
    if (!parsed) { dropCache(); console.log("[Myse recipe-sync] cached copy invalid — removed"); return; }
    RECIPES = parsed;
    // console.log, not a UI indicator: WebView forwards this to logcat even in
    // a release build (remote DevTools is what's gated by debuggable, not
    // console output), so this is how a silent, user-invisible background
    // process gets checked on a real device.
    console.log("[Myse recipe-sync] opened with " + parsed.length + " recipes from a prior sync");
  }

  /* Fire-and-forget: no retry, no UI, and any failure (offline, a timeout, a
     bad deploy serving a partial file) just means the next launch looks
     exactly like this one. Never applied this session — only ever written to
     the cache, for applyCachedIfNewer() to pick up next time the app opens. */
  function checkForUpdate() {
    var controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    fetch(LIVE_URL, { signal: controller ? controller.signal : undefined })
      .then(function (res) {
        return res.ok ? res.text() : Promise.reject(new Error("HTTP " + res.status));
      })
      .then(function (text) {
        if (timer) clearTimeout(timer);
        if (text.length > MAX_BYTES) {
          console.log("[Myse recipe-sync] fetched " + text.length + " bytes — implausibly large, ignored");
          return;
        }
        var parsed = parseAndValidate(text);
        if (!parsed) { console.log("[Myse recipe-sync] fetched but couldn't validate — ignored"); return; }
        var entry = JSON.stringify({ bundle: BUNDLE_FP, data: text });
        var current;
        try { current = localStorage.getItem(CACHE_KEY); } catch (e) { current = null; }
        if (entry === current) { console.log("[Myse recipe-sync] checked — already current"); return; }
        try {
          localStorage.setItem(CACHE_KEY, entry);
          console.log("[Myse recipe-sync] cached " + parsed.length + " recipes — applies next open");
        } catch (e) { /* storage full/unavailable — skip */ }
      })
      .catch(function (e) { console.log("[Myse recipe-sync] check failed (offline?): " + e.message); });
  }

  applyCachedIfNewer();
  checkForUpdate();
})();
