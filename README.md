# Mise — a meal-prep recipe library (demo)

A static demo site for planning a week of batch cooking. 130 recipes across
nine protein categories, all tagged for the US big-9 allergens.

## Run it

Any static server works. From this folder:

```
python -m http.server 8347
```

then open http://localhost:8347. (There is also a `.claude/launch.json`
entry named `mise-static` for Claude Code previews.)

## What it does

- **Allergy filter** — pick any of the US big-9 allergens (dairy, eggs, fish,
  shellfish, tree nuts, peanuts, wheat/gluten, soy, sesame) and every recipe
  containing one is hidden. Each recipe's allergens were tagged per-ingredient
  (including hidden sources like soy sauce = soy + wheat) and independently
  audited.
- **Protein filter** — show only chicken, beef, pork, turkey, fish, shrimp,
  tofu, beans & legumes, or eggs.
- **Ingredient filter** — type ingredients you want to cook with; recipes must
  contain all of them.
- **Serving scaling** — a global "servings to prep" default, plus a per-recipe
  stepper that live-scales every ingredient quantity (with proper fractions:
  1½ cups, ⅔ tbsp, ...).

## Files

- `index.html` / `styles.css` / `app.js` — the site (no build step, no dependencies)
- `recipes.js` — the recipe data (130 recipes). To add more, append objects with
  the same shape; the filters, suggestions, and counts all derive from the data.
  Keep `allergens` equal to the union of the ingredients' allergen tags.

## Note

Recipe data is illustrative demo content. Anyone with a severe allergy should
verify actual product labels.
