# Whole-site audit — 18 July 2026

Branch `site-deep-audit`. Method: seven parallel deep reviews (recipe data,
board code, data/auth/backend, profile+log+maths+PDF, CSS vs the design doc,
the Capacitor apps, docs/copy/legal) plus a live browser pass over all five
pages at desktop and 375px on a real signed-in session. `node
tools/test-progress.js`: **37/37 pass**. Zero console errors, zero 404s, zero
`?v=` mismatches, 131/131 recipes have images.

**Verdict:** the fundamentals are genuinely strong — no XSS (every
user-content sink escapes), the Plus gate holds at every call site, RLS
matches its claims, recipe data is mechanically immaculate (allergen unions
exact on 131/131, macro error median 0.4%, all seafood at 3 fridge days), the
type/palette system is the design doc's own recommendation, and all text
contrast passes AA. The real findings cluster in five places: **the new
Supabase sync layer's merge logic, schema-vs-UI contract gaps, the newest
features missing platform invariants (iOS inputs, Android back button), legal
copy that predates the backend, and doc drift.**

Severity: **P0** user-facing wrong/trust-breaking · **P1** real bug ·
**P2** should fix · **P3** polish/nitpick. Every item independently verified
by a second pass or a runtime repro before landing here.

---

## Suggested fix waves

1. **Wave 1 — web, data integrity + trust (deployable immediately):**
   §1.1–1.4, §2.1–2.3, §3.1–3.3, legal rewrite §6.1. Includes one SQL
   migration Jake must run in the dashboard (stars nullable + length caps).
2. **Wave 2 — app-side (needs `npm run sync` + rebuild):** §4.1–4.6.
3. **Wave 3 — recipe data + tool hardening:** §5.
4. **Wave 4 — docs and brand sweep:** §6.2–6.9.

---

## 1. Store/sync layer (the profile backend)

- [x] **1.1 P1 — Hydrate re-merges every page load and resurrects deletions.** *(done: `mise-synced-<uid>` marker; post-first-sync hydrate is server-wins)*
  `hydratedFor` is in-memory only (store.js:199-256, 79, 263); the local→server
  union re-runs each load with no tombstones, so a favorite/allergy/log
  entry/review deleted on phone A is unioned back by laptop B's next load.
  Fix: persist a per-uid synced-once marker; post-first-sync hydrate is
  server-wins wholesale; writes remain the only upward path.
