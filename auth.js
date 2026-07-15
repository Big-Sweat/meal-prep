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

  function init() {
    if (!enabled) return;
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = function () {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      client.auth.getSession().then(function (res) {
        currentUser = mapUser(res.data.session && res.data.session.user);
        notify();
      });
      client.auth.onAuthStateChange(function (_event, session) {
        currentUser = mapUser(session && session.user);
        notify();
      });
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
      return client.auth.signInWithOAuth({
        provider: provider,
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    },
    signOut: function () { return client.auth.signOut(); },
    init: init
  };
})();

MiseAuth.init();
