// Add new recipes to the Mise library.
//
// Usage: node tools/add-recipes.js <new-recipes.json>
//
// Input: a JSON array of recipe objects in the recipes.js schema (difficulty
// optional - it is computed here). The script:
//   1. enforces hidden-allergen rules per ingredient (only ever ADDS tags)
//   2. sets recipe.allergens to the exact union of ingredient allergens
//   3. drops gluten-free/dairy-free tags contradicted by the ingredients
//   4. computes difficulty from the same formula the site's slider uses
//   5. checks macros, id/name collisions, and schema basics
//   6. merges, re-interleaves by protein, rewrites recipes.js
//   7. patches the recipe counts and bumps the cache version in index.html,
//      and updates the counts in README.md
//
// After running: verify in a browser, then commit and push.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'recipes.js');
const INDEX = path.join(ROOT, 'index.html');
const README = path.join(ROOT, 'README.md');

const input = process.argv[2];
if (!input) { console.error('usage: node tools/add-recipes.js <new-recipes.json>'); process.exit(1); }
const ADD = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(ADD) || !ADD.length) { console.error('input must be a non-empty JSON array'); process.exit(1); }

const ALLER = ['dairy','eggs','fish','shellfish','tree nuts','peanuts','wheat','soy','sesame'];
const PROT = ['chicken','beef','pork','turkey','fish','shrimp','tofu','beans','eggs'];
const REQUIRED = ['id','name','description','protein','cuisine','tags','baseServings','prepMinutes','cookMinutes',
  'caloriesPerServing','proteinGrams','carbsGrams','fatGrams','fridgeDays','freezerFriendly','allergens',
  'ingredients','steps','storageNote'];

/* ---- hidden-allergen rules (substring tests on lowercase item names) ---- */
const has = (i, s) => i.includes(s);
const RULES = [
  { a: 'soy', test: i => has(i,'soy sauce') || has(i,'tamari') || has(i,'tofu') || has(i,'tempeh') || has(i,'edamame') || has(i,'miso') || has(i,'hoisin') || has(i,'soybean') },
  { a: 'wheat', test: i => (has(i,'soy sauce') && !has(i,'tamari')) || has(i,'hoisin') || has(i,'pasta') || has(i,'spaghetti') || has(i,'penne') || has(i,'rigatoni') || has(i,'shells') || has(i,'orzo') || has(i,'couscous') || has(i,'panko') || has(i,'breadcrumb') || has(i,'soba') || has(i,'gnocchi') || has(i,'farro') || has(i,'seitan') || has(i,'barley') || has(i,'flour tortilla') ||
      (has(i,'flour') && !has(i,'chickpea') && !has(i,'almond') && !has(i,'rice') && !has(i,'corn') && !has(i,'coconut') && !has(i,'oat') && !has(i,'tapioca')) ||
      (has(i,'noodle') && !has(i,'rice') && !has(i,'glass')) ||
      (has(i,'vermicelli') && !has(i,'rice')) },
  { a: 'dairy', test: i => (has(i,'butter') && !has(i,'peanut butter') && !has(i,'almond butter') && !has(i,'sunflower') && !has(i,'cocoa butter')) || has(i,'ghee') || has(i,'cheese') || has(i,'cheddar') || has(i,'mozzarella') || has(i,'parmesan') || has(i,'feta') || has(i,'monterey') || has(i,'yogurt') ||
      (has(i,'milk') && !has(i,'coconut milk') && !has(i,'almond milk') && !has(i,'oat milk') && !has(i,'soy milk')) ||
      (has(i,'cream') && !has(i,'cream of tartar') && !has(i,'coconut cream') && !has(i,'cashew')) ||
      (has(i,'crema') && !has(i,'cashew')) },
  { a: 'eggs', test: i => (has(i,'egg') && !has(i,'eggplant')) || has(i,'mayo') || has(i,'aioli') },
  { a: 'fish', test: i => has(i,'fish sauce') || has(i,'worcestershire') || has(i,'salmon') || has(i,'tuna') || has(i,'cod ') || i === 'cod' || has(i,'tilapia') || has(i,'anchov') || has(i,'white fish') || has(i,'mahi') || has(i,'halibut') },
  { a: 'shellfish', test: i => has(i,'shrimp') || has(i,'oyster sauce') || has(i,'prawn') || has(i,'crab') },
  { a: 'peanuts', test: i => has(i,'peanut') },
  { a: 'tree nuts', test: i => has(i,'cashew') || has(i,'almond') || has(i,'pecan') || has(i,'walnut') || has(i,'pistachio') || has(i,'pine nut') || has(i,'hazelnut') },
  { a: 'sesame', test: i => has(i,'sesame') || has(i,'tahini') },
];

const HANDS_OFF = ['one-pan','one-pot','sheet-pan','slow-cooker'];
const fixes = [];
const problems = [];

