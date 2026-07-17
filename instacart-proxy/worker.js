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

// Origins allowed to call this proxy. The deployed site + local dev servers.
const ALLOWED_ORIGINS = [
  "https://big-sweat.github.io",
  "http://localhost:8347",
  "http://127.0.0.1:8347"
];

// Instacart production endpoint. Dev/sandbox: https://connect.dev.instacart.tools
const INSTACART_URL = "https://connect.instacart.com/idp/v1/products/products_link";

// Where Instacart's "back to site" link should point.
const PARTNER_LINKBACK = "https://big-sweat.github.io/meal-prep/";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      "Access-Control-Allow-Origin": allow,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    if (!env.INSTACART_API_KEY) return json({ error: "proxy missing INSTACART_API_KEY" }, 500, cors);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid JSON" }, 400, cors); }

    const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
    if (!lineItems.length) return json({ error: "no line_items" }, 400, cors);

    const payload = {
      title: typeof body.title === "string" && body.title ? body.title : "Mise shopping list",
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

    if (!res.ok) return json({ error: "instacart error", status: res.status, detail: data }, res.status, cors);

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
