# Myse — a meal-prep recipe library

A static site for planning a week of batch cooking. 131 recipes across
nine protein categories, all tagged for the US big-9 allergens, filterable and
scalable, with an optional account that follows you across devices.

Live at https://big-sweat.github.io/meal-prep/ — pushes to `main` deploy
automatically (GitHub Pages; there is no build step, so what's in the repo is
what ships).

## Run it

Any static server works. From this folder:

```
python -m http.server 8347
```

then open http://localhost:8347. (There is also a `.claude/launch.json`
entry named `mise-static` for Claude Code previews.)

## What it does

- **Filter what you can and can't eat** — hide every recipe containing any of
  the US big-9 allergens (tagged per-ingredient, including hidden sources like
  soy sauce = soy + wheat, and independently audited); narrow by protein, by
  meal, by difficulty, by goal; or type ingredients you want to cook with. Live
  search across names, descriptions, cuisines, tags, and ingredients.
- **Serving scaling** — a global "servings to prep" default plus a per-recipe
  stepper that live-scales every quantity with proper fractions (1½ cups, ⅔ tbsp).
- **Weekly plan + shopping list** — add recipes to a plan and get one combined,
  de-duplicated shopping list, with a one-tap hand-off to Instacart, Walmart, or
  Amazon Fresh.
- **Per-recipe PDF and print**, laid out dependency-free.
- **Accounts (real, optional)** — email/password or Google/Apple sign-in via
  Supabase. Favorites, standing allergies, your nutrition profile and log, and
  your ratings/reviews persist server-side and follow you across devices;
  ratings and reviews are shared publicly. Signed out, everything stays in your
  browser. Browsing, filtering, search, ratings, reviews, favorites, the profile
  page, and the log are all free forever.
- **"Your kitchen"** (`profile.html`) — standing allergies, an optional
  Mifflin-St Jeor calorie target, your favorites, and your ratings/reviews.
- **"The log"** (`log.html`) — weight, lifts, and runs, leading always with the
  7-day trend rather than the last reading. A weigh-in keeps the calorie target
  current. Deliberately a log, not a coach.
- **Prep gear** (`products.html`) — an affiliate list of the kit a meal-prep
  kitchen actually uses.
- **Myse Plus** — an optional paid tier ($2.99/month with a 14-day free trial,
  or $29.99 once) that unlocks print, PDF, the weekly-plan view, and the calorie
  target, and removes ads. Billing runs through the mobile app stores
  (RevenueCat); it is not yet live, so the site runs in a no-charge preview mode.
- **Mobile apps** — a Capacitor project under `app/` wraps the same site for
  Android and iOS, with the recipe library bundled for offline use.

## Files

The repo root is the site. `index.html` / `styles.css` / `app.js` are the
board; `store.js` is the shared data layer and `auth.js` the Supabase sign-in.
`recipes.js` / `recipes.json` hold the recipe data (131 recipes). **Don't
hand-edit the recipe data** — build recipe objects in the documented schema and
run `node tools/add-recipes.js <file>`, which audits allergens, computes
difficulty, checks macros, and writes both files from the same source so they
can't drift. `CLAUDE.md` is the full guide to the codebase.

## Note

Recipe data is illustrative content. Anyone with a severe allergy should verify
actual product labels. The calorie target is an estimate, and nothing on the
site is medical advice.
