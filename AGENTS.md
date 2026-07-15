# Mise — meal-prep recipe library (agent notes)

`CLAUDE.md` is the canonical guide — read it first. This is the short version.

Static site, **no build step, no dependencies**: `index.html` + `styles.css` +
`app.js` + `recipes.js` (the data). Extras: `pdf.js` (recipe PDF download),
`products.html` / `products.js` (affiliate prep-gear page), `ads.js` (pre-print
interstitial config), `auth.js` (Supabase auth config — demo profile fallback
while its keys are empty), `assets/recipes/<id>.png` (optional card images). Live via
GitHub Pages at https://big-sweat.github.io/meal-prep/ — pushes to `main` deploy
automatically. Design rules: `CLAUDEwebdesign copy (1).md`.

Local preview: `python -m http.server 8347` (launch.json name `mise-static`).

**Cache-busting:** asset links in `index.html`/`products.html` carry `?v=N`.
Bump the version anywhere a file you changed is referenced, or returning
visitors get stale caches. `styles.css` is linked from both HTML files.

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
