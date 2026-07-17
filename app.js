/* Mise — meal-prep recipe library */
(function () {
  "use strict";

  /* The big-9 list lives in store.js: the profile page draws its standing-
     allergy chips from the same array, and an allergen vocabulary that
     disagreed with itself across two pages is the last bug this feature wants. */
  var ALLERGENS = MiseStore.ALLERGENS;

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

  /* Equal-weight protein swaps for the recipe modal. Nutrition is expressed
     per 100g so the original protein's contribution can be removed and the
     substitute's added without disturbing the rest of the recipe. The values
     are intentionally representative rather than brand-specific. */
  var PROTEIN_SWAPS = {
    chicken: {
      item: "boneless skinless chicken breast", note: "cut as the recipe directs",
      terms: "boneless skinless chicken breasts?|chicken breasts?|chicken thighs?|ground chicken|cooked chicken breasts?|cooked chicken|rotisserie chicken|chicken sausage links?|chicken",
      calories: 165, protein: 31, carbs: 0, fat: 3.6, allergens: []
    },
    beef: {
      item: "lean beef", note: "cut or crumbled as the recipe directs",
      terms: "ground beef(?: \\(\d+% lean\\))?|beef chuck roast|chuck roast|sirloin steak|skirt steak|flank steak|steak|beef",
      calories: 217, protein: 26, carbs: 0, fat: 12, allergens: []
    },
    pork: {
      item: "pork tenderloin", note: "cut as the recipe directs",
      terms: "boneless pork shoulder|pork shoulder|pork tenderloin|ground pork|pork breakfast sausage|fresh chorizo|chorizo|pork",
      calories: 195, protein: 27, carbs: 0, fat: 9, allergens: []
    },
    turkey: {
      item: "lean ground turkey", note: "shape or crumble as the recipe directs",
      terms: "italian turkey sausage links?|turkey sausage|ground turkey|turkey",
      calories: 170, protein: 29, carbs: 0, fat: 7, allergens: []
    },
    fish: {
      item: "cod fillets", note: "cut into portions as the recipe directs",
      terms: "salmon fillets?|canned salmon|smoked salmon|cod fillets?|tilapia fillets?|canned tuna(?: in water)?|tuna|salmon|cod|tilapia|fish",
      calories: 160, protein: 24, carbs: 0, fat: 7, allergens: ["fish"]
    },
    shrimp: {
      item: "large shrimp", note: "peeled and deveined",
      terms: "large shrimp|shrimp",
      calories: 99, protein: 24, carbs: 0.2, fat: 0.3, allergens: ["shellfish"]
    },
    tofu: {
      item: "extra-firm tofu", note: "pressed and cut as the recipe directs",
      terms: "extra-firm tofu|firm tofu|tofu",
      calories: 144, protein: 17, carbs: 3, fat: 9, allergens: ["soy"]
    },
    beans: {
      item: "chickpeas", note: "drained and rinsed",
      terms: "black beans?|pinto beans?|kidney beans?|cannellini beans?|white beans?|chickpeas?|brown lentils?|red lentils?|lentils?|shelled edamame|edamame|tempeh|natural peanut butter|peanut butter|beans?|legumes?",
      calories: 130, protein: 8.5, carbs: 22, fat: 0.7, allergens: []
    },
    eggs: {
      item: "large eggs", note: "beaten if the recipe directs",
      terms: "large eggs?|eggs?",
      calories: 143, protein: 13, carbs: 0.7, fat: 9.5, allergens: ["eggs"]
    }
  };

  var MEALS = [
    { id: "breakfast", label: "Breakfast" },
    { id: "main", label: "Lunch & dinner" }
  ];

  var GOALS = [
    { id: "bulk", label: "Bulk" },
    { id: "cut", label: "Cut" },
    { id: "maintain", label: "Maintain" }
  ];

  var SUGGEST_CANDIDATES = [
    "rice", "broccoli", "sweet potato", "quinoa", "black beans",
    "spinach", "noodles", "potatoes"
  ];

  var state = {
    goals: new Set(),
    meals: new Set(),
    allergies: new Set(),
    proteins: new Set(),
    terms: [],
    servings: 4,
    maxDifficulty: 3,
    query: "",
    favOnly: false
  };

  /* The allergies saved to this account (see the standing-allergies section).
     Cached rather than re-read: activeFilterCount() runs on every render, and
     hitting localStorage on every keystroke of the search box would be silly. */
  var standingAllergies = [];

  /* ---------- account, ratings, reviews, favorites ----------
     The bytes live in store.js, shared with the profile page. What stays here
     is the board's own session: who is signed in, and their favorites as a Set
     the filter can test cheaply on every keystroke. */

  // Real auth (Supabase, see auth.js) when configured; demo profile otherwise.
  var realAuth = typeof MiseAuth !== "undefined" && MiseAuth.enabled;
  var profile = realAuth ? null : MiseStore.account();
  var favs = new Set();

  function who() { return MiseStore.who(profile); }

  function loadFavs() { favs = new Set(MiseStore.favs(who())); }
  loadFavs();

  function saveFavs() { MiseStore.setFavs(who(), Array.from(favs)); }

  function ratingSummary(id) { return MiseStore.ratingSummary(id); }
  function myRating(id) { return MiseStore.myRating(who(), id); }
  function setMyRating(id, stars) { MiseStore.setMyRating(who(), id, stars); }
  function reviewsFor(id) { return MiseStore.reviewsFor(id); }

  function upsertReview(id, text) {
    MiseStore.upsertReview(who(), profile.name, id, text, myRating(id) || null);
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

  function matchesGoal(r, goal) {
    if (goal === "cut") return r.caloriesPerServing <= 500;
    if (goal === "maintain") return r.caloriesPerServing > 500 && r.caloriesPerServing <= 650;
    return r.caloriesPerServing > 650;
  }

  function matches(r) {
    if (state.favOnly && !favs.has(r.id)) return false;
    if (state.goals.size && !Array.from(state.goals).some(function (goal) {
      return matchesGoal(r, goal);
    })) return false;
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

  /* Counts what you switched on *this session*. Standing allergies are the
     baseline the board starts from, so they don't light up the badge and don't
     make "clear all filters" appear when nothing has been touched — otherwise
     anyone with a saved allergy would see a permanent "2" and a clear button
     that looks broken, because clearing resets to those allergies rather than
     wiping them. */
  function activeFilterCount() {
    var extraAllergies = 0;
    state.allergies.forEach(function (id) {
      if (standingAllergies.indexOf(id) === -1) extraAllergies++;
    });
    return state.goals.size + state.meals.size + extraAllergies + state.proteins.size + state.terms.length +
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

  function macroSummaryHTML(r, className, estimated) {
    var target = calorieTarget();
    var targetNote = target
      ? '<span class="macro-target">' + Math.round(r.caloriesPerServing / target * 100) + "% OF YOUR DAY</span>"
      : "";
    return (
      '<div class="macro-summary ' + className + '" role="group" aria-label="Nutrition per serving">' +
        '<div class="macro-heading mono"><span>' + (estimated ? "EST. PER SERVING" : "PER SERVING") + '</span>' + targetNote + "</div>" +
        '<dl class="macro-grid">' +
          '<div class="macro-item macro-item--calories"><dt>Calories</dt><dd>' + r.caloriesPerServing + '<span class="macro-unit">kcal</span></dd></div>' +
          '<div class="macro-item"><dt>Protein</dt><dd>' + r.proteinGrams + '<span class="macro-unit">g</span></dd></div>' +
          '<div class="macro-item"><dt>Carbs</dt><dd>' + r.carbsGrams + '<span class="macro-unit">g</span></dd></div>' +
          '<div class="macro-item"><dt>Fat</dt><dd>' + r.fatGrams + '<span class="macro-unit">g</span></dd></div>' +
        "</dl>" +
      "</div>"
    );
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
    return (
      '<li class="card">' +
        '<span class="tape mono" aria-hidden="true">' + esc(proteinLabel(r.protein)).toUpperCase() + "</span>" +
        '<div class="card-photo">' +
          '<img src="' + esc(recipeImageSrc(r)) + '" alt="' + esc(r.name) + '" loading="lazy" onerror="this.parentElement.hidden=true">' +
        "</div>" +
        '<h3><button class="card-btn" data-id="' + esc(r.id) + '">' + esc(r.name) + "</button></h3>" +
        '<p class="card-desc">' + esc(r.description) + "</p>" +
        macroSummaryHTML(r, "card-nutrition") +
        '<p class="card-meta">' +
          ratingMeta +
          "<span>" + DIFF_WORDS[r.difficulty].toUpperCase() + "</span><span class=\"sep\">/</span>" +
          "<span>" + total + " MIN</span><span class=\"sep\">/</span>" +
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

  function buildToggleChips(containerId, defs, set, extraClass, exclusive) {
    var host = $(containerId);
    // a stale cached index.html may predate this container; skip rather than crash
    if (!host) return;
    defs.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (extraClass || "");
      b.textContent = d.label;
      b.setAttribute("data-chip", d.id);
      // read from the set rather than assuming off: standing allergies are
      // already in it before these are drawn
      b.setAttribute("aria-pressed", String(set.has(d.id)));
      b.addEventListener("click", function () {
        if (set.has(d.id)) { set.delete(d.id); b.setAttribute("aria-pressed", "false"); }
        else {
          if (exclusive) {
            set.clear();
            host.querySelectorAll(".chip").forEach(function (chip) {
              chip.setAttribute("aria-pressed", "false");
            });
          }
          set.add(d.id);
          b.setAttribute("aria-pressed", "true");
        }
        render();
      });
      host.appendChild(b);
    });
  }

  // Push a set back onto already-drawn chips. Needed because real auth resolves
  // after the rail is built, so someone's standing allergies can arrive late.
  function syncToggleChips(containerId, set) {
    var host = $(containerId);
    if (!host) return;
    host.querySelectorAll("[data-chip]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(set.has(b.getAttribute("data-chip"))));
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

  function proteinIndex(r) {
    var swap = PROTEIN_SWAPS[r.protein];
    if (!swap) return -1;
    var matcher = new RegExp(swap.terms, "i");
    for (var i = 0; i < r.ingredients.length; i++) {
      if (matcher.test(r.ingredients[i].item)) return i;
    }
    return -1;
  }

  function proteinGrams(ing, protein) {
    var qty = Number(ing.qty) || 0;
    var unit = (ing.unit || "").toLowerCase();
    if (unit === "lb") return qty * 453.592;
    if (unit === "oz") return qty * 28.3495;
    if (unit.indexOf("can") === 0) return qty * 255;
    if (unit === "cup") {
      if (protein === "chicken") return qty * 140;
      if (protein === "beans") return qty * 190;
      return qty * 225;
    }
    if (protein === "eggs") return qty * 50;
    // The only unmeasured primary protein currently in the library is one
    // rotisserie chicken; use its typical yield of pulled meat.
    if (protein === "chicken" && /rotisserie/i.test(ing.item)) return qty * 900;
    return qty * 170;
  }

  function swapQuantity(grams, protein) {
    if (protein === "eggs") {
      return { qty: Math.max(1, Math.round(grams / 50)), unit: "" };
    }
    if (protein === "beans") {
      return { qty: Math.max(1, Math.round(grams / 255)), unit: "can (14 oz)" };
    }
    if (grams >= 340) {
      return { qty: Math.max(0.25, Math.round(grams / 453.592 * 4) / 4), unit: "lb" };
    }
    return { qty: Math.max(1, Math.round(grams / 28.3495)), unit: "oz" };
  }

  function swapWords(text, originalProtein, newProtein) {
    var matcher = new RegExp(PROTEIN_SWAPS[originalProtein].terms, "gi");
    var lower = proteinLabel(newProtein).toLowerCase();
    return String(text).replace(matcher, function (match) {
      return match.charAt(0) === match.charAt(0).toUpperCase()
        ? lower.charAt(0).toUpperCase() + lower.slice(1)
        : lower;
    });
  }

  function substitutedRecipe(r, newProtein) {
    var index = proteinIndex(r);
    if (index < 0 || !PROTEIN_SWAPS[newProtein]) return r;

    var original = PROTEIN_SWAPS[r.protein];
    var substitute = PROTEIN_SWAPS[newProtein];
    var grams = proteinGrams(r.ingredients[index], r.protein);
    var quantity = swapQuantity(grams, newProtein);
    var perServingFactor = grams / 100 / r.baseServings;
    var ingredients = r.ingredients.map(function (ing) {
      return {
        qty: ing.qty, unit: ing.unit, item: ing.item, note: ing.note,
        allergens: (ing.allergens || []).slice()
      };
    });

    ingredients[index] = {
      qty: quantity.qty,
      unit: quantity.unit,
      item: substitute.item,
      note: substitute.note,
      allergens: substitute.allergens.slice()
    };

    var allergens = [];
    ingredients.forEach(function (ing) {
      (ing.allergens || []).forEach(function (allergen) {
        if (allergens.indexOf(allergen) === -1) allergens.push(allergen);
      });
    });

    return Object.assign({}, r, {
      name: swapWords(r.name, r.protein, newProtein),
      description: swapWords(r.description, r.protein, newProtein),
      protein: newProtein,
      caloriesPerServing: Math.max(0, Math.round(r.caloriesPerServing + (substitute.calories - original.calories) * perServingFactor)),
      proteinGrams: Math.max(0, Math.round(r.proteinGrams + (substitute.protein - original.protein) * perServingFactor)),
      carbsGrams: Math.max(0, Math.round(r.carbsGrams + (substitute.carbs - original.carbs) * perServingFactor)),
      fatGrams: Math.max(0, Math.round(r.fatGrams + (substitute.fat - original.fat) * perServingFactor)),
      allergens: allergens,
      ingredients: ingredients,
      steps: r.steps.map(function (step) { return swapWords(step, r.protein, newProtein); }),
      storageNote: swapWords(r.storageNote, r.protein, newProtein)
    });
  }

  function proteinOptions(r) {
    return PROTEINS.filter(function (protein) { return protein.id !== r.protein; })
      .map(function (protein) {
        return '<option value="' + protein.id + '">' + esc(protein.label) + "</option>";
      }).join("");
  }

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
    var currentRecipe = r;
    var total = r.prepMinutes + r.cookMinutes;
    var contains = r.allergens.length
      ? "CONTAINS: " + r.allergens.join(" · ").toUpperCase()
      : "NO MAJOR ALLERGENS";

    modalBody.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape" id="m-protein-tape">' + esc(proteinLabel(r.protein)).toUpperCase() + "</span>" +
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
      '<p class="modal-desc" id="m-description">' + esc(r.description) + "</p>" +
      '<div id="m-macros">' + macroSummaryHTML(r, "modal-nutrition") + "</div>" +
      '<p class="modal-stats">' +
        "<span>" + DIFF_WORDS[r.difficulty].toUpperCase() + "</span>" +
        "<span>PREP " + r.prepMinutes + " MIN</span>" +
        "<span>COOK " + r.cookMinutes + " MIN</span>" +
        "<span>TOTAL " + total + " MIN</span>" +
      "</p>" +
      '<p id="m-contains" class="modal-contains' + (r.allergens.length ? "" : " none") + '">' + esc(contains) + "</p>" +
      '<div class="protein-swap">' +
        '<label for="protein-swap">Substitute protein?</label>' +
        '<select id="protein-swap">' +
          '<option value="">Choose a protein</option>' + proteinOptions(r) +
        "</select>" +
        '<span id="protein-swap-confirm" class="protein-swap-confirm" role="status" hidden>Protein substituted!</span>' +
        '<small>Macros are estimated from an equal-weight swap.</small>' +
      "</div>" +
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
          '<p class="swap-method-note" id="m-swap-note" hidden></p>' +
          '<ol class="step-list" id="m-step-list">' +
            r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
          "</ol>" +
          '<div class="modal-storage">' +
            '<span class="mono">STORAGE</span><span id="m-storage-text">' + esc(r.storageNote) + "</span>" +
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
        $("#m-ing-list").innerHTML = ingredientRows(currentRecipe, mServings);
      }
    );

    $("#protein-swap").addEventListener("change", function () {
      var selected = this.value;
      currentRecipe = selected ? substitutedRecipe(r, selected) : r;
      var currentContains = currentRecipe.allergens.length
        ? "CONTAINS: " + currentRecipe.allergens.join(" · ").toUpperCase()
        : "NO MAJOR ALLERGENS";

      $("#m-protein-tape").textContent = proteinLabel(currentRecipe.protein).toUpperCase();
      $("#modal-title").textContent = currentRecipe.name;
      $("#m-description").textContent = currentRecipe.description;
      $("#m-macros").innerHTML = macroSummaryHTML(currentRecipe, "modal-nutrition", !!selected);
      $("#m-contains").textContent = currentContains;
      $("#m-contains").className = "modal-contains" + (currentRecipe.allergens.length ? "" : " none");
      $("#m-ing-list").innerHTML = ingredientRows(currentRecipe, mServings);
      $("#m-step-list").innerHTML = currentRecipe.steps.map(function (step) {
        return "<li>" + esc(step) + "</li>";
      }).join("");
      $("#m-storage-text").textContent = currentRecipe.storageNote;
      $("#protein-swap-confirm").hidden = !selected;
      $("#m-swap-note").hidden = !selected;
      $("#m-swap-note").textContent = selected
        ? "Cooking time may change with " + proteinLabel(selected).toLowerCase() + "; follow its package guidance and check that it is cooked through."
        : "";
    });

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
        MiseNative.sharePDF(recipeToPDFModel(currentRecipe, mServings), r.id + ".pdf", currentRecipe.name);
      } else {
        window.print();
      }
    });
    $("#modal-download").addEventListener("click", function () {
      if (requirePlus()) return;
      MisePDF.download(recipeToPDFModel(currentRecipe, mServings), r.id + ".pdf");
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

  /* Signed out, the masthead opens the sign-in dialog; signed in, it's the way
     through to profile.html. The account, the goals and sign-out all live on
     that page now, so this dialog only ever has to do the one job. */
  function updateAuthUI(view) {
    // view: "main" (sign in / sign up), "reset" (request a link) or "newpass"
    // (set a new password after clicking the link). Only meaningful for realAuth.
    view = view || "main";
    authBtn.textContent = profile ? "HI, " + profile.name.toUpperCase() + " →" : "SIGN IN";
    $("#auth-real").hidden = !!profile || !realAuth || view !== "main";
    $("#auth-signedout").hidden = !!profile || realAuth;
    var reset = $("#auth-reset"), newpass = $("#auth-newpass");
    if (reset) reset.hidden = view !== "reset";
    if (newpass) newpass.hidden = view !== "newpass";
    var logLink = $("#log-link");
    if (logLink) logLink.hidden = !profile;   // no account, nothing to log against
  }

  function openAuth() {
    // Always open on the main sign-in view with no stale messages, even if the
    // dialog was last closed on the reset or new-password step.
    ["#auth-error", "#reset-msg", "#newpass-msg"].forEach(function (id) {
      var el = $(id);
      if (el) { el.hidden = true; el.textContent = ""; }
    });
    updateAuthUI();
    authModal.showModal();
    if (!profile) $(realAuth ? "#real-email" : "#auth-name").focus();
  }

  /* A small self-dismissing notice, top-centre. Built in JS so no HTML file has
     to carry the markup. Success fades after a few seconds; the actionable
     error variant lingers a little longer and stays put while hovered. */
  function showToast(title, body, kind) {
    var t = document.createElement("div");
    t.className = "toast toast--" + (kind || "ok");
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");

    var h = document.createElement("p");
    h.className = "toast-title";
    h.textContent = title;
    t.appendChild(h);

    if (body) {
      var p = document.createElement("p");
      p.className = "toast-body";
      p.textContent = body;
      t.appendChild(p);
    }

    var close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = "&times;";
    t.appendChild(close);

    document.body.appendChild(t);

    var timer;
    var dismiss = function () {
      clearTimeout(timer);
      t.classList.remove("show");
      setTimeout(function () { if (t.parentNode) t.remove(); }, 320);
    };
    var arm = function (ms) { clearTimeout(timer); timer = setTimeout(dismiss, ms); };

    close.addEventListener("click", dismiss);
    t.addEventListener("mouseenter", function () { clearTimeout(timer); });
    t.addEventListener("mouseleave", function () { arm(1800); });

    // next frame so the entrance transition runs
    requestAnimationFrame(function () { t.classList.add("show"); });
    arm(kind === "error" ? 7000 : 4200);
    return t;
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

  authBtn.addEventListener("click", function () {
    if (profile) { window.location.href = "profile.html"; return; }
    openAuth();
  });
  $("#auth-close").addEventListener("click", function () { authModal.close(); });

  authModal.addEventListener("click", function (e) {
    if (e.target === authModal) authModal.close();
  });

  $("#auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("#auth-name").value.trim();
    if (!name) return;
    profile = { name: name };
    MiseStore.setAccount(profile);
    loadFavs();
    applyStandingAllergies();
    updateAuthUI();
    render();
    authModal.close();
  });

  /* ---------- real auth (Supabase) wiring ---------- */

  if (realAuth) {
    var authMode = "signin";

    var msgFor = function (id) {
      return function (text, ok) {
        var el = $(id);
        el.hidden = !text;
        el.textContent = text || "";
        el.classList.toggle("ok", !!ok);
      };
    };
    var authMsg = msgFor("#auth-error");
    var resetMsg = msgFor("#reset-msg");
    var newpassMsg = msgFor("#newpass-msg");

    /* ---------- email-confirmation landing ----------
       A confirmation (or expired-link) email drops the browser back here with
       params in the URL. Read them BEFORE Supabase's async init clears them,
       but don't strip the URL yet — detectSessionInUrl still needs the `code`
       to establish the session. */
    var landing = (function () {
      var q = new URLSearchParams(window.location.search);
      var h = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      var pick = function (k) { return q.get(k) || h.get(k); };
      return {
        confirmed: q.get("mise_confirmed") === "1",
        error: pick("error") || pick("error_code"),
        errorDesc: pick("error_description")
      };
    })();
    var confirmPending = landing.confirmed && !landing.error;

    function cleanUrl() {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, document.title, window.location.pathname);
      }
    }

    // Expired / already-used link: no session comes, so handle it now. (Also
    // catches an expired reset link, which lands the same way — the wording is
    // deliberately generic.)
    if (landing.error) {
      cleanUrl();
      showToast("That link didn't work",
        "It may have expired or already been used. Sign in again to get a fresh one.",
        "error");
    }

    MiseAuth.onChange(function (user) {
      profile = user ? { id: user.id, name: user.name, email: user.email } : null;
      if (!profile) {
        state.favOnly = false;
        favChip.setAttribute("aria-pressed", "false");
      }
      loadFavs();
      applyStandingAllergies();  // per-account, so they arrive with the session
      updateAuthUI();
      render();
      if (profile && authModal.open) authModal.close();
      // The code exchange that signs them in is the confirmation completing.
      if (confirmPending && profile) {
        confirmPending = false;
        cleanUrl();
        showToast("Email confirmed!", "You're signed in as " + profile.name + ".");
      }
    });

    $("#auth-mode-toggle").addEventListener("click", function () {
      authMode = authMode === "signin" ? "signup" : "signin";
      $("#real-submit").textContent = authMode === "signin" ? "Sign in" : "Create account";
      $("#real-password").setAttribute("autocomplete",
        authMode === "signin" ? "current-password" : "new-password");
      this.innerHTML = authMode === "signin"
        ? "NEW HERE? CREATE AN ACCOUNT &rarr;"
        : "ALREADY HAVE AN ACCOUNT? SIGN IN &rarr;";
      // "Forgot password" only makes sense when signing in to an existing account.
      $("#auth-forgot").hidden = authMode !== "signin";
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

    /* ---------- forgot / reset password ---------- */

    $("#auth-forgot").addEventListener("click", function () {
      resetMsg("");
      $("#reset-email").value = $("#real-email").value.trim();  // carry it over
      updateAuthUI("reset");
      $("#reset-email").focus();
    });

    $("#reset-back").addEventListener("click", function () {
      resetMsg("");
      updateAuthUI("main");
      $("#real-email").focus();
    });

    $("#reset-form").addEventListener("submit", function (e) {
      e.preventDefault();
      resetMsg("");
      if (!MiseAuth.isReady()) {
        resetMsg("Still connecting to the sign-in service — try again in a second.");
        return;
      }
      var email = $("#reset-email").value.trim();
      var submit = $("#reset-submit");
      submit.disabled = true;
      MiseAuth.resetPassword(email).then(function (res) {
        submit.disabled = false;
        if (res.error) { resetMsg(res.error.message); return; }
        // Worded not to confirm whether the address has an account (Supabase
        // doesn't either), so the form can't be used to probe for members.
        resetMsg("If that email has an account, a reset link is on its way. Check your inbox.", true);
      }).catch(function () {
        submit.disabled = false;
        resetMsg("Could not reach the sign-in service. Check your connection and try again.");
      });
    });

    // Landed here from a "reset your password" email link: show the form that
    // sets the new one. The temporary recovery session is live but MiseAuth
    // holds back the normal sign-in until the password is actually saved.
    MiseAuth.onRecovery(function () {
      newpassMsg("");
      $("#newpass-input").value = "";
      // Drop the recovery token from the address bar so a refresh doesn't re-run it.
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      updateAuthUI("newpass");
      if (!authModal.open) authModal.showModal();
      $("#newpass-input").focus();
    });

    $("#newpass-form").addEventListener("submit", function (e) {
      e.preventDefault();
      newpassMsg("");
      if (!MiseAuth.isReady()) {
        newpassMsg("Still connecting to the sign-in service — try again in a second.");
        return;
      }
      var password = $("#newpass-input").value;
      var submit = $("#newpass-submit");
      submit.disabled = true;
      MiseAuth.updatePassword(password).then(function (res) {
        submit.disabled = false;
        if (res.error) { newpassMsg(res.error.message); return; }
        // Success fires USER_UPDATED -> onChange signs the user in and closes.
        newpassMsg("Password updated — you're signed in.", true);
      }).catch(function () {
        submit.disabled = false;
        newpassMsg("Could not save the new password. Try the reset link again.");
      });
    });
  }

  favChip.addEventListener("click", function () {
    if (!profile) { openAuth(); return; }
    state.favOnly = !state.favOnly;
    favChip.setAttribute("aria-pressed", String(state.favOnly));
    render();
  });

  /* ---------- standing allergies ---------- */

  /* The board's allergy chips are a session: untick one and it is back on the
     next load. The ones saved to an account are a different thing — they apply
     on every visit, which is the right default for the one filter where being
     wrong means someone eats what they react to. So they land in state before
     the first render, and the rail says where they came from.

     Ticking a chip on the board deliberately does NOT rewrite the account: a
     temporary "what does the board look like without the dairy filter" must not
     quietly un-set an allergy someone lives with. profile.html is the only
     place that writes them. */
  function applyStandingAllergies() {
    standingAllergies = MiseStore.allergies(who());
    // Mutate in place. The chip handlers closed over this exact Set, so
    // reassigning state.allergies would leave them pointing at the old one.
    state.allergies.clear();
    standingAllergies.forEach(function (id) { state.allergies.add(id); });
    syncToggleChips("#allergy-chips", state.allergies);
    var note = $("#allergy-standing");
    if (note) note.hidden = standingAllergies.length === 0;
  }

  /* Thin wrapper so the card and masthead call sites read as they did before.
     The Plus gate itself lives in store.js — once, for both pages. */
  function calorieTarget() { return MiseStore.calorieTarget(who()); }

  /* ---------- Mise Plus ---------- */

  /* The dialog and the gate both live in plus-ui.js, shared with the profile
     page. All this page has to say is what to redraw once someone buys. */
  function requirePlus() { return MisePlusUI.require(); }

  MisePlusUI.onChange(function () { render(); updatePlanUI(); });

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
    // Structured line items for the Instacart cart API — same data, but numbers
    // instead of the pretty-printed "2 cups + 1 tbsp" string. One line per item;
    // an item measured in two units rides along as line_item_measurements.
    var lineItems = Object.keys(byItem).sort().map(function (item) {
      var ms = byItem[item].map(function (m) {
        var q = Math.round(m.qty * 100) / 100;
        return { quantity: q > 0 ? q : 1, unit: m.unit || "each" };
      });
      var li = { name: item };
      if (ms.length === 1) { li.quantity = ms[0].quantity; li.unit = ms[0].unit; }
      else { li.line_item_measurements = ms; }
      return li;
    });
    return { items: items, pantry: Object.keys(pantry).sort(), lineItems: lineItems };
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

  // Which store the shopping-list items currently link to (null = plain text).
  // Instacart isn't a link-mode store — it's a one-shot cart build — so it's
  // never held here; only the per-item deep-link stores (walmart/amazon) are.
  var shopStore = null;

  function shopItemHTML(it) {
    var amt = '<span class="amt">' + esc(it.amount) + "</span>";
    if (shopStore && window.MiseGrocery) {
      var url = MiseGrocery.itemUrl(shopStore, it.item);
      if (url) {
        // The <a> is display:contents so amt + name still land in the <li>'s
        // 3-column grid; the arrow rides inside the name span, not a 4th column.
        return '<li><span class="sq" aria-hidden="true"></span>' +
          '<a class="shop-link" href="' + esc(url) + '" target="_blank" rel="noopener nofollow">' +
            amt + '<span class="shop-name">' + esc(it.item) +
              '<span class="shop-go" aria-hidden="true">&#8599;</span></span>' +
          "</a></li>";
      }
    }
    return '<li><span class="sq" aria-hidden="true"></span>' + amt + "<span>" + esc(it.item) + "</span></li>";
  }

  function storeSectionHTML() {
    if (!window.MiseGrocery) return "";
    var storeLabel = shopStore === "walmart" ? "Walmart" : shopStore === "amazon" ? "Amazon Fresh" : "";
    return '<div class="shop-send">' +
      '<p class="modal-section-title">Send this list to a store</p>' +
      '<div class="store-btns">' +
        '<button class="store-btn is-instacart" id="send-instacart" type="button">Build my Instacart cart</button>' +
        '<button class="store-btn' + (shopStore === "walmart" ? " on" : "") +
          '" data-store="walmart" type="button" aria-pressed="' + (shopStore === "walmart") + '">Walmart</button>' +
        '<button class="store-btn' + (shopStore === "amazon" ? " on" : "") +
          '" data-store="amazon" type="button" aria-pressed="' + (shopStore === "amazon") + '">Amazon Fresh</button>' +
      "</div>" +
      '<p class="store-status" id="store-status" role="status">' +
        (storeLabel ? "Tap any item above to find it at " + storeLabel + "." : "") + "</p>" +
      '<p class="store-note">Mise may earn a small commission from these links &mdash; it never changes your price. ' +
        'As an Amazon Associate, I earn from qualifying purchases. ' +
        '<a href="legal.html" target="_blank" rel="noopener">Details</a>.</p>' +
    "</div>";
  }

  function setStoreStatus(msg) {
    var el = $("#store-status");
    if (el) el.textContent = msg;
  }

  function copyShoppingList(list) {
    var lines = list.items.map(function (it) { return it.amount + "  " + it.item; });
    if (list.pantry.length) lines.push("from the pantry, to taste: " + list.pantry.join(", "));
    var text = "MISE — SHOPPING LIST\n" + lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {});
    }
    return Promise.resolve();
  }

  function sendToInstacart(btn) {
    var list = buildShoppingList(planEntries());
    if (!list.lineItems.length) return;
    if (window.MiseGrocery && MiseGrocery.instacartLive()) {
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Building your cart…";
      setStoreStatus("Sending your list to Instacart…");
      MiseGrocery.buildInstacartCart("Mise — your week’s groceries", list.lineItems)
        .then(function (url) {
          window.open(url, "_blank", "noopener");
          setStoreStatus("Your Instacart cart is ready — opened in a new tab.");
        })
        .catch(function () {
          copyShoppingList(list);
          window.open("https://www.instacart.com/store", "_blank", "noopener");
          setStoreStatus("Couldn’t reach Instacart just now — list copied so you can paste it in.");
        })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    } else {
      // Demo mode: proxy not configured yet. Copy the list, open Instacart, say so.
      copyShoppingList(list);
      window.open("https://www.instacart.com/store", "_blank", "noopener");
      setStoreStatus("List copied — paste it into Instacart. One-tap carts turn on once the Instacart key is set up.");
    }
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
        list.items.map(shopItemHTML).join("") +
      "</ul>" +
      (list.pantry.length ? '<p class="shop-pantry">From the pantry, to taste: ' + esc(list.pantry.join(", ")) + ".</p>" : "") +
      storeSectionHTML() +
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
    var instaBtn = e.target.closest("#send-instacart");
    if (instaBtn) { sendToInstacart(instaBtn); return; }
    var storeBtn = e.target.closest(".store-btn[data-store]");
    if (storeBtn) {
      var store = storeBtn.getAttribute("data-store");
      shopStore = shopStore === store ? null : store;  // toggle link mode off/on
      renderPlanBody();
      return;
    }
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
    if (MisePlusUI.isOpen()) { MisePlusUI.close(); return; }
    if (authModal.open) { authModal.close(); return; }
    if (modalEl.open) { modalEl.close(); return; }
    if (planModal.open) { planModal.close(); return; }
    if (railEl.classList.contains("open") && window.innerWidth < 1024) setRail(false);
  });

  /* ---------- wire up ---------- */

  buildToggleChips("#goal-chips", GOALS, state.goals, "", true);
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
    state.goals.clear();
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
    // Back to the baseline, not to nothing: an account's standing allergies
    // survive "clear all filters". Clearing the board should never be the thing
    // that serves someone the food they can't eat.
    applyStandingAllergies();
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

  /* A link from the profile page carries the recipe in the hash
     (index.html#chicken-tikka), so favorites and reviews over there can open
     the real ticket here. Inbound only — no pushState on every modal open,
     which would put a history entry between the board and the back button that
     native.js relies on. */
  function openFromHash() {
    var id = (window.location.hash || "").replace(/^#/, "");
    if (!id) return;
    var r = RECIPES.find(function (x) { return x.id === id; });
    if (r) openModal(r);
  }

  applyStandingAllergies();
  render();
  updatePlanUI();
  updateAuthUI();
  renderAppLinks();
  openFromHash();
})();
