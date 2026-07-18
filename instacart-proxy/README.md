# Mise → Instacart proxy

The only server-side piece of Mise. Everything else is static files; this exists
solely because Instacart's shopping-list API key is a **secret** and can't ship
in `grocery.js`. The worker holds the key, forwards the browser's ingredient
list to Instacart, and returns the pre-filled-cart URL. It stores nothing.

```
browser (grocery.js)  ──POST {title, line_items}──►  this worker  ──Bearer key──►  Instacart
                      ◄──── { products_link_url } ────                ◄── products_link_url ──
```

Without this deployed, the site still works — the Instacart button falls back to
copying the list and opening instacart.com. Deploy it to turn on one-tap carts.

## What you need first

1. **An Instacart Developer Platform key.** Sign up at
   <https://docs.instacart.com/developer_platform_api> → create an app → copy the
   API key. (There's a dev/sandbox key too; to point at sandbox, change
   `INSTACART_URL` in `worker.js` to `https://connect.dev.instacart.tools/...`.)
2. **A free Cloudflare account** (workers.cloudflare.com). Any serverless host
   works — a Netlify/Vercel function is ~the same 40 lines — but Workers is the
   least fuss and has a generous free tier.

## Deploy (Cloudflare, ~5 min)

```bash
npm install -g wrangler          # Cloudflare's CLI
cd instacart-proxy
wrangler login                   # opens the browser once

# create wrangler.toml (or use the one below)
wrangler deploy                  # publishes worker.js, prints the URL

# set the secret key (NOT committed anywhere):
wrangler secret put INSTACART_API_KEY
# paste your Instacart key when prompted

# optional, once you're an approved Instacart affiliate:
wrangler secret put INSTACART_AFFILIATE
# paste e.g.  aff_id=123&affiliate_platform=idp_partner
```

Minimal `wrangler.toml`:

```toml
name = "myse-instacart"
main = "worker.js"
compatibility_date = "2026-01-01"
```

`wrangler deploy` prints a URL like `https://myse-instacart.<you>.workers.dev`.

## Wire it up

Paste that URL into `grocery.js` at the repo root:

```js
var INSTACART_ENDPOINT = "https://myse-instacart.<you>.workers.dev";
```

Bump `grocery.js?v=N` in `index.html` (cache-busting — see the repo `CLAUDE.md`),
commit, push. Done: the Instacart button now builds a real cart.

## Notes

- **CORS is locked down.** `worker.js` only answers the origins in
  `ALLOWED_ORIGINS` (the live site + `localhost:8347` for local testing). Add
  your own domain there if you move off GitHub Pages.
- **The native app** would call the same worker; its origin differs
  (`capacitor://`/`https://localhost`), so add that to `ALLOWED_ORIGINS` before
  shipping an app build that uses this. Web-first for now.
- **Affiliate income** starts once Instacart approves your live integration as an
  affiliate partner; set `INSTACART_AFFILIATE` then and the commission-tracking
  params ride along on every returned cart URL.
- This directory is **not** bundled into the app and **not** in
  `app/scripts/sync-web.js` — it's server infra, not a web file.
