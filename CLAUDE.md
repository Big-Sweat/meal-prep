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
- `assets/recipes/<recipe-id>.png` — optional per-recipe card images, looked up
  by `id` (`recipeImageSrc` in app.js). Not every recipe has one; cards fall
  back gracefully when the file is missing.

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

**Auth**
- `auth.js` — Supabase sign-in (email/password + Google + Apple OAuth). While
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` are empty it loads nothing external and the
  site falls back to the demo name-only profile. Setup steps are in the file's
  header comment; the Supabase JS SDK is injected from jsDelivr only when
  configured. Ratings/reviews/favorites still live in localStorage either way —
  moving them to Supabase tables (shared across visitors) is the known next step.

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
