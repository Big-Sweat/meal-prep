/* grocery.js — MiseGrocery: send the week's shopping list to a grocery store,
   and (once you're signed up) earn an affiliate commission on what people buy.

   Three partners, each shipping in DEMO MODE until you add its credential —
   same pattern as products.js and subscription.js. Nothing here charges anyone
   or leaks a secret; the one secret (Instacart's API key) lives in the proxy,
   never in this file.

   ── 1. INSTACART — the real cart-builder ────────────────────────────────────
   Instacart's "Create shopping list page" API takes the whole ingredient list
   and returns a URL to a cart pre-filled with matched products. That is the
   money-maker: one tap → a populated Instacart cart → commission on the order.
   BUT the API key is secret and MUST stay server-side, so this cannot be called
   from the browser. Stand up the tiny proxy in instacart-proxy/ (see its
   README — ~5 min on Cloudflare's free tier), then paste its public URL into
   INSTACART_ENDPOINT below. Until then Instacart falls back to copy-the-list.
   Affiliate signup: docs.instacart.com/developer_platform_api (a live
   integration can register as an affiliate partner).

   ── 2. WALMART — Impact affiliate deep-link ─────────────────────────────────
   Walmart's affiliate program runs on Impact (affiliates.walmart.com). There's
   no "fill a whole cart" API for affiliates, so each list item becomes a tagged
   search link. Impact tracks clicks by routing through your personal tracking
   link, so paste that template into WALMART_IMPACT below (with {u} where the
   destination URL goes). Blank = plain, untagged Walmart searches that still
   work, just don't earn.

   ── 3. AMAZON FRESH / WHOLE FOODS — Associates ──────────────────────────────
   Reuses the Amazon Associates tag pattern from products.js. Each item is an
   Amazon Fresh grocery search carrying your tag. Keep AMAZON_TAG in step with
   products.js's AFFILIATE_TAG. */

var MiseGrocery = (function () {
  "use strict";

  /* ---- credentials (all blank/placeholder = demo mode) ---- */

  // Public URL of your Instacart proxy, e.g. "https://mise-instacart.<you>.workers.dev".
  // Blank => Instacart falls back to copy-list. See instacart-proxy/README.md.
  var INSTACART_ENDPOINT = "";

  // Your Impact tracking-link template, {u} = url-encoded destination, e.g.
  // "https://goto.walmart.com/c/1234567/1234567/9383?veh=aff&sourceid=imp_&u={u}".
  // Blank => plain Walmart search (works, but no commission).
  var WALMART_IMPACT = "";

  // Amazon Associates tag; keep in step with products.js. Placeholder earns nothing.
  var AMAZON_TAG = "YOUR-AFFILIATE-TAG-20";

  /* ---- Instacart ---- */

  function instacartLive() { return !!INSTACART_ENDPOINT; }

  // POST the structured list to the proxy; resolves to the pre-filled cart URL.
  // lineItems: [{ name, quantity?, unit?, line_item_measurements? }, …]
  function buildInstacartCart(title, lineItems) {
    return fetch(INSTACART_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, line_items: lineItems })
    }).then(function (res) {
      if (!res.ok) throw new Error("instacart proxy HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || !data.products_link_url) throw new Error("proxy returned no products_link_url");
      return data.products_link_url;
    });
  }

  /* ---- per-item deep-links (static, no key needed) ---- */

  function walmartUrl(item) {
    var dest = "https://www.walmart.com/search?q=" + encodeURIComponent(item);
    if (WALMART_IMPACT && WALMART_IMPACT.indexOf("{u}") !== -1) {
      return WALMART_IMPACT.replace("{u}", encodeURIComponent(dest));
    }
    return dest;
  }

  function amazonUrl(item) {
    // i=amazonfresh scopes the search to the Amazon Fresh grocery store.
    var u = "https://www.amazon.com/s?k=" + encodeURIComponent(item) + "&i=amazonfresh";
    // Only ride the tag once it's real — a placeholder tag is just noise on the URL.
    if (AMAZON_TAG && AMAZON_TAG !== "YOUR-AFFILIATE-TAG-20") {
      u += "&tag=" + encodeURIComponent(AMAZON_TAG);
    }
    return u;
  }

  // Store id -> per-item URL builder, for the board's link-mode toggle.
  function itemUrl(store, item) {
    if (store === "walmart") return walmartUrl(item);
    if (store === "amazon") return amazonUrl(item);
    return null;
  }

  return {
    instacartLive: instacartLive,
    buildInstacartCart: buildInstacartCart,
    walmartUrl: walmartUrl,
    amazonUrl: amazonUrl,
    itemUrl: itemUrl
  };
})();
