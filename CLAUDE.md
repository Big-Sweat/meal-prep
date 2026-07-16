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
- `app.js` — all **board** behavior (~1200 lines, one IIFE, `"use strict"`):
  filtering, rendering, serving-scale math with proper fractions, the recipe
  modal, the persisted weekly plan + combined shopping list, and live search.
  Constants at the top (`PROTEINS`, `MEALS`, `SUGGEST_CANDIDATES`) define the
  filter chips; `ALLERGENS` comes from `store.js` because the profile page needs
  the same list. **It grabs `index.html`'s DOM at module scope, so it cannot be
  loaded on another page** — that's why `profile.js` exists rather than a flag.
  Inbound `index.html#<recipe-id>` opens that recipe (`openFromHash`), which is
  what the profile page's lists link to.
- `store.js` — `MiseStore`: **the shared data layer, and the only place a
  storage key is written down.** Every per-user key (favorites, ratings,
  reviews, the nutrition profile, standing allergies) plus the big-9 `ALLERGENS`
  vocabulary, so the board and the profile page cannot drift. Pure functions
  over localStorage: pass in `who`, get that person's data — no session state,
  since each page tracks the signed-in user itself. Still the demo layer (it all
  lives in this browser); reimplementing these functions against Supabase tables
  is the known next step, and no caller would change.
- `plus-ui.js` — `MisePlusUI`: the upgrade dialog, **shared by both pages** so
  there is only ever one paywall. It builds its own `<dialog>` on first open, so
  no HTML file carries the markup. `MisePlusUI.require()` is the call-site gate
  (`if (MisePlusUI.require()) return;`), and pages get `onChange(fn)` to redraw
  after a purchase. It subscribes to `MiseSub.onChange`, so an entitlement change
  from *anywhere* redraws — including, once step 4 of `subscription.js` is done,
  a real billing SDK's callback or a store-side refund.
- `profile.html` / `profile.js` — **"your kitchen": the per-account page.**
  Standing allergies, the calorie target, favorites, and your ratings/reviews.
  The masthead's "HI, NAME →" goes here when signed in. See the profile-page
  section below.
- `recipes.js` — **the data.** `var RECIPES = [ … ]` (currently 131 recipes).
  Everything on the site — filters, suggestions, counts, macros — derives from
  this array. Do not hand-edit it to add recipes; use the tool (below).
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

**Subscription (Mise Plus) — the paid tier**
- `subscription.js` — `MiseSub`, the entitlement authority. **`isPlus()` is the
  single gate**; the dialog that sells it lives in `plus-ui.js` and call sites
  use `MisePlusUI.require()`, which opens it and returns true when the caller
  should stop. Two products, same entitlement: `mise_plus_monthly` ($0.99/mo)
  and `mise_plus_lifetime` ($4.99 once).
- **Paid:** print, PDF download, the weekly plan view, the calorie target,
  no ads.
  **Free forever:** browsing, filters, search, ratings, reviews, favorites,
  standing allergies, **the whole profile page**, and **accounts** — never
  paywall signup; it's where a purchase restores to. *Adding* to the plan is
  free on purpose; the wall is on opening it.
