# Mise — meal-prep recipe library

Static site, **no build step and no dependencies**. Plain HTML/CSS/vanilla JS,
served as files. Live via GitHub Pages at https://big-sweat.github.io/meal-prep/
— pushes to `main` deploy automatically (there is no CI/build job; what's in the
repo is what ships).

Local preview (any static server works):

```
python -m http.server 8347
```

then open http://localhost:8347. There's a `.claude/launch.json` entry named
`mise-static` for Claude Code previews.

Design rules live in `CLAUDEwebdesign copy (1).md` — follow them for any UI work.
`AGENTS.md` is a short mirror of this file for other agent tools; keep the two
in rough sync when you change the workflow described here.

## Files

**The site**
- `index.html` — the recipe library (the home page). Wires up the filter rail,
  results grid, search box, and three `<dialog>` modals (recipe, weekly plan,
  pre-print ad).
- `styles.css` — all styling. Editorial "prep board" look (see the design doc).
- `app.js` — all recipe-page behavior (~800 lines, one IIFE, `"use strict"`):
  filtering, rendering, serving-scale math with proper fractions, the recipe
  modal, the persisted weekly plan + combined shopping list, live search, and
  the pre-print/PDF interstitial. Constants at the top (`ALLERGENS`, `PROTEINS`,
  `MEALS`, `SUGGEST_CANDIDATES`) define the filter chips.
- `recipes.js` — **the data.** `var RECIPES = [ … ]` (currently 130 recipes:
  108 mains, 22 breakfasts). Everything on the site — filters, suggestions,
  counts, macros — derives from this array. Do not hand-edit it to add recipes;
  use the tool (below).
- `pdf.js` — dependency-free PDF generator for the per-recipe "Download PDF"
  button. Lays a recipe out on US-Letter using the PDF base-14 Courier fonts
  (no embedding, exact wrapping). Brand colors are duplicated here from
  `styles.css`.
- `assets/recipes/<recipe-id>.webp` — optional per-recipe card images, looked up
  by `id` (`recipeImageSrc` in app.js). Not every recipe has one; cards fall
  back gracefully when the file is missing (the `img` onerror hides the frame).
  **Keep these WebP.** They started as 1536×1024 PNGs at ~2.6MB each — 83MB
  total, which made an 87MB APK and shipped multi-megabyte images to phones.
  `tools/optimize-images.js` re-encodes PNG→WebP q80 at the same dimensions
  (−92%, no visible loss since cards render ~400px and the modal ~810px).
  Run it on any photo you add.

**Prep-gear page (affiliate)**
- `products.html` — standalone "Prep Gear" page (linked from the masthead).
  Renders `PRODUCTS` inline; no app.js needed.
- `products.js` — `PRODUCTS` (gear grouped by category) plus `productUrl()`.
  Links are Amazon searches tagged with `AFFILIATE_TAG`. **Monetization:**
  replace `AFFILIATE_TAG` with a real Amazon Associates tag to activate.

**Ads**
- `ads.js` — config for the "before you print" interstitial. While
  `NETWORK_AD_HTML` is empty, the slot shows *house ads* (two random picks from
  `PRODUCTS`). Paste an ad-network embed into `NETWORK_AD_HTML` to run real ads.

