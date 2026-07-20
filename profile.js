/* Myse — the profile page ("your kitchen").
 *
 * A separate page from the board, sharing its data through store.js and its
 * paywall through plus-ui.js. app.js is not loaded here: it grabs index.html's
 * DOM at module scope and would throw on the first selector.
 *
 * THIS PAGE IS FREE, and needs only an account. Favorites, ratings, reviews and
 * standing allergies are free forever (see CLAUDE.md), and an account is the
 * thing a Plus purchase restores into — putting a wall here would strand the
 * purchase it's meant to recover. The one Plus-gated thing on the page is the
 * calorie target, and that gate lives in store.js's calorieTarget(), not here,
 * so it stays true in one place for both pages.
 *
 * Sign-in deliberately lives on the board, not here: auth.js sends OAuth back to
 * window.location.pathname, and Supabase's redirect allowlist is configured for
 * the site root (see the header of auth.js). A sign-in button on this page would
 * bounce off that allowlist.
 */
(function () {
  "use strict";

  var host = document.getElementById("kitchen");

  // Supabase resolves asynchronously; the demo account is a synchronous read.
  var realAuth = typeof MiseAuth !== "undefined" && MiseAuth.enabled;
  var account = realAuth ? null : MiseStore.account();
  var ready = !realAuth;
  var unreachable = false;   // auth service never answered — say so, don't lie
  var draft = null;          // the calorie form's working copy, saved on submit

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function me() { return MiseStore.who(account); }
  function $(sel) { return host.querySelector(sel); }

  function recipeById(id) {
    return RECIPES.find(function (r) { return r.id === id; });
  }

  function stars(n) {
    var out = "";
    for (var i = 1; i <= 5; i++) out += i <= n ? "★" : "☆";
    return out;
  }

  /* ---------- the page shell ---------- */

  function render() {
    if (!ready) {
      host.innerHTML = '<p class="kit-loading mono">LOADING YOUR KITCHEN&hellip;</p>';
      return;
    }
    if (!account) { renderSignedOut(); return; }

    host.innerHTML =
      '<div class="kit-grid">' +
        '<aside class="kit-id">' +
          // The saved daily target surfaces here, above the identity card, so a
          // just-saved target lands in view (see renderTargetReadout).
          '<div id="kit-target-readout"></div>' +
          '<div id="kit-id"></div>' +
        "</aside>" +
        '<div class="kit-sections">' +
          '<section class="kit-section" id="kit-allergies"></section>' +
          '<section class="kit-section" id="kit-target"></section>' +
          '<section class="kit-section" id="kit-favorites"></section>' +
          // Community recipes need the Supabase backend; the demo layer has no
          // place to post to, so the section (and its Share button) only appears
          // with real auth.
          (realAuth ? '<section class="kit-section" id="kit-recipes"></section>' : "") +
          '<section class="kit-section" id="kit-activity"></section>' +
          '<section class="kit-section" id="kit-danger"></section>' +
        "</div>" +
      "</div>";

    renderIdentity();
    renderTargetReadout();
    renderAllergies();
    renderTarget();
    renderFavorites();
    if (realAuth) renderMyRecipes();
    renderActivity();
    renderDanger();
  }

  function renderSignedOut() {
    host.innerHTML =
      '<div class="kit-empty-page">' +
        '<span class="modal-tape">YOUR KITCHEN</span>' +
        (unreachable
          ? "<h2>Can&rsquo;t reach the sign-in service</h2>" +
            '<p class="kit-empty-line">Your kitchen needs your account, and we couldn&rsquo;t get to it — ' +
              "you may be offline. The recipes themselves work without a connection.</p>"
          : "<h2>You&rsquo;re not signed in</h2>" +
            '<p class="kit-empty-line">Your kitchen holds your allergies, your calorie target, and every ' +
              "recipe you&rsquo;ve saved or rated. An account is free, and always will be.</p>") +
        '<div class="kit-ctas">' +
          // Sign-in lives on the board (auth.js's OAuth redirect is the site
          // root), so this hands off to it and comes straight back here. Not
          // offered when auth is unreachable — the button would just fail.
          (unreachable ? "" :
            '<a class="kit-cta" href="index.html?signin=1&amp;next=profile.html">Sign in</a>') +
          '<a class="kit-cta kit-cta--ghost" href="index.html">&larr; Back to the recipes</a>' +
        "</div>" +
      "</div>";
  }

  /* ---------- who you are ---------- */

  function renderIdentity() {
    var s = MiseStore.stats(me());
    var plus = MiseSub.isPlus();
    var kind = MiseSub.kind();
    var onTrial = plus && MiseSub.onTrial();
    var planLabel = onTrial
      ? "FREE TRIAL · " + MiseSub.trialDaysLeft() + "D LEFT"
      : (kind === "lifetime" ? "LIFETIME" : "MONTHLY");

    $("#kit-id").innerHTML =
      '<div class="kit-card kit-card--id">' +
        '<span class="tape mono" aria-hidden="true">SIGNED IN</span>' +
        '<p class="kit-name">' + esc(account.name) + "</p>" +
        (account.email ? '<p class="kit-email mono">' + esc(account.email) + "</p>" : "") +
        '<p class="auth-stats mono">' +
          s.favorites + " FAVORITES · " + s.rated + " RATED · " + s.reviewed + " REVIEWED" +
        "</p>" +
        '<div class="kit-plus">' +
          (plus
            ? '<p class="kit-plus-on mono">MYSE PLUS · ' + planLabel + "</p>" +
              '<button class="kit-plus-manage mono" id="kit-manage" type="button">MANAGE &rarr;</button>'
            : '<p class="kit-plus-off mono">FREE PLAN</p>' +
              '<button class="kit-plus-manage mono" id="kit-manage" type="button">SEE MYSE PLUS &rarr;</button>') +
        "</div>" +
        '<button class="clear-btn" id="kit-signout" type="button">Sign out</button>' +
      "</div>";

    $("#kit-manage").addEventListener("click", function () { MisePlusUI.open(); });
    $("#kit-signout").addEventListener("click", signOut);
  }

  function signOut() {
    // Back to the board either way: a signed-out profile page is a dead end.
    if (realAuth) {
      if (!MiseAuth.isReady()) { window.location.href = "index.html"; return; }
      MiseAuth.signOut().then(function () { window.location.href = "index.html"; })
        .catch(function () { window.location.href = "index.html"; });
      return;
    }
    MiseStore.clearAccount();
    window.location.href = "index.html";
  }

  /* ---------- what you can't eat ---------- */

  function renderAllergies() {
    var on = MiseStore.allergies(me());
    var labels = on.map(function (id) {
      var a = MiseStore.ALLERGENS.find(function (x) { return x.id === id; });
      return a ? a.label.toLowerCase() : id;
    });

    // "dairy", "dairy and peanuts", "dairy, peanuts and soy"
    var list = labels.length <= 1
      ? labels.join("")
      : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];

    $("#kit-allergies").innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">STANDING ALLERGIES</span>' +
        "<h2>What you can&rsquo;t eat</h2>" +
        '<p class="kit-lede">Set these once and the board opens with them on, every visit. ' +
          "You can still switch one off from the filter rail for a single look around &mdash; " +
          "that won&rsquo;t change what&rsquo;s saved here.</p>" +
        '<div class="chip-row" id="kit-allergy-chips">' +
          MiseStore.ALLERGENS.map(function (a) {
            return '<button type="button" class="chip" data-allergen="' + esc(a.id) + '" aria-pressed="' +
              (on.indexOf(a.id) !== -1) + '">' + esc(a.label) + "</button>";
          }).join("") +
        "</div>" +
        '<p class="kit-allergy-state' + (on.length ? " kit-allergy-state--on" : "") + '" id="kit-allergy-state">' +
          (on.length
            ? "The board will hide every recipe containing " + esc(list) + "."
            : "Nothing set &mdash; the board shows every recipe.") +
        "</p>" +
        '<p class="kit-fineprint">Myse tags allergens per ingredient and errs towards over-tagging, ' +
          "including the hidden ones (soy sauce is soy and wheat). It&rsquo;s still illustrative data: " +
          "if a reaction is severe, read the label on the actual jar.</p>" +
      "</div>";

    $("#kit-allergies").querySelectorAll("[data-allergen]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = this.getAttribute("data-allergen");
        var next = MiseStore.allergies(me());
        var at = next.indexOf(id);
        if (at === -1) next.push(id);
        else next.splice(at, 1);
        MiseStore.setAllergies(me(), next);
        renderAllergies();   // redraw so the sentence under the chips stays true
        renderFavorites();   // a favorite may now clash (or stop clashing) with the list
      });
    });
  }

  /* ---------- what you're aiming for (Plus) ---------- */

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

  // The daily-target result, split out so a keystroke can refresh just this bit
  // (see the input handler in wireTarget) instead of rebuilding the whole form.
  function targetCalc(d) {
    return MiseNutrition.valid(d) ? MiseNutrition.dailyCalories(d) : null;
  }

  function targetOutputHTML(d) {
    var calc = targetCalc(d);
    if (!calc) return '<p class="nut-incomplete">' + esc(MiseNutrition.blocker(d) || "") + "</p>";
    var warns = MiseNutrition.warnings(d);
    return '<div class="nut-result">' +
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
      "</div>";
  }

  // Live-update the target + the save button WITHOUT touching the input DOM.
  // Rebuilding the inputs on every keystroke ate digits and decimals and jumped
  // the caret (type=number has no selectionStart to restore) — badly on mobile.
  function updateTargetResult() {
    var out = $("#nut-output");
    if (out) out.innerHTML = targetOutputHTML(draft);
    var save = $("#nut-save");
    if (save) save.disabled = !targetCalc(draft);
  }

  // The saved daily target, surfaced in the sidebar above the identity card once
  // a valid target is saved (Plus only, since the target is Plus-gated). It
  // reflects what's SAVED, not the in-progress draft — edits land here when saved.
  // Empty markup when there's nothing to show, so the sidebar collapses to just
  // the identity card.
  function renderTargetReadout() {
    var slot = $("#kit-target-readout");
    if (!slot) return;
    var saved = MiseSub.isPlus() ? MiseStore.nutrition(me()) : null;
    var calc = saved ? targetCalc(saved) : null;
    slot.innerHTML = calc
      ? '<div class="kit-card kit-card--readout">' + targetOutputHTML(saved) + "</div>"
      : "";
  }

  // A quiet, self-dismissing "Target Saved!" — a confirmation, not a celebration
  // (this page's tone). Lives in the actions row and fades after a couple seconds.
  function flashSaved() {
    var actions = $("#kit-target .nut-actions");
    if (!actions) return;
    var old = actions.querySelector(".nut-saved");
    if (old) old.parentNode.removeChild(old);
    var msg = document.createElement("p");
    msg.className = "nut-saved mono";
    msg.setAttribute("role", "status");
    msg.textContent = "Target Saved!";
    actions.appendChild(msg);
    setTimeout(function () {
      msg.classList.add("nut-saved--out");
      setTimeout(function () { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 400);
    }, 2600);
  }

  function renderTarget() {
    var el = $("#kit-target");

    /* Not on Plus. Never hide the fact that a saved profile is still there —
       a lapsed subscriber's numbers are kept on purpose, and telling them so is
       the difference between "resubscribe" and "fill this all in again". */
    if (!MiseSub.isPlus()) {
      var saved = MiseStore.nutrition(me());
      el.innerHTML =
        '<div class="kit-card kit-card--locked">' +
          '<span class="tape mono" aria-hidden="true">MYSE PLUS</span>' +
          "<h2>Your calorie target</h2>" +
          (saved
            ? '<p class="kit-lede">Your goals are still saved &mdash; we haven&rsquo;t touched them. ' +
                "Resubscribe and your target comes straight back, with no retyping.</p>"
            : '<p class="kit-lede">A daily number worked out from your goal, your body and how much you ' +
              "move &mdash; and then every recipe on the board shows what share of your day it is.</p>") +
          '<button class="sub-buy" id="kit-unlock">' +
            '<span class="sub-buy-price">' + (saved ? "Bring it back" : "Unlock with Myse Plus") + "</span>" +
            '<span class="sub-buy-note mono">' +
              (MiseSub.trialAvailable()
                ? MiseSub.trialDays() + " days free, then " + esc(MiseSub.monthlyPrice())
                : esc(MiseSub.monthlyPrice())) +
              " &middot; OR " + esc(MiseSub.lifetimePrice()).toUpperCase() + "</span>" +
          "</button>" +
        "</div>";
      $("#kit-unlock").addEventListener("click", function () { MisePlusUI.open(); });
      return;
    }

    if (!draft) draft = MiseStore.nutrition(me()) || blankDraft();
    if (!draft.units) draft.units = "imperial";

    var d = draft;
    var imperial = d.units === "imperial";
    var calc = targetCalc(d);
    // A target is "saved" once a stored profile produces a valid result — the
    // same condition the sidebar readout uses. Drives the button label and
    // whether the inline result box shows (it doesn't, once saved: it's up top).
    var savedProfile = MiseStore.nutrition(me());
    var hasSaved = !!(savedProfile && targetCalc(savedProfile));

    // Round total inches ONCE, then split — rounding feet and inches
    // separately produced "5 ft 12 in" (12 > the input's max=11) for heights
    // near a foot boundary, e.g. 182cm.
    var totalIn = d.heightCm ? Math.round(MiseNutrition.cmToIn(d.heightCm)) : null;
    var ft = totalIn !== null ? Math.floor(totalIn / 12) : "";
    var inch = totalIn !== null ? totalIn % 12 : "";
    var lb = d.weightKg ? Math.round(MiseNutrition.kgToLb(d.weightKg)) : "";

    el.innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">YOUR GOALS</span>' +
        "<h2>Your calorie target</h2>" +
        '<p class="kit-lede">An estimate from the Mifflin-St Jeor equation &mdash; the one dietitians ' +
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

        // Before the first save the result previews inline; afterwards it lives
        // in the sidebar readout above the identity card, so the section is just
        // the form again.
        (hasSaved ? "" : '<div id="nut-output">' + targetOutputHTML(d) + "</div>") +

        '<div class="nut-actions">' +
          '<button class="sub-buy" id="nut-save"' + (calc ? "" : " disabled") + ">" +
            (hasSaved ? "Update my target" : "Save my target") + "</button>" +
          (savedProfile ? '<button class="review-signin mono" id="nut-clear">CLEAR MY PROFILE</button>' : "") +
        "</div>" +
        '<p class="nut-disclaimer">Myse isn&rsquo;t a doctor or a dietitian. This is a population-average ' +
          "estimate; if you have a health condition, are pregnant, or are treating an eating disorder, " +
          "get a number from a professional instead.</p>" +
      "</div>";

    wireTarget();
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

  function wireTarget() {
    var el = $("#kit-target");

    el.querySelectorAll("[data-field]").forEach(function (b) {
      b.addEventListener("click", function () {
        syncDraftFromForm();
        draft[this.getAttribute("data-field")] = this.getAttribute("data-val");
        renderTarget();
      });
    });

    el.querySelectorAll("[data-units]").forEach(function (b) {
      b.addEventListener("click", function () {
        syncDraftFromForm();               // keep the values, just change the display
        draft.units = this.getAttribute("data-units");
        renderTarget();
      });
    });

    el.querySelectorAll(".nut-fields input").forEach(function (i) {
      i.addEventListener("input", function () {
        // Update the live target only — do NOT re-render the inputs. Rebuilding
        // them mid-keystroke dropped digits/decimals and jumped the caret
        // (type=number has no selectionStart to restore), worst of all on mobile.
        syncDraftFromForm();
        updateTargetResult();
      });
    });

    var save = el.querySelector("#nut-save");
    if (save) save.addEventListener("click", function () {
      syncDraftFromForm();
      if (!MiseNutrition.valid(draft)) return;
      MiseStore.setNutrition(me(), draft);
      renderTarget();          // section reverts to the form; button now "Update"
      renderTargetReadout();   // surface the saved target above the identity card
      flashSaved();            // "Target Saved!"
    });

    var clear = el.querySelector("#nut-clear");
    if (clear) clear.addEventListener("click", function () {
      MiseStore.clearNutrition(me());
      draft = blankDraft();
      renderTarget();
      renderTargetReadout();   // nothing saved now, so the sidebar readout clears
    });
  }

  /* ---------- what you've saved ---------- */

  function renderFavorites() {
    // A favorite whose recipe has since left the library just isn't shown.
    var list = MiseStore.favs(me()).map(recipeById).filter(Boolean);
    var standing = MiseStore.allergies(me());

    /* A recipe favorited before an allergy was added is hidden on the board but
       would still sit here looking saved and safe. Say so plainly instead —
       this page is the one place the two facts meet. */
    function clashes(r) {
      return r.allergens.filter(function (a) { return standing.indexOf(a) !== -1; });
    }
    var clashing = list.filter(function (r) { return clashes(r).length; }).length;

    $("#kit-favorites").innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">FAVORITES</span>' +
        "<h2>What you&rsquo;ve saved</h2>" +
        (list.length
          ? '<p class="kit-lede">' + list.length + (list.length === 1 ? " recipe" : " recipes") +
              " you&rsquo;ve starred." +
              (clashing
                ? " " + (clashing === 1 ? "One of them clashes" : clashing + " of them clash") +
                  " with your allergies, so the board hides " + (clashing === 1 ? "it" : "them") + "; " +
                  (clashing === 1 ? "it&rsquo;s" : "they&rsquo;re") + " flagged below."
                : "") + "</p>" +
            '<ul class="kit-list">' +
              list.map(function (r) {
                var bad = clashes(r);
                return '<li><a class="kit-row" href="index.html#' + esc(r.id) + '">' +
                  '<span class="kit-row-name">' + esc(r.name) + "</span>" +
                  '<span class="kit-row-meta mono">' +
                    esc(r.protein.toUpperCase()) + " · " + (r.prepMinutes + r.cookMinutes) + " MIN · " +
                    r.caloriesPerServing + " CAL" +
                    (r.allergens.length ? ' <span class="kit-row-warn">CONTAINS ' + esc(r.allergens.join(", ").toUpperCase()) + "</span>" : "") +
                  "</span>" +
                  (bad.length
                    ? '<span class="kit-clash mono">ON YOUR ALLERGY LIST: ' + esc(bad.join(", ").toUpperCase()) + "</span>"
                    : "") +
                "</a></li>";
              }).join("") +
            "</ul>"
          : '<p class="kit-none">Nothing saved yet. Tap the &hearts; on any recipe ticket and it lands here.</p>') +
      "</div>";
  }

  /* ---------- what you've shared ---------- */

  // Community recipes you've posted. Fetched async from Supabase (myRecipes),
  // cached so a re-render doesn't flash "Loading"; null means not-yet-fetched.
  var myRecipesCache = null;

  function loadMyRecipes() {
    MiseStore.myRecipes(me(), function (list) {
      myRecipesCache = list || [];
      renderMyRecipes();
    });
  }

  function renderMyRecipes() {
    var el = $("#kit-recipes");
    if (!el) return;
    var list = myRecipesCache;

    var inner;
    if (list === null) {
      inner = '<p class="kit-none">Loading&hellip;</p>';
    } else if (!list.length) {
      inner = '<p class="kit-none">You haven&rsquo;t shared any recipes yet. Post one and it joins ' +
        "the Community board for everyone to cook, review, and plan.</p>" +
        '<button class="sub-buy kit-share-btn" type="button" data-share-recipe>Share a recipe</button>';
    } else {
      inner = '<p class="kit-lede">' + list.length + (list.length === 1 ? " recipe" : " recipes") +
          " you&rsquo;ve shared to the Community board.</p>" +
        '<ul class="kit-list">' +
          list.map(function (r) {
            return "<li><div class=\"kit-review\">" +
              '<a class="kit-row kit-row--flush" href="index.html#' + esc(r.id) + '">' +
                '<span class="kit-row-name">' + esc(r.name) + "</span>" +
                '<span class="kit-row-meta mono">' +
                  esc(String(r.protein).toUpperCase()) + " · " + (r.prepMinutes + r.cookMinutes) + " MIN · " +
                  r.caloriesPerServing + " CAL" +
                "</span>" +
              "</a>" +
              '<div class="kit-recipe-actions">' +
                '<button class="kit-review-del mono" data-edit="' + esc(r.id) + '" type="button">EDIT</button>' +
                '<button class="kit-review-del mono" data-del-recipe="' + esc(r.id) + '" type="button">DELETE</button>' +
              "</div>" +
            "</div></li>";
          }).join("") +
        "</ul>" +
        '<button class="sub-buy kit-share-btn" type="button" data-share-recipe>Share another recipe</button>';
    }

    el.innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">YOUR RECIPES</span>' +
        "<h2>What you&rsquo;ve shared</h2>" +
        inner +
      "</div>";

    if (list === null) { loadMyRecipes(); return; }   // first paint kicks the fetch

    el.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = this.getAttribute("data-edit");
        var r = (myRecipesCache || []).filter(function (x) { return x.id === id; })[0];
        if (r && typeof MiseCommunityUI !== "undefined") MiseCommunityUI.open(r);
      });
    });

    /* Two presses to delete: the recipe is public and shared, so removal is
       everywhere — one stray tap shouldn't do it. Same arm pattern as reviews. */
    el.querySelectorAll("[data-del-recipe]").forEach(function (b) {
      var armTimer;
      function disarm() {
        clearTimeout(armTimer);
        b.setAttribute("data-armed", "no");
        b.classList.remove("kit-review-del--arm");
        b.textContent = "DELETE";
      }
      b.addEventListener("click", function () {
        if (this.getAttribute("data-armed") !== "yes") {
          this.setAttribute("data-armed", "yes");
          this.classList.add("kit-review-del--arm");
          this.textContent = "TAP AGAIN TO DELETE";
          clearTimeout(armTimer);
          armTimer = setTimeout(disarm, 4000);
          return;
        }
        clearTimeout(armTimer);
        var id = this.getAttribute("data-del-recipe");
        this.disabled = true;
        MiseStore.deleteRecipe(me(), id, function (err) {
          if (err) { disarm(); b.disabled = false; return; }
          myRecipesCache = (myRecipesCache || []).filter(function (x) { return x.id !== id; });
          renderMyRecipes();
        });
      });
      b.addEventListener("blur", disarm);
    });
  }

  /* ---------- what you've cooked ---------- */

  // Ratings and reviews are one thought per recipe, so they're one list: your
  // stars, and what you said, if you said anything.
  function activityRows() {
    var byId = {};
    MiseStore.myRatings(me()).forEach(function (r) {
      byId[r.id] = { id: r.id, stars: r.stars, text: null, date: null };
    });
    MiseStore.myReviews(me()).forEach(function (rv) {
      var row = byId[rv.id] || (byId[rv.id] = { id: rv.id, stars: 0, text: null, date: null });
      row.text = rv.text;
      row.date = rv.date;
      if (!row.stars && rv.stars) row.stars = rv.stars;
    });
    return Object.keys(byId)
      .map(function (k) { return byId[k]; })
      .filter(function (row) { return recipeById(row.id); })
      .sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
  }

  function renderActivity() {
    var rows = activityRows();

    $("#kit-activity").innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">RATINGS &amp; REVIEWS</span>' +
        "<h2>What you&rsquo;ve cooked</h2>" +
        (rows.length
          ? '<p class="kit-lede">Every recipe you&rsquo;ve rated, and what you said about it.</p>' +
            '<ul class="kit-list">' +
              rows.map(function (row) {
                var r = recipeById(row.id);
                return "<li>" +
                  '<div class="kit-review">' +
                    '<a class="kit-row kit-row--flush" href="index.html#' + esc(row.id) + '">' +
                      '<span class="kit-row-name">' + esc(r.name) + "</span>" +
                      '<span class="kit-row-meta mono">' +
                        '<span class="kit-stars" aria-label="' + row.stars + ' out of 5">' + stars(row.stars) + "</span>" +
                        (row.date ? " · " + esc(row.date) : "") +
                      "</span>" +
                    "</a>" +
                    (row.text
                      ? '<p class="kit-review-text">' + esc(row.text) + "</p>" +
                        '<button class="kit-review-del mono" data-del="' + esc(row.id) + '" type="button">DELETE REVIEW</button>'
                      : "") +
                  "</div>" +
                "</li>";
              }).join("") +
            "</ul>"
          : '<p class="kit-none">Nothing rated yet. Open a recipe, cook it, and leave yourself a note ' +
            "about what you&rsquo;d change.</p>") +
      "</div>";

    /* Two presses to delete. A review lives on the server and is public, so a
       deletion removes it everywhere — one stray tap shouldn't do that. The
       button says what the next press does, and re-locks itself if left alone. */
    $("#kit-activity").querySelectorAll("[data-del]").forEach(function (b) {
      var armTimer;
      function disarm() {
        clearTimeout(armTimer);
        b.setAttribute("data-armed", "no");
        b.classList.remove("kit-review-del--arm");
        b.textContent = "DELETE REVIEW";
      }
      b.addEventListener("click", function () {
        if (this.getAttribute("data-armed") !== "yes") {
          this.setAttribute("data-armed", "yes");
          this.classList.add("kit-review-del--arm");
          this.textContent = "TAP AGAIN TO DELETE";
          // Blur doesn't fire on iOS (a tap doesn't focus a button), so also
          // re-lock on a timer — otherwise it can sit primed indefinitely.
          clearTimeout(armTimer);
          armTimer = setTimeout(disarm, 4000);
          return;
        }
        clearTimeout(armTimer);
        MiseStore.removeReview(me(), this.getAttribute("data-del"));
        renderActivity();
        renderIdentity();   // the stats line counts reviews
      });
      b.addEventListener("blur", disarm);
    });
  }

  /* ---------- deleting the account ---------- */

  /* A wall away from everything else on the page: light red, its own heading,
     and a two-step confirm so the last thing on the page can't be triggered by
     one stray tap. Only shown signed in — render() calls it inside the account
     branch, so a signed-out visitor never sees it. */
  function renderDanger() {
    var el = $("#kit-danger");
    el.innerHTML =
      '<div class="kit-card kit-card--danger">' +
        '<span class="tape mono" aria-hidden="true">DANGER ZONE</span>' +
        "<h2>Delete your account</h2>" +
        '<p class="kit-lede kit-danger-lede">This closes your account for good and clears everything ' +
          "Myse keeps for you &mdash; your standing allergies, your calorie target, your favorites, and " +
          "every rating and review. Signing up again later starts you over as a new account, with none " +
          "of this. There&rsquo;s no undo.</p>" +
        '<div class="kit-danger-actions" id="kit-danger-actions">' +
          '<button class="kit-danger-btn" id="kit-delete" type="button">Delete account</button>' +
        "</div>" +
      "</div>";
    $("#kit-delete").addEventListener("click", armDelete);
  }

  function armDelete() {
    confirmBox(
      "Are you sure? This permanently removes your account and everything in it, and it " +
        "can’t be brought back.",
      "Yes, delete everything"
    );
  }

  // The confirm / retry prompt: a warning line plus go/cancel. Shared so a
  // failed attempt can re-arm with a different message and a "Try again" button.
  function confirmBox(message, goLabel) {
    var box = $("#kit-danger-actions");
    box.innerHTML =
      '<p class="kit-danger-warn" role="alert">' + esc(message) + "</p>" +
      '<div class="kit-danger-confirm">' +
        '<button class="kit-danger-btn kit-danger-btn--go" id="kit-delete-yes" type="button">' + esc(goLabel) + "</button>" +
        '<button class="kit-danger-cancel" id="kit-delete-no" type="button">Cancel</button>' +
      "</div>";
    $("#kit-delete-yes").addEventListener("click", deleteAccount);
    $("#kit-delete-no").addEventListener("click", renderDanger);   // back to the armed-away state
  }

  function deletingState() {
    var box = $("#kit-danger-actions");
    if (box) box.innerHTML = '<p class="kit-danger-warn" role="status">Deleting your account…</p>';
  }

  // The board shows a "your account was deleted" banner off this marker.
  function toBoardDeleted() { window.location.href = "index.html?mise_deleted=1"; }

  function deleteAccount() {
    // Demo account: no server, nothing to authorize — just clear this browser.
    if (!realAuth) {
      MiseStore.deleteUserData(me());
      MiseStore.clearAccount();
      toBoardDeleted();
      return;
    }

    if (!MiseAuth.isReady()) {
      confirmBox("We couldn’t reach the sign-in service. Check your connection and try again.", "Try again");
      return;
    }

    /* Order matters. The auth account is deleted first, server-side, because
       that call is authorized by the LIVE session — sign out or wipe local data
       first and it would fail. Only once the account is truly gone do we clear
       this browser and end the (now-orphaned) session. If the server call
       fails, we delete NOTHING and let them retry, rather than claim success. */
    deletingState();
    MiseAuth.deleteAccount().then(function (res) {
      if (res && res.error) {
        confirmBox("We couldn’t delete your account: " + (res.error.message || "please try again.") +
          " Nothing was removed.", "Try again");
        return;
      }
      MiseStore.deleteUserData(me());
      MiseAuth.signOut().then(toBoardDeleted, toBoardDeleted);
    }).catch(function () {
      confirmBox("We couldn’t reach the server, so your account was not deleted. Please try again.", "Try again");
    });
  }

  /* ---------- boot ---------- */

  // A purchase (or a cancel) changes the target card and the Plus badge.
  MisePlusUI.onChange(function () {
    if (!account) return;
    renderTarget();
    renderIdentity();
  });

  // "Share a recipe" buttons on this page (no app.js here to catch them). Already
  // signed in on the profile page, so open the form straight away.
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-share-recipe]");
    if (!t) return;
    e.preventDefault();
    if (account && typeof MiseCommunityUI !== "undefined") MiseCommunityUI.open();
  });

  // A publish/edit from the dialog refreshes the "your recipes" list.
  document.addEventListener("mise:recipe-published", function () {
    myRecipesCache = null;
    renderMyRecipes();
  });

  if (realAuth) {
    MiseAuth.onChange(function (user) {
      account = user ? { id: user.id, name: user.name, email: user.email } : null;
      ready = true;
      unreachable = false;   // auth answered after all — clear a fired timeout
      draft = null;        // a different person gets a different form
      myRecipesCache = null;   // and a different person's shared recipes
      render();
    });
    // Sign-in renders from cache first; hydrate() then loads this account's rows
    // from Supabase and fires onSync, so redraw the whole page with real data.
    // hydrate only runs for a signed-in user, so if onChange was missed or
    // delayed (a cold CDN can drop the event, stranding the 8s "can't reach"
    // state), adopt the resolved account here.
    MiseStore.onSync(function () {
      var u = MiseAuth.user && MiseAuth.user();
      if (u && u.id && !account) {
        account = { id: u.id, name: u.name, email: u.email };
        ready = true;
        unreachable = false;
      }
      draft = null;
      myRecipesCache = null;   // hydrate landed — refetch this account's shared recipes
      render();
    });
    /* Last resort: auth.js pulls the Supabase SDK off jsDelivr, and if that
       request stalls, onChange never fires and this page would spin forever.

       Deliberately slow, because this only fires on a slow-but-alive network:
       a device that's actually offline fails the script tag fast and auth.js's
       onerror notifies us immediately, so waiting longer costs a genuinely
       offline visitor nothing — while a cold jsDelivr fetch on a thin
       connection routinely outran the 8s this used to be.

       And "can't reach" is only honest if the SDK never landed. If the client
       exists, getSession is merely slow: say "signed out" — which onChange
       corrects a moment later — rather than a flat lie that ALSO hides the
       Sign in button, at exactly the moment someone wants it. */
    setTimeout(function () {
      if (ready) return;
      ready = true;
      unreachable = !(MiseAuth.isReady && MiseAuth.isReady());
      render();
    }, 15000);
  }

  render();
})();