- `BILLING_ANDROID_KEY` / `BILLING_IOS_KEY` are empty, so it runs in **demo
  mode**: purchase flips a localStorage flag, charges nothing, and the dialog
  says so in red. Real billing needs a Play Console account ($25) + merchant
  profile + one uploaded build with the Billing Library + ACTIVE products. Note
  (checked against Google's docs, Jul 2026): billing **can** be tested on a
  sideloaded debug APK once those exist — license testers bypass the
  install-source check.
- **One ad slot only:** the in-feed `SPONSORED` ticket every `AD_EVERY` (12)
  recipes in `render()`, honouring `NETWORK_AD_HTML`. The old pre-print
  interstitial was deleted — print is Plus-only and Plus removes ads, so it was
  unreachable. Don't reintroduce it without changing that logic.

**App download links**
- `apps.js` — `IOS_APP_URL` / `ANDROID_APP_URL`. Both empty as of Jul 2026
  because **nothing is published to either store yet**; the footer block
  (`#app-links`, rendered by `renderAppLinks()` in app.js) stays hidden and
  emits no markup until a URL is set, so the site never shows a dead store link.
  Do not invent URLs here. The buttons deliberately carry **no Apple/Google
  logos** — both companies require their official badge artwork for store links
  and forbid redrawing it; swap to real badges at launch (see `app/README.md`).

**Nutrition profile (calorie target)**
- `nutrition.js` — `MiseNutrition`: pure maths, no DOM, no storage, so it can be
  checked on its own. Mifflin-St Jeor BMR × an activity multiplier ± a goal
  delta. **The coefficients were verified against the 1990 paper and the
  Academy of Nutrition and Dietetics EAL — do not "tidy" them.** `10 / 6.25 / 5`
  with `+5` (male) / `−161` (female).
- Health-adjacent, so it is deliberately conservative: targets are **clamped to
  a floor** (1200 kcal female / 1500 male, the bottom of the 2013 AHA/ACC/TOS
  ranges) and say so when clamped; `blocker()` **refuses** to compute for
  under-18s and explains why rather than showing a validation error;
  `warnings()` flags over-65, high/low BMI, athletes, and the sex-neutral
  option. Keep all of that if you touch this.
- The `unspecified` sex constant (−78) is the midpoint and is **not a validated
  equation** — there is no sex-neutral Mifflin. It exists so people who won't
  state a sex aren't blocked; the UI admits the error.
- Stored per user at `mise-nutrition-<id>`. **Plus-gated**, and the gate lives in
  **`MiseStore.calorieTarget(who)` in `store.js`** — one place, for both pages,
  so the card "% OF YOUR DAY" and the profile card follow the entitlement
  automatically. A lapsed subscriber **keeps their saved profile**; the number
  just stops showing until they resubscribe, and the profile page says so in as
  many words. Never delete it on lapse — nobody should have to retype their body.

**The profile page ("your kitchen") — `profile.html` + `profile.js`**
- Four sections plus an identity card: **standing allergies**, the **calorie
  target**, **favorites**, and **your ratings & reviews**. Reached from the
  masthead ("HI, NAME →") when signed in.
- **The page is free and needs only an account** — only the calorie card is
  gated. Do not wall the page: favorites, reviews and accounts are free forever,
  and an account is what a purchase restores into, so a wall here would strand
  the purchase it exists to recover.
- **Sign-in deliberately stays on the board.** `auth.js` sends OAuth back to
  `window.location.pathname`, and Supabase's redirect allowlist is configured
  for the site root — a sign-in button here would bounce off it. Signed out, the
  page just points at the board; **sign-out redirects there** rather than
  leaving a dead page.
- Supabase resolves **asynchronously**, so the page renders a loading state
  first and `MiseAuth.onChange` drives the real render. There's an 8s timeout
  that says "can't reach the sign-in service" rather than spinning forever —
  the apps bundle the recipes for offline use, but auth needs the network.
- **Standing allergies** are the one filter saved to an account: the board loads
  with them on, every visit. Changing a chip on the *board* is session-only and
  never rewrites the account — a temporary "what's this look like without dairy"
  must not un-set an allergy someone lives with. They're the baseline, so they
  don't count toward the filter badge, and **"clear all filters" resets to them
  rather than wiping them**. A favorite that contradicts one is flagged on the
  page, since the board hides it and it would otherwise sit there looking safe.
- Sections render independently (`renderTarget()` etc.) so typing in the calorie
  form doesn't redraw the page. That form re-renders per keystroke and restores
  focus by hand — same trick the old modal used; don't "tidy" it away.

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

Asset links in `index.html`, `products.html` and `profile.html` carry `?v=N`
query strings, e.g. `app.js?v=21`, `styles.css?v=18`. GitHub Pages sets long
cache headers, so **if you change a file, bump its `?v=N` everywhere it's
referenced**, or returning visitors get a stale cache (this has caused real
breakage — a stale `recipes.js` against fresh HTML). Note `styles.css` is
referenced from **all three** HTML files — keep the versions in step. The
recipe tool bumps `recipes.js?v=` for you; everything else is manual.

This bites *during local testing too*, not just in production: a plain reload
will happily re-run a cached `.js` while the server has your new one, so a fix
looks like it didn't work. If local behaviour contradicts the code you just
wrote, check that first — `fetch('file.js?bust=' + Math.random())` and compare
against what the page is actually running.

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