- [x] **1.2 P1 — Server-wins hydrate reverts newer local data after a failed
  push.** *(done: nutrition keeps the newer of savedAt vs updated_at; local-newer re-pushes)* Nutrition + ratings branches (store.js:213-216, 228-238) never
  compare `updated_at` (the select at :183 doesn't even fetch it). **Live-
  confirmed:** profile weight 89.81 kg (=198.0 lb, stale server) vs newest
  weigh-in 79.37 kg (=175.0 lb); board + profile computed the calorie target
  ~125-200 kcal high from a 10 kg-stale weight; only log.html self-heals
  (`maybeSyncWeight` runs on its render). Fix: fetch `updated_at`, keep
  whichever side is newer, stamp local writes; plus §1.5.
- [x] **1.3 P1 — Star-less reviews are silently destroyed.** *(migration `20260718120000_review_constraints.sql` written — Jake must run it in the SQL editor)* UI supports
  review-without-rating (app.js:161-163, render at 1117-1118) but
  `reviews.stars` is `NOT NULL` (migration :108); push 23502s (only logged),
  local cache shows it posted, next `fetchRecipeSocial` erases it. Fix
  (migration): drop NOT NULL — the 1-5 CHECK passes NULL. Surface push
  failures.
- [x] **1.4 P2 — No length caps on `reviews.body`/`author`/`recipe_id`.** *(same migration + render truncation in app.js)*
  Unbounded text; RLS permits own-row PATCH to multi-MB; every visitor
  downloads it (store.js:293); junk `recipe_id` rows inflate the summary every
  visitor fetches unfiltered (store.js:276). Fix (same migration):
  `char_length(body) <= 1000`, `author <= 64`, `recipe_id <= 64`; truncate at
  render; consider `.in("recipe_id", knownIds)` for summaries.
- [x] **1.5 P3 — `syncNutritionWeight` pushes unconditionally on every log
  render** *(done: early-return when current)* (store.js:526-534; log.js:292) — churn + widens the §1.2 race.
  Early-return when `p.weightKg === kg`.
- [x] **1.6 P3 — Double hydrate on load** *(done: in-flight guard)* (auth.js:106-131 notifies twice;
  guard set only on completion, store.js:557/561/263). In-flight flag.
- [ ] **1.7 P3 — `push.favorites`/`allergies` are delete-then-insert**
  (store.js:122-135) — a drop between the two leaves the server list empty
  until next union. Upsert + targeted deletes.
- [x] **1.8 P3 — `deleteUserData` misses `mise-log-units-<who>`** *(done: wipes log-units, tombstones, and the synced marker; `mise-plan` decision still open)*
  (store.js:323-347 vs log.js:31,65); also decide whether the global
  `mise-plan` (app.js:182) should survive account deletion on a shared
  browser.
- [ ] **1.9 P3 — Demo-mode rating aggregates broken** (store.js:362-364 reads
  only server-fetched SUMMARY_KEY; with SUPABASE_URL empty a demo rating never
  shows in card averages). CLAUDE.md claims demo parity.
- [ ] **1.10 P3 — `log_entries.id` is a global PK** (migration :57) — a
  guessed id can be squatted by another account, making the victim's push fail
  silently forever. `primary key (user_id, id)`.
- [ ] **1.11 P3 — `calorieTarget` gate fails open** if subscription.js ever
  isn't loaded (store.js:450). Fail closed.
- [ ] **1.12 P3 — Old clients rewrite the filtered log** (store.js:499-521):
  unknown-`t` rows are dropped then written back on any add/delete —
  contradicts the documented "new kind = new `t`" growth path. Write back
  unfiltered ± the change.

## 2. Board (app.js + index.html)

- [x] **2.1 P1 — Modal opened before auth resolves never updates.** *(done: `refreshModalSocial()` on auth/onSync + `openAuth` no-ops signed-in; live-verified)*
  `openFromHash` runs synchronously at eval (app.js:2059); the async SDK
  always loses the race, `fetchRecipeSocial` no-ops once (null client) and is
  never retried; `onChange`/`onSync` re-render only the grid (1305-1331). The
  profile page's favorite links reproduce this 100%: signed-in users get
  "SIGN IN TO RATE & REVIEW". Bonus: clicking that button while signed in
  opens an **empty** auth dialog (`updateAuthUI` hides every view when
  `profile` is set, 1146-1147). Fix: re-render the open modal's social
  section + re-fetch on auth/sync arrival; make `openAuth` no-op when signed
  in.
- [x] **2.2 P2 — Auth events reset session filter chips.** *(done: uid-change guard; signed-out onSync no longer touches chips either)* Every Supabase
  event (`TOKEN_REFRESHED` ~hourly, `SIGNED_IN` on tab refocus) funnels to
  `applyStandingAllergies()` + full `render()` (auth.js:113-131 →
  app.js:1305-1314, 1484-1493), reverting session chip changes mid-browse.
  Guard: only reset when the uid actually changed.
- [x] **2.3 P2 — Stale `fetchRecipeSocial` callback clobbers the wrong
  modal** *(done: same-recipe-still-open guard on both fetch sites)* (app.js:1003-1006): no still-current guard; recipe A's late
  response overwrites open recipe B, or throws if closed. Bail unless same id
  still open.
- [ ] **2.4 P2 — Search re-renders everything per keystroke** with per-card
  `ratingSummary` + `calorieTarget` JSON.parses (~4 parses × cards, image
  churn; worst in Show-all). Debounce ~120 ms; hoist reads per render pass.
- [ ] **2.5 P2 — Interstitial fires on every page turn** (app.js:506-578) —
  live-verified: browsing 5 pages = 4 full-screen ads + in-feed tickets.
  Product call: first turn per session only, or every Nth. (Also §6.2 —
  CLAUDE.md still says the interstitial class was deleted.)
- [ ] **2.6 P3 — `formatQty` renders "0"** for small scaled quantities — 19
  live rows (e.g. 0.25 tsp ÷ 6 servings → "0 tsp black pepper"). Floor at
  "⅛" / "pinch".
- [ ] **2.7 P3 — Broken `\d` escape in the beef swap regex** (app.js:34:
  `"\\(\d+% lean\\)"` → dead branch, runtime-verified "(93% lean)" survives
  into swapped steps).
- [ ] **2.8 P3 — `swapWords` renames broth/stock** ("beef broth" → "chicken
  broth" in steps while the ingredient list keeps beef broth; verified on
  beef-barbacoa-bowls step 2). Exclude broth/stock context.
- [ ] **2.9 P3 — No diacritic folding in search** ("jalapeno" misses
  "jalapeño"). NFD-strip both sides.
- [ ] **2.10 P3 — Un-ticking a standing allergy is invisible**
  (app.js:298-305 counts only additions): badge 0, no "clear all", board
  silently includes an allergen the account excludes. Count symmetric
  difference from baseline.
- [ ] **2.11 P3 — Ingredient spans concatenate in copy/AT**
  (app.js:824-827, also 1610-1617): grid-spaced visually, but clipboard gets
  "2 lbboneless…". Literal space between spans — zero-risk.
- [ ] **2.12 P3 — Hash change while already on the board doesn't open the
  modal** (load-only handling). Add a `hashchange` listener.
- [ ] **2.13 P3 — A11y batch:** hash-/plan-opened modals drop focus to body
  on close (openerBtn null); pager rebuild destroys the focused button (plan
  stepper at 1780-1781 shows the right pattern); h1→h3 jump (index ~360);
  `#mobile-count` lacks the live region desktop `#count` has; mobile rail
  overlay isn't focus-trapped; auth dialog `aria-labelledby` points at the
  demo-only heading — announces "Set up your prep profile" over the real
  sign-in (index.html:191 vs 238; swap target per view).
- [ ] **2.14 P3 — SEO batch:** no canonical, no OG/Twitter meta (shares
  render bare — live-verified), no theme-color, no JSON-LD Recipe markup.
  Cheap wins for a public content site.
- [ ] **2.15 P3 — Small stuff:** `landing.errorDesc` unused (1284);
  re-rating never updates the review row's stars (store.js:371-377); demo
  `upsertReview` matches by display name so two local "Sam"s collide
  (store.js:394-395); `openModal` lacks the `showModal` guard
  `openInterstitial` has; never-subscribed users see lapsed-subscriber copy
  ("Resubscribe / Bring it back") on the profile calorie card.

## 3. Auth, entitlement, backend services

- [x] **3.1 P1 — Supabase SDK injected unpinned** *(done: pinned 2.110.7 + sha384 SRI + crossorigin + onerror)* (auth.js:93, jsDelivr
  `@2`, no SRI, no onerror): supply-chain exposure on every load + silent
  dead sign-in if the CDN is unreachable (only profile.html has a timeout).
  Pin exact version + `integrity` + `crossorigin` + onerror notice.
- [x] **3.2 P1 (pre-wiring) — Instacart worker is callable by anyone** *(done in code: 403 unknown origins, body/item/name caps, field sanitization, no detail leak; CF rate rule + redeploy when wiring the endpoint)*
  (worker.js:32-51): disallowed origins are processed anyway (fallback header,
  no rejection), no rate limit, no size/item caps, and error `detail` leaks
  upstream responses. Must fix before `INSTACART_ENDPOINT` goes live: 403
  unknown origins, cap items (~200) + body size, validate item shape, add a
  CF rate rule.
- [x] **3.3 P1 (pre-app-release) — delete-account CORS misses Capacitor
  origins** *(done in code, both files; Edge Function needs a CLI redeploy before the next app build)* (index.ts:27-30 vs `https://localhost` / `capacitor://localhost`):
  in-app account deletion — which both stores require — always fails in the
  built apps. Add both origins to the function and the worker.
- [ ] **3.4 P3 — Recovery gating one-load-deep + substring match**
  (auth.js:41 `indexOf("type=recovery")` matches crafted params; abandoning a
  recovery leaves a persisted session that quietly signs in next visit).
  Parse params properly; sign out abandoned recoveries.
- [ ] **3.5 P3 — Native deep-link exchange has no `.catch`** (auth.js:84-86):
  expired link = silent dead end + unhandled rejection.

## 4. The apps (Capacitor)

- [x] **4.1 P1 — Android back button exits the app from an open ad.** *(done: ad-interstitial in the list + a generic dialog[open] sweep so future dialogs can't regress it)*
  native.js:25 dialog list lacks `"ad-interstitial"` (index.html:176); every
  free user who paginates then presses back quits the app from inside an ad.
  Fix: `document.querySelector("dialog[open]")` instead of a hardcoded list.
- [x] **4.2 P1 — iOS 16px input rule missing for every profile/log field** *(done: nut-fields, log-form date/text/number/select, protein-swap added, type-qualified to outrank base rules; CSSOM-verified)*
  (styles.css:2904-2917 covers board/auth only; `.nut-fields input` 15px
  :1824, `.log-form` inputs/selects 13px :2257, `.protein-swap select` 12px
  :1043): iPhone focus-zooms with no zoom-back — a documented invariant the
  newer forms shipped without. Add them to the @supports block.
- [x] **4.3 P2 — recipe-sync applies any cached copy unconditionally** *(done: bundle fingerprint stamped into cache entries — mismatched = app updated = cache dropped; corrupt/legacy entries removed; 2MB cap; 18-assertion node harness passes incl. the round-trip)*
  (recipe-sync.js:58-64; "newer" is never checked against the bundle): an app
  update built ahead of the site deploy has its new recipes silently reverted
  by the cache every launch. Stamp recipes.json with a generated date and
  compare; invalidate cache when bundled data changes. Also: remove corrupt
  cache entries on validation failure; add a size cap before parse/setItem.
- [x] **4.4 P2 — `allowBackup="true"`** *(done: false, with the why in a comment)* (AndroidManifest.xml:5): WebView
  localStorage — Supabase session token included — rides device backups.
  Disable or add backup rules before store launch.
- [x] **4.5 P2 — Launcher branding still "Mise"** *(done: capacitor.config ×2, strings.xml, Info.plist, and the two web share strings; identifiers untouched)* — capacitor.config.json:3,
  android strings.xml:3-4, iOS Info.plist CFBundleDisplayName — while the web
  is Myse. (Identifiers — `com.deadliftdigital.mise`, product ids, storage
  keys, `Mise*` globals — stay.) Plus the two user-visible web strings:
  Instacart cart title app.js:1663, share title app.js:1761.
- [x] **4.6 P2 — Runbook prices wrong** *(done: $2.99/$29.99; also fixed the stale "Untested on a device" gap, the MISE block quote, the one-ad-slot claim, and apps.js's stale debug-APK header; auth.js:74 comment folded in from 4.7)* (app/README.md:196-197: $0.99/$4.99
  vs the real $2.99/$29.99 everywhere else) — following it creates mispriced
  live store products. Also §6: stale "Untested on a device" + debug-APK
  claims contradicted elsewhere in the same file.
- [ ] **4.7 P3 — products/legal ship without native.js** (default WebView
  back behavior, inconsistent); consider adding for consistency. auth.js:74
  "Android only:" comment is wrong (code correctly runs on iOS too).

## 5. Recipe data + tools

- [x] **5.1 P1 — Sausage hidden-filler policy applied inconsistently** *(done: wheat+dairy tagged on all 5 via a new permanent tool rule, label-check note normalized onto each, contradicted gluten-free/dairy-free tags dropped)* (5
  recipes): turkey-sausage-and-peppers has the label-check note but no tags;
  country-breakfast-bowls, chicken-sausage-and-veggie-sheet-pan,
  chicken-sausage-breakfast-hash, chorizo-sweet-potato-breakfast-skillet have
  neither. Per the over-tag mandate: tag wheat+dairy or at minimum copy the
  note to all five.
- [x] **5.2 P1 — Tag errors that mislead filters:** *(done — all three classes)* `vegetarian-adjacent` on
  chicken-caprese-orzo-bowls (search "vegetarian" surfaces a chicken recipe);
  `no-cook` on 3 recipes that cook (mediterranean-breakfast-boxes,
  smoked-salmon-breakfast-boxes, harvest-chicken-salad → `no-reheat`);
  `under-30-min` false on shrimp-fried-rice + blackened-tilapia (35 min →
  `under-40-min`).
- [x] **5.3 P2 — Unit "c" on 5 carbonara ingredients** *(done: normalized + a unit whitelist now hard-fails in the tool)* splits the shopping
  list ("1 cup + 1 c grated parmesan" — runtime-verified). Normalize to
  "cup"; add a unit whitelist to the tool.
- [x] **5.4 P2 — Macros:** *(done: PB-oats 520/16/64/23, souvlaki 650/54/60/18 — both self-consistent)* peanut-butter-banana-overnight-oats understated
  ~20-25% (≈520/P16/C64/F23 vs stated 410/14/52/16);
  greek-chicken-souvlaki-bowls ~15% light (≈650-700 vs 560) — recompute both.
- [x] **5.5 P2 — `freezer-friendly` tag missing on 34 of 91** *(done: backfilled)*
  `freezerFriendly:true`** (searching "freezer" misses them; storageNote isn't
  in the search haystack). Backfill from the field, or append the field to the
  haystack in app.js.
- [x] **5.6 P2 — Taxonomy hygiene:** *(done: 20 recased + 8 "-inspired" merged; family→kid-friendly; high-protein fixed both directions; 3 storage-note pairs differentiated)* 20 lowercase cuisines (full list in the
  recipe report); "-inspired" duplicates (Thai/Thai-inspired etc.);
  kid-friendly (11) vs family-friendly (2) merge; high-protein missing on 3
  ≥40 g mains; 3 duplicated boilerplate storageNote pairs.
- [x] **5.7 P2 — add-recipes.js gaps:** *(done: in-batch dup guard, numeric/boolean checks, extended allergen rules incl. sausage/pesto/tortilla/shellfish/fish/bread classes, unit whitelist, profile.html ?v bump; rejection smoke-tested)* duplicate ids *within one batch* pass
  (:109-114); numeric fields never type/range-checked (`"15"` passes and
  renders "1530 MIN"; qty ≤ 0 passes; baseServings 0 divides); hidden-allergen
  backstop misses lobster/scallop/clam/mussel, trout/sardine/mackerel,
  bread/bun/pita/naan/udon/ramen/wonton, macadamia/brazil, and pesto
  (pine nuts + parmesan); no unit whitelist; bumps `recipes.js?v=` in
  index.html only while **profile.html also loads recipes.js** — next ingest
  skews the two pages (the exact stale-cache class CLAUDE.md warns about).
- [x] **5.8 P3 — optimize-images.js:** *(done: per-file try/catch + JPEG/case-insensitive; test-progress 37→46 assertions incl. `at`, windowDays, 1%-boundary both sides, same-day dupes, zero-span; pdf.js qty column capped; carbonara sourceUrl canonical)* one corrupt PNG aborts the batch (no
  per-file try/catch); only lowercase `.png`; JPEGs silently ignored.
  test-progress.js gaps: `at` never asserted directly, no 1%-boundary case,
  no `windowDays` override, no same-day duplicates. pdf.js: qty column >16
  chars breaks `hang()` alignment (cosmetic). carbonara sourceUrl is a
  `/wprm_print/` endpoint — swap for the canonical page.

## 6. Copy, legal, docs, design system

- [x] **6.1 P0 — legal.html materially misstates where data lives** *(done: rewritten + Myse Plus & not-medical-advice sections + deletion right + date; log.html footer reworded)*
  (:45-76, "Last updated 17 July" — one day before the backend shipped):
  claims favorites/ratings/reviews/allergies/nutrition/log stay in the
  browser and clearing site data removes them; in fact Supabase stores all of
  it for signed-in users, ratings/reviews are **world-readable**, and only
  account deletion removes server rows. Also missing: subscription terms
  (price/trial/renewal/store-managed cancellation), a general not-medical-
  advice section, the account-deletion right. Same false claim on
  log.html:38 ("YOUR LOG LIVES IN THIS BROWSER"). Rewrite + bump the date;
  reword the log footer.
- [ ] **6.2 P1 — CLAUDE.md's ad policy is backwards** ("One ad slot only…
  don't reintroduce the interstitial" — it shipped; an obedient agent would
  delete live behavior). Also stale in HANDOFF.md:159, ads.js:1-5, and
  app.js:388-390 (which contradicts :507 twenty lines later).
- [ ] **6.3 P1 — CLAUDE.md missing four repo artifacts entirely:**
  grocery.js, legal.html, instacart-proxy/ (":285 the only server-side code"
  is now false), HANDOFF.md; cache-busting section says four HTML files (five);
  "the tool bumps recipes.js?v= for you" is index-only (§5.7). AGENTS.md
  mirrors all the same gaps.
- [ ] **6.4 P1 — README.md describes the pre-Supabase site** (name-only
  sign-in, "storage layer in app.js", hand-append recipes — contradicting
  CLAUDE.md's own "use the tool"); feature list omits plan/PDF/profile/log/
  Plus/gear/grocery. Title still "Mise". Rewrite.
- [ ] **6.5 P2 — Design-token discipline:** `--chile` used for 8
  non-allergen things (contract at styles.css:10 says allergens only — either
  fix the decorative uses or amend the contract); the danger-zone red
  `#A93122` is **1.06:1 from chile** — visually identical, defeating its own
  stated purpose (shift the family or drop the pretense); error-toast accent
  tape-on-ticket 1.39:1 (invisible — needs ~3:1 amber); unselected stars
  1.48:1 (use `--faded`); focus ring kale-on-ink 2.35:1 on dark controls
  (two-color ring).
- [ ] **6.6 P2 — Tap targets below the doc's 44px floor on touch tablets:**
  the ≤767px fix doesn't cover 768-1366 (iPads get 36-38px fav/plan/chips);
  sub-44 at all widths: toast-close 28, mast-link 26, stars 34, suggest 34,
  nut-unit 34, search-clear/view-btn/plan-remove 40, ios-tease-close ~24.
  Gate compact sizes on `(hover:hover) and (pointer:fine)` instead of width.
- [ ] **6.7 P2 — Safe-area gaps:** `.mobile-bar` (sticky top) has no
  `env(safe-area-inset-top)`; landscape notch list omits `.kitchen`
  (profile/log) and `.legal-main`. Paid print output includes the
  Instacart/Walmart/Amazon buttons + commission note as dead ink
  (styles.css:2946-2953 hide list) — add `.shop-send/.store-btns/
  .store-status/.store-note/.shop-go`; decide whether reviews belong in a
  printed recipe.
- [ ] **6.8 P2 — Products page ships placeholder affiliate tags**
  (`tag=YOUR-AFFILIATE-TAG-20` in every live Amazon URL): omit the param
  while AFFILIATE_TAG is placeholder, matching the empty-constant pattern
  everywhere else. Also unify disclosure voice (Myse/we/I across
  products.html:31-37, legal.html:34-39, app.js:1634-1636).
- [ ] **6.9 P3 — Dead/redundant CSS list** (unmatchable `.rail.open ~ *`
  :623; overridden `.search-box` :217; four redundant `[hidden]` rules; dead
  5th grid track in ≤479 `.modal-actions` stealing ~48px from SAVE/ADD;
  `.chip` overflow-wrap only ≥1024 — long custom chips can side-scroll the
  mobile rail); token census (`#F4F8F0` ×9 → `--on-kale`; un-tokenized
  `--ticket`; 9-hex unnamed danger family); 28 font sizes on a half-pixel
  ladder (drift: gear h3 19px vs card h3 20px); `.shop-link`
  `display:contents` can't show a focus ring (older Safari drops it from the
  a11y tree); "5 ft 12 in" height rounding + write-back drift
  (profile.js:281 — add the inch===12 carry); favorites clash flags stale
  after an allergy chip toggle (profile.js:175-185 — also call
  renderFavorites); unreachable flag never cleared on late auth
  (profile.js:660-665, log.js:622-627); iOS two-press delete stays armed
  (blur never fires — add a timer); unspecified-sex floor uses 1200 (design
  call: the file's conservative stance argues for 1500 or an explicit
  caveat); "MYSE — DEMO BUILD" footer accuracy now that accounts/storage are
  real (Jake's call); HANDOFF says Android 15, CLAUDE.md + app README say 16
  — one is wrong; comment-rot sweep (profile.js:528-530 "no server copy",
  log.js:282-283, subscription.js:1 header, ~18 "Mise" dev headers);
  recipe-inbox has one unprocessed TikTok link.

---

*Full per-area reports (with complete failing-id lists and contrast tables)
live in the audit session's agent transcripts; this file is the working
checklist distilled from them.*
