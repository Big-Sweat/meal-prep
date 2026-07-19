/* Mise → Instacart proxy (Cloudflare Worker).

   The ONE piece of Mise that isn't a static file. It exists for exactly one
   reason: Instacart's "Create shopping list page" API key is a secret, and a
   secret cannot live in grocery.js (anyone could read it). This tiny worker
   holds the key server-side, forwards the browser's ingredient list to
   Instacart, and hands back the pre-filled-cart URL. It stores nothing, has no
   database, and only ever talks to Instacart.

   Deploy: see README.md (≈5 minutes, free tier). Two secrets to set:
     INSTACART_API_KEY   – required. Your Instacart Developer Platform key.
     INSTACART_AFFILIATE – optional. Query string appended to the returned URL
                           once you're an approved affiliate, e.g.
                           "aff_id=123&affiliate_platform=idp_partner".

   Then paste this worker's URL into INSTACART_ENDPOINT in grocery.js. */

// Origins allowed to call this proxy. The deployed site, the Capacitor apps
// (Android WebView serves from https://localhost, iOS from
// capacitor://localhost), and local dev servers. Requests from anywhere else
// are rejected outright — CORS headers only stop browsers, so the reject
// below is what actually keeps bots from burning the Instacart quota.
const ALLOWED_ORIGINS = [
  "https://big-sweat.github.io",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost:8347",
  "http://127.0.0.1:8347"
];

// Abuse caps. The biggest real plan is a few dozen ingredients; anything past
// these numbers is not a shopping list.
const MAX_BODY_BYTES = 50000;
const MAX_ITEMS = 200;
const MAX_NAME_LEN = 120;

// Instacart production endpoint. Dev/sandbox: https://connect.dev.instacart.tools
const INSTACART_URL = "https://connect.instacart.com/idp/v1/products/products_link";

// Where Instacart's "back to site" link should point.
const PARTNER_LINKBACK = "https://big-sweat.github.io/meal-prep/";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    // Reject unknown callers instead of answering with a fallback header:
    // curl and server-side scripts ignore CORS entirely, so the old
    // "fall back to origin[0]" pattern still processed every request and only
    // *looked* locked down. (Also add a Cloudflare rate-limiting rule on this
    // route before going live — see README.)
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: "origin not allowed" }), {
        status: 403, headers: { "Content-Type": "application/json", "Vary": "Origin" }
      });
    }
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    if (!env.INSTACART_API_KEY) return json({ error: "proxy missing INSTACART_API_KEY" }, 500, cors);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: "request too large" }, 413, cors);
      body = JSON.parse(raw);
    } catch (e) { return json({ error: "invalid JSON" }, 400, cors); }

    // Sanitize to exactly the fields grocery.js sends ({ name, quantity?,
    // unit?, line_item_measurements? }) — nothing else rides through to
    // Instacart, and every string is length-capped.
    const rawItems = Array.isArray(body.line_items) ? body.line_items : [];
    if (!rawItems.length) return json({ error: "no line_items" }, 400, cors);
    if (rawItems.length > MAX_ITEMS) return json({ error: "too many line_items" }, 400, cors);
    const lineItems = [];
    for (const it of rawItems) {
      if (!it || typeof it.name !== "string" || !it.name.trim()) {
        return json({ error: "every line_item needs a name" }, 400, cors);
      }
      const clean = { name: it.name.trim().slice(0, MAX_NAME_LEN) };
      if (typeof it.quantity === "number" && isFinite(it.quantity) && it.quantity > 0) {
        clean.quantity = Math.min(it.quantity, 9999);
      }
      if (typeof it.unit === "string" && it.unit) clean.unit = it.unit.slice(0, 40);
      if (Array.isArray(it.line_item_measurements)) {
        clean.line_item_measurements = it.line_item_measurements.slice(0, 5)
          .filter((m) => m && typeof m.quantity === "number" && isFinite(m.quantity) && m.quantity > 0)
          .map((m) => ({
            quantity: Math.min(m.quantity, 9999),
            unit: typeof m.unit === "string" ? m.unit.slice(0, 40) : ""
          }));
      }
      lineItems.push(clean);
    }

    const payload = {
      title: (typeof body.title === "string" && body.title ? body.title : "Myse shopping list").slice(0, 120),
      link_type: "shopping_list",
      line_items: lineItems,
      landing_page_configuration: {
        partner_linkback_url: PARTNER_LINKBACK,
        enable_pantry_items: true
      }
    };

    let res, data;
    try {
      res = await fetch(INSTACART_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": "Bearer " + env.INSTACART_API_KEY
        },
        body: JSON.stringify(payload)
      });
      data = await res.json();
    } catch (e) {
      return json({ error: "upstream request failed" }, 502, cors);
    }

    if (!res.ok) {
      // Log the upstream detail for `wrangler tail`, but never forward it —
      // Instacart's error bodies can describe the account/key, and callers
      // only need to know the cart didn't build.
      console.log("instacart error", res.status, JSON.stringify(data).slice(0, 500));
      return json({ error: "instacart error", status: res.status }, res.status, cors);
    }

    let url = data && data.products_link_url;
    if (url && env.INSTACART_AFFILIATE) {
      url += (url.indexOf("?") === -1 ? "?" : "&") + env.INSTACART_AFFILIATE;
    }
    return json({ products_link_url: url }, 200, cors);
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors)
  });
}