for (const r of ADD) {
  for (const k of REQUIRED) if (r[k] === undefined) problems.push((r.id || r.name || '?') + ': missing field ' + k);
  if (r.protein && !PROT.includes(r.protein)) problems.push(r.id + ': bad protein "' + r.protein + '"');
  if (!/^[a-z0-9-]+$/.test(r.id || '')) problems.push((r.id || '?') + ': id must be kebab-case');
  if (!Array.isArray(r.ingredients) || r.ingredients.length < 4) problems.push(r.id + ': too few ingredients');
  if (!Array.isArray(r.steps) || r.steps.length < 3) problems.push(r.id + ': too few steps');

  for (const ing of r.ingredients || []) {
    if (ing.qty !== null && typeof ing.qty !== 'number') problems.push(r.id + ': non-numeric qty on "' + ing.item + '"');
    ing.allergens = ing.allergens || [];
    for (const a of ing.allergens) if (!ALLER.includes(a)) problems.push(r.id + ': unknown allergen "' + a + '"');
    const item = String(ing.item || '').toLowerCase();
    for (const rule of RULES) {
      if (rule.test(item) && !ing.allergens.includes(rule.a)) {
        ing.allergens.push(rule.a);
        fixes.push(r.id + ': added "' + rule.a + '" to "' + ing.item + '"');
      }
    }
  }
  const union = [...new Set((r.ingredients || []).flatMap(i => i.allergens))];
  if (union.slice().sort().join(',') !== [...(r.allergens || [])].sort().join(',')) {
    fixes.push(r.id + ': recipe allergens set to union: ' + (union.join(', ') || '(none)'));
    r.allergens = union;
  }
  r.tags = (r.tags || []).filter(t => {
    if (t === 'gluten-free' && r.allergens.includes('wheat')) { fixes.push(r.id + ': dropped gluten-free tag'); return false; }
    if (t === 'dairy-free' && r.allergens.includes('dairy')) { fixes.push(r.id + ': dropped dairy-free tag'); return false; }
    return true;
  });

  let raw = r.ingredients.length + 1.5 * r.steps.length + 0.4 * r.prepMinutes;
  if (r.tags.some(t => HANDS_OFF.includes(t))) raw -= 3;
  r.difficulty = raw <= 26 ? 1 : raw <= 31 ? 2 : 3;

  if (r.meal !== 'breakfast' && r.meal !== 'main') {
    r.meal = r.tags.includes('breakfast') ? 'breakfast' : 'main';
  }

  const est = 4 * r.proteinGrams + 4 * r.carbsGrams + 9 * r.fatGrams;
  if (Math.abs(est - r.caloriesPerServing) / r.caloriesPerServing > 0.2) {
    problems.push(r.id + ': macros inconsistent (4P+4C+9F = ' + est + ' vs ' + r.caloriesPerServing + ' cal)');
  }
}

/* ---- merge ---- */
const src = fs.readFileSync(SITE, 'utf8');
const existing = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
const ids = new Set(existing.map(r => r.id));
const names = new Set(existing.map(r => r.name.toLowerCase()));
for (const r of ADD) {
  if (ids.has(r.id)) problems.push('id already exists: ' + r.id);
  if (names.has((r.name || '').toLowerCase())) problems.push('name already exists: ' + r.name);
}

if (fixes.length) console.log('auto-fixes:\n  ' + fixes.join('\n  '));
if (problems.length) { console.error('PROBLEMS (nothing written):\n  ' + problems.join('\n  ')); process.exit(1); }

const all = existing.concat(ADD);
const groups = {};
for (const r of all) (groups[r.protein] = groups[r.protein] || []).push(r);
const order = ['chicken','beef','tofu','fish','turkey','pork','shrimp','beans','eggs'];
const interleaved = [];
let added = true;
while (added) {
  added = false;
  for (const p of order) { const g = groups[p]; if (g && g.length) { interleaved.push(g.shift()); added = true; } }
}
if (interleaved.length !== all.length) throw new Error('interleave lost recipes');

const total = interleaved.length;
const body = '/* Mise recipe data - ' + total + ' recipes. Generated + allergen-audited. difficulty: 1 easy, 2 moderate, 3 involved (scored from ingredients, steps, prep time). */\n' +
  'var RECIPES = ' + JSON.stringify(interleaved, null, 2) + ';\n';
fs.writeFileSync(SITE, body);

/* ---- patch counts + cache version in index.html and README.md ---- */
let html = fs.readFileSync(INDEX, 'utf8');
html = html.replace(/<span>\d+ RECIPES<\/span>/, '<span>' + total + ' RECIPES</span>');
html = html.replace(/">\d+ of \d+<\/p>/, '">' + total + ' of ' + total + '</p>');
html = html.replace(/Showing \d+ of \d+ recipes/, 'Showing ' + total + ' of ' + total + ' recipes');
html = html.replace(/recipes\.js\?v=(\d+)/, (m, v) => 'recipes.js?v=' + (parseInt(v, 10) + 1));
fs.writeFileSync(INDEX, html);

let readme = fs.readFileSync(README, 'utf8');
readme = readme.replace(/\d+ recipes across/, total + ' recipes across');
readme = readme.replace(/recipe data \(\d+ recipes\)/, 'recipe data (' + total + ' recipes)');
fs.writeFileSync(README, readme);

console.log('added ' + ADD.length + ' recipe(s): ' + ADD.map(r => r.id).join(', '));
console.log('library total: ' + total + ' | recipes.js, index.html, README.md updated');
console.log('next: verify in a browser, then commit and push');
