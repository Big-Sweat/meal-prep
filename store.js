/* Mise — the shared data layer.
 *
 * Everything the site persists about a person, in one place. The board (app.js)
 * and the profile page (profile.js) both need favorites, ratings, reviews, the
 * nutrition profile and the standing allergies; without this file each would
 * carry its own copy of the string "mise-favs-", and the two would drift.
 *
 * Pure functions over localStorage: pass in who you are, get back your data.
 * No DOM, no session state — the pages track the signed-in user themselves
 * (from auth.js) and hand it in, so there's only ever one source of truth for
 * "who is this".
 *
 * Still the demo storage layer: it all lives in this browser, so nothing is
 * shared between visitors. To go multi-user, reimplement the functions below
 * against Supabase tables — neither page cares where the bytes come from.
 */

var MiseStore = (function () {
  "use strict";

  var ACCOUNT_KEY      = "mise-profile";     // the demo account: { name }
  var RATINGS_KEY      = "mise-ratings";     // { recipeId: { who: 1-5 } }
  var REVIEWS_KEY      = "mise-reviews";     // { recipeId: [{ by, author, stars, text, date }] }
  var FAVS_PREFIX      = "mise-favs-";       // who -> [recipeId]
  var NUTRITION_PREFIX = "mise-nutrition-";  // who -> nutrition profile
  var ALLERGY_PREFIX   = "mise-allergies-";  // who -> [allergen id]

  /* The US big-9. Lives here rather than in app.js because both pages need it:
     the board draws the filter chips from it and the profile page draws the
     standing-allergy chips from it, and an allergen list that disagreed with
     itself across two pages is exactly the bug you don't want in this feature.
     (Proteins and meals stay in app.js — only the board filters on those.) */
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
     per-user key hangs off this, so it has to be derived the same way on both
     pages — hence living here rather than being written out twice. */
  function who(account) {
    return account ? (account.id || account.name) : null;
  }

  /* ---------- the demo account (no-op once Supabase is configured) ---------- */

  function account() { return read(ACCOUNT_KEY, null); }
  function setAccount(a) { write(ACCOUNT_KEY, a); }
  function clearAccount() { drop(ACCOUNT_KEY); }

  /* ---------- favorites ---------- */

  function favs(w) { return w ? read(FAVS_PREFIX + w, []) : []; }
  function setFavs(w, list) { if (w) write(FAVS_PREFIX + w, list); }

  /* ---------- ratings ---------- */

  function ratingSummary(id) {
    var perUser = read(RATINGS_KEY, {})[id] || {};
    var names = Object.keys(perUser);
    if (!names.length) return { avg: 0, count: 0 };
    var sum = 0;
    names.forEach(function (n) { sum += perUser[n]; });
    return { avg: Math.round((sum / names.length) * 10) / 10, count: names.length };
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
  }

  // Every recipe this person has rated, for the profile page's list.
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
    // One review per person per recipe: drop any earlier one before adding.
    var list = (all[id] || []).filter(function (rv) {
      return (rv.by || rv.author) !== w && rv.author !== name;
    });
    list.unshift({
      by: w,
      author: name,
      stars: stars,
      text: text,
      date: new Date().toISOString().slice(0, 10)
    });
    all[id] = list;
    write(REVIEWS_KEY, all);
  }

  // Every review this person has written, for the profile page's list.
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
  }

  /* ---------- nutrition profile ---------- */

  // Validated on the way out: a half-filled or hand-edited profile reads as
  // "not set up" rather than feeding junk into the equation.
  function nutrition(w) {
    if (!w) return null;
    var p = read(NUTRITION_PREFIX + w, null);
    return (p && MiseNutrition.valid(p)) ? p : null;
  }
  function setNutrition(w, p) { if (w) write(NUTRITION_PREFIX + w, p); }
  function clearNutrition(w) { if (w) drop(NUTRITION_PREFIX + w); }

  /* The one number the rest of the app cares about; null until it's set up.
     THE PLUS GATE FOR THE CALORIE TARGET LIVES HERE — one function, so the
     recipe cards' "% OF YOUR DAY", the profile page and anything added later
     all follow the entitlement automatically instead of each remembering to
     ask. A lapsed subscriber keeps their saved profile: resubscribing brings
     the number straight back rather than making someone retype their body. */
  function calorieTarget(w) {
    if (typeof MiseSub !== "undefined" && !MiseSub.isPlus()) return null;
    var n = nutrition(w);
    if (!n) return null;
    var r = MiseNutrition.dailyCalories(n);
    return r ? r.target : null;
  }

  /* ---------- standing allergies ---------- */

  /* The board's allergy chips are session-only by design; these are the ones
     saved to an account, applied on every visit. Read defensively — this list
     decides what food someone is shown, so anything that isn't a recognised
     allergen id is dropped rather than trusted. */
  function allergies(w) {
    if (!w) return [];
    var saved = read(ALLERGY_PREFIX + w, []);
    if (!Array.isArray(saved)) return [];
    return saved.filter(function (id) {
      return ALLERGENS.some(function (a) { return a.id === id; });
    });
  }
  function setAllergies(w, list) { if (w) write(ALLERGY_PREFIX + w, list); }

  /* ---------- the progress log ---------- */

  /* ONE typed, append-only log per person rather than a key per kind, so
     adding a kind later is a new `t` and a new form — not a new storage key, a
     new migration and a fourth copy of this plumbing:

       { id, d: "2026-07-16", t: "weight", kg }
       { id, d, t: "lift", ex, sets, reps, kg }
       { id, d, t: "run",  km, mins }

     Canonical units are ALWAYS kg and km. Display converts (see log.js); what's
     stored never depends on which toggle someone last pressed, so switching
     units can't corrupt history. */
  var LOG_PREFIX = "mise-log-";

  var LOG_TYPES = {
    weight: ["kg"],
    lift: ["sets", "reps", "kg"],
    run: ["km", "mins"]
  };

  function validEntry(e) {
    if (!e || typeof e !== "object") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.d)) return false;
    if (isNaN(Date.parse(e.d + "T00:00:00Z"))) return false;   // rejects 2026-02-31
    var fields = LOG_TYPES[e.t];
    if (!fields) return false;
    for (var i = 0; i < fields.length; i++) {
      var v = e[fields[i]];
      if (typeof v !== "number" || !isFinite(v) || v <= 0) return false;
    }
    if (e.t === "lift" && !(typeof e.ex === "string" && e.ex.trim())) return false;
    return true;
  }

  /* Validated on the way out, like nutrition(): a hand-edited or half-written
     localStorage entry is dropped rather than fed to the maths or drawn on a
     chart. Sorted oldest-first — every caller wants it that way. */
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
    // Date.now alone collides when two entries are added in the same tick.
    e.id = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
    all.push(e);
    write(LOG_PREFIX + w, all);
    return e.id;
  }

  function removeLogEntry(w, id) {
    if (!w) return;
    write(LOG_PREFIX + w, logEntries(w).filter(function (e) { return e.id !== id; }));
  }

  /* Closes the loop the calorie target opens: a weigh-in updates the body the
     target is computed from, so the number follows you instead of going stale
     the day after you set it up. Only weight is touched — goal, activity, age
     and height stay exactly as they were set.

     Deliberately NOT gated. The nutrition profile is stored for free and
     calorieTarget() decides who may *see* the result, so a lapsed subscriber's
     weight keeps up to date and resubscribing shows a current number rather
     than one from months ago. Reads raw rather than via nutrition(): a profile
     that's invalid for some other reason (no age yet) should still record a
     weight instead of silently discarding it. */
  function syncNutritionWeight(w, kg) {
    if (!w || !(kg > 0)) return false;
    var p = read(NUTRITION_PREFIX + w, null);
    if (!p || typeof p !== "object") return false;
    p.weightKg = kg;
    write(NUTRITION_PREFIX + w, p);
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

  return {
    ALLERGENS: ALLERGENS,
    LOG_TYPES: LOG_TYPES,
    who: who,
    account: account, setAccount: setAccount, clearAccount: clearAccount,
    favs: favs, setFavs: setFavs,
    ratingSummary: ratingSummary, myRating: myRating, setMyRating: setMyRating, myRatings: myRatings,
    reviewsFor: reviewsFor, upsertReview: upsertReview, myReviews: myReviews, removeReview: removeReview,
    nutrition: nutrition, setNutrition: setNutrition, clearNutrition: clearNutrition,
    calorieTarget: calorieTarget,
    allergies: allergies, setAllergies: setAllergies,
    logEntries: logEntries, logOfType: logOfType, addLogEntry: addLogEntry,
    removeLogEntry: removeLogEntry, syncNutritionWeight: syncNutritionWeight,
    stats: stats
  };
})();