**Subscription (Mise Plus)**
- `subscription.js` — `MiseSub`: the ad-free entitlement. `BILLING_ANDROID_KEY`
  / `BILLING_IOS_KEY` are empty, so it runs in **demo mode**: the purchase
  button flips a localStorage flag, charges nothing, and the dialog says so in
  red. Real billing needs a Play Console account ($25) + merchant profile + one
  uploaded build containing the Billing Library + an ACTIVE product; that's why
  demo mode exists. Note (checked against Google's docs, Jul 2026): billing
  **can** be tested on a sideloaded debug APK once those exist — license testers
  bypass the install-source check. The rest of the app only touches
  `isAdFree() / purchase() / restore()`, so swapping in a real SDK shouldn't
  touch app.js.
- Ads gated on it: the in-feed `SPONSORED` ticket every `AD_EVERY` (12) recipes
  in `render()`, and the pre-print interstitial in `showAdThen()`. **Never make
  the ad-free path merely shorter** — subscribers must skip it entirely.

**App download links**
- `apps.js` — `IOS_APP_URL` / `ANDROID_APP_URL`. Both empty as of Jul 2026
  because **nothing is published to either store yet**; the footer block
  (`#app-links`, rendered by `renderAppLinks()` in app.js) stays hidden and
  emits no markup until a URL is set, so the site never shows a dead store link.
  Do not invent URLs here. The buttons deliberately carry **no Apple/Google
  logos** — both companies require their official badge artwork for store links
  and forbid redrawing it; swap to real badges at launch (see `app/README.md`).

**Auth**
- `auth.js` — Supabase sign-in (email/password + Google + Apple OAuth). While
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` are empty it loads nothing external and the
  site falls back to the demo name-only profile. Setup steps are in the file's
  header comment; the Supabase JS SDK is injected from jsDelivr only when
  configured. Ratings/reviews/favorites still live in localStorage either way —
  moving them to Supabase tables (shared across visitors) is the known next step.

**Mobile apps (Android + iOS)**
- `app/` — Capacitor project (app id `com.deadliftdigital.mise`, both
  platforms). The repo root is the source of truth; `app/scripts/sync-web.js`
  copies the web files into `app/www/` (gitignored) and `npm run sync` then runs
  `cap sync` for both. **If you add a new top-level web file, add it to that
  script's `FILES` allowlist or it won't ship in the apps.**
  - `app/android/` — **built and verified** on Android 16. Build output is
    redirected outside OneDrive (see `app/README.md`; OneDrive locks `build/`
    and breaks rebuilds).
  - `app/ios/` — **scaffolded but never compiled**: Apple only allows iOS builds
    on macOS with Xcode. Capacitor 8 uses SPM, so no CocoaPods step. The OAuth
    URL scheme is registered in `ios/App/App/Info.plist`.
- `native.js` (repo root) — iOS + Android adaptations; a no-op on the web
  (`MiseNative.isNative`, `MiseNative.platform`). PDF/print via the OS share
  sheet on both; the back-button handler is scoped to Android. Native OAuth
  (system browser + `com.deadliftdigital.mise://auth` deep link) lives in
  `auth.js`, since it needs the Supabase client.
- **iOS CSS rules worth knowing:** inputs are bumped to 16px inside
  `@supports (-webkit-touch-callout: none)` (iOS-only) because iOS zooms the
  page on any focused input under 16px — do not "tidy" this away. Fixed
  furniture pads by `env(safe-area-inset-*)` and the viewport carries
  `viewport-fit=cover`.

**Docs / meta**
- `README.md` — public-facing readme (recipe count is patched by the tool).
- `recipe-inbox/links.md` — drop-box for recipe URLs (see below).
- `tools/add-recipes.js` — the recipe-ingest tool (see below).

## Cache-busting — do not skip this

Asset links in `index.html` (and `products.html`) carry `?v=N` query strings,
e.g. `app.js?v=9`, `styles.css?v=8`, `recipes.js?v=7`. GitHub Pages sets long
cache headers, so **if you change a file, bump its `?v=N` everywhere it's
referenced**, or returning visitors get a stale cache (this has caused real
breakage — a stale `recipes.js` against fresh HTML). Note `styles.css` is
referenced from *both* HTML files — keep the two versions in step. The
recipe tool bumps `recipes.js?v=` for you; everything else is manual.

## Recipe data schema

Each entry in `RECIPES` (see `tools/add-recipes.js` `REQUIRED` for the
authoritative field list):

```js
{
  id, name, description,            // id is kebab-case, unique
  protein,                          // chicken|beef|pork|turkey|fish|shrimp|tofu|beans|eggs
  meal,                             // "breakfast" | "main" (lunch/dinner)
  cuisine, tags: [],                // tags feed search + difficulty hints
  baseServings, prepMinutes, cookMinutes,
  caloriesPerServing, proteinGrams, carbsGrams, fatGrams,
  fridgeDays, freezerFriendly,
  difficulty,                       // 1 easy / 2 moderate / 3 involved — COMPUTED by the tool
  allergens: [],                    // union of ingredient allergens — COMPUTED by the tool
  ingredients: [ { qty, unit, item, note, allergens: [] }, … ],
  steps: [],
  storageNote,
  sourceUrl                         // original link when imported from the inbox
}
```

- Allergen vocabulary (US big-9): `dairy, eggs, fish, shellfish, tree nuts,
  peanuts, wheat, soy, sesame`. Tag them **per ingredient**; the recipe-level
  `allergens` is exactly the union and is recomputed by the tool.
- Macros must be roughly self-consistent: `4·protein + 4·carbs + 9·fat` within
  20% of `caloriesPerServing` (the tool rejects otherwise).
- `qty` is a number or `null` ("to taste"); the site live-scales it.

## Recipe inbox — "process the recipe inbox"

`recipe-inbox/links.md` is where Jake pastes recipe URLs. When asked to process
it:

1. Read the links under **To add**.
2. Fetch each page and extract the recipe facts: ingredients with quantities,
   servings, times, and method.
3. **Rewrite, don't copy.** Ingredient facts and cooking procedure are fine to
   use; the description, step wording, and any commentary must be written fresh
   in the site's plain cookbook voice (see existing recipes for tone — 1-2
   specific sentences, why it preps well, no marketing fluff). Do not reproduce
   the source page's prose.
4. Build recipe objects in the schema above (match an existing entry
   field-for-field). Include a `sourceUrl` (honest provenance, harmless to the
   app) and a `meal` field: `"breakfast"` or `"main"` — the tool defaults it
   from a `"breakfast"` tag if omitted. Tag every ingredient's big-9 allergens;
   hidden sources matter (soy sauce = soy + wheat, fish sauce = fish, Worcestershire
   = fish, coconut is NOT a tree nut). Adapt to meal-prep: `baseServings` 4 or 6,
   a final portioning step, an honest `storageNote` and `fridgeDays` (2-3 for
   seafood).
5. Save the objects as a JSON array and run: `node tools/add-recipes.js <file>`.
   The tool: enforces the hidden-allergen rules per ingredient (only ever *adds*
   tags), sets `allergens` to the exact union, drops `gluten-free`/`dairy-free`
   tags contradicted by the ingredients, computes `difficulty` with the same
   formula the slider uses, checks macros + id/name collisions + schema basics,
   re-interleaves the library by protein, rewrites `recipes.js`, and patches the
   counts + bumps `recipes.js?v=` in `index.html` and the counts in `README.md`.
   **Fix anything it rejects rather than forcing it** — it writes nothing if any
   check fails.
6. Verify in a browser (count went up, the new recipes open, filters catch their
   allergens), then move the processed links in `links.md` from **To add** to
   **Added** as `- <url> → <recipe-id>`. Leave bad links under To add with a note
   about what went wrong (paywall, not a recipe, single-serving drink, …).
7. Commit and push when Jake asks for it (his usual flow) — that deploys the
   live site.

Recipe data is illustrative demo content with an allergy disclaimer in the
footer; keep allergen tagging **conservative** — over-tag rather than under-tag
when uncertain.
