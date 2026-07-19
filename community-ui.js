/* Myse — community recipe submission + report dialog (MiseCommunityUI).
 *
 * A shared, self-building <dialog> — same pattern as plus-ui.js — so the board
 * and the profile page share one form and no HTML file carries the markup. It
 * builds the dialog on first open and reuses it for both the submit/edit form
 * and the report form (two render modes, one element).
 *
 * Posting requires an account; the store's write path is pinned to the signed-in
 * user by RLS. On a successful publish it dispatches a `mise:recipe-published`
 * DOM event so whichever page is open can confirm it — store.js has already
 * refreshed the world-readable list, which redraws the board via onCommunity
 * (the new recipe mixed in with the house ones and flagged).
 *
 * The photo is downscaled and re-encoded to WebP in the browser before upload:
 * caps the longest side at 1280px (cards render ~400px, the modal ~810px), which
 * also strips EXIF — so a phone photo's GPS location never reaches the server.
 *
 * Inert on the web with no Supabase configured (MiseStore.publishRecipe no-ops
 * without a signed-in backend); the entry points that open it are gated on a
 * signed-in account by the caller.
 */
var MiseCommunityUI = (function () {
  "use strict";

  // Kept in step with the recipe schema. Proteins/meals mirror app.js's chips;
  // allergens come from the shared store vocabulary so the two can't drift.
  var PROTEINS = [
    { id: "chicken", label: "Chicken" }, { id: "beef", label: "Beef" },
    { id: "pork", label: "Pork" }, { id: "turkey", label: "Turkey" },
    { id: "fish", label: "Fish" }, { id: "shrimp", label: "Shrimp" },
    { id: "tofu", label: "Tofu" }, { id: "beans", label: "Beans & legumes" },
    { id: "eggs", label: "Eggs" }
  ];
  var MEALS = [
    { id: "main", label: "Lunch & dinner" },
    { id: "breakfast", label: "Breakfast" }
  ];
  var REPORT_REASONS = [
    { id: "spam", label: "Spam or advertising" },
    { id: "inappropriate", label: "Inappropriate or offensive" },
    { id: "unsafe", label: "Unsafe, or wrong allergen info" },
    { id: "copyright", label: "Copied from somewhere else" },
    { id: "other", label: "Something else" }
  ];

  var MAX_PHOTO_BYTES = 15 * 1024 * 1024;   // reject huge inputs before decoding
  var PHOTO_MAX_DIM = 1280;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function allergens() {
    return (typeof MiseStore !== "undefined" && MiseStore.ALLERGENS) || [];
  }
  function currentUser() {
    return (typeof MiseAuth !== "undefined" && MiseAuth.user && MiseAuth.user()) || null;
  }
  function who() { var u = currentUser(); return u ? u.id : null; }

  // ---------- the dialog shell (built once) ----------

  var modal = null, body = null, editing = null;
  var $ = function (sel) { return body.querySelector(sel); };

  function ensure() {
    if (modal) return;
    modal = document.createElement("dialog");
    modal.className = "modal community-modal";
    modal.setAttribute("aria-label", "Share a recipe");
    body = document.createElement("div");
    body.className = "modal-body";
    modal.appendChild(body);
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.close(); });
    body.addEventListener("click", onBodyClick);
    body.addEventListener("submit", onBodySubmit);
  }

  function onBodyClick(e) {
    var t = e.target;
    if (t.closest("#cf-add-ing"))  { e.preventDefault(); addIngredientRow(); return; }
    if (t.closest("#cf-add-step")) { e.preventDefault(); addStepRow(); return; }
    var ir = t.closest(".ci-remove"); if (ir) { e.preventDefault(); var a = ir.closest(".ci-row"); if (a) a.remove(); return; }
    var sr = t.closest(".cs-remove"); if (sr) { e.preventDefault(); var b = sr.closest(".cs-row"); if (b) b.remove(); return; }
    if (t.closest("#cf-close") || t.closest("#cf-cancel") || t.closest("#cr-close")) { e.preventDefault(); modal.close(); }
  }
  function onBodySubmit(e) {
    e.preventDefault();
    if (e.target.id === "cf-form") submitForm();
    else if (e.target.id === "cr-form") submitReport();
  }

  // ---------- photo: downscale + re-encode to WebP in the browser ----------

  function downscale(file, cb) {
    if (!file || !/^image\//.test(file.type)) { cb(null); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) { URL.revokeObjectURL(url); cb(null); return; }
      var scale = Math.min(1, PHOTO_MAX_DIM / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      try {
        canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) { cb(blob || null); }, "image/webp", 0.8);
      } catch (e) { URL.revokeObjectURL(url); cb(null); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  // ---------- helpers ----------

  // Same score the recipe tool (tools/add-recipes.js) and the site's difficulty
  // slider use, so a community recipe reads at the same effort level as a house
  // one — including the hands-off discount, or a one-pot/slow-cooker recipe would
  // score a level harder than its house equivalent near a bucket boundary.
  var HANDS_OFF = ["one-pan", "one-pot", "sheet-pan", "slow-cooker"];
  function computeDifficulty(ingLen, stepLen, prepMinutes, tags) {
    var raw = ingLen + 1.5 * stepLen + 0.4 * prepMinutes;
    if ((tags || []).some(function (t) { return HANDS_OFF.indexOf(t) !== -1; })) raw -= 3;
    return raw <= 26 ? 1 : raw <= 31 ? 2 : 3;
  }
  function genId() {
    return "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function numVal(sel, dflt) {
    var el = $(sel); if (!el) return dflt;
    var n = parseFloat(el.value);
    return isFinite(n) ? n : dflt;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function formError(msg) {
    var el = $("#cf-msg"); if (!el) return;
    el.hidden = !msg; el.textContent = msg || "";
    if (msg) el.scrollIntoView({ block: "nearest" });
  }

  function ingredientRowHTML(ing) {
    ing = ing || {};
    return '<div class="ci-row">' +
      '<input class="ci-qty" type="text" inputmode="decimal" placeholder="Qty" aria-label="Quantity" value="' + esc(ing.qty == null ? "" : ing.qty) + '">' +
      '<input class="ci-unit" type="text" placeholder="Unit" aria-label="Unit" value="' + esc(ing.unit || "") + '">' +
      '<input class="ci-item" type="text" placeholder="Ingredient" aria-label="Ingredient" value="' + esc(ing.item || "") + '">' +
      '<input class="ci-note" type="text" placeholder="Note (optional)" aria-label="Note" value="' + esc(ing.note || "") + '">' +
      '<button type="button" class="ci-remove" aria-label="Remove ingredient">&times;</button>' +
    "</div>";
  }
  function stepRowHTML(text) {
    return '<div class="cs-row">' +
      '<textarea class="cs-text" rows="2" placeholder="Describe this step" aria-label="Step">' + esc(text || "") + "</textarea>" +
      '<button type="button" class="cs-remove" aria-label="Remove step">&times;</button>' +
    "</div>";
  }
  function addIngredientRow() { var h = $("#cf-ings"); if (h) h.insertAdjacentHTML("beforeend", ingredientRowHTML({})); }
  function addStepRow() { var h = $("#cf-steps"); if (h) h.insertAdjacentHTML("beforeend", stepRowHTML("")); }

  // ---------- the submit / edit form ----------

  function renderForm(existing) {
    editing = existing || null;
    var r = existing || {};
    var u = currentUser();
    var poster = (u && u.name) || "you";

    var opt = function (list, sel) {
      return list.map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (o.id === sel ? " selected" : "") + ">" + esc(o.label) + "</option>";
      }).join("");
    };

    var allergenBoxes = allergens().map(function (a) {
      var on = (r.allergens || []).indexOf(a.id) !== -1;
      return '<label class="cf-check"><input type="checkbox" class="cf-allergen" value="' + esc(a.id) + '"' + (on ? " checked" : "") + "> " + esc(a.label) + "</label>";
    }).join("");

    var ings = (r.ingredients && r.ingredients.length ? r.ingredients : [{}]).map(ingredientRowHTML).join("");
    var steps = (r.steps && r.steps.length ? r.steps : [""]).map(stepRowHTML).join("");

    body.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape">' + (editing ? "EDIT YOUR RECIPE" : "SHARE A RECIPE") + "</span>" +
        '<button class="modal-close" id="cf-close" type="button" aria-label="Close">&times;</button>' +
      "</div>" +
      '<h2 class="auth-h2">' + (editing ? "Edit your recipe" : "Share your recipe") + "</h2>" +
      '<p class="modal-desc">Posting as <strong>' + esc(poster) + "</strong>. Community recipes are " +
        "public, and their nutrition and allergen info is self-declared &mdash; so tag allergens honestly.</p>" +

      '<form id="cf-form" class="cf-form" novalidate>' +

        '<div class="cf-field">' +
          '<label for="cf-name">Recipe name</label>' +
          '<input id="cf-name" type="text" maxlength="120" required value="' + esc(r.name || "") + '">' +
        "</div>" +
        '<div class="cf-field">' +
          '<label for="cf-desc">Short description</label>' +
          '<textarea id="cf-desc" maxlength="500" rows="2" placeholder="A sentence or two on why it preps well.">' + esc(r.description || "") + "</textarea>" +
        "</div>" +

        '<div class="cf-field">' +
          '<label for="cf-photo">Photo <span class="cf-opt">(optional)</span></label>' +
          '<input id="cf-photo" type="file" accept="image/*">' +
          '<div id="cf-photo-preview" class="cf-photo-preview"' + (r.photoUrl ? "" : " hidden") + ">" +
            (r.photoUrl ? '<img src="' + esc(r.photoUrl) + '" alt="Current photo">' : "") +
          "</div>" +
        "</div>" +

        '<div class="cf-grid">' +
          '<div class="cf-field"><label for="cf-protein">Main protein</label><select id="cf-protein">' + opt(PROTEINS, r.protein) + "</select></div>" +
          '<div class="cf-field"><label for="cf-meal">Meal</label><select id="cf-meal">' + opt(MEALS, r.meal) + "</select></div>" +
          '<div class="cf-field"><label for="cf-cuisine">Cuisine</label><input id="cf-cuisine" type="text" maxlength="60" value="' + esc(r.cuisine || "") + '"></div>' +
          '<div class="cf-field"><label for="cf-tags">Tags <span class="cf-opt">(comma-separated)</span></label><input id="cf-tags" type="text" value="' + esc((r.tags || []).join(", ")) + '"></div>' +
        "</div>" +

        '<div class="cf-grid cf-grid--nums">' +
          '<div class="cf-field"><label for="cf-servings">Servings</label><input id="cf-servings" type="number" min="1" max="24" value="' + esc(r.baseServings || 4) + '"></div>' +
          '<div class="cf-field"><label for="cf-prep">Prep min</label><input id="cf-prep" type="number" min="0" value="' + esc(r.prepMinutes == null ? "" : r.prepMinutes) + '"></div>' +
          '<div class="cf-field"><label for="cf-cook">Cook min</label><input id="cf-cook" type="number" min="0" value="' + esc(r.cookMinutes == null ? "" : r.cookMinutes) + '"></div>' +
          '<div class="cf-field"><label for="cf-fridge">Keeps (days)</label><input id="cf-fridge" type="number" min="0" value="' + esc(r.fridgeDays == null ? 3 : r.fridgeDays) + '"></div>' +
        "</div>" +

        '<p class="cf-legend mono">PER SERVING</p>' +
        '<div class="cf-grid cf-grid--nums">' +
          '<div class="cf-field"><label for="cf-cal">Calories</label><input id="cf-cal" type="number" min="0" value="' + esc(r.caloriesPerServing == null ? "" : r.caloriesPerServing) + '"></div>' +
          '<div class="cf-field"><label for="cf-p">Protein g</label><input id="cf-p" type="number" min="0" value="' + esc(r.proteinGrams == null ? "" : r.proteinGrams) + '"></div>' +
          '<div class="cf-field"><label for="cf-c">Carbs g</label><input id="cf-c" type="number" min="0" value="' + esc(r.carbsGrams == null ? "" : r.carbsGrams) + '"></div>' +
          '<div class="cf-field"><label for="cf-f">Fat g</label><input id="cf-f" type="number" min="0" value="' + esc(r.fatGrams == null ? "" : r.fatGrams) + '"></div>' +
        "</div>" +

        '<label class="cf-check cf-freezer"><input id="cf-freezer" type="checkbox"' + (r.freezerFriendly ? " checked" : "") + "> Freezer-friendly</label>" +

        '<div class="cf-field">' +
          '<span class="cf-group-label">Allergens it contains</span>' +
          '<div class="cf-checks">' + allergenBoxes + "</div>" +
        "</div>" +

        '<div class="cf-field">' +
          '<span class="cf-group-label">Ingredients</span>' +
          '<div id="cf-ings" class="cf-rows">' + ings + "</div>" +
          '<button type="button" id="cf-add-ing" class="cf-add mono">+ Add ingredient</button>' +
        "</div>" +

        '<div class="cf-field">' +
          '<span class="cf-group-label">Method</span>' +
          '<div id="cf-steps" class="cf-rows">' + steps + "</div>" +
          '<button type="button" id="cf-add-step" class="cf-add mono">+ Add step</button>' +
        "</div>" +

        '<div class="cf-field">' +
          '<label for="cf-storage">Storage note</label>' +
          '<textarea id="cf-storage" maxlength="500" rows="2" placeholder="How to store it, and for how long.">' + esc(r.storageNote || "") + "</textarea>" +
        "</div>" +

        '<p id="cf-msg" class="auth-error" hidden></p>' +
        '<div class="cf-actions">' +
          '<button type="button" id="cf-cancel" class="cf-cancel mono">Cancel</button>' +
          '<button type="submit" id="cf-submit" class="review-post">' + (editing ? "Save changes" : "Publish recipe") + "</button>" +
        "</div>" +
      "</form>";

    var photo = $("#cf-photo");
    if (photo) photo.addEventListener("change", function () {
      var f = photo.files && photo.files[0];
      var box = $("#cf-photo-preview");
      if (!box) return;
      if (!f) { box.hidden = true; box.innerHTML = ""; return; }
      var url = URL.createObjectURL(f);
      box.hidden = false;
      box.innerHTML = '<img alt="Selected photo">';
      box.firstChild.src = url;
    });
  }

  function collect() {
    var name = ($("#cf-name").value || "").trim();
    if (!name) { formError("Give your recipe a name."); return null; }

    var ingredients = [];
    body.querySelectorAll(".ci-row").forEach(function (row) {
      var item = (row.querySelector(".ci-item").value || "").trim();
      if (!item) return;
      var qtyRaw = (row.querySelector(".ci-qty").value || "").trim();
      var qty = qtyRaw === "" ? null : parseFloat(qtyRaw);
      if (qty != null && !isFinite(qty)) qty = null;
      ingredients.push({
        qty: qty,
        unit: (row.querySelector(".ci-unit").value || "").trim(),
        item: item,
        note: (row.querySelector(".ci-note").value || "").trim(),
        allergens: []
      });
    });
    if (!ingredients.length) { formError("Add at least one ingredient."); return null; }

    var steps = [];
    body.querySelectorAll(".cs-text").forEach(function (t) {
      var s = (t.value || "").trim(); if (s) steps.push(s);
    });
    if (!steps.length) { formError("Add at least one method step."); return null; }

    var checked = [];
    body.querySelectorAll(".cf-allergen:checked").forEach(function (c) { checked.push(c.value); });

    var tags = ($("#cf-tags").value || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    var prep = clamp(numVal("#cf-prep", 0), 0, 100000);

    var recipe = {
      id: editing ? editing.id : genId(),
      name: name,
      description: ($("#cf-desc").value || "").trim(),
      protein: $("#cf-protein").value || "chicken",
      cuisine: ($("#cf-cuisine").value || "").trim(),
      tags: tags,
      meal: $("#cf-meal").value === "breakfast" ? "breakfast" : "main",
      baseServings: clamp(Math.round(numVal("#cf-servings", 4)), 1, 24),
      prepMinutes: Math.round(prep),
      cookMinutes: Math.round(clamp(numVal("#cf-cook", 0), 0, 100000)),
      caloriesPerServing: Math.round(clamp(numVal("#cf-cal", 0), 0, 100000)),
      proteinGrams: Math.round(clamp(numVal("#cf-p", 0), 0, 100000)),
      carbsGrams: Math.round(clamp(numVal("#cf-c", 0), 0, 100000)),
      fatGrams: Math.round(clamp(numVal("#cf-f", 0), 0, 100000)),
      fridgeDays: Math.round(clamp(numVal("#cf-fridge", 3), 0, 3650)),
      freezerFriendly: !!$("#cf-freezer").checked,
      difficulty: computeDifficulty(ingredients.length, steps.length, prep, tags),
      allergens: checked,
      ingredients: ingredients,
      steps: steps,
      storageNote: ($("#cf-storage").value || "").trim(),
      author: (currentUser() && currentUser().name) || "Cook"
    };
    if (editing) recipe.photoPath = editing.photoPath || null;   // keep existing photo unless replaced
    return recipe;
  }

  function submitForm() {
    formError("");
    var w = who();
    if (!w) { formError("Sign in to post a recipe."); return; }
    var recipe = collect();
    if (!recipe) return;

    var submit = $("#cf-submit");
    submit.disabled = true;
    var original = submit.textContent;
    submit.textContent = editing ? "Saving…" : "Publishing…";

    var done = function (err, id) {
      submit.disabled = false; submit.textContent = original;
      if (err) { formError("Couldn't save that. Check your connection and try again."); return; }
      modal.close();
      try {
        document.dispatchEvent(new CustomEvent("mise:recipe-published", {
          detail: { id: id || recipe.id, editing: !!editing }
        }));
      } catch (e) { /* CustomEvent unsupported — the board still redraws via onCommunity */ }
    };

    var fileInput = $("#cf-photo");
    var file = fileInput && fileInput.files && fileInput.files[0];
    var send = function (blob) {
      if (editing) MiseStore.updateRecipe(w, recipe.id, recipe, blob, done);
      else MiseStore.publishRecipe(w, recipe, blob, done);
    };

    if (file) {
      if (file.size > MAX_PHOTO_BYTES) {
        submit.disabled = false; submit.textContent = original;
        formError("That image is too large (15 MB max). Pick a smaller one.");
        return;
      }
      downscale(file, function (blob) { send(blob); });
    } else {
      send(null);
    }
  }

  // ---------- the report form ----------

  function renderReport(recipeId) {
    editing = null;
    body.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape">REPORT RECIPE</span>' +
        '<button class="modal-close" id="cr-close" type="button" aria-label="Close">&times;</button>' +
      "</div>" +
      '<h2 class="auth-h2">Report this recipe</h2>' +
      '<p class="modal-desc">Tell us what’s wrong. Enough reports hide a recipe from the board while it’s reviewed.</p>' +
      '<form id="cr-form" data-recipe="' + esc(recipeId) + '">' +
        '<div class="cf-field"><label for="cr-reason">Reason</label>' +
          '<select id="cr-reason">' +
            REPORT_REASONS.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.label) + "</option>"; }).join("") +
          "</select></div>" +
        '<div class="cf-field"><label for="cr-note">Anything to add? <span class="cf-opt">(optional)</span></label>' +
          '<textarea id="cr-note" maxlength="400" rows="3"></textarea></div>' +
        '<p id="cr-msg" class="auth-error" hidden></p>' +
        '<div class="cf-actions">' +
          '<button type="submit" id="cr-submit" class="review-post">Submit report</button>' +
        "</div>" +
      "</form>";
  }

  function submitReport() {
    var w = who();
    var msg = $("#cr-msg");
    var show = function (t, ok) { if (!msg) return; msg.hidden = !t; msg.textContent = t || ""; msg.classList.toggle("ok", !!ok); };
    if (!w) { show("Sign in to report a recipe."); return; }
    var form = $("#cr-form");
    var recipeId = form.getAttribute("data-recipe");
    var reasonSel = $("#cr-reason");
    var reasonLabel = reasonSel.options[reasonSel.selectedIndex] ? reasonSel.options[reasonSel.selectedIndex].text : reasonSel.value;
    var note = ($("#cr-note").value || "").trim();
    var reason = note ? reasonLabel + " — " + note : reasonLabel;

    var submit = $("#cr-submit");
    submit.disabled = true;
    MiseStore.reportRecipe(w, recipeId, reason, function (err) {
      submit.disabled = false;
      if (err) { show("Couldn't send that report. Try again."); return; }
      show("Thanks — we'll take a look.", true);
      setTimeout(function () { if (modal && modal.open) modal.close(); }, 1200);
    });
  }

  // ---------- public API ----------

  function open(existing) {
    if (!who()) return;               // caller gates on sign-in; defensive no-op
    ensure();
    renderForm(existing || null);
    modal.showModal();
    var first = $("#cf-name"); if (first) first.focus();
  }
  function openReport(recipeId) {
    if (!recipeId || !who()) return;
    ensure();
    renderReport(recipeId);
    modal.showModal();
  }

  return { open: open, openReport: openReport };
})();
