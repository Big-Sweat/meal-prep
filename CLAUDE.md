# Mise — meal-prep recipe library

Static site (no build step): `index.html` + `styles.css` + `app.js` + `recipes.js`
(the data) + `pdf.js` (recipe PDF download). Live via GitHub Pages at
https://big-sweat.github.io/meal-prep/ — pushes to `main` deploy automatically.
Design rules live in `CLAUDEwebdesign copy (1).md` — follow them for any UI work.
Local preview: `python -m http.server 8347` (launch.json name `mise-static`).

**Cache-busting:** asset links in index.html carry `?v=N`. Bump the version for
any file you change, or returning visitors get stale caches.

## Recipe inbox — "process the recipe inbox"

`recipe-inbox/links.md` is a drop-box where Jake pastes recipe URLs. When asked
to process it:

1. Read the links under **To add**.
2. Fetch each page and extract the recipe facts: ingredients with quantities,
   servings, times, and method.
3. **Rewrite, don't copy.** Ingredient facts and cooking procedure are fine to
   use; the description, step wording, and any commentary must be written fresh
   in the site's plain cookbook voice (see existing recipes for tone — 1-2
   specific sentences, why it preps well, no marketing fluff). Do not reproduce
   the source page's prose.
4. Build recipe objects in the recipes.js schema (match an existing entry
   field-for-field). Include a `sourceUrl` field with the original link
   (harmless to the app, honest provenance). Tag every ingredient's big-9
   allergens — hidden sources matter (soy sauce = soy + wheat, fish sauce =
   fish, coconut is NOT a tree nut). Adapt the recipe to be meal-prep friendly:
   baseServings 4 or 6, a final portioning step, an honest storageNote and
   fridgeDays (2-3 for seafood).
5. Save the objects as a JSON array and run: `node tools/add-recipes.js <file>`.
   It verifies allergen tags (rule-based), recomputes the union, scores
   difficulty, checks macros and collisions, merges into recipes.js, and
   patches counts + cache version in index.html and README.md. Fix anything it
   rejects rather than forcing it.
6. Verify in a browser (count went up, the new recipes open, filters catch
   their allergens), then move the processed links in `recipe-inbox/links.md`
   from **To add** to **Added** as `- <url> → <recipe-id>`. Leave bad links
   under To add with a note about what went wrong (paywall, not a recipe, ...).
7. Commit and push when Jake asks for it (his usual flow) — that deploys the
   live site.

Recipe data is demo content with an allergy disclaimer in the footer; keep
allergen tagging conservative (over-tag rather than under-tag when uncertain).
