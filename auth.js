/* Mise auth - Supabase integration.

   SETUP (one time, ~10 minutes):
   1. Create a free project at https://supabase.com
   2. In the dashboard: Authentication -> Sign In / Up
        - Email: enabled by default
        - Google: follow the dashboard's guide (create a Google Cloud OAuth
          client, paste its ID + secret)
        - Apple: requires a paid Apple Developer account; the button below
          works as soon as you add the credentials
   3. Authentication -> URL Configuration:
        Site URL:      https://big-sweat.github.io/meal-prep/
        Redirect URLs: https://big-sweat.github.io/meal-prep/
                       http://localhost:8347/   (for local testing)
   4. Project Settings -> API: copy the Project URL and the anon public key
      into the two constants below. The anon key is designed to be public -
      committing it is fine.

   While the constants are empty the site falls back to the demo profile
   (name only, stored in the browser) and this file loads no external code. */

var SUPABASE_URL = "https://bypeqzvxgqjsylerzxlk.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cGVxenZ4Z3Fqc3lsZXJ6eGxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNDYyNTEsImV4cCI6MjA5OTcyMjI1MX0.HbT-DRZeLkIzk3LCLUk3spYLTp2Nq-SiCYOGCIM-wLg";

var MiseAuth = (function () {
  "use strict";

  var enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  var client = null;
  var currentUser = null;
  var listeners = [];

  // Android (Capacitor). Google refuses OAuth from an embedded WebView
  // ("disallowed_useragent"), so on native we hand the sign-in URL to the
  // system browser and catch the result on a deep link back into the app.
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform());
  var NATIVE_REDIRECT = "com.deadliftdigital.mise://auth";

  function mapUser(u) {
    if (!u) return null;
    var meta = u.user_metadata || {};
    var name = meta.full_name || meta.name ||
      (u.email ? u.email.split("@")[0] : "Cook");
    return { id: u.id, email: u.email || "", name: name };
  }

  function notify() {
    listeners.forEach(function (fn) { fn(currentUser); });
  }

  // Android only: Supabase sends the browser to com.deadliftdigital.mise://auth?code=…
  // once the provider is done. Trade that code for a session and close the tab.
  function listenForDeepLink() {
    var P = (window.Capacitor && window.Capacitor.Plugins) || {};
    if (!P.App) return;
    P.App.addListener("appUrlOpen", function (data) {
      if (!data || !data.url || data.url.indexOf(NATIVE_REDIRECT) !== 0) return;
      var code = null;
      try { code = new URL(data.url).searchParams.get("code"); } catch (e) { /* ignore */ }
      if (!code) return;
      client.auth.exchangeCodeForSession(code).then(function () {
        if (P.Browser) P.Browser.close();
      });
    });
  }

  function init() {
    if (!enabled) return;
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = function () {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // PKCE is required for the deep-link flow: the app finishes sign-in
          // by exchanging a code, with no secret on the device.
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          // On native the callback arrives as a deep link, not a page load.
          detectSessionInUrl: !isNative
        }
      });
      client.auth.getSession().then(function (res) {
        currentUser = mapUser(res.data.session && res.data.session.user);
        notify();
      });
      client.auth.onAuthStateChange(function (_event, session) {
        currentUser = mapUser(session && session.user);
        notify();
      });
      if (isNative) listenForDeepLink();
    };
    document.head.appendChild(s);
  }

  return {
    enabled: enabled,
    isReady: function () { return !!client; },
    user: function () { return currentUser; },
    onChange: function (fn) { listeners.push(fn); },
    signUp: function (email, password) {
      return client.auth.signUp({ email: email, password: password });
    },
    signIn: function (email, password) {
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    signInWith: function (provider) {
      if (!isNative) {
        return client.auth.signInWithOAuth({
          provider: provider,
          options: { redirectTo: window.location.origin + window.location.pathname }
        });
      }
      // Native: get the URL but open it ourselves, in the system browser.
      return client.auth.signInWithOAuth({
        provider: provider,
        options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true }
      }).then(function (res) {
        if (res.error || !res.data || !res.data.url) return res;
        var P = (window.Capacitor && window.Capacitor.Plugins) || {};
        if (!P.Browser) return { error: { message: "Browser plugin unavailable." } };
        return P.Browser.open({ url: res.data.url }).then(function () { return res; });
      });
    },
    signOut: function () { return client.auth.signOut(); },
    init: init
  };
})();

MiseAuth.init();
