/* Myse — the shared data layer.
 *
 * Everything the site persists about a person, in one place. The board (app.js)
 * and the profile page (profile.js) both need favorites, ratings, reviews, the
 * nutrition profile and the standing allergies; without this file each would
 * carry its own copy of the string "mise-favs-", and the two would drift.
 *
 * TWO LAYERS, one synchronous API. The functions below still read and write
 * localStorage synchronously — so every caller (app.js/profile.js/log.js) is
 * unchanged and the UI never waits on the network. But localStorage is now a
 * CACHE, not the source of truth: when a real account signs in, hydrate() pulls
 * that person's rows from Supabase into the cache (merging up anything local on
 * a first sync so nothing is lost) and fires onSync so the pages redraw; and
 * every write updates the cache AND pushes to Supabase in the background. So the
 * data follows a person across devices and survives a cache wipe — sign in
 * anywhere and hydrate() brings it back. Exactly the pattern subscription.js
 * uses for isPlus(): a synchronous cache reconciled against an async authority.
 *
 * Signed out (with Supabase configured) there is no `who`, so the per-user
 * functions no-op — a signed-out visitor accumulates no private data. Ratings
 * and reviews are the exception: they are shared, so their aggregates and text
 * are world-readable and fetched per recipe (see fetchRecipeSocial).
 *
 * Without Supabase configured (SUPABASE_URL empty) the whole backend is skipped
 * and this is the old browser-only demo layer, unchanged.
 */

