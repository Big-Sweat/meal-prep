# Mise — meal-prep recipe library (agent notes)

`CLAUDE.md` is the canonical guide — read it first. This is the short version.

Static site, **no build step, no dependencies**. Three pages: `index.html` (the
board — `app.js`), `profile.html` (**"your kitchen"**, the per-account page —
`profile.js`), and `products.html` (affiliate prep gear — `products.js`), over
`styles.css` + `recipes.js` (the data).

Shared modules: `store.js` (`MiseStore` — **the only place a per-user storage
key is written down**, plus the big-9 `ALLERGENS` list; both pages read it),
`plus-ui.js` (`MisePlusUI` — the one upgrade dialog, shared; `require()` is the
gate, and it builds its own markup), `subscription.js` (`MiseSub` — the
entitlement; `isPlus()` is THE gate), `nutrition.js` (pure calorie maths),
`auth.js` (Supabase — demo name-only profile fallback while its keys are empty),
`pdf.js` (recipe PDF), `ads.js`, `apps.js` (store links — both empty because
nothing is published; the footer block hides itself rather than show a dead
link, and the buttons carry no Apple/Google logos on purpose), `native.js`
(iOS + Android adaptations, no-op on web).

**`app.js` binds `index.html`'s DOM at module scope — never load it on another
page.** That's why `profile.js` exists.

Also: `app/` (Capacitor project: `app/android/` builds and runs, `app/ios/` needs
a Mac with Xcode — see `app/README.md`; **add any new top-level web file to
`app/scripts/sync-web.js` or it won't ship in the apps**),
`assets/recipes/<id>.webp` (optional card images — **WebP, not PNG**; run
`tools/optimize-images.js` on any new photo). Live via GitHub Pages at
https://big-sweat.github.io/meal-prep/ — pushes to `main` deploy automatically.
Design rules: `CLAUDEwebdesign copy (1).md`.

Local preview: `python -m http.server 8347` (launch.json name `mise-static`).

**Cache-busting:** asset links in all three HTML files carry `?v=N`. Bump the
version anywhere a file you changed is referenced, or returning visitors get
stale caches. `styles.css` is linked from **all three** HTML files — keep them in
step. This bites during local testing too: a reload will re-run a cached `.js`
while the server has the new one, so a fix looks like it failed.

**Paid vs free:** Plus buys print, PDF, the weekly plan, the calorie target, and
no ads. Free forever: browsing, filters, search, ratings, reviews, favorites,
standing allergies, the whole profile page, and accounts — **never paywall
signup**, it's what a purchase restores into.

**Adding recipes:** don't hand-edit `recipes.js`. Build recipe objects in the
schema (see CLAUDE.md), save as a JSON array, and run
`node tools/add-recipes.js <file>` — it audits allergens, computes difficulty
and the allergen union, checks macros/collisions, merges, and patches counts +
cache version. Fix what it rejects; it writes nothing on failure.

**Recipe inbox** (`recipe-inbox/links.md`): when asked to "process the recipe
inbox", follow the full 7-step workflow in CLAUDE.md — fetch, **rewrite (don't
copy) the prose**, tag big-9 allergens conservatively, adapt for meal prep, run
the tool, verify in a browser, then move links to **Added**. Commit/push only
when Jake asks.
