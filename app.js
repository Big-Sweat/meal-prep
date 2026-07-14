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

  var SUGGEST_CANDIDATES = [
    "rice", "broccoli", "sweet potato", "quinoa", "black beans",
    "spinach", "noodles", "potatoes"
  ];

  var state = {
    allergies: new Set(),
    proteins: new Set(),
    terms: [],
    servings: 4
  };

  var $ = function (sel) { return document.querySelector(sel); };

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
    if (state.allergies.size) {
      for (var i = 0; i < r.allergens.length; i++) {
        if (state.allergies.has(r.allergens[i])) return false;
      }
    }
    if (state.proteins.size && !state.proteins.has(r.protein)) return false;
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
    return state.allergies.size + state.proteins.size + state.terms.length;
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

  function cardHTML(r) {
    var total = r.prepMinutes + r.cookMinutes;
    var contains = r.allergens.length
      ? "contains " + r.allergens.join(" · ")
      : "no major allergens";
    return (
      '<li class="card">' +
        '<span class="tape mono" aria-hidden="true">' + esc(proteinLabel(r.protein)).toUpperCase() + "</span>" +
        '<h3><button class="card-btn" data-id="' + esc(r.id) + '">' + esc(r.name) + "</button></h3>" +
        '<p class="card-desc">' + esc(r.description) + "</p>" +
        '<p class="card-meta">' +
          "<span>" + total + " MIN</span><span class=\"sep\">/</span>" +
          "<span>" + r.caloriesPerServing + " CAL/SERV</span><span class=\"sep\">/</span>" +
          "<span>KEEPS " + r.fridgeDays + " DAYS</span>" +
          (r.freezerFriendly ? '<span class="sep">/</span><span>FREEZES</span>' : "") +
        "</p>" +
        '<p class="card-allergens' + (r.allergens.length ? "" : " none") + '">' + esc(contains) + "</p>" +
      "</li>"
    );
  }

  function render() {
    var visible = RECIPES.filter(matches);
    cardsEl.innerHTML = visible.map(cardHTML).join("");
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

  function openModal(r) {
    var servings = state.servings;
    var total = r.prepMinutes + r.cookMinutes;
    var contains = r.allergens.length
      ? "CONTAINS: " + r.allergens.join(" · ").toUpperCase()
      : "NO MAJOR ALLERGENS";

    modalBody.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape">' + esc(proteinLabel(r.protein)).toUpperCase() + "</span>" +
        '<div class="modal-actions">' +
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
      '<h2 id="modal-title">' + esc(r.name) + "</h2>" +
      '<p class="modal-desc">' + esc(r.description) + "</p>" +
      '<p class="modal-stats">' +
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

    $("#modal-close").addEventListener("click", function () { modalEl.close(); });
    $("#modal-print").addEventListener("click", function () { window.print(); });
    $("#modal-download").addEventListener("click", function () {
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
    if (modalEl.open) { modalEl.close(); return; }
    if (railEl.classList.contains("open") && window.innerWidth < 1024) setRail(false);
  });

  /* ---------- wire up ---------- */

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

  clearBtn.addEventListener("click", function () {
    state.allergies.clear();
    state.proteins.clear();
    state.terms = [];
    document.querySelectorAll('.chip[aria-pressed="true"]').forEach(function (c) {
      c.setAttribute("aria-pressed", "false");
    });
    renderTermChips();
    render();
  });

  render();
})();
