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
  var SYNCED_PREFIX    = "mise-synced-";     // who -> 1 once THIS browser has merged its local data up (see hydrate)
  var LOG_RM_PREFIX    = "mise-log-rm-";     // who -> [entry ids deleted here, kept until the server confirms]
  var LOG_UNITS_PREFIX = "mise-log-units-";  // who -> display units; log.js reads/writes it, we wipe it on delete

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
        .then(function () {
          // Confirmed gone server-side — the tombstone has done its job.
          var dead = read(LOG_RM_PREFIX + b.uid, []);
          if (!Array.isArray(dead)) return;
          var i = dead.indexOf(id);
          if (i !== -1) { dead.splice(i, 1); write(LOG_RM_PREFIX + b.uid, dead); }
        }, function (e) { log("push log remove failed", e); });
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

  /* Pull this person's rows into the cache.

     FIRST sync on a given browser (no SYNCED marker yet): they may have local
     data from before the backend existed, so merge it UP and nothing is lost —
     sets union, singletons prefer the newer side, local-only rows are pushed.

     EVERY LATER sync: the server is the source of truth and the cache is
     replaced wholesale. The union used to re-run on every page load, which
     made a row deleted on another device indistinguishable from never-synced
     local data — so deletions were resurrected forever. Two exceptions:

       - LOG ENTRIES still merge by id (an entry written here while its push
         died must not be dropped), with a tombstone list so entries deleted
         HERE can't ride back in through that union.
       - THE NUTRITION PROFILE keeps whichever side is NEWER (local savedAt vs
         the row's updated_at). It used to be server-wins, so a weigh-in whose
         push died was quietly reverted on the next page load — and the board
         computed a calorie target from the stale server weight. Local-newer
         re-pushes, healing the server instead.

     Then fireSync so the pages redraw with the reconciled data. */
  var hydrating = null;   // uid mid-pull; two auth events on one load must not double-run
  function hydrate(user) {
    var b = backend();
    if (!b || !user || user.id !== b.uid) return;
    var uid = b.uid;
    if (hydrating === uid) return;
    hydrating = uid;
    var firstSync = !read(SYNCED_PREFIX + uid, null);

    Promise.all([
      b.c.from("favorites").select("recipe_id"),
      b.c.from("allergies").select("allergen_id"),
      b.c.from("nutrition_profiles").select("profile,updated_at").maybeSingle(),
      b.c.from("log_entries").select("*"),
      b.c.from("ratings").select("recipe_id,stars").eq("user_id", uid),
      b.c.from("reviews").select("*").eq("user_id", uid),
      b.c.from("recipe_rating_summary").select("*")
    ]).then(function (res) {
      hydrating = null;
      var err = res.filter(function (r) { return r && r.error; })[0];
      if (err) { log("hydrate error", err.error); return; }
      var sbFavs  = (res[0].data || []).map(function (r) { return r.recipe_id; });
      var sbAllg  = (res[1].data || []).map(function (r) { return r.allergen_id; });
      var sbNut   = res[2].data ? res[2].data.profile : null;
      var sbNutAt = res[2].data ? (Date.parse(res[2].data.updated_at) || 0) : 0;
      var sbLog   = (res[3].data || []).map(logFromRow);
      var sbRate  = res[4].data || [];
      var sbRev   = res[5].data || [];
      var sbSum   = res[6].data || [];

      // ----- favorites -----
      if (firstSync) {
        var locFavs = read(FAVS_PREFIX + uid, []);
        var favSet = {}; sbFavs.concat(locFavs).forEach(function (id) { favSet[id] = 1; });
        var favs = Object.keys(favSet);
        write(FAVS_PREFIX + uid, favs);
        if (locFavs.some(function (id) { return sbFavs.indexOf(id) === -1; })) push.favorites(b, favs);
      } else {
        write(FAVS_PREFIX + uid, sbFavs);
      }

      // ----- allergies -----
      if (firstSync) {
        var locAllg = read(ALLERGY_PREFIX + uid, []);
        var aSet = {}; sbAllg.concat(locAllg).forEach(function (id) { aSet[id] = 1; });
        var allg = Object.keys(aSet);
        write(ALLERGY_PREFIX + uid, allg);
        if (locAllg.some(function (id) { return sbAllg.indexOf(id) === -1; })) push.allergies(b, allg);
      } else {
        write(ALLERGY_PREFIX + uid, sbAllg);
      }

      // ----- nutrition: the newer side wins -----
      var locNut = read(NUTRITION_PREFIX + uid, null);
      var locNutAt = (locNut && typeof locNut.savedAt === "number") ? locNut.savedAt : 0;
      if (sbNut && (!locNut || sbNutAt >= locNutAt)) {
        write(NUTRITION_PREFIX + uid, sbNut);
      } else if (locNut) {
        push.nutrition(b, locNut);   // local is newer (or server empty): heal the server
      }

      // ----- log: union by id, minus the local tombstones -----
      var locLog = read(LOG_PREFIX + uid, []);
      if (!Array.isArray(locLog)) locLog = [];
      var dead = read(LOG_RM_PREFIX + uid, []);
      if (!Array.isArray(dead)) dead = [];
      var deadSet = {}; dead.forEach(function (id) { deadSet[id] = 1; });
      var byId = {};
      sbLog.forEach(function (e) { if (!deadSet[e.id]) byId[e.id] = e; });
      locLog.forEach(function (e) {
        if (e && e.id && !deadSet[e.id] && !byId[e.id]) { byId[e.id] = e; push.logAdd(b, e); }  // local-only -> up
      });
      write(LOG_PREFIX + uid, Object.keys(byId).map(function (k) { return byId[k]; }));
      // Deletions the server hasn't caught up on: re-issue them, and forget
      // tombstones for anything the server no longer has anyway.
      var sbIds = {}; sbLog.forEach(function (e) { sbIds[e.id] = 1; });
      var pending = dead.filter(function (id) { return sbIds[id]; });
      write(LOG_RM_PREFIX + uid, pending);
      pending.forEach(function (id) { push.logRemove(b, id); });

      // ----- ratings (own) -----
      var ratings = {};
      sbRate.forEach(function (r) { (ratings[r.recipe_id] = ratings[r.recipe_id] || {})[uid] = r.stars; });
      if (firstSync) {
        var locRatings = read(RATINGS_KEY, {});
        Object.keys(locRatings).forEach(function (rid) {
          var mine = locRatings[rid] && locRatings[rid][uid];
          if (mine && !(ratings[rid] && ratings[rid][uid])) {
            (ratings[rid] = ratings[rid] || {})[uid] = mine;
            push.rating(b, rid, mine);
          }
        });
      }
      write(RATINGS_KEY, ratings);

      // ----- reviews (own) -----
      var reviews = {};
      sbRev.forEach(function (r) {
        reviews[r.recipe_id] = [{ by: uid, author: r.author, stars: r.stars, text: r.body,
          date: (r.created_at || "").slice(0, 10) }];
      });
      if (firstSync) {
        var locReviews = read(REVIEWS_KEY, {});
        Object.keys(locReviews).forEach(function (rid) {
          (locReviews[rid] || []).forEach(function (rv) {
            if ((rv.by || rv.author) === uid && !reviews[rid]) {
              reviews[rid] = [rv];
              push.review(b, rid, rv.stars, rv.text, rv.author);
            }
          });
        });
      }
      write(REVIEWS_KEY, reviews);

      // ----- public rating aggregates -----
      var sums = {};
      sbSum.forEach(function (r) { sums[r.recipe_id] = { avg: Number(r.avg) || 0, count: r.count || 0 }; });
      write(SUMMARY_KEY, sums);

      write(SYNCED_PREFIX + uid, 1);
      hydratedFor = uid;
      log("hydrated", uid, firstSync ? "(first sync: merged local data up)" : "");
      fireSync();
    }, function (e) { hydrating = null; log("hydrate rejected", e); });
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

  /* ---------- community recipes (user-submitted, world-readable) ----------

     The first UGC that isn't a rating or review. Rows live in `user_recipes`
     (owner-writable, world-readable via an auto-hide-on-reports RLS policy — see
     supabase/migrations/20260719000000_community_recipes.sql). On read they are
     coerced into the recipe schema and handed to the board, which merges them
     into the global RECIPES array so the modal, plan, reviews and favorites all
     work unchanged. Same world-readable shape as loadSummaries(): a client but
     no `who`, so it works signed out. A dedicated onCommunity channel (not
     onSync) drives the board's re-merge, keeping it clear of the favorites/
     ratings redraw. */

  var COMMUNITY_KEY = "mise-community";   // cache of the mapped public recipe list
  var communityListeners = [];
  function onCommunity(fn) { communityListeners.push(fn); }
  function fireCommunity() { communityListeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function community() { var l = read(COMMUNITY_KEY, []); return Array.isArray(l) ? l : []; }

  // A client with no session requirement — the read path is public.
  function publicClient() {
    return (typeof MiseAuth !== "undefined" && MiseAuth.enabled && MiseAuth.client && MiseAuth.client()) || null;
  }

  // The recipe fields we persist in the jsonb `data` column (everything except
  // the injected id/source/author/photo, which live in their own columns).
  var RECIPE_DATA_FIELDS = [
    "name", "description", "protein", "cuisine", "tags", "meal",
    "baseServings", "prepMinutes", "cookMinutes",
    "caloriesPerServing", "proteinGrams", "carbsGrams", "fatGrams",
    "fridgeDays", "freezerFriendly", "difficulty",
    "allergens", "ingredients", "steps", "storageNote", "sourceUrl"
  ];

  function photoUrlFor(path) {
    if (!path) return null;
    var c = publicClient();
    if (!c || !c.storage) return null;
    try {
      var res = c.storage.from("recipe-photos").getPublicUrl(path);
      return (res && res.data && res.data.publicUrl) || null;
    } catch (e) { return null; }
  }

  /* Turn one server row into a recipe object the board can render. Community
     recipes are untrusted remote input AND their numeric fields are interpolated
     raw (unescaped) into the card/modal HTML, so every value is coerced here:
     numbers to finite numbers, arrays to arrays, difficulty clamped to 1-3 (or
     DIFF_WORDS[r.difficulty].toUpperCase() throws), allergens filtered to the
     big-9. A row missing a name, any ingredient, or any step is dropped. */
  function mapRecipeRow(row) {
    if (!row || typeof row !== "object" || !row.id || !row.data || typeof row.data !== "object") return null;
    var d = row.data;

    function num(v, min, max, dflt) {
      var n = Number(v);
      if (!isFinite(n)) n = dflt;
      if (min != null && n < min) n = min;
      if (max != null && n > max) n = max;
      return n;
    }
    function str(v) { return v == null ? "" : String(v); }
    function arr(v) { return Array.isArray(v) ? v : []; }

    var name = str(d.name).trim();
    if (!name) return null;

    var validAllergen = {};
    ALLERGENS.forEach(function (a) { validAllergen[a.id] = 1; });

    var ingredients = arr(d.ingredients).map(function (ing) {
      if (!ing || typeof ing !== "object") return null;
      var item = str(ing.item).trim();
      if (!item) return null;
      var qty = (ing.qty == null || ing.qty === "") ? null : num(ing.qty, 0, 100000, null);
      return {
        qty: (qty != null && isFinite(qty)) ? qty : null,
        unit: str(ing.unit).slice(0, 40),
        item: item.slice(0, 120),
        note: str(ing.note).slice(0, 200),
        allergens: arr(ing.allergens).map(String).filter(function (a) { return validAllergen[a]; })
      };
    }).filter(Boolean);
    if (!ingredients.length) return null;

    var steps = arr(d.steps).map(function (s) { return str(s).trim().slice(0, 800); }).filter(Boolean);
    if (!steps.length) return null;

    var difficulty = Math.round(num(d.difficulty, 1, 3, 2));
    if (difficulty < 1 || difficulty > 3) difficulty = 2;

    return {
      id: String(row.id),
      name: name.slice(0, 120),
      description: str(d.description).slice(0, 500),
      protein: str(d.protein).slice(0, 40) || "chicken",
      cuisine: str(d.cuisine).slice(0, 60),
      tags: arr(d.tags).map(function (t) { return str(t).slice(0, 40); }).slice(0, 20),
      meal: d.meal === "breakfast" ? "breakfast" : "main",
      baseServings: Math.max(1, Math.round(num(d.baseServings, 1, 24, 4))),
      prepMinutes: Math.round(num(d.prepMinutes, 0, 100000, 0)),
      cookMinutes: Math.round(num(d.cookMinutes, 0, 100000, 0)),
      caloriesPerServing: Math.round(num(d.caloriesPerServing, 0, 100000, 0)),
      proteinGrams: Math.round(num(d.proteinGrams, 0, 100000, 0)),
      carbsGrams: Math.round(num(d.carbsGrams, 0, 100000, 0)),
      fatGrams: Math.round(num(d.fatGrams, 0, 100000, 0)),
      fridgeDays: Math.round(num(d.fridgeDays, 0, 3650, 3)),
      freezerFriendly: !!d.freezerFriendly,
      difficulty: difficulty,
      allergens: arr(d.allergens).map(String).filter(function (a) { return validAllergen[a]; }),
      ingredients: ingredients,
      steps: steps,
      storageNote: str(d.storageNote).slice(0, 500),
      sourceUrl: str(d.sourceUrl).slice(0, 300),
      // injected, not from `data`:
      source: "community",
      author: str(row.author || "Cook").slice(0, 80),
      userId: row.user_id || null,
      photoPath: row.photo_path || null,
      photoUrl: photoUrlFor(row.photo_path),
      createdAt: row.created_at || null
    };
  }

  /* The whole public list. Reads user_recipes; RLS auto-hides anything over the
     report threshold (the author still sees their own). Caches the mapped list
     and fires onCommunity so the board re-merges. Signed out works too. */
  function loadCommunity(cb) {
    var c = publicClient();
    if (!c) { if (cb) cb(); return; }
    c.from("user_recipes").select("*").order("created_at", { ascending: false }).then(function (res) {
      if (res.error) { log("community load error", res.error); if (cb) cb(); return; }
      var mapped = (res.data || []).map(mapRecipeRow).filter(Boolean);
      write(COMMUNITY_KEY, mapped);
      fireCommunity();
      log("community loaded", mapped.length);
      if (cb) cb();
    }, function (e) { log("community load rejected", e); if (cb) cb(); });
  }

  // Build the jsonb `data` payload from a client-side recipe object.
  function recipeData(recipe) {
    var data = {};
    RECIPE_DATA_FIELDS.forEach(function (k) { if (recipe[k] !== undefined) data[k] = recipe[k]; });
    return data;
  }

  /* Publish a recipe. Uploads the (already-downscaled webp) photo to the user's
     own folder first; a failed upload doesn't block the recipe (photo is
     optional). Then inserts the row and refreshes the public list so it appears
     on the board. cb(err|null, id). */
  function publishRecipe(w, recipe, photoBlob, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    var id = String(recipe.id);
    var author = String(recipe.author || "Cook").slice(0, 80);
    var data = recipeData(recipe);

    function insertRow(photoPath) {
      b.c.from("user_recipes").insert({
        id: id, user_id: b.uid, author: author, data: data, photo_path: photoPath || null
      }).then(function (res) {
        if (res.error) { log("publish failed", res.error); if (cb) cb(res.error); return; }
        loadCommunity();          // refresh cache + redraw the board
        if (cb) cb(null, id);
      }, function (e) { log("publish rejected", e); if (cb) cb(e); });
    }

    if (photoBlob) {
      var path = b.uid + "/" + id + ".webp";
      b.c.storage.from("recipe-photos").upload(path, photoBlob, { upsert: true, contentType: "image/webp" })
        .then(function (res) { insertRow(res && res.error ? null : path); },
              function () { insertRow(null); });
    } else {
      insertRow(null);
    }
  }

  /* Edit an existing recipe you own. A new photoBlob replaces the photo;
     otherwise recipe.photoPath (the existing path, or null to clear) is kept. */
  function updateRecipe(w, id, recipe, photoBlob, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    id = String(id);
    var data = recipeData(recipe);
    var author = String(recipe.author || "Cook").slice(0, 80);

    function applyUpdate(photoPath) {
      b.c.from("user_recipes").update({
        data: data, author: author, photo_path: photoPath || null, updated_at: new Date().toISOString()
      }).eq("user_id", b.uid).eq("id", id).then(function (res) {
        if (res.error) { log("update failed", res.error); if (cb) cb(res.error); return; }
        loadCommunity();
        if (cb) cb(null, id);
      }, function (e) { log("update rejected", e); if (cb) cb(e); });
    }

    if (photoBlob) {
      var path = b.uid + "/" + id + ".webp";
      b.c.storage.from("recipe-photos").upload(path, photoBlob, { upsert: true, contentType: "image/webp" })
        .then(function (res) { applyUpdate(res && res.error ? (recipe.photoPath || null) : path); },
              function () { applyUpdate(recipe.photoPath || null); });
    } else {
      applyUpdate(recipe.photoPath || null);
    }
  }

  /* Delete a recipe you own. The row's reports cascade away with it (FK); the
     photo is best-effort removed. */
  function deleteRecipe(w, id, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    id = String(id);
    b.c.from("user_recipes").delete().eq("user_id", b.uid).eq("id", id).then(function (res) {
      try { b.c.storage.from("recipe-photos").remove([b.uid + "/" + id + ".webp"]); } catch (e) {}
      var list = read(COMMUNITY_KEY, []);
      if (Array.isArray(list)) {
        write(COMMUNITY_KEY, list.filter(function (x) { return x.id !== id; }));
        fireCommunity();
      }
      if (res.error) { log("delete failed", res.error); if (cb) cb(res.error); return; }
      if (cb) cb(null);
    }, function (e) { log("delete rejected", e); if (cb) cb(e); });
  }

  /* Report someone else's recipe. ignoreDuplicates makes a re-report a clean
     no-op (ON CONFLICT DO NOTHING) — and, crucially, DO NOTHING needs only the
     INSERT privilege, so it works without an UPDATE grant/policy on the
     author-private reports table (a plain upsert emits ON CONFLICT DO UPDATE,
     which Postgres requires UPDATE rights for and would 42501). Enough distinct
     reports auto-hide the recipe (RLS). */
  function reportRecipe(w, id, reason, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    b.c.from("recipe_reports").upsert({
      reporter_id: b.uid, recipe_id: String(id), reason: reason ? String(reason).slice(0, 400) : null
    }, { onConflict: "reporter_id,recipe_id", ignoreDuplicates: true }).then(function (res) {
      if (res.error) log("report failed", res.error);
      if (cb) cb(res.error || null);
    }, function (e) { log("report rejected", e); if (cb) cb(e); });
  }

  /* The signed-in user's own recipes (including any auto-hidden ones), for the
     profile page's "your recipes" section. */
  function myRecipes(w, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb([]); return; }
    b.c.from("user_recipes").select("*").eq("user_id", b.uid)
      .order("created_at", { ascending: false }).then(function (res) {
        if (res.error) { log("myRecipes error", res.error); if (cb) cb([]); return; }
        if (cb) cb((res.data || []).map(mapRecipeRow).filter(Boolean));
      }, function (e) { log("myRecipes rejected", e); if (cb) cb([]); });
  }

  /* ---------- the forum (threads + flat replies, world-readable) ----------

     Same rails as community recipes: a world-readable list fetched into a cache
     and redrawn via a dedicated channel (onForum), author-scoped writes, and
     auto-hide-on-reports enforced by RLS. Threads carry a reply count + last
     activity from the `forum_thread_meta` view so the list can sort by what's
     active. Replies for one thread are fetched on open (fetchThread), like
     reviews for a recipe. See supabase/migrations/20260719000001_forum.sql. */

  var FORUM_KEY = "mise-forum-threads";   // cache of the mapped thread list
  var forumListeners = [];
  function onForum(fn) { forumListeners.push(fn); }
  function fireForum() { forumListeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function forumThreads() { var l = read(FORUM_KEY, []); return Array.isArray(l) ? l : []; }

  function mapThreadRow(row) {
    if (!row || !row.id) return null;
    var id = String(row.id);
    if (!/^[a-z0-9-]+$/.test(id)) return null;
    var title = String(row.title == null ? "" : row.title).slice(0, 140);
    if (!title.trim()) return null;
    return {
      id: id,
      userId: row.user_id || null,
      author: String(row.author || "Cook").slice(0, 80),
      category: String(row.category || "general").slice(0, 40),
      title: title,
      body: String(row.body == null ? "" : row.body).slice(0, 5000),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      replyCount: 0,
      lastActivity: row.created_at || null
    };
  }

  /* The whole thread list + per-thread reply meta, merged and sorted by most
     recent activity (a reply bumps a thread). Signed out works too. */
  function loadForumThreads(cb) {
    var c = publicClient();
    if (!c) { if (cb) cb(); return; }
    Promise.all([
      c.from("forum_threads").select("*"),
      c.from("forum_thread_meta").select("*")
    ]).then(function (res) {
      if (res[0].error) { log("forum load error", res[0].error); if (cb) cb(); return; }
      var meta = {};
      if (!res[1].error) (res[1].data || []).forEach(function (m) { meta[m.thread_id] = m; });
      var threads = (res[0].data || []).map(mapThreadRow).filter(Boolean).map(function (t) {
        var m = meta[t.id];
        if (m) { t.replyCount = m.reply_count || 0; if (m.last_reply_at) t.lastActivity = m.last_reply_at; }
        return t;
      });
      threads.sort(function (a, b) {
        var av = a.lastActivity || "", bv = b.lastActivity || "";
        return av > bv ? -1 : av < bv ? 1 : 0;   // newest activity first
      });
      write(FORUM_KEY, threads);
      fireForum();
      log("forum loaded", threads.length);
      if (cb) cb();
    }, function (e) { log("forum load rejected", e); if (cb) cb(); });
  }

  /* Replies for one thread, oldest first. World-readable (works signed out). */
  function fetchThread(threadId, cb) {
    var c = publicClient();
    if (!c) { if (cb) cb([]); return; }
    c.from("forum_replies").select("*").eq("thread_id", threadId)
      .order("created_at", { ascending: true }).then(function (res) {
        if (res.error) { log("thread fetch error", res.error); if (cb) cb([]); return; }
        var replies = (res.data || []).map(function (r) {
          if (!r || !r.id) return null;
          return {
            id: String(r.id), threadId: r.thread_id, userId: r.user_id || null,
            author: String(r.author || "Cook").slice(0, 80),
            body: String(r.body == null ? "" : r.body).slice(0, 5000),
            createdAt: r.created_at || null
          };
        }).filter(Boolean);
        if (cb) cb(replies);
      }, function (e) { log("thread fetch rejected", e); if (cb) cb([]); });
  }

  function createThread(w, data, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    var id = "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    b.c.from("forum_threads").insert({
      id: id, user_id: b.uid,
      author: String(data.author || "Cook").slice(0, 80),
      category: String(data.category || "general").slice(0, 40),
      title: String(data.title || "").slice(0, 140),
      body: String(data.body || "").slice(0, 5000)
    }).then(function (res) {
      if (res.error) { log("create thread failed", res.error); if (cb) cb(res.error); return; }
      loadForumThreads();
      if (cb) cb(null, id);
    }, function (e) { log("create thread rejected", e); if (cb) cb(e); });
  }

  function createReply(w, threadId, body, author, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    var id = "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    b.c.from("forum_replies").insert({
      id: id, thread_id: String(threadId), user_id: b.uid,
      author: String(author || "Cook").slice(0, 80),
      body: String(body || "").slice(0, 5000)
    }).then(function (res) {
      if (res.error) { log("create reply failed", res.error); if (cb) cb(res.error); return; }
      // A reply lifts the thread in the list; the meta view recomputes activity.
      loadForumThreads();
      if (cb) cb(null, id);
    }, function (e) { log("create reply rejected", e); if (cb) cb(e); });
  }

  function deleteThread(w, id, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    b.c.from("forum_threads").delete().eq("user_id", b.uid).eq("id", String(id)).then(function (res) {
      loadForumThreads();
      if (cb) cb(res.error || null);
    }, function (e) { if (cb) cb(e); });
  }

  function deleteReply(w, id, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    b.c.from("forum_replies").delete().eq("user_id", b.uid).eq("id", String(id)).then(function (res) {
      if (cb) cb(res.error || null);   // caller re-fetches the open thread
    }, function (e) { if (cb) cb(e); });
  }

  /* Report a thread or a reply (kind = 'thread' | 'reply'). ignoreDuplicates ->
     ON CONFLICT DO NOTHING, which needs only INSERT (no UPDATE grant/policy on
     the author-private reports table); a repeat report is a clean no-op. Enough
     distinct reports auto-hide it (RLS). Same reasoning as reportRecipe. */
  function reportForum(w, kind, id, reason, cb) {
    var b = forPush(w);
    if (!b) { if (cb) cb(new Error("not signed in")); return; }
    b.c.from("forum_reports").upsert({
      reporter_id: b.uid, target_kind: kind, target_id: String(id),
      reason: reason ? String(reason).slice(0, 400) : null
    }, { onConflict: "reporter_id,target_kind,target_id", ignoreDuplicates: true }).then(function (res) {
      if (res.error) log("report forum failed", res.error);
      if (cb) cb(res.error || null);
    }, function (e) { if (cb) cb(e); });
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
    drop(LOG_RM_PREFIX + w);
    drop(LOG_UNITS_PREFIX + w);
    drop(SYNCED_PREFIX + w);

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
    p.savedAt = Date.now();   // recency stamp — hydrate keeps whichever side is newer
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
    var b = forPush(w);
    if (b) {
      // Tombstone until the server confirms, so hydrate's union can't
      // resurrect an entry deleted here whose delete-push died mid-flight.
      var dead = read(LOG_RM_PREFIX + w, []);
      if (!Array.isArray(dead)) dead = [];
      if (dead.indexOf(id) === -1) { dead.push(id); write(LOG_RM_PREFIX + w, dead); }
      push.logRemove(b, id);
    }
  }

  /* A weigh-in updates the body the calorie target is computed from. Not gated,
     so a lapsed subscriber's weight keeps up to date. */
  function syncNutritionWeight(w, kg) {
    if (!w || !(kg > 0)) return false;
    var p = read(NUTRITION_PREFIX + w, null);
    if (!p || typeof p !== "object") return false;
    if (p.weightKg === kg) return true;   // already current: no write, no push, no churn
    p.weightKg = kg;
    p.savedAt = Date.now();   // recency stamp — hydrate keeps whichever side is newer
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
  var communityLoaded = false;   // load the public list exactly once, when the client is first ready
  function maybeLoadCommunity() {
    if (communityLoaded) return;
    // publicClient() is null until the Supabase SDK finishes loading async, so a
    // wireBackend()-time call would no-op; onChange (which fires once the client
    // is ready) is the reliable trigger, same as loadSummaries().
    if (!publicClient()) return;
    communityLoaded = true;
    loadCommunity();   // world-readable + auth-independent; fires onCommunity when it lands
  }
  function wireBackend() {
    if (typeof MiseAuth === "undefined" || !MiseAuth.enabled || !MiseAuth.onChange) return;
    MiseAuth.onChange(function (user) {
      if (user && user.id) { if (hydratedFor !== user.id) hydrate(user); }   // pulls summaries too
      else { hydratedFor = null; loadSummaries(); }                          // signed out: board aggregates only
      maybeLoadCommunity();                                                  // client is ready now
    });
    var u = MiseAuth.user && MiseAuth.user();
    if (u && u.id) { if (hydratedFor !== u.id) hydrate(u); }
    else { loadSummaries(); }
    maybeLoadCommunity();   // covers a client already ready before we wired
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
    onSync: onSync, hydrate: hydrate, fetchRecipeSocial: fetchRecipeSocial,
    // community recipes (user-submitted): board merges on onCommunity.
    onCommunity: onCommunity, community: community, loadCommunity: loadCommunity,
    publishRecipe: publishRecipe, updateRecipe: updateRecipe, deleteRecipe: deleteRecipe,
    reportRecipe: reportRecipe, myRecipes: myRecipes,
    // the forum (threads + replies): forum.js redraws on onForum.
    onForum: onForum, forumThreads: forumThreads, loadForumThreads: loadForumThreads,
    fetchThread: fetchThread, createThread: createThread, createReply: createReply,
    deleteThread: deleteThread, deleteReply: deleteReply, reportForum: reportForum
  };
})();
