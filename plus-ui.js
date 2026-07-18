/* Mise — the Mise Plus upgrade dialog.
 *
 * Lifted out of app.js when the profile page arrived: the board and
 * profile.html both have to be able to offer the upgrade, and two copies of a
 * paywall is how a project ends up quoting two different prices. subscription.js
 * owns the entitlement; this owns the one dialog that sells it.
 *
 * Usage — the gate reads the same as it always did:
 *     if (MisePlusUI.require()) return;   // true => stop, the dialog is up
 * and a page re-renders itself after a purchase via:
 *     MisePlusUI.onChange(function () { ... });
 *
 * The dialog builds its own markup, so neither HTML file carries a copy of it
 * and a page that never opens it pays nothing for it.
 */

var MisePlusUI = (function () {
  "use strict";

  var modal = null;
  var body = null;
  var listeners = [];

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function changed() { listeners.forEach(function (fn) { fn(); }); }

  function ensure() {
    if (modal) return;
    modal = document.createElement("dialog");
    modal.id = "sub-modal";
    modal.className = "modal sub-modal";
    modal.setAttribute("aria-labelledby", "sub-title");
    body = document.createElement("div");
    body.className = "modal-body";
    body.id = "sub-body";
    modal.appendChild(body);
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.close(); });
  }

  // Scoped to the dialog: ids are global, and the pages have their own.
  function $(sel) { return body.querySelector(sel); }

  function render() {
    var live = MiseSub.isLive();

    if (MiseSub.isPlus()) {
      var kind = MiseSub.kind();
      body.innerHTML =
        '<div class="modal-top">' +
          '<span class="modal-tape">MYSE PLUS</span>' +
          '<button class="modal-close" id="sub-close" aria-label="Close">&times;</button>' +
        "</div>" +
        '<h2 id="sub-title">You&rsquo;re on Plus</h2>' +
        '<p class="modal-desc">Printing, PDFs, the weekly plan, and your calorie target are ' +
          "unlocked, and the board is clear of sponsored tickets." +
          (live ? "" : " This is the demo unlock — nothing was charged.") + "</p>" +
        '<button class="clear-btn" id="sub-cancel">' +
          (live
            ? (kind === "lifetime" ? "Manage purchase" : "Manage subscription")
            : "Switch back to free") +
        "</button>";
      $("#sub-close").addEventListener("click", function () { modal.close(); });
      $("#sub-cancel").addEventListener("click", function () { MiseSub.cancel(); });
      return;
    }

    // RECIPES is on both pages today; guard anyway so a future page that skips
    // the 448KB of recipe data still gets a working paywall.
    var count = typeof RECIPES !== "undefined" ? "ALL " + RECIPES.length + " RECIPES" : "EVERY RECIPE";

    body.innerHTML =
      '<div class="modal-top">' +
        '<span class="modal-tape">MYSE PLUS</span>' +
        '<button class="modal-close" id="sub-close" aria-label="Close">&times;</button>' +
      "</div>" +
      '<h2 id="sub-title">Take it to the kitchen</h2>' +
      '<p class="modal-desc">Plus unlocks the parts you use once you&rsquo;ve decided to cook:</p>' +
      '<ul class="sub-list">' +
        "<li>Print a recipe, or save it as a PDF</li>" +
        "<li>The weekly plan and its combined shopping list</li>" +
        "<li>Your goals and a daily calorie target &mdash; every recipe then shows " +
          "what share of your day it is</li>" +
        "<li>No sponsored tickets on the board</li>" +
      "</ul>" +
      '<p class="sub-free mono">FREE FOREVER: ' + count + ", EVERY FILTER, " +
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

    $("#sub-close").addEventListener("click", function () { modal.close(); });

    /* No render() here: MiseSub.notify() fires on a successful purchase and the
       subscription below redraws. The error path never notifies, so `btn` is
       still live when we re-enable it. */
    function buy(kind, btn) {
      btn.disabled = true;
      MiseSub.purchase(kind).catch(function (e) {
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
        if (res.plus) return;   // notify() already redrew this dialog
        var err = $("#sub-error");
        err.hidden = false;
        err.textContent = res.demo
          ? "Nothing to restore in the demo — there is no store account behind it yet."
          : "No purchase found on this account.";
      });
    });
  }

  function open() {
    ensure();
    render();
    modal.showModal();
  }

  /* The paywall in one place. Call at the top of any Plus-only action; returns
     true when the caller should stop, with the upgrade dialog already up. */
  function require() {
    if (MiseSub.isPlus()) return false;
    open();
    return true;
  }

  /* subscription.js owns the entitlement, so let it be the authority: whenever
     it changes, redraw this dialog and tell the page. Subscribing here rather
     than firing from each button means a change made anywhere lands — a restore,
     and, once step 4 of subscription.js is done, a real billing SDK's
     entitlement callback or a store-side refund arriving on its own. */
  MiseSub.onChange(function () {
    if (modal) render();
    changed();
  });

  // One delegated handler for every "remove ads" affordance, on any page.
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-remove-ads]");
    if (!t) return;
    e.preventDefault();
    open();
  });

  return {
    open: open,
    require: require,
    onChange: function (fn) { listeners.push(fn); },
    isOpen: function () { return !!(modal && modal.open); },
    close: function () { if (modal) modal.close(); }
  };
})();