var MiseStore = (function () {
  "use strict";

  var ACCOUNT_KEY      = "mise-profile";     // the demo account: { name }
  var RATINGS_KEY      = "mise-ratings";     // cache of the signed-in user's ratings: { recipeId: { who: 1-5 } }
  var REVIEWS_KEY      = "mise-reviews";     // cache: { recipeId: [{ by, author, stars, text, date }] }
  var FAVS_PREFIX      = "mise-favs-";       // who -> [recipeId]
  var NUTRITION_PREFIX = "mise-nutrition-";  // who -> nutrition profile
  var ALLERGY_PREFIX   = "mise-allergies-";  // who -> [allergen id]
  var LOG_PREFIX       = "mise-log-";        // who -> [entries]
  var SUMMARY_KEY      = "mise-rating-sums";  // cache of the public aggregate: { recipeId: { avg, count } }

  /* The US big-9. Lives here rather than in app.js because both pages need it. */
  var ALLERGENS = [
    { id: "dairy", label: "Dairy" },
    { id: "eggs", label: "Eggs" },
    { id: "fish", label: "Fish" },
    { id: "shellfish", label: "Shellfish" },
    { id: "tree nuts", label: "Tree nuts" },
    { id: "peanuts", label: "Peanuts" },
    { id: "wheat", label: "Wheat / gluten" },
    { id: "soy", label: "Soy" },
    { id: "sesame", label: "Sesame" }
  ];

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function drop(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* Real auth gives us a stable id; the demo account only has a name. Every
     per-user key hangs off this, and with Supabase the id is auth.uid() — the
     same value RLS scopes every row to. */
  function who(account) {
    return account ? (account.id || account.name) : null;
  }

  // ── Supabase backend ───────────────────────────────────────────────────────
  //
  // All of this is inert unless MiseAuth is configured AND a user is signed in.
  // The cache functions above never call into here directly; instead each write
  // fires a push (best-effort, logged on failure — the cache holds the value
  // until the next successful sync), and hydrate() pulls on sign-in.

  var listeners = [];
  var hydratedFor = null;   // uid whose data is currently in the cache

  function onSync(fn) { listeners.push(fn); }
  function fireSync() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function log() {
    try { console.log.apply(console, ["[mise-store]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  // The client + signed-in uid, or null when there's nothing to talk to.
  function backend() {
    if (typeof MiseAuth === "undefined" || !MiseAuth.enabled) return null;
    var c = MiseAuth.client && MiseAuth.client();
    var u = MiseAuth.user && MiseAuth.user();
    if (!c || !u || !u.id) return null;
    return { c: c, uid: u.id };
  }

  // A write only pushes when `w` is the signed-in user (which is all a caller
  // ever passes, since who() is that same id) — never another account's rows.
  function forPush(w) {
    var b = backend();
    return (b && w && w === b.uid) ? b : null;
  }

  // Split a log entry into its columns + the jsonb `data` (everything else, so
  // a new field — like the weigh-in time — rides along without a schema change).
  function logRow(uid, e) {
    var data = {};
    Object.keys(e).forEach(function (k) {
      if (k !== "id" && k !== "d" && k !== "t") data[k] = e[k];
    });
    return { id: e.id, user_id: uid, d: e.d, t: e.t, data: data };
  }
  function logFromRow(row) {
    var e = { id: row.id, d: row.d, t: row.t };
    var data = row.data || {};
    Object.keys(data).forEach(function (k) { e[k] = data[k]; });
    return e;
  }

  var push = {
    // Sets: the caller hands us the whole desired list, so replace wholesale.
    favorites: function (b, list) {
      b.c.from("favorites").delete().eq("user_id", b.uid).then(function () {
        if (list.length) return b.c.from("favorites").insert(list.map(function (id) {
          return { user_id: b.uid, recipe_id: id };
        }));
      }).then(null, function (e) { log("push favorites failed", e); });
    },
    allergies: function (b, list) {
      b.c.from("allergies").delete().eq("user_id", b.uid).then(function () {
        if (list.length) return b.c.from("allergies").insert(list.map(function (id) {
          return { user_id: b.uid, allergen_id: id };
        }));
      }).then(null, function (e) { log("push allergies failed", e); });
    },
    nutrition: function (b, profile) {
      b.c.from("nutrition_profiles").upsert({
        user_id: b.uid, profile: profile, updated_at: new Date().toISOString()
      }).then(null, function (e) { log("push nutrition failed", e); });
    },
    nutritionClear: function (b) {
      b.c.from("nutrition_profiles").delete().eq("user_id", b.uid)
        .then(null, function (e) { log("clear nutrition failed", e); });
    },
    logAdd: function (b, e) {
      b.c.from("log_entries").insert(logRow(b.uid, e))
        .then(null, function (err) { log("push log add failed", err); });
    },
    logRemove: function (b, id) {
      b.c.from("log_entries").delete().eq("user_id", b.uid).eq("id", id)
        .then(null, function (e) { log("push log remove failed", e); });
    },
    rating: function (b, recipeId, stars) {
      b.c.from("ratings").upsert({
        user_id: b.uid, recipe_id: recipeId, stars: stars, updated_at: new Date().toISOString()
      }).then(null, function (e) { log("push rating failed", e); });
    },
    review: function (b, recipeId, stars, body, author) {
      b.c.from("reviews").upsert({
        user_id: b.uid, recipe_id: recipeId, stars: stars || null,
        body: body, author: author, updated_at: new Date().toISOString()
      }).then(null, function (e) { log("push review failed", e); });
    },
    reviewRemove: function (b, recipeId) {
      b.c.from("reviews").delete().eq("user_id", b.uid).eq("recipe_id", recipeId)
        .then(null, function (e) { log("push review remove failed", e); });
    }
  };

  /* Pull this person's rows into the cache. On a FIRST sync (they have local
     data from before the backend, or from using the site before signing in),
     merge it up so nothing is lost: sets union, singletons keep the server's
     copy when it has one, and anything local-only is pushed to the server. Then
     fireSync so the pages redraw with the reconciled data. */
  function hydrate(user) {
    var b = backend();
    if (!b || !user || user.id !== b.uid) return;
    var uid = b.uid;

    Promise.all([
      b.c.from("favorites").select("recipe_id"),
      b.c.from("allergies").select("allergen_id"),
      b.c.from("nutrition_profiles").select("profile").maybeSingle(),
      b.c.from("log_entries").select("*"),
      b.c.from("ratings").select("recipe_id,stars").eq("user_id", uid),
      b.c.from("reviews").select("*").eq("user_id", uid),
      b.c.from("recipe_rating_summary").select("*")
    ]).then(function (res) {
      var err = res.filter(function (r) { return r && r.error; })[0];
      if (err) { log("hydrate error", err.error); return; }
      var sbFavs = (res[0].data || []).map(function (r) { return r.recipe_id; });
      var sbAllg = (res[1].data || []).map(function (r) { return r.allergen_id; });
      var sbNut  = res[2].data ? res[2].data.profile : null;
      var sbLog  = (res[3].data || []).map(logFromRow);
      var sbRate = res[4].data || [];
      var sbRev  = res[5].data || [];
      var sbSum  = res[6].data || [];

      // ----- favorites: union, migrate local-only up -----
      var locFavs = read(FAVS_PREFIX + uid, []);
      var favSet = {}; sbFavs.concat(locFavs).forEach(function (id) { favSet[id] = 1; });
      var favs = Object.keys(favSet);
      write(FAVS_PREFIX + uid, favs);
      if (locFavs.some(function (id) { return sbFavs.indexOf(id) === -1; })) push.favorites(b, favs);

      // ----- allergies: union, migrate -----
      var locAllg = read(ALLERGY_PREFIX + uid, []);
      var aSet = {}; sbAllg.concat(locAllg).forEach(function (id) { aSet[id] = 1; });
      var allg = Object.keys(aSet);
      write(ALLERGY_PREFIX + uid, allg);
      if (locAllg.some(function (id) { return sbAllg.indexOf(id) === -1; })) push.allergies(b, allg);

      // ----- nutrition: server wins if present, else migrate local up -----
      var locNut = read(NUTRITION_PREFIX + uid, null);
      if (sbNut) { write(NUTRITION_PREFIX + uid, sbNut); }
      else if (locNut) { push.nutrition(b, locNut); }   // keep local, send it up

      // ----- log: union by id, migrate local-only up -----
      var locLog = read(LOG_PREFIX + uid, []);
      if (!Array.isArray(locLog)) locLog = [];
      var byId = {};
      sbLog.forEach(function (e) { byId[e.id] = e; });
      locLog.forEach(function (e) {
        if (e && e.id && !byId[e.id]) { byId[e.id] = e; push.logAdd(b, e); }  // local-only -> up
      });
      write(LOG_PREFIX + uid, Object.keys(byId).map(function (k) { return byId[k]; }));

      // ----- ratings (own): server wins per recipe, migrate local-only up -----
      var locRatings = read(RATINGS_KEY, {});
      var ratings = {};
      sbRate.forEach(function (r) { (ratings[r.recipe_id] = ratings[r.recipe_id] || {})[uid] = r.stars; });
      Object.keys(locRatings).forEach(function (rid) {
        var mine = locRatings[rid] && locRatings[rid][uid];
        if (mine && !(ratings[rid] && ratings[rid][uid])) {
          (ratings[rid] = ratings[rid] || {})[uid] = mine;
          push.rating(b, rid, mine);
        }
      });
      write(RATINGS_KEY, ratings);

      // ----- reviews (own): server wins per recipe, migrate local-only up -----
      var locReviews = read(REVIEWS_KEY, {});
      var reviews = {};
      sbRev.forEach(function (r) {
        reviews[r.recipe_id] = [{ by: uid, author: r.author, stars: r.stars, text: r.body,
          date: (r.created_at || "").slice(0, 10) }];
      });
      Object.keys(locReviews).forEach(function (rid) {
        (locReviews[rid] || []).forEach(function (rv) {
          if ((rv.by || rv.author) === uid && !reviews[rid]) {
            reviews[rid] = [rv];
            push.review(b, rid, rv.stars, rv.text, rv.author);
          }
        });
      });
      write(REVIEWS_KEY, reviews);

      // ----- public rating aggregates -----
      var sums = {};
      sbSum.forEach(function (r) { sums[r.recipe_id] = { avg: Number(r.avg) || 0, count: r.count || 0 }; });
      write(SUMMARY_KEY, sums);

      hydratedFor = uid;
      log("hydrated", uid);
      fireSync();
    }, function (e) { log("hydrate rejected", e); });
  }

  /* The public rating aggregate for the whole board. Anon-readable, so it loads
     for signed-out visitors too — otherwise a shared rating would only ever show
     to whoever wrote it. hydrate() already pulls this for signed-in users, so
     this is the signed-out path; both write SUMMARY_KEY and fireSync to redraw. */
  function loadSummaries() {
    var c = (typeof MiseAuth !== "undefined" && MiseAuth.enabled && MiseAuth.client && MiseAuth.client()) || null;
    if (!c) return;
    c.from("recipe_rating_summary").select("*").then(function (res) {
      if (res.error) { log("summaries error", res.error); return; }
      var sums = {};
      (res.data || []).forEach(function (r) { sums[r.recipe_id] = { avg: Number(r.avg) || 0, count: r.count || 0 }; });
      write(SUMMARY_KEY, sums);
      fireSync();
    }, function (e) { log("summaries rejected", e); });
  }

  /* Reviews for a recipe are shared, so they aren't in the per-user cache —
     fetch them (and the fresh aggregate) when a recipe opens, drop them in the
     cache, and call back so the modal can redraw its reviews. Reads work signed
     out too (the tables are world-readable). */
  function fetchRecipeSocial(recipeId, cb) {
    var c = (typeof MiseAuth !== "undefined" && MiseAuth.enabled && MiseAuth.client && MiseAuth.client()) || null;
    if (!c) { if (cb) cb(); return; }
    Promise.all([
      c.from("reviews").select("*").eq("recipe_id", recipeId).order("created_at", { ascending: false }),
      c.from("recipe_rating_summary").select("*").eq("recipe_id", recipeId).maybeSingle()
    ]).then(function (res) {
      if (!res[0].error) {
        var all = read(REVIEWS_KEY, {});
        all[recipeId] = (res[0].data || []).map(function (r) {
          return { by: r.user_id, author: r.author, stars: r.stars, text: r.body,
            date: (r.created_at || "").slice(0, 10) };
        });
        write(REVIEWS_KEY, all);
      }
      if (!res[1].error && res[1].data) {
        var sums = read(SUMMARY_KEY, {});
        sums[recipeId] = { avg: Number(res[1].data.avg) || 0, count: res[1].data.count || 0 };
        write(SUMMARY_KEY, sums);
      }
      if (cb) cb();
    }, function () { if (cb) cb(); });
  }

  /* ---------- the demo account (unused once a real account signs in) ---------- */

  function account() { return read(ACCOUNT_KEY, null); }
  function setAccount(a) { write(ACCOUNT_KEY, a); }
  function clearAccount() { drop(ACCOUNT_KEY); }

  /* Wipe every trace of one person from THIS BROWSER (the cache). The Supabase
     rows are removed by the account-deletion flow: deleting the auth user
     cascades every table below (on delete cascade), so there is nothing to
     delete here beyond the local cache. */
  function deleteUserData(w) {
    if (!w) return;
    drop(FAVS_PREFIX + w);
    drop(NUTRITION_PREFIX + w);
    drop(ALLERGY_PREFIX + w);
    drop(LOG_PREFIX + w);

    var ratings = read(RATINGS_KEY, {});
    Object.keys(ratings).forEach(function (id) {
      if (ratings[id] && ratings[id][w] != null) {
        delete ratings[id][w];
        if (!Object.keys(ratings[id]).length) delete ratings[id];
      }
    });
    write(RATINGS_KEY, ratings);

    var reviews = read(REVIEWS_KEY, {});
    Object.keys(reviews).forEach(function (id) {
      reviews[id] = (reviews[id] || []).filter(function (rv) {
        return (rv.by || rv.author) !== w;
      });
      if (!reviews[id].length) delete reviews[id];
    });
    write(REVIEWS_KEY, reviews);
  }

  /* ---------- favorites ---------- */

  function favs(w) { return w ? read(FAVS_PREFIX + w, []) : []; }
  function setFavs(w, list) {
    if (!w) return;
    write(FAVS_PREFIX + w, list);
    var b = forPush(w); if (b) push.favorites(b, list);
  }

  /* ---------- ratings ---------- */

  // The public aggregate now comes from the fetched summary cache, not from
  // counting local rows (the cache only holds the signed-in user's own ratings).
  function ratingSummary(id) {
    return read(SUMMARY_KEY, {})[id] || { avg: 0, count: 0 };
  }

  function myRating(w, id) {
    if (!w) return 0;
    return (read(RATINGS_KEY, {})[id] || {})[w] || 0;
  }

  function setMyRating(w, id, stars) {
    if (!w) return;
    var all = read(RATINGS_KEY, {});
    (all[id] = all[id] || {})[w] = stars;
    write(RATINGS_KEY, all);
    var b = forPush(w); if (b) push.rating(b, id, stars);
  }

  function myRatings(w) {
    if (!w) return [];
    var all = read(RATINGS_KEY, {});
    return Object.keys(all)
      .filter(function (id) { return all[id][w]; })
      .map(function (id) { return { id: id, stars: all[id][w] }; });
  }

  /* ---------- reviews ---------- */

  function reviewsFor(id) { return read(REVIEWS_KEY, {})[id] || []; }

  function upsertReview(w, name, id, text, stars) {
    if (!w) return;
    var all = read(REVIEWS_KEY, {});
    var list = (all[id] || []).filter(function (rv) {
      return (rv.by || rv.author) !== w && rv.author !== name;
    });
    list.unshift({
      by: w, author: name, stars: stars, text: text,
      date: new Date().toISOString().slice(0, 10)
    });
    all[id] = list;
    write(REVIEWS_KEY, all);
    var b = forPush(w); if (b) push.review(b, id, stars, text, name);
  }

  function myReviews(w) {
    if (!w) return [];
    var all = read(REVIEWS_KEY, {});
    var out = [];
    Object.keys(all).forEach(function (id) {
      all[id].forEach(function (rv) {
        if ((rv.by || rv.author) === w) out.push({ id: id, stars: rv.stars, text: rv.text, date: rv.date });
      });
    });
    return out;
  }

  function removeReview(w, id) {
    if (!w) return;
    var all = read(REVIEWS_KEY, {});
    if (!all[id]) return;
    all[id] = all[id].filter(function (rv) { return (rv.by || rv.author) !== w; });
    if (!all[id].length) delete all[id];
    write(REVIEWS_KEY, all);
    var b = forPush(w); if (b) push.reviewRemove(b, id);
  }

  /* ---------- nutrition profile ---------- */

  function nutrition(w) {
    if (!w) return null;
    var p = read(NUTRITION_PREFIX + w, null);
    return (p && MiseNutrition.valid(p)) ? p : null;
  }
  function setNutrition(w, p) {
    if (!w) return;
    write(NUTRITION_PREFIX + w, p);
    var b = forPush(w); if (b) push.nutrition(b, p);
  }
  function clearNutrition(w) {
    if (!w) return;
    drop(NUTRITION_PREFIX + w);
    var b = forPush(w); if (b) push.nutritionClear(b);
  }

  /* The one number the rest of the app cares about; null until it's set up.
     THE PLUS GATE FOR THE CALORIE TARGET LIVES HERE. A lapsed subscriber keeps
     their saved profile; the number just stops showing. */
  function calorieTarget(w) {
    if (typeof MiseSub !== "undefined" && !MiseSub.isPlus()) return null;
    var n = nutrition(w);
    if (!n) return null;
    var r = MiseNutrition.dailyCalories(n);
    return r ? r.target : null;
  }

  /* ---------- standing allergies ---------- */

  function allergies(w) {
    if (!w) return [];
    var saved = read(ALLERGY_PREFIX + w, []);
    if (!Array.isArray(saved)) return [];
    return saved.filter(function (id) {
      return ALLERGENS.some(function (a) { return a.id === id; });
    });
  }
  function setAllergies(w, list) {
    if (!w) return;
    write(ALLERGY_PREFIX + w, list);
    var b = forPush(w); if (b) push.allergies(b, list);
  }

  /* ---------- the progress log ---------- */

  var LOG_TYPES = {
    weight: ["kg"],
    lift: ["sets", "reps", "kg"],
    run: ["km", "mins"]
  };

  function validEntry(e) {
    if (!e || typeof e !== "object") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.d)) return false;
    if (isNaN(Date.parse(e.d + "T00:00:00Z"))) return false;
    var fields = LOG_TYPES[e.t];
    if (!fields) return false;
    for (var i = 0; i < fields.length; i++) {
      var v = e[fields[i]];
      if (typeof v !== "number" || !isFinite(v) || v <= 0) return false;
    }
    if (e.t === "lift" && !(typeof e.ex === "string" && e.ex.trim())) return false;
    return true;
  }

  function logEntries(w) {
    if (!w) return [];
    var raw = read(LOG_PREFIX + w, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(validEntry).sort(function (a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
    });
  }

  function logOfType(w, t) {
    return logEntries(w).filter(function (e) { return e.t === t; });
  }

  function addLogEntry(w, e) {
    if (!w || !validEntry(e)) return null;
    var all = logEntries(w);
    e.id = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
    all.push(e);
    write(LOG_PREFIX + w, all);
    var b = forPush(w); if (b) push.logAdd(b, e);
    return e.id;
  }

  function removeLogEntry(w, id) {
    if (!w) return;
    write(LOG_PREFIX + w, logEntries(w).filter(function (e) { return e.id !== id; }));
    var b = forPush(w); if (b) push.logRemove(b, id);
  }

  /* A weigh-in updates the body the calorie target is computed from. Not gated,
     so a lapsed subscriber's weight keeps up to date. */
  function syncNutritionWeight(w, kg) {
    if (!w || !(kg > 0)) return false;
    var p = read(NUTRITION_PREFIX + w, null);
    if (!p || typeof p !== "object") return false;
    p.weightKg = kg;
    write(NUTRITION_PREFIX + w, p);
    var b = forPush(w); if (b) push.nutrition(b, p);
    return true;
  }

  /* ---------- summary ---------- */

  function stats(w) {
    return {
      favorites: favs(w).length,
      rated: myRatings(w).length,
      reviewed: myReviews(w).length,
      logged: logEntries(w).length
    };
  }

  /* Hydrate whenever a real account signs in; clear the hydrated marker on sign
     out (the cache stays — it's harmless and speeds the next sign-in — but a
     different account signing in re-hydrates under its own uid). Deferred to
     DOMContentLoaded because store.js loads BEFORE auth.js, so MiseAuth isn't
     defined yet at module time. onChange is the reliable trigger (it fires once
     the SDK loads and resolves the session); the direct hydrate() covers a
     session that resolved before we wired. */
  function wireBackend() {
    if (typeof MiseAuth === "undefined" || !MiseAuth.enabled || !MiseAuth.onChange) return;
    MiseAuth.onChange(function (user) {
      if (user && user.id) { if (hydratedFor !== user.id) hydrate(user); }   // pulls summaries too
      else { hydratedFor = null; loadSummaries(); }                          // signed out: board aggregates only
    });
    var u = MiseAuth.user && MiseAuth.user();
    if (u && u.id) { if (hydratedFor !== u.id) hydrate(u); }
    else { loadSummaries(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireBackend);
  else wireBackend();

  return {
    ALLERGENS: ALLERGENS,
    LOG_TYPES: LOG_TYPES,
    who: who,
    account: account, setAccount: setAccount, clearAccount: clearAccount,
    deleteUserData: deleteUserData,
    favs: favs, setFavs: setFavs,
    ratingSummary: ratingSummary, myRating: myRating, setMyRating: setMyRating, myRatings: myRatings,
    reviewsFor: reviewsFor, upsertReview: upsertReview, myReviews: myReviews, removeReview: removeReview,
    nutrition: nutrition, setNutrition: setNutrition, clearNutrition: clearNutrition,
    calorieTarget: calorieTarget,
    allergies: allergies, setAllergies: setAllergies,
    logEntries: logEntries, logOfType: logOfType, addLogEntry: addLogEntry,
    removeLogEntry: removeLogEntry, syncNutritionWeight: syncNutritionWeight,
    stats: stats,
    // backend hooks — pages redraw on onSync; the recipe modal fetches shared social.
    onSync: onSync, hydrate: hydrate, fetchRecipeSocial: fetchRecipeSocial
  };
})();
