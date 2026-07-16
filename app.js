/* Mise — meal-prep recipe library */
(function () {
  "use strict";

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

  var PROTEINS = [
    { id: "chicken", label: "Chicken" },
    { id: "beef", label: "Beef" },
    { id: "pork", label: "Pork" },
    { id: "turkey", label: "Turkey" },
    { id: "fish", label: "Fish" },
    { id: "shrimp", label: "Shrimp" },
    { id: "tofu", label: "Tofu" },
    { id: "beans", label: "Beans & legumes" },
    { id: "eggs", label: "Eggs" }
  ];

  var MEALS = [
    { id: "breakfast", label: "Breakfast" },
    { id: "main", label: "Lunch & dinner" }
  ];

  var SUGGEST_CANDIDATES = [
    "rice", "broccoli", "sweet potato", "quinoa", "black beans",
    "spinach", "noodles", "potatoes"
  ];

  var state = {
    meals: new Set(),
    allergies: new Set(),
    proteins: new Set(),
    terms: [],
    servings: 4,
    maxDifficulty: 3,
    query: "",
    favOnly: false
  };

  /* ---------- profile, ratings, reviews, favorites ----------
     Demo storage layer: everything lives in this browser's localStorage.
     To go multi-user later, reimplement these few functions against a
     backend (e.g. Supabase auth + tables) - the UI doesn't care. */

  var PROFILE_KEY = "mise-profile";
  var RATINGS_KEY = "mise-ratings";   // { recipeId: { profileName: 1-5 } }
  var REVIEWS_KEY = "mise-reviews";   // { recipeId: [{author, stars, text, date}] }
  var FAVS_PREFIX = "mise-favs-";     // per profile name -> [recipeId]

  function lsRead(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function lsWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // Real auth (Supabase, see auth.js) when configured; demo profile otherwise.
  var realAuth = typeof MiseAuth !== "undefined" && MiseAuth.enabled;
  var profile = realAuth ? null : lsRead(PROFILE_KEY, null);
  var favs = new Set();

  function who() { return profile ? (profile.id || profile.name) : null; }

  function loadFavs() {
    favs = new Set(profile ? lsRead(FAVS_PREFIX + who(), []) : []);
  }
  loadFavs();

  function saveFavs() {
    if (profile) lsWrite(FAVS_PREFIX + who(), Array.from(favs));
  }

  function ratingSummary(id) {
    var perUser = lsRead(RATINGS_KEY, {})[id] || {};
    var names = Object.keys(perUser);
    if (!names.length) return { avg: 0, count: 0 };
    var sum = 0;
    names.forEach(function (n) { sum += perUser[n]; });
    return { avg: Math.round((sum / names.length) * 10) / 10, count: names.length };
  }

  function myRating(id) {
    if (!profile) return 0;
    return (lsRead(RATINGS_KEY, {})[id] || {})[who()] || 0;
  }

  function setMyRating(id, stars) {
    var all = lsRead(RATINGS_KEY, {});
    (all[id] = all[id] || {})[who()] = stars;
    lsWrite(RATINGS_KEY, all);
  }

  function reviewsFor(id) {
    return lsRead(REVIEWS_KEY, {})[id] || [];
  }

  function upsertReview(id, text) {
    var all = lsRead(REVIEWS_KEY, {});
    var me = who();
    var list = (all[id] || []).filter(function (rv) { return (rv.by || rv.author) !== me && rv.author !== profile.name; });
    list.unshift({
      by: me,
      author: profile.name,
      stars: myRating(id) || null,
      text: text,
      date: new Date().toISOString().slice(0, 10)
    });
    all[id] = list;
    lsWrite(REVIEWS_KEY, all);
  }

  // one lowercase haystack per recipe: name, description, cuisine, tags, ingredients
  var HAYSTACKS = {};
  RECIPES.forEach(function (r) {
    HAYSTACKS[r.id] = (
      r.name + " " + r.description + " " + r.cuisine + " " +
      (r.tags || []).join(" ") + " " +
      r.ingredients.map(function (i) { return i.item; }).join(" ")
    ).toLowerCase();
  });

  var DIFF_WORDS = { 1: "easy", 2: "moderate", 3: "involved" };
  var DIFF_OUT = { 1: "easy only", 2: "up to moderate", 3: "any effort" };

  var $ = function (sel) { return document.querySelector(sel); };

  /* ---------- the week's plan (persisted) ---------- */

  var PLAN_KEY = "mise-plan";

  function loadPlan() {
    var m = new Map();
    try {
      JSON.parse(localStorage.getItem(PLAN_KEY) || "[]").forEach(function (e) {
        if (RECIPES.some(function (r) { return r.id === e.id; })) {
          m.set(e.id, Math.max(1, Math.min(12, parseInt(e.servings, 10) || 4)));
        }
      });
    } catch (e) { /* private mode etc. — plan just won't persist */ }
    return m;
  }

  function savePlan() {
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(
        Array.from(plan, function (p) { return { id: p[0], servings: p[1] }; })
      ));
    } catch (e) { /* ignore */ }
  }

  var plan = loadPlan();

  var cardsEl = $("#cards");
  var countEl = $("#count");
  var mobileCountEl = $("#mobile-count");
  var emptyEl = $("#empty");
  var railEl = $("#filter-rail");
  var modalEl = $("#recipe-modal");
  var modalBody = $("#modal-body");
  var badgeEl = $("#filter-count-badge");
  var clearBtn = $("#clear-all");
  var openerBtn = null; // element to restore focus to after modal closes
  var firstRender = true;

  /* ---------- quantity formatting ---------- */

  var GLYPHS = [
    [0, ""], [0.125, "⅛"], [0.25, "¼"], [0.333, "⅓"],
    [0.375, "⅜"], [0.5, "½"], [0.625, "⅝"], [0.667, "⅔"],
    [0.75, "¾"], [0.875, "⅞"], [1, ""]
  ];

  function formatQty(n) {
    if (n >= 10) return String(Math.round(n * 2) / 2);
    var whole = Math.floor(n + 1e-9);
    var frac = n - whole;
    var best = null, bestDiff = 1;
    for (var i = 0; i < GLYPHS.length; i++) {
      var d = Math.abs(frac - GLYPHS[i][0]);
      if (d < bestDiff) { bestDiff = d; best = GLYPHS[i]; }
    }
    if (bestDiff <= 0.04) {
      if (best[0] === 1) { whole += 1; best = [0, ""]; }
      if (whole === 0 && best[1] === "") return "0";
      return (whole > 0 ? whole : "") + best[1];
    }
    return String(Math.round(n * 10) / 10);
  }

  var PLURALS = { cup: "cups", clove: "cloves", slice: "slices", head: "heads", bunch: "bunches" };

  function formatUnit(unit, qty) {
    if (!unit) return "";
    if (qty <= 1) return unit;
    if (PLURALS[unit]) return PLURALS[unit];
    if (unit.indexOf("can (") === 0) return unit.replace("can (", "cans (");
    return unit;
  }

  /* ---------- filtering ---------- */

  function matches(r) {
    if (state.favOnly && !favs.has(r.id)) return false;
    if (state.meals.size && !state.meals.has(r.meal)) return false;
    if (state.allergies.size) {
      for (var i = 0; i < r.allergens.length; i++) {
        if (state.allergies.has(r.allergens[i])) return false;
      }
    }
    if (state.proteins.size && !state.proteins.has(r.protein)) return false;
    if (r.difficulty > state.maxDifficulty) return false;
    if (state.query) {
      var hay = HAYSTACKS[r.id];
      var words = state.query.split(/\s+/);
      for (var w = 0; w < words.length; w++) {
        if (hay.indexOf(words[w]) === -1) return false;
      }
    }
    for (var t = 0; t < state.terms.length; t++) {
      var term = state.terms[t];
      var found = r.ingredients.some(function (ing) {
        return ing.item.toLowerCase().indexOf(term) !== -1;
      });
      if (!found) return false;
    }
    return true;
  }

  function activeFilterCount() {
    return state.meals.size + state.allergies.size + state.proteins.size + state.terms.length +
      (state.maxDifficulty < 3 ? 1 : 0) + (state.favOnly ? 1 : 0);
  }

  /* ---------- rendering ---------- */

  function proteinLabel(id) {
    for (var i = 0; i < PROTEINS.length; i++) {
      if (PROTEINS[i].id === id) return PROTEINS[i].label;
    }
    return id;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function recipeImageSrc(r) {
    // WebP, not PNG: same pixels, ~92% smaller. Cards/modal hide the frame via
    // the img onerror handler for recipes with no photo.
    return "assets/recipes/" + r.id + ".webp";
  }

  function cardHTML(r) {
    var total = r.prepMinutes + r.cookMinutes;
    var contains = r.allergens.length
      ? "contains " + r.allergens.join(" · ")
      : "no major allergens";
    var rating = ratingSummary(r.id);
    var ratingMeta = rating.count
      ? "<span>&#9733; " + rating.avg + "</span><span class=\"sep\">/</span>"
      : "";
    var isFav = favs.has(r.id);
    // With a calorie target set, the raw number means something: show the share.
    var target = calorieTarget();
    var calMeta = target
      ? r.caloriesPerServing + " CAL &middot; " + Math.round(r.caloriesPerServing / target * 100) + "% OF YOUR DAY"
      : r.caloriesPerServing + " CAL/SERV";
    return (
      '<li class="card">' +
        '<span class="tape mono" aria-hidden="true">' + esc(proteinLabel(r.protein)).toUpperCase() + "</span>" +
        '<div class="card-photo">' +
          '<img src="' + esc(recipeImageSrc(r)) + '" alt="' + esc(r.name) + '" loading="lazy" onerror="this.parentElement.hidden=true">' +
        "</div>" +
        '<h3><button class="card-btn" data-id="' + esc(r.id) + '">' + esc(r.name) + "</button></h3>" +
        '<p class="card-desc">' + esc(r.description) + "</p>" +
        '<p class="card-meta">' +
          ratingMeta +
          "<span>" + DIFF_WORDS[r.difficulty].toUpperCase() + "</span><span class=\"sep\">/</span>" +
          "<span>" + total + " MIN</span><span class=\"sep\">/</span>" +
          "<span>" + calMeta + "</span><span class=\"sep\">/</span>" +
          "<span>KEEPS " + r.fridgeDays + " DAYS</span>" +
          (r.freezerFriendly ? '<span class="sep">/</span><span>FREEZES</span>' : "") +
        "</p>" +
        '<div class="card-foot">' +
          '<p class="card-allergens' + (r.allergens.length ? "" : " none") + '">' + esc(contains) + "</p>" +
          '<button class="fav-btn' + (isFav ? " on" : "") + '" data-fav="' + esc(r.id) + '" aria-pressed="' + isFav + '" aria-label="' + (isFav ? "Remove " : "Save ") + esc(r.name) + (isFav ? " from favorites" : " to favorites") + '">' +
            (isFav ? "&#9829;" : "&#9825;") +
          "</button>" +
          '<button class="plan-btn' + (plan.has(r.id) ? " on" : "") + '" data-plan="' + esc(r.id) + '" aria-pressed="' + plan.has(r.id) + '">' +
            (plan.has(r.id) ? "&#10003; PLANNED" : "+ PLAN") +
          "</button>" +
        "</div>" +
      "</li>"
    );
  }

  // An in-feed sponsored ticket every AD_EVERY recipes. Without a placement the
  // reader actually meets, "remove ads" would be selling nothing. Subscribers
  // get none of these; see subscription.js.
  var AD_EVERY = 12;

  // This is now the only ad slot on the site, so it is also where a real ad
  // network lands: set NETWORK_AD_HTML in ads.js and it renders that embed
  // instead of a house ad.
  function adCardHTML() {
    if (typeof NETWORK_AD_HTML !== "undefined" && NETWORK_AD_HTML) {
      return (
        '<li class="card card--ad card--ad-network">' +
          '<span class="tape tape--ad mono" aria-hidden="true">SPONSORED</span>' +
          '<div class="ad-network-slot">' + NETWORK_AD_HTML + "</div>" +
          '<div class="card-foot">' +
            '<button class="ad-card-remove mono" data-remove-ads>REMOVE ADS</button>' +
          "</div>" +
        "</li>"
      );
    }
    var flat = [];
    if (typeof PRODUCTS !== "undefined") {
      PRODUCTS.forEach(function (g) { g.items.forEach(function (p) { flat.push(p); }); });
    }
    if (!flat.length) return "";
    var p = flat[Math.floor(Math.random() * flat.length)];
    return (
      '<li class="card card--ad">' +
        '<span class="tape tape--ad mono" aria-hidden="true">SPONSORED</span>' +
        "<h3>" + esc(p.name) + "</h3>" +
        '<p class="card-desc">' + esc(p.blurb) + "</p>" +
        '<p class="card-meta"><span>' + esc(p.priceBand) + "</span></p>" +
        '<div class="card-foot">' +
          '<a class="ad-card-link mono" href="' + esc(productUrl(p)) + '" target="_blank" rel="sponsored noopener">VIEW ON AMAZON &rarr;</a>' +
          '<button class="ad-card-remove mono" data-remove-ads>REMOVE ADS</button>' +
        "</div>" +
      "</li>"
    );
  }

  function render() {
    var visible = RECIPES.filter(matches);
    var adFree = typeof MiseSub !== "undefined" && MiseSub.isAdFree();
    var html = "";
    visible.forEach(function (r, i) {
      html += cardHTML(r);
      // never trail an ad off the end of the list
      if (!adFree && (i + 1) % AD_EVERY === 0 && i + 1 < visible.length) html += adCardHTML();
    });
    cardsEl.innerHTML = html;
    if (firstRender) { cardsEl.classList.add("reveal"); firstRender = false; }
    else { cardsEl.classList.remove("reveal"); }

    var text = "Showing " + visible.length + " of " + RECIPES.length + " recipes";
    countEl.textContent = text;
    mobileCountEl.textContent = visible.length + " of " + RECIPES.length;
    emptyEl.hidden = visible.length !== 0;

    var n = activeFilterCount();
    badgeEl.hidden = n === 0;
    badgeEl.textContent = n;
    clearBtn.hidden = n === 0;

    var apply = $("#apply-filters");
    apply.textContent = visible.length === 0 ? "Nothing matches" : "Show " + visible.length + (visible.length === 1 ? " recipe" : " recipes");
  }

  /* ---------- filter chips ---------- */

  function buildToggleChips(containerId, defs, set, extraClass) {
    var host = $(containerId);
    // a stale cached index.html may predate this container; skip rather than crash
    if (!host) return;
    defs.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (extraClass || "");
      b.textContent = d.label;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        if (set.has(d.id)) { set.delete(d.id); b.setAttribute("aria-pressed", "false"); }
        else { set.add(d.id); b.setAttribute("aria-pressed", "true"); }
        render();
      });
      host.appendChild(b);
    });
  }

  function renderTermChips() {
    var host = $("#ingredient-chips");
    host.innerHTML = "";
    state.terms.forEach(function (term, idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip chip--term";
      b.innerHTML = esc(term) + ' <span class="x" aria-hidden="true">&times;</span>';
      b.setAttribute("aria-label", "Remove ingredient filter: " + term);
      b.addEventListener("click", function () {
        state.terms.splice(idx, 1);
        renderTermChips();
        render();
      });
      host.appendChild(b);
    });
  }

  function addTerm(raw) {
    var term = raw.trim().toLowerCase();
    if (!term || state.terms.indexOf(term) !== -1) return;
    state.terms.push(term);
    renderTermChips();
    render();
  }

  function buildSuggestions() {
    var host = $("#ingredient-suggest");
    var corpus = RECIPES.map(function (r) {
      return r.ingredients.map(function (i) { return i.item.toLowerCase(); }).join(" | ");
    }).join(" | ");
    var shown = 0;
    SUGGEST_CANDIDATES.forEach(function (c) {
      if (shown >= 6 || corpus.indexOf(c) === -1) return;
      shown++;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "suggest";
      b.textContent = "+ " + c;
      b.addEventListener("click", function () { addTerm(c); });
      host.appendChild(b);
    });
  }

  /* ---------- servings ---------- */

  function bindStepper(downEl, outEl, upEl, get, setFn) {
    downEl.addEventListener("click", function () { setFn(Math.max(1, get() - 1)); outEl.textContent = get(); });
    upEl.addEventListener("click", function () { setFn(Math.min(12, get() + 1)); outEl.textContent = get(); });
  }

  /* ---------- modal ---------- */

  function ingredientRows(r, servings) {
    var factor = servings / r.baseServings;
    return r.ingredients.map(function (ing) {
      var qtyText;
      if (ing.qty == null) {
        qtyText = "—";
      } else {
        var scaled = ing.qty * factor;
        qtyText = formatQty(scaled) + (ing.unit ? " " + formatUnit(ing.unit, scaled) : "");
      }
      return (
        "<li>" +
          '<span class="qty">' + esc(qtyText) + "</span>" +
          '<span class="what">' + esc(ing.item) +
            (ing.note ? '<span class="note">, ' + esc(ing.note) + "</span>" : "") +
          "</span>" +
        "</li>"
      );
    }).join("");
  }

  function recipeToPDFModel(r, servings) {
    var factor = servings / r.baseServings;
    var total = r.prepMinutes + r.cookMinutes;
    return {
      name: r.name,
      description: r.description,
      protein: proteinLabel(r.protein),
      meta: [
        "PREP " + r.prepMinutes + " MIN", "COOK " + r.cookMinutes + " MIN", "TOTAL " + total + " MIN",
        r.caloriesPerServing + " CAL", "P " + r.proteinGrams + "G", "C " + r.carbsGrams + "G",
        "F " + r.fatGrams + "G", "PER SERVING"
      ].join("   "),
      contains: r.allergens.length
        ? "CONTAINS: " + r.allergens.join(" · ").toUpperCase()
        : "NO MAJOR ALLERGENS",
      hasAllergens: r.allergens.length > 0,
      servings: servings,
      baseServings: r.baseServings,
      ingredients: r.ingredients.map(function (ing) {
        var qtyText = "";
        if (ing.qty != null) {
          var scaled = ing.qty * factor;
          qtyText = formatQty(scaled) + (ing.unit ? " " + formatUnit(ing.unit, scaled) : "");
        }
        return { qty: qtyText, text: ing.item + (ing.note ? ", " + ing.note : "") };
      }),
      steps: r.steps.slice(),
      storageNote: r.storageNote
    };
  }

  function openModal(r, servingsOverride) {
    var servings = servingsOverride || state.servings;
    var total = r.prepMinutes + r.cookMinutes;
    var contains = r.allergens.length
      ? "CONTAINS: " + r.allergens.join(" · ").toUpperCase()
      : "NO MAJOR ALLERGENS";

    modalBody.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape">' + esc(proteinLabel(r.protein)).toUpperCase() + "</span>" +
        '<div class="modal-actions">' +
          '<button class="plan-tool" id="modal-fav" type="button" aria-pressed="' + favs.has(r.id) + '">' +
            (favs.has(r.id) ? "&#9829; SAVED" : "&#9825; SAVE") +
          "</button>" +
          '<button class="plan-tool" id="modal-plan" type="button" aria-pressed="' + plan.has(r.id) + '">' +
            (plan.has(r.id) ? "&#10003; ON THE PLAN" : "+ ADD TO PLAN") +
          "</button>" +
          '<button class="modal-tool" id="modal-download" type="button" aria-label="Download recipe as PDF" title="Download PDF">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
              '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />' +
              '<path d="M7 10l5 5 5-5" />' +
              '<path d="M12 15V3" />' +
            "</svg>" +
          "</button>" +
          '<button class="modal-tool" id="modal-print" type="button" aria-label="Print recipe" title="Print recipe">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
              '<path d="M6 9V3h12v6" />' +
              '<path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />' +
              '<path d="M6 14h12v7H6z" />' +
            "</svg>" +
          "</button>" +
          '<button class="modal-close" id="modal-close" aria-label="Close recipe">&times;</button>' +
        "</div>" +
      "</div>" +
      '<div class="modal-photo">' +
        '<img src="' + esc(recipeImageSrc(r)) + '" alt="' + esc(r.name) + '" onerror="this.parentElement.hidden=true">' +
      "</div>" +
      '<h2 id="modal-title">' + esc(r.name) + "</h2>" +
      '<p class="modal-desc">' + esc(r.description) + "</p>" +
      '<p class="modal-stats">' +
        "<span>" + DIFF_WORDS[r.difficulty].toUpperCase() + "</span>" +
        "<span>PREP " + r.prepMinutes + " MIN</span>" +
        "<span>COOK " + r.cookMinutes + " MIN</span>" +
        "<span>TOTAL " + total + " MIN</span>" +
        "<span>" + r.caloriesPerServing + " CAL</span>" +
        "<span>P " + r.proteinGrams + "G</span>" +
        "<span>C " + r.carbsGrams + "G</span>" +
        "<span>F " + r.fatGrams + "G</span>" +
        "<span>PER SERVING</span>" +
      "</p>" +
      '<p class="modal-contains' + (r.allergens.length ? "" : " none") + '">' + esc(contains) + "</p>" +
      '<div class="rate-row">' +
        '<span class="rate-label mono">YOUR RATING</span>' +
        '<div class="stars" id="modal-stars" role="group" aria-label="Rate this recipe"></div>' +
        '<span class="rate-avg mono" id="rate-avg"></span>' +
      "</div>" +
      '<div class="modal-cols">' +
        "<div>" +
          '<p class="modal-section-title">Ingredients</p>' +
          '<div class="modal-servings">' +
            '<div class="stepper" role="group" aria-label="Servings for this recipe">' +
              '<button type="button" id="m-serv-down" aria-label="Fewer servings">&minus;</button>' +
              '<output id="m-serv-out" class="mono">' + servings + "</output>" +
              '<button type="button" id="m-serv-up" aria-label="More servings">+</button>' +
            "</div>" +
            '<p class="serv-note">servings · written for ' + r.baseServings + "</p>" +
          "</div>" +
          '<ul class="ing-list" id="m-ing-list">' + ingredientRows(r, servings) + "</ul>" +
        "</div>" +
        "<div>" +
          '<p class="modal-section-title">Method</p>' +
          '<ol class="step-list">' +
            r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
          "</ol>" +
          '<div class="modal-storage">' +
            '<span class="mono">STORAGE</span>' + esc(r.storageNote) +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="modal-reviews">' +
        '<p class="modal-section-title">Reviews</p>' +
        '<div id="reviews-list"></div>' +
        '<form id="review-form" hidden>' +
          '<label class="visually-hidden" for="review-text">Your review</label>' +
          '<textarea id="review-text" maxlength="500" placeholder="How did it prep? How did day 4 taste?"></textarea>' +
          '<button type="submit" class="review-post">Post review</button>' +
        "</form>" +
        '<button id="review-signin" class="review-signin mono" type="button" hidden>SIGN IN TO RATE &amp; REVIEW &rarr;</button>' +
      "</div>";

    var mServings = servings;
    bindStepper(
      $("#m-serv-down"), $("#m-serv-out"), $("#m-serv-up"),
      function () { return mServings; },
      function (v) {
        mServings = v;
        $("#m-ing-list").innerHTML = ingredientRows(r, mServings);
      }
    );

    renderModalRating(r.id);
    renderReviews(r.id);

    $("#modal-stars").addEventListener("click", function (e) {
      var star = e.target.closest(".star");
      if (!star) return;
      if (!profile) { openAuth(); return; }
      setMyRating(r.id, parseInt(star.getAttribute("data-star"), 10));
      renderModalRating(r.id);
      renderReviews(r.id);
      render(); // card meta shows the new average
    });

    $("#review-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var text = $("#review-text").value.trim();
      if (!text || !profile) return;
      upsertReview(r.id, text);
      $("#review-text").value = "";
      renderReviews(r.id);
    });

    $("#review-signin").addEventListener("click", openAuth);

    $("#modal-fav").addEventListener("click", function () {
      toggleFav(r.id);
      var on = favs.has(r.id);
      this.innerHTML = on ? "&#9829; SAVED" : "&#9825; SAVE";
      this.setAttribute("aria-pressed", String(on));
    });

    $("#modal-close").addEventListener("click", function () { modalEl.close(); });
    $("#modal-plan").addEventListener("click", function () {
      togglePlan(r.id, null);
      var on = plan.has(r.id);
      this.innerHTML = on ? "&#10003; ON THE PLAN" : "+ ADD TO PLAN";
      this.setAttribute("aria-pressed", String(on));
    });
    $("#modal-print").addEventListener("click", function () {
      if (requirePlus()) return;
      // Android has no window.print(); the share sheet carries Print instead.
      if (window.MiseNative && MiseNative.isNative) {
        MiseNative.sharePDF(recipeToPDFModel(r, mServings), r.id + ".pdf", r.name);
      } else {
        window.print();
      }
    });
    $("#modal-download").addEventListener("click", function () {
      if (requirePlus()) return;
      MisePDF.download(recipeToPDFModel(r, mServings), r.id + ".pdf");
    });
    modalEl.showModal();
    modalEl.scrollTop = 0;
  }

  // close when the backdrop itself is clicked
  modalEl.addEventListener("click", function (e) {
    if (e.target === modalEl) modalEl.close();
  });

  modalEl.addEventListener("close", function () {
    modalBody.innerHTML = "";
    if (openerBtn && document.contains(openerBtn)) openerBtn.focus();
    openerBtn = null;
  });

  cardsEl.addEventListener("click", function (e) {
    var favBtn = e.target.closest(".fav-btn");
    if (favBtn) {
      toggleFav(favBtn.getAttribute("data-fav"));
      return;
    }
    var planBtn = e.target.closest(".plan-btn");
    if (planBtn) {
      togglePlan(planBtn.getAttribute("data-plan"), planBtn);
      return;
    }
    var btn = e.target.closest(".card-btn");
    if (!btn) {
      var card = e.target.closest(".card");
      if (card) btn = card.querySelector(".card-btn");
    }
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var recipe = RECIPES.find(function (r) { return r.id === id; });
    if (recipe) { openerBtn = btn; openModal(recipe); }
  });

  /* ---------- rating + review rendering ---------- */

  function renderModalRating(id) {
    var mine = myRating(id);
    var html = "";
    for (var i = 1; i <= 5; i++) {
      html += '<button type="button" class="star' + (i <= mine ? " on" : "") + '" data-star="' + i +
        '" aria-label="Rate ' + i + " of 5" + (i === mine ? ", your current rating" : "") + '">' +
        (i <= mine ? "&#9733;" : "&#9734;") + "</button>";
    }
    $("#modal-stars").innerHTML = html;
    var s = ratingSummary(id);
    $("#rate-avg").textContent = s.count
      ? "★ " + s.avg + " · " + s.count + (s.count === 1 ? " RATING" : " RATINGS")
      : "NO RATINGS YET";
  }

  function renderReviews(id) {
    var list = reviewsFor(id);
    var host = $("#reviews-list");
    if (!list.length) {
      host.innerHTML = '<p class="review-empty">No reviews yet &mdash; cook it and be the first.</p>';
    } else {
      host.innerHTML = list.map(function (rv) {
        var n = Math.max(0, Math.min(5, parseInt(rv.stars, 10) || 0));
        var stars = n ? "&#9733;".repeat(n) + '<span class="review-stars-off">' + "&#9734;".repeat(5 - n) + "</span>" : "";
        return '<div class="review">' +
          '<p class="review-head mono">' +
            (stars ? '<span class="review-stars">' + stars + "</span> " : "") +
            esc(rv.author.toUpperCase()) + " &middot; " + esc(rv.date) +
          "</p>" +
          '<p class="review-text">' + esc(rv.text) + "</p>" +
        "</div>";
      }).join("");
    }
    $("#review-form").hidden = !profile;
    $("#review-signin").hidden = !!profile;
  }

  /* ---------- auth + favorites UI ---------- */

  var authModal = $("#auth-modal");
  var authBtn = $("#auth-btn");
  var favChip = $("#fav-chip");

  function updateAuthUI() {
    authBtn.textContent = profile ? "HI, " + profile.name.toUpperCase() : "SIGN IN";
    $("#auth-real").hidden = !!profile || !realAuth;
    $("#auth-signedout").hidden = !!profile || realAuth;
    $("#auth-signedin").hidden = !profile;
    if (profile) {
      $("#auth-greeting").textContent = "Signed in as " + profile.name +
        (profile.email ? " (" + profile.email + ")" : "");
      var me = who();
      var ratings = lsRead(RATINGS_KEY, {});
      var rated = Object.keys(ratings).filter(function (id) { return ratings[id][me]; }).length;
      var reviews = lsRead(REVIEWS_KEY, {});
      var written = Object.keys(reviews).filter(function (id) {
        return reviews[id].some(function (rv) { return (rv.by || rv.author) === me; });
      }).length;
      $("#auth-stats").textContent =
        favs.size + " FAVORITES · " + rated + " RATED · " + written + " REVIEWED";

      var target = calorieTarget();
      var note = $("#auth-goals-note");
      if (note) {
        note.textContent = target ? target + " KCAL/DAY →" : "SET UP →";
      }
    }
  }

  function openAuth() {
    updateAuthUI();
    authModal.showModal();
    if (!profile) $(realAuth ? "#real-email" : "#auth-name").focus();
  }

  function toggleFav(id) {
    if (!profile) { openAuth(); return; }
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    saveFavs();
    var on = favs.has(id);
    var btn = document.querySelector('.fav-btn[data-fav="' + id + '"]');
    if (btn) {
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.innerHTML = on ? "&#9829;" : "&#9825;";
    }
    if (state.favOnly) render();
  }

  authBtn.addEventListener("click", openAuth);
  $("#auth-close").addEventListener("click", function () { authModal.close(); });
  $("#auth-goals").addEventListener("click", function () {
    authModal.close();
    openProfile();
  });

  authModal.addEventListener("click", function (e) {
    if (e.target === authModal) authModal.close();
  });

  $("#auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("#auth-name").value.trim();
    if (!name) return;
    profile = { name: name };
    lsWrite(PROFILE_KEY, profile);
    favs = new Set(lsRead(FAVS_PREFIX + name, []));
    updateAuthUI();
    render();
    authModal.close();
  });

  $("#auth-signout").addEventListener("click", function () {
    if (realAuth) {
      MiseAuth.signOut(); // onChange listener resets the UI
      authModal.close();
      return;
    }
    profile = null;
    try { localStorage.removeItem(PROFILE_KEY); } catch (e) { /* ignore */ }
    favs = new Set();
    state.favOnly = false;
    favChip.setAttribute("aria-pressed", "false");
    updateAuthUI();
    render();
    authModal.close();
  });

  /* ---------- real auth (Supabase) wiring ---------- */

  if (realAuth) {
    var authMode = "signin";

    var authMsg = function (text, ok) {
      var el = $("#auth-error");
      el.hidden = !text;
      el.textContent = text || "";
      el.classList.toggle("ok", !!ok);
    };

    MiseAuth.onChange(function (user) {
      profile = user ? { id: user.id, name: user.name, email: user.email } : null;
      if (!profile) {
        state.favOnly = false;
        favChip.setAttribute("aria-pressed", "false");
      }
      loadFavs();
      updateAuthUI();
      render();
      if (profile && authModal.open) authModal.close();
    });

    $("#auth-mode-toggle").addEventListener("click", function () {
      authMode = authMode === "signin" ? "signup" : "signin";
      $("#real-submit").textContent = authMode === "signin" ? "Sign in" : "Create account";
      $("#real-password").setAttribute("autocomplete",
        authMode === "signin" ? "current-password" : "new-password");
      this.innerHTML = authMode === "signin"
        ? "NEW HERE? CREATE AN ACCOUNT &rarr;"
        : "ALREADY HAVE AN ACCOUNT? SIGN IN &rarr;";
      authMsg("");
    });

    $("#real-auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      authMsg("");
      if (!MiseAuth.isReady()) {
        authMsg("Still connecting to the sign-in service — try again in a second.");
        return;
      }
      var email = $("#real-email").value.trim();
      var password = $("#real-password").value;
      var submit = $("#real-submit");
      submit.disabled = true;
      var action = authMode === "signup"
        ? MiseAuth.signUp(email, password)
        : MiseAuth.signIn(email, password);
      action.then(function (res) {
        submit.disabled = false;
        if (res.error) { authMsg(res.error.message); return; }
        if (authMode === "signup" && res.data && res.data.user && !res.data.session) {
          authMsg("Almost there — check your email for a confirmation link, then sign in.", true);
          return;
        }
        // a session means success; the onChange listener closes the dialog
      }).catch(function () {
        submit.disabled = false;
        authMsg("Could not reach the sign-in service. Check your connection and try again.");
      });
    });

    var oauth = function (provider) {
      authMsg("");
      if (!MiseAuth.isReady()) {
        authMsg("Still connecting to the sign-in service — try again in a second.");
        return;
      }
      MiseAuth.signInWith(provider).then(function (res) {
        if (res.error) authMsg(res.error.message);
        // on success the browser redirects to the provider
      }).catch(function () {
        authMsg("Could not reach the sign-in service. Check your connection and try again.");
      });
    };

    $("#oauth-google").addEventListener("click", function () { oauth("google"); });
    $("#oauth-apple").addEventListener("click", function () { oauth("apple"); });
  }

  favChip.addEventListener("click", function () {
    if (!profile) { openAuth(); return; }
    state.favOnly = !state.favOnly;
    favChip.setAttribute("aria-pressed", String(state.favOnly));
    render();
  });

  /* ---------- nutrition profile (goals + calorie target) ---------- */

  var NUTRITION_PREFIX = "mise-nutrition-";   // per profile, like favorites
  var profileModal = $("#profile-modal");
  var profileBody = $("#profile-body");
  var draft = null;   // the form's working copy, committed on save

  function loadNutrition() {
    if (!profile) return null;
    var p = lsRead(NUTRITION_PREFIX + who(), null);
    return (p && MiseNutrition.valid(p)) ? p : null;
  }

  function saveNutrition(p) {
    if (profile) lsWrite(NUTRITION_PREFIX + who(), p);
  }

  // The one number the rest of the app cares about; null until it's set up.
  function calorieTarget() {
    var n = loadNutrition();
    if (!n) return null;
    var r = MiseNutrition.dailyCalories(n);
    return r ? r.target : null;
  }

  function blankDraft() {
    return {
      goal: "maintain",
      sex: "unspecified",
      age: null,
      heightCm: null,
      weightKg: null,
      activity: "moderate",
      units: "imperial"
    };
  }

  function chipRow(name, options, current) {
    return options.map(function (o) {
      return '<button type="button" class="chip nut-chip" data-field="' + name + '" data-val="' + o.id +
        '" aria-pressed="' + (current === o.id) + '">' + esc(o.label) + "</button>";
    }).join("");
  }

  function renderProfileBody() {
    var d = draft;
    var imperial = d.units === "imperial";
    var ready = MiseNutrition.valid(d);
    var calc = ready ? MiseNutrition.dailyCalories(d) : null;
    var warns = ready ? MiseNutrition.warnings(d) : [];

    // height/weight shown in whichever units are selected
    var ft = d.heightCm ? Math.floor(MiseNutrition.cmToIn(d.heightCm) / 12) : "";
    var inch = d.heightCm ? Math.round(MiseNutrition.cmToIn(d.heightCm) % 12) : "";
    var lb = d.weightKg ? Math.round(MiseNutrition.kgToLb(d.weightKg)) : "";

    profileBody.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape">YOUR GOALS</span>' +
        '<button class="modal-close" id="profile-close" aria-label="Close">&times;</button>' +
      "</div>" +
      '<h2 id="profile-title">Your calorie target</h2>' +
      '<p class="modal-desc">An estimate from the Mifflin-St Jeor equation — the one dietitians ' +
        "generally use. It&rsquo;s a starting point, not a prescription.</p>" +

      '<div class="nut-group">' +
        '<p class="nut-label mono">GOAL</p>' +
        '<div class="chip-row">' + chipRow("goal", [
          { id: "cut", label: "Cut" }, { id: "maintain", label: "Maintain" }, { id: "bulk", label: "Bulk" }
        ], d.goal) + "</div>" +
        '<p class="nut-hint">' + esc(MiseNutrition.GOALS[d.goal].hint) + "</p>" +
      "</div>" +

      '<div class="nut-group">' +
        '<p class="nut-label mono">SEX</p>' +
        '<div class="chip-row">' + chipRow("sex", [
          { id: "female", label: "Female" }, { id: "male", label: "Male" }, { id: "unspecified", label: "Rather not say" }
        ], d.sex) + "</div>" +
        '<p class="nut-hint">The equation uses a different constant for each &mdash; they differ ' +
          "by 166 kcal a day. &ldquo;Rather not say&rdquo; splits the difference, which is honest " +
          "but less accurate.</p>" +
      "</div>" +

      '<div class="nut-group">' +
        '<div class="nut-units">' +
          '<p class="nut-label mono">YOU</p>' +
          '<div class="chip-row">' +
            '<button type="button" class="chip nut-unit' + (imperial ? " on" : "") + '" data-units="imperial">ft / lb</button>' +
            '<button type="button" class="chip nut-unit' + (imperial ? "" : " on") + '" data-units="metric">cm / kg</button>' +
          "</div>" +
        "</div>" +
        '<div class="nut-fields">' +
          '<label class="nut-field"><span class="mono">AGE</span>' +
            '<input id="nut-age" type="number" inputmode="numeric" min="18" max="100" value="' + (d.age || "") + '" placeholder="30"></label>' +
          (imperial
            ? '<label class="nut-field"><span class="mono">HEIGHT</span>' +
                '<span class="nut-pair">' +
                  '<input id="nut-ft" type="number" inputmode="numeric" min="3" max="8" value="' + ft + '" placeholder="5"><em>ft</em>' +
                  '<input id="nut-in" type="number" inputmode="numeric" min="0" max="11" value="' + inch + '" placeholder="10"><em>in</em>' +
                "</span></label>" +
              '<label class="nut-field"><span class="mono">WEIGHT</span>' +
                '<span class="nut-pair"><input id="nut-lb" type="number" inputmode="numeric" min="66" max="660" value="' + lb + '" placeholder="175"><em>lb</em></span></label>'
            : '<label class="nut-field"><span class="mono">HEIGHT</span>' +
                '<span class="nut-pair"><input id="nut-cm" type="number" inputmode="numeric" min="120" max="250" value="' + (d.heightCm ? Math.round(d.heightCm) : "") + '" placeholder="178"><em>cm</em></span></label>' +
              '<label class="nut-field"><span class="mono">WEIGHT</span>' +
                '<span class="nut-pair"><input id="nut-kg" type="number" inputmode="numeric" min="30" max="300" value="' + (d.weightKg ? Math.round(d.weightKg) : "") + '" placeholder="80"><em>kg</em></span></label>') +
        "</div>" +
      "</div>" +

      '<div class="nut-group">' +
        '<p class="nut-label mono">ACTIVITY</p>' +
        '<div class="nut-activity">' +
          Object.keys(MiseNutrition.ACTIVITY).map(function (k) {
            var a = MiseNutrition.ACTIVITY[k];
            return '<button type="button" class="nut-act' + (d.activity === k ? " on" : "") + '" data-field="activity" data-val="' + k + '">' +
              "<strong>" + esc(a.label) + "</strong>" +
              '<span class="nut-act-hint">' + esc(a.hint) + "</span>" +
            "</button>";
          }).join("") +
        "</div>" +
      "</div>" +

      (calc
        ? '<div class="nut-result">' +
            '<p class="nut-result-label mono">YOUR DAILY TARGET</p>' +
            '<p class="nut-big">' + calc.target + ' <span class="nut-big-unit">kcal</span></p>' +
            '<p class="nut-math mono">BMR ' + calc.bmr + " &middot; TDEE " + calc.tdee +
              (calc.delta ? " &middot; " + (calc.delta > 0 ? "+" : "") + calc.delta + " TO " + esc(MiseNutrition.GOALS[d.goal].label.toUpperCase()) : " &middot; MAINTAIN") +
            "</p>" +
            (calc.floored
              ? '<p class="nut-warn">That works out below ' + calc.floor + " kcal, so we&rsquo;ve held it there. " +
                "Eating under that isn&rsquo;t something to do without a doctor.</p>"
              : "") +
            warns.map(function (w) { return '<p class="nut-warn">' + esc(w) + "</p>"; }).join("") +
          "</div>"
        : '<p class="nut-incomplete">' + esc(MiseNutrition.blocker(d) || "") + "</p>") +

      '<div class="nut-actions">' +
        '<button class="sub-buy" id="nut-save"' + (calc ? "" : " disabled") + ">Save my target</button>" +
        (loadNutrition() ? '<button class="review-signin mono" id="nut-clear">CLEAR MY PROFILE</button>' : "") +
      "</div>" +
      '<p class="nut-disclaimer">Mise isn&rsquo;t a doctor or a dietitian. This is a population-average ' +
        "estimate; if you have a health condition, are pregnant, or are treating an eating disorder, " +
        "get a number from a professional instead.</p>";

    wireProfileBody();
  }

  function readNumber(id) {
    var el = $(id);
    if (!el) return null;
    var v = parseFloat(el.value);
    return isFinite(v) ? v : null;
  }

  // Pull the form back into the draft, then re-render so the target updates live.
  function syncDraftFromForm() {
    draft.age = readNumber("#nut-age");
    if (draft.units === "imperial") {
      var ft = readNumber("#nut-ft"), inch = readNumber("#nut-in"), lb = readNumber("#nut-lb");
      draft.heightCm = (ft !== null) ? MiseNutrition.inToCm(ft * 12 + (inch || 0)) : null;
      draft.weightKg = (lb !== null) ? MiseNutrition.lbToKg(lb) : null;
    } else {
      draft.heightCm = readNumber("#nut-cm");
      draft.weightKg = readNumber("#nut-kg");
    }
  }

  function wireProfileBody() {
    $("#profile-close").addEventListener("click", function () { profileModal.close(); });

    profileBody.querySelectorAll("[data-field]").forEach(function (b) {
      b.addEventListener("click", function () {
        syncDraftFromForm();
        draft[this.getAttribute("data-field")] = this.getAttribute("data-val");
        renderProfileBody();
      });
    });

    profileBody.querySelectorAll("[data-units]").forEach(function (b) {
      b.addEventListener("click", function () {
        syncDraftFromForm();               // keep the values, just change the display
        draft.units = this.getAttribute("data-units");
        renderProfileBody();
      });
    });

    profileBody.querySelectorAll(".nut-fields input").forEach(function (i) {
      i.addEventListener("input", function () {
        var id = this.id, pos = this.selectionStart;
        syncDraftFromForm();
        renderProfileBody();
        var again = $("#" + id);          // re-render blows away focus; put it back
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) {} }
      });
    });

    var save = $("#nut-save");
    if (save) save.addEventListener("click", function () {
      syncDraftFromForm();
      if (!MiseNutrition.valid(draft)) return;
      saveNutrition(draft);
      updateAuthUI();
      render();
      profileModal.close();
    });

    var clear = $("#nut-clear");
    if (clear) clear.addEventListener("click", function () {
      try { localStorage.removeItem(NUTRITION_PREFIX + who()); } catch (e) { /* ignore */ }
      draft = blankDraft();
      renderProfileBody();
      updateAuthUI();
      render();
    });
  }

  function openProfile() {
    if (!profile) { openAuth(); return; }
    draft = loadNutrition() || blankDraft();
    if (!draft.units) draft.units = "imperial";
    renderProfileBody();
    profileModal.showModal();
    profileModal.scrollTop = 0;
  }

  profileModal.addEventListener("click", function (e) {
    if (e.target === profileModal) profileModal.close();
  });

  /* ---------- Mise Plus (remove-ads subscription) ---------- */

  var subModal = $("#sub-modal");
  var subBody = $("#sub-body");

  /* The paywall in one place. Call at the top of any Plus-only action:
       if (requirePlus()) return;
     Returns true when the caller should stop (and the upgrade dialog is up). */
  function requirePlus() {
    if (MiseSub.isPlus()) return false;
    openSub();
    return true;
  }

  function renderSubBody() {
    var live = MiseSub.isLive();

    if (MiseSub.isPlus()) {
      var kind = MiseSub.kind();
      subBody.innerHTML =
        '<div class="modal-top">' +
          '<span class="modal-tape">MISE PLUS</span>' +
          '<button class="modal-close" id="sub-close" aria-label="Close">&times;</button>' +
        "</div>" +
        '<h2 id="sub-title">You&rsquo;re on Plus</h2>' +
        '<p class="modal-desc">Printing, PDFs, and the weekly plan are unlocked, and the board is ' +
          "clear of sponsored tickets." +
          (live ? "" : " This is the demo unlock — nothing was charged.") + "</p>" +
        '<button class="clear-btn" id="sub-cancel">' +
          (live
            ? (kind === "lifetime" ? "Manage purchase" : "Manage subscription")
            : "Switch back to free") +
        "</button>";
      $("#sub-close").addEventListener("click", function () { subModal.close(); });
      $("#sub-cancel").addEventListener("click", function () {
        MiseSub.cancel().then(function () { renderSubBody(); render(); updatePlanUI(); });
      });
      return;
    }

    subBody.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape">MISE PLUS</span>' +
        '<button class="modal-close" id="sub-close" aria-label="Close">&times;</button>' +
      "</div>" +
      '<h2 id="sub-title">Take it to the kitchen</h2>' +
      '<p class="modal-desc">Plus unlocks the parts you use once you&rsquo;ve decided to cook:</p>' +
      '<ul class="sub-list">' +
        "<li>Print a recipe, or save it as a PDF</li>" +
        "<li>The weekly plan and its combined shopping list</li>" +
        "<li>No sponsored tickets on the board</li>" +
      "</ul>" +
      '<p class="sub-free mono">FREE FOREVER: ALL ' + RECIPES.length + " RECIPES, EVERY FILTER, " +
        "SEARCH, RATINGS, REVIEWS, FAVORITES, AND YOUR ACCOUNT.</p>" +
      (live
        ? ""
        : '<p class="sub-demo mono">DEMO BUILD — THIS CHARGES NOTHING. REAL BILLING NEEDS A STORE ' +
          "ACCOUNT AND A PUBLISHED PRODUCT; SEE SUBSCRIPTION.JS.</p>") +
      '<div class="sub-options">' +
        '<button class="sub-buy" id="sub-buy-month">' +
          '<span class="sub-buy-price">' + esc(MiseSub.monthlyPrice()) + "</span>" +
          '<span class="sub-buy-note mono">' + (live ? "SUBSCRIBE" : "DEMO UNLOCK") + " &middot; CANCEL ANYTIME</span>" +
        "</button>" +
        '<button class="sub-buy sub-buy--alt" id="sub-buy-life">' +
          '<span class="sub-buy-price">' + esc(MiseSub.lifetimePrice()) + "</span>" +
          '<span class="sub-buy-note mono">' + (live ? "PAY ONCE" : "DEMO UNLOCK") + " &middot; KEEP IT FOREVER</span>" +
        "</button>" +
      "</div>" +
      '<button class="review-signin mono" id="sub-restore">RESTORE PURCHASE</button>' +
      '<p id="sub-error" class="auth-error" hidden></p>';

    $("#sub-close").addEventListener("click", function () { subModal.close(); });

    function buy(kind, btn) {
      btn.disabled = true;
      MiseSub.purchase(kind).then(function () {
        renderSubBody();
        render();
        updatePlanUI();
      }).catch(function (e) {
        btn.disabled = false;
        var err = $("#sub-error");
        err.hidden = false;
        err.textContent = e.message;
      });
    }
    $("#sub-buy-month").addEventListener("click", function () { buy("monthly", this); });
    $("#sub-buy-life").addEventListener("click", function () { buy("lifetime", this); });

    $("#sub-restore").addEventListener("click", function () {
      MiseSub.restore().then(function (res) {
        if (res.plus) { renderSubBody(); render(); updatePlanUI(); return; }
        var err = $("#sub-error");
        err.hidden = false;
        err.textContent = res.demo
          ? "Nothing to restore in the demo — there is no store account behind it yet."
          : "No purchase found on this account.";
      });
    });
  }

  function openSub() {
    renderSubBody();
    subModal.showModal();
  }

  subModal.addEventListener("click", function (e) {
    if (e.target === subModal) subModal.close();
  });

  // One delegated handler for every "remove ads" affordance on the page.
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-remove-ads]");
    if (!t) return;
    e.preventDefault();
    openSub();
  });

  /* ---------- weekly plan UI ---------- */

  var planModal = $("#plan-modal");
  var planBody = $("#plan-body");
  var planBarEl = $("#plan-bar");

  function updatePlanUI() {
    var n = plan.size;
    planBarEl.hidden = n === 0;
    document.body.classList.toggle("has-plan", n > 0);
    $("#plan-bar-label").textContent = n + (n === 1 ? " recipe" : " recipes") + " planned";
  }

  function togglePlan(id, cardBtn) {
    if (plan.has(id)) plan.delete(id);
    else plan.set(id, state.servings);
    savePlan();
    var on = plan.has(id);
    var btn = cardBtn || document.querySelector('.plan-btn[data-plan="' + id + '"]');
    if (btn) {
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.innerHTML = on ? "&#10003; PLANNED" : "+ PLAN";
    }
    updatePlanUI();
  }

  function planEntries() {
    return Array.from(plan, function (p) {
      var r = RECIPES.find(function (x) { return x.id === p[0]; });
      return r ? { r: r, servings: p[1] } : null;
    }).filter(Boolean);
  }

  function buildShoppingList(entries) {
    var measured = {};
    var pantry = {};
    entries.forEach(function (e) {
      var factor = e.servings / e.r.baseServings;
      e.r.ingredients.forEach(function (ing) {
        var name = ing.item.toLowerCase();
        if (ing.qty == null) { pantry[name] = true; return; }
        var key = name + "|" + (ing.unit || "");
        if (!measured[key]) measured[key] = { item: name, unit: ing.unit, qty: 0 };
        measured[key].qty += ing.qty * factor;
      });
    });
    var byItem = {};
    Object.keys(measured).forEach(function (k) {
      var m = measured[k];
      (byItem[m.item] = byItem[m.item] || []).push(m);
    });
    var items = Object.keys(byItem).sort().map(function (item) {
      var amount = byItem[item].map(function (m) {
        return formatQty(m.qty) + (m.unit ? " " + formatUnit(m.unit, m.qty) : "");
      }).join(" + ");
      return { item: item, amount: amount };
    });
    return { items: items, pantry: Object.keys(pantry).sort() };
  }

  // Android: the plan goes out as text through the share sheet — a shopping
  // list you can paste into notes or send to whoever is at the shop.
  function planAsText() {
    var entries = planEntries();
    var list = buildShoppingList(entries);
    var out = ["MISE — THE WEEK'S PLAN", ""];
    out.push("SHOPPING LIST");
    list.items.forEach(function (it) { out.push("- " + it.amount + "  " + it.item); });
    if (list.pantry.length) out.push("- from the pantry, to taste: " + list.pantry.join(", "));
    out.push("", "RECIPES");
    entries.forEach(function (e) {
      out.push("- " + e.r.name + " (" + e.servings + " servings, " +
        (e.r.prepMinutes + e.r.cookMinutes) + " min)");
    });
    return out.join("\n");
  }

  function renderPlanBody() {
    var entries = planEntries();
    var head =
      '<div class="modal-top">' +
        '<span class="modal-tape">THE WEEK&rsquo;S PLAN</span>' +
        '<div class="plan-head-actions">' +
          (entries.length ? '<button class="plan-tool" id="plan-print" type="button">' +
            (window.MiseNative && MiseNative.isNative ? "SHARE PLAN" : "PRINT / SAVE PDF") +
            "</button>" : "") +
          (entries.length ? '<button class="plan-tool" id="plan-clear" type="button">CLEAR PLAN</button>' : "") +
          '<button class="modal-close" id="plan-close" aria-label="Close plan">&times;</button>' +
        "</div>" +
      "</div>" +
      '<h2 id="plan-title">Plan &amp; shopping list</h2>';

    if (!entries.length) {
      planBody.innerHTML = head +
        '<p class="plan-empty">Nothing planned yet &mdash; tap &ldquo;+ PLAN&rdquo; on any recipe ticket to start your week.</p>';
      return;
    }

    var totalServings = entries.reduce(function (n, e) { return n + e.servings; }, 0);
    var list = buildShoppingList(entries);

    planBody.innerHTML = head +
      '<p class="plan-sub">' + entries.length + (entries.length === 1 ? " recipe" : " recipes") +
        " &middot; " + totalServings + " servings across the week. Adjust servings here and the shopping list updates.</p>" +
      '<div class="plan-rows">' +
        entries.map(function (e) {
          return '<div class="plan-row">' +
            '<button class="plan-row-name" data-open="' + esc(e.r.id) + '">' + esc(e.r.name) + "</button>" +
            '<div class="plan-row-controls">' +
              '<div class="stepper" role="group" aria-label="Servings for ' + esc(e.r.name) + '">' +
                '<button type="button" class="p-down" data-id="' + esc(e.r.id) + '" aria-label="Fewer servings">&minus;</button>' +
                '<output class="mono">' + e.servings + " SERV</output>" +
                '<button type="button" class="p-up" data-id="' + esc(e.r.id) + '" aria-label="More servings">+</button>' +
              "</div>" +
              '<button class="plan-remove" data-id="' + esc(e.r.id) + '" aria-label="Remove ' + esc(e.r.name) + ' from plan">&times;</button>' +
            "</div>" +
          "</div>";
        }).join("") +
      "</div>" +
      '<p class="modal-section-title">Shopping list</p>' +
      '<ul class="shop-list">' +
        list.items.map(function (it) {
          return '<li><span class="sq" aria-hidden="true"></span><span class="amt">' + esc(it.amount) + "</span><span>" + esc(it.item) + "</span></li>";
        }).join("") +
      "</ul>" +
      (list.pantry.length ? '<p class="shop-pantry">From the pantry, to taste: ' + esc(list.pantry.join(", ")) + ".</p>" : "") +
      '<p class="modal-section-title">The recipes</p>' +
      entries.map(function (e) {
        var r = e.r;
        return '<div class="plan-recipe">' +
          "<h3>" + esc(r.name) + "</h3>" +
          '<p class="plan-recipe-meta">SCALED FOR ' + e.servings + " SERVINGS (WRITTEN FOR " + r.baseServings + ") &middot; PREP " +
            r.prepMinutes + " MIN &middot; COOK " + r.cookMinutes + " MIN &middot; " + r.caloriesPerServing + " CAL/SERV" +
            (r.allergens.length ? " &middot; CONTAINS " + esc(r.allergens.join(", ").toUpperCase()) : "") + "</p>" +
          '<ul class="ing-list">' + ingredientRows(r, e.servings) + "</ul>" +
          '<p class="modal-section-title plan-method-title">Method</p>' +
          '<ol class="step-list">' + r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
          '<div class="modal-storage"><span class="mono">STORAGE</span>' + esc(r.storageNote) + "</div>" +
        "</div>";
      }).join("");
  }

  planBody.addEventListener("click", function (e) {
    if (e.target.closest("#plan-close")) { planModal.close(); return; }
    if (e.target.closest("#plan-print")) {
      // only reachable behind the plan gate, but belt and braces
      if (requirePlus()) return;
      if (window.MiseNative && MiseNative.isNative) {
        MiseNative.shareText("Mise — the week's plan", planAsText());
      } else {
        window.print();
      }
      return;
    }
    if (e.target.closest("#plan-clear")) {
      plan.clear(); savePlan(); updatePlanUI(); render(); renderPlanBody();
      return;
    }
    var step = e.target.closest(".p-up, .p-down");
    if (step) {
      var id = step.getAttribute("data-id");
      var up = step.classList.contains("p-up");
      var v = plan.get(id) || 4;
      v = up ? Math.min(12, v + 1) : Math.max(1, v - 1);
      plan.set(id, v);
      savePlan();
      renderPlanBody();
      var again = planBody.querySelector((up ? ".p-up" : ".p-down") + '[data-id="' + id + '"]');
      if (again) again.focus();
      return;
    }
    var rm = e.target.closest(".plan-remove");
    if (rm) {
      plan.delete(rm.getAttribute("data-id"));
      savePlan(); updatePlanUI(); render(); renderPlanBody();
      return;
    }
    var open = e.target.closest(".plan-row-name");
    if (open) {
      var rid = open.getAttribute("data-open");
      var recipe = RECIPES.find(function (r) { return r.id === rid; });
      if (recipe) { planModal.close(); openModal(recipe, plan.get(rid)); }
    }
  });

  // Adding to the plan stays free — it costs nothing and lets people build the
  // basket. The wall is here, on opening it, because the value is the combined
  // shopping list, not the act of ticking a box.
  $("#open-plan").addEventListener("click", function () {
    if (requirePlus()) return;
    renderPlanBody();
    planModal.showModal();
    planModal.scrollTop = 0;
  });

  planModal.addEventListener("click", function (e) {
    if (e.target === planModal) planModal.close();
  });

  /* ---------- mobile rail ---------- */

  function setRail(open) {
    railEl.classList.toggle("open", open);
    $("#open-filters").setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open && window.innerWidth < 1024 ? "hidden" : "";
    if (open) { $("#close-filters").focus(); }
    else { $("#open-filters").focus(); }
  }

  $("#open-filters").addEventListener("click", function () { setRail(true); });
  $("#close-filters").addEventListener("click", function () { setRail(false); });
  $("#apply-filters").addEventListener("click", function () { setRail(false); });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (subModal.open) { subModal.close(); return; }
    if (profileModal.open) { profileModal.close(); return; }
    if (authModal.open) { authModal.close(); return; }
    if (modalEl.open) { modalEl.close(); return; }
    if (planModal.open) { planModal.close(); return; }
    if (railEl.classList.contains("open") && window.innerWidth < 1024) setRail(false);
  });

  /* ---------- wire up ---------- */

  buildToggleChips("#meal-chips", MEALS, state.meals);
  buildToggleChips("#allergy-chips", ALLERGENS, state.allergies);
  buildToggleChips("#protein-chips", PROTEINS, state.proteins);
  buildSuggestions();

  $("#ingredient-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("#ingredient-input");
    addTerm(input.value);
    input.value = "";
    input.focus();
  });

  bindStepper(
    $("#serv-down"), $("#serv-out"), $("#serv-up"),
    function () { return state.servings; },
    function (v) { state.servings = v; }
  );

  var searchInput = $("#search-input");
  var searchClear = $("#search-clear");

  searchInput.addEventListener("input", function () {
    state.query = searchInput.value.trim().toLowerCase();
    searchClear.hidden = state.query === "";
    render();
  });

  searchClear.addEventListener("click", function () {
    searchInput.value = "";
    state.query = "";
    searchClear.hidden = true;
    render();
    searchInput.focus();
  });

  var diffSlider = $("#diff-slider");
  var diffOut = $("#diff-out");

  function applyDifficulty() {
    state.maxDifficulty = parseInt(diffSlider.value, 10);
    diffOut.textContent = DIFF_OUT[state.maxDifficulty];
    diffSlider.setAttribute("aria-valuetext", DIFF_OUT[state.maxDifficulty]);
    render();
  }

  diffSlider.addEventListener("input", applyDifficulty);
  diffSlider.setAttribute("aria-valuetext", DIFF_OUT[state.maxDifficulty]);

  clearBtn.addEventListener("click", function () {
    state.meals.clear();
    state.allergies.clear();
    state.proteins.clear();
    state.terms = [];
    state.favOnly = false;
    state.query = "";
    searchInput.value = "";
    searchClear.hidden = true;
    state.maxDifficulty = 3;
    diffSlider.value = "3";
    diffOut.textContent = DIFF_OUT[3];
    diffSlider.setAttribute("aria-valuetext", DIFF_OUT[3]);
    document.querySelectorAll('.chip[aria-pressed="true"]').forEach(function (c) {
      c.setAttribute("aria-pressed", "false");
    });
    renderTermChips();
    render();
  });

  /* ---------- app download links ---------- */

  // apps.js carries the two store URLs. While both are empty this renders
  // nothing at all, so the site never links to a listing that doesn't exist.
  // Deliberately no Apple/Google logos here: those are trademarks, and the
  // licensed way to show them is each store's official badge, which may not be
  // redrawn. Swap these text buttons for the real badges at launch — see apps.js.
  function renderAppLinks() {
    var ios = typeof IOS_APP_URL !== "undefined" ? IOS_APP_URL : "";
    var android = typeof ANDROID_APP_URL !== "undefined" ? ANDROID_APP_URL : "";
    var host = $("#app-links");
    if (!host || (!ios && !android)) return;

    var buttons = "";
    if (ios) {
      buttons += '<a class="app-link" href="' + esc(ios) + '" target="_blank" rel="noopener">' +
        "GET IT FOR IPHONE &rarr;</a>";
    }
    if (android) {
      buttons += '<a class="app-link" href="' + esc(android) + '" target="_blank" rel="noopener">' +
        "GET IT FOR ANDROID &rarr;</a>";
    }

    host.innerHTML =
      '<p class="app-links-title mono" id="app-links-title">MISE ON YOUR PHONE</p>' +
      '<p class="app-links-line">All ' + RECIPES.length + " recipes live inside the app, so the board, " +
        "your plan, and the shopping list all work with no signal at the shop.</p>" +
      '<div class="app-links-row">' + buttons + "</div>" +
      // Google's current legal-line tool emits exactly this. The widely copied
      // "…and the Google Play logo are trademarks…" is legacy text from the
      // retired badge generator.
      (android ? '<p class="app-links-legal">Google Play is a trademark of Google LLC.</p>' : "");
    host.hidden = false;
  }

  render();
  updatePlanUI();
  updateAuthUI();
  renderAppLinks();
})();
