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
  results grid, search box, and four `<dialog>` modals (recipe, weekly plan,
  sign-in, and the page-turn `ad-interstitial`). The Plus dialog is NOT here —
  `plus-ui.js` builds it on first open. (The *old pre-print* interstitial was
  deleted; the page-turn one that ships now is a different slot — see **Ads**.)
  Carries the only `.mast-meta` colophon left (VOL. 02 / count / allergen tags)
  and the nav's two action buttons — see **Navigation** below.
- `styles.css` — all styling. Editorial "prep board" look (see the design doc).
- `app.js` — all **board** behavior (~2300 lines, one IIFE, `"use strict"`):
  filtering, rendering, serving-scale math with proper fractions, the recipe
  modal, the persisted weekly plan + combined shopping list, live search, and
  **community recipes** (user-submitted, fetched by `store.js` and merged into
  `RECIPES` on `onCommunity`). They're **mixed into the board** alongside house
  recipes and flagged with a `.card-flag` COMMUNITY stamp (`state.communityOnly`
  is an optional filter, like favOnly, to show just them). Because they live in
  `RECIPES`, the modal/plan/reviews/PDF all work on them unchanged — the merge
  rebuilds `HAYSTACKS` and, unlike a house-only board, `loadPlan()` no longer
  prunes unknown ids (a community recipe planned before the async fetch lands
  must survive, not be erased).
  Constants at the top (`PROTEINS`, `MEALS`, `SUGGEST_CANDIDATES`) define the
  filter chips; `ALLERGENS` comes from `store.js` because the profile page needs
  the same list. The recipe modal's **"Substitute protein?"** picker doesn't just
  word-swap: `substitutedRecipe` *adapts* the recipe to the new protein — it
  rewrites the cook step's time and doneness for the method that step uses,
  corrects the safe internal temp, inserts any prep the new protein needs (press
  tofu, thaw/pat shrimp, pat fish), recomputes prep/cook minutes, and — when the
  recipe's technique doesn't suit the protein (shrimp in an 8-hour braise) —
  raises a plain-language caution instead of a wrong number. The cooking
  knowledge lives in **`PROTEIN_COOK`** (per-protein doneness cue, safe temp, and
  method→time table): **the temps are USDA safe minimums and the times are
  representative — don't "tidy" them, undercooking is the real risk.** The step
  detection (`stepMethod`/`proteinCookMethod`) is heuristic and was tuned against
  every recipe×protein combo; if you add recipes with unusual step phrasing,
  re-check that swaps still read sensibly. **It grabs `index.html`'s DOM at module scope, so it cannot be
  loaded on another page** — that's why `profile.js` exists rather than a flag.
  Inbound `index.html#<recipe-id>` opens that recipe (`openFromHash`), which is
  what the profile page's lists link to.
- `store.js` — `MiseStore`: **the shared data layer, and the only place a
  storage key is written down.** Every per-user key (favorites, ratings,
  reviews, the nutrition profile, standing allergies) plus the big-9 `ALLERGENS`
  vocabulary, so the board and the profile page cannot drift. Keeps a
  **synchronous** API (pass in `who`, get that person's data — no caller ever
  awaits), but localStorage is now a **cache**, not the source of truth. When a
  real account signs in, `hydrate()` pulls that person's rows from Supabase into
  the cache (merging up any local data on a first sync so nothing's lost) and
  fires `onSync` so the pages redraw; every write updates the cache **and**
  pushes to Supabase in the background. So profile data follows a person across
  devices and survives a cache wipe — same shape as `isPlus()`, a sync cache
  reconciled against an async authority. Public rating aggregates load for
  signed-out visitors too (`loadSummaries`); reviews are fetched per recipe on
  modal open (`fetchRecipeSocial`). **Community recipes** ride the same rails:
  `loadCommunity` fetches the world-readable list (auto-hidden past a report
  threshold) and fires `onCommunity`; `publishRecipe`/`updateRecipe`/
  `deleteRecipe`/`reportRecipe`/`myRecipes` are the author-scoped writes (photo
  uploads go to a Supabase Storage bucket). **The forum** rides the same rails:
  `loadForumThreads` (list + reply-count meta, fires `onForum`), `fetchThread`
  (a thread's replies), and `createThread`/`createReply`/`deleteThread`/
  `deleteReply`/`reportForum`. Tables + RLS live in `supabase/migrations/`
  (see **Profile backend** below). With `SUPABASE_URL` empty it falls back to
  the old browser-only demo layer, unchanged.
- `plus-ui.js` — `MisePlusUI`: the upgrade dialog, **shared by every page** so
  there is only ever one paywall. It builds its own `<dialog>` on first open, so
  no HTML file carries the markup. `MisePlusUI.require()` is the call-site gate
  (`if (MisePlusUI.require()) return;`), and pages get `onChange(fn)` to redraw
  after a purchase. It subscribes to `MiseSub.onChange`, so an entitlement change
  from *anywhere* redraws — including, once step 4 of `subscription.js` is done,
  a real billing SDK's callback or a store-side refund.
- `community-ui.js` — `MiseCommunityUI`: the **community-recipe** submit/edit
  form and the report dialog — a self-building `<dialog>` shared by the board and
  the profile page (same lazy-build pattern as `plus-ui.js`). Downscales an
  uploaded photo to WebP in-browser (canvas, ≤1280px longest side, which also
  strips EXIF) before upload. On a successful publish it fires a
  `mise:recipe-published` DOM event so the open page switches to the Community
  view. Posting is free but needs an account; it no-ops without a signed-in
  Supabase backend. Must be in `sync-web.js`'s FILES list to ship in the apps.
- `moderation.js` — `MiseModeration`: the shared banned-word check (hate slurs +
  profanity) that **blocks** on match in recipe text, forum posts, and display
  names. `check(text)`/`checkAll(...)` return the offending match or null;
  whole-word + a light leetspeak fold (a$$/sh1t/f4g). **This is only the client
  UX gate** — the real fence is the `has_banned_word()` DB trigger (anon key is
  public, so a raw POST bypasses the client). **Its `BODY` word list is
  duplicated in `supabase/migrations/20260719000002_content_moderation.sql` —
  keep the two in sync** (SQL uses `\y` for `\b`, otherwise identical). Loaded on
  index/profile/forum before community-ui.js/forum.js; in `sync-web.js` FILES.
- `profile.html` / `profile.js` — **"your kitchen": the per-account page.**
  Standing allergies, the calorie target, favorites, and your ratings/reviews.
  Reached from the nav's YOUR KITCHEN on any page, or the board's "HI, NAME →"
  when signed in. See the profile-page section below.
- `log.html` / `log.js` — **"the log": weight, lifts and runs.** Free. Does not
  load `recipes.js` (no use for 448KB of recipe data here). See the log section
  below.
- `forum.html` / `forum.js` — **the forum: discuss meal prep + the fitness
  journey.** A standalone page like the log — renders into `#forum`, loads
  `store.js`+`auth.js` (no `recipes.js`, no `app.js`). Threads + flat replies from
  Supabase via `MiseStore` (`loadForumThreads`/`fetchThread`/`createThread`/
  `createReply`/…), navigated by hash (`forum.html#t-<id>` opens a thread).
  **Reading is public; posting needs an account, and the first sign-in is on the
  board** (auth.js's OAuth redirect is the site root — same constraint as
  profile.html), so a signed-out visitor gets a "sign in from the board" prompt.
  Instant post + report + auto-hide moderation, same as community recipes.
- `progress.js` — `MiseProgress`: the log's maths. Pure, no DOM, no storage —
  same deal as `nutrition.js`, and for the same reason. **Checked by
  `node tools/test-progress.js` (37 assertions, no dependencies) — run it if you
  touch this.** The trend/rate maths is subtler than it looks; see below.
- `recipes.js` — **the data.** `var RECIPES = [ … ]` (currently 131 recipes).
  Everything on the site — filters, suggestions, counts, macros — derives from
  this array. Do not hand-edit it to add recipes; use the tool (below).
- `recipes.json` — **the exact same array**, written by the same tool call from
  the same string, so the two files cannot drift. It is not bundled into the
  apps (see `recipe-sync.js` below) — its only consumer is a live fetch from
  the deployed site.
- `recipe-sync.js` — a self-contained IIFE, no exposed API. Closes the gap
  between "the website is always live" and "the app is a snapshot from
  whenever it was last built." Native-only; on the website recipes.js is
  already fresh on every load, so this would just be a second, wasted ~430KB
  download. Fetches `recipes.json` — **data only, `JSON.parse`, never
  `recipes.js`, never `eval`** — this is the app's first-ever runtime fetch of
  remote content, and running fetched code is a materially different risk than
  parsing fetched data; keep that line. **Updates apply only at the START of
  the next app open, never mid-session** — a quiet background check caches
  anything newer, and a synchronous read of that cache (before app.js/
  profile.js build their search index or render) applies it on the *next*
  launch, so the board someone is already looking at can never change under
  them. Diagnostic `console.log` lines are intentional, not debug leftovers —
  WebView forwards `console.log` to `logcat` even in a release build (only
  *remote* DevTools is gated by `debuggable`), and that's the only way to
  verify a deliberately-invisible-to-the-user background process on a real
  release-signed phone.
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

- `legal.html` — standalone "Privacy & Disclosures" page, linked from every
  footer. Static content (no app.js): privacy (what Supabase stores when signed
  in, that ratings/reviews are public, the account-deletion right), the
  affiliate/FTC disclosures, a Myse Plus terms section, and a not-medical-advice
  section. **Keep it in step with what actually ships** — it's the site's only
  privacy statement.

**Prep-gear page (affiliate)**
- `products.html` — standalone "Prep Gear" page (a nav section).
  Renders `PRODUCTS` inline; no app.js needed.
- `products.js` — `PRODUCTS` (gear grouped by category) plus `productUrl()`.
  Links are Amazon searches tagged with `AFFILIATE_TAG`. **Monetization:**
  replace `AFFILIATE_TAG` with a real Amazon Associates tag to activate. While
  it's the placeholder, `productUrl()` omits the `tag=` param rather than ship a
  dead affiliate id.

**Grocery hand-off (from the weekly plan)**
- `grocery.js` — `MiseGrocery`: turns the plan's combined shopping list into a
  store hand-off three ways — Instacart (POSTs the line-items to the proxy
  below, gets a pre-filled-cart URL back), Walmart (per-item search links,
  optionally wrapped in an Impact affiliate template), and Amazon Fresh (tagged
  per-item searches). All three are empty-constant/demo until their id is set
  (`INSTACART_ENDPOINT`, `WALMART_IMPACT`, `AMAZON_TAG`); with none set it falls
  back to copy-the-list. Reached from inside the plan modal, so it's Plus-gated.

**Ads**
- `ads.js` — `NETWORK_AD_HTML`, the shared embed for **both** ad placements.
  While it's empty they show *house ads* (a pick from `PRODUCTS`); paste an
  ad-network embed to run real ads in both. See **Ads (two placements)** below.

**Subscription (Mise Plus) — the paid tier**
- `subscription.js` — `MiseSub`, the entitlement authority. **`isPlus()` is the
  single gate**; the dialog that sells it lives in `plus-ui.js` and call sites
  use `MisePlusUI.require()`, which opens it and returns true when the caller
  should stop. Two products, same entitlement: `mise_plus_monthly` ($2.99/mo)
  and `mise_plus_lifetime` ($29.99 once).
- **Paid:** print, PDF download, the weekly plan view, the calorie target,
  no ads.
  **Free forever:** browsing, filters, search, ratings, reviews, favorites,
  standing allergies, **the whole profile page**, **the log**, and **accounts** —
  never paywall signup; it's where a purchase restores to. *Adding* to the plan
  is free on purpose; the wall is on opening it. The log is free at no cost to
  the tier: it writes weight into the nutrition profile, and `calorieTarget()` is
  already gated, so "your target follows your body" is a Plus benefit for free.
- `BILLING_ANDROID_KEY` / `BILLING_IOS_KEY` are empty, so it runs in **demo
  mode**: purchase flips a localStorage flag, charges nothing, and the dialog
  says so in red. **The RevenueCat Capacitor SDK is wired** behind
  `isPlus`/`purchase`/`restore`/`manage` (reached via
  `Capacitor.Plugins.Purchases`, so the web stays a plain `<script>` and no-ops
  there); a non-empty key flips it live. The **monthly plan opens a 14-day free
  trial** (`SUB_TRIAL_DAYS`; a store free-trial offer live, mirrored locally in
  demo). `BILLING_TEST_KEY` runs the RevenueCat **Test Store** on a NATIVE build
  for dev testing — **never ship it** (a release with a test key can't take real
  money, and RevenueCat refuses a test key in a *release* build anyway, so test
  with a **debug** build). Going live still needs a Play Console account ($25) +
  merchant profile + an uploaded build with the Billing Library + ACTIVE
  products + a RevenueCat project whose entitlement id is `plus`; the
  `subscription.js` header is the runbook. Billing can be tested on a sideloaded
  debug APK once those exist — license testers bypass the install-source check.
- **Ads (two placements), both suppressed for Plus and both honouring
  `NETWORK_AD_HTML`:** (1) the in-feed `SPONSORED` ticket every `AD_EVERY` (12)
  recipes in `render()`, and (2) the page-turn `ad-interstitial` a free reader
  meets on "Next" (fires every turn, by product decision — Jul 2026). *Separate
  from* the old **pre-print** interstitial, which was deleted and must not come
  back (print is Plus-only and Plus removes ads, so it was unreachable).

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
- Five sections plus an identity card: **standing allergies**, the **calorie
  target**, **favorites**, **your recipes** (the community recipes you've posted,
  with edit/delete — real-auth only, via `MiseStore.myRecipes`), and **your
  ratings & reviews**. Reached from the nav (YOUR KITCHEN) on every page, and
  from the board's "HI, NAME →" when signed in.
- **The page is free and needs only an account** — only the calorie card is
  gated. Do not wall the page: favorites, reviews and accounts are free forever,
  and an account is what a purchase restores into, so a wall here would strand
  the purchase it exists to recover.
- **The sign-in dialog deliberately stays on the board.** `auth.js` sends OAuth
  back to `window.location.pathname`, and Supabase's redirect allowlist is
  configured for the site root — a *dialog* here would bounce off it. **Sign-out
  redirects there** rather than leaving a dead page.
- **Signed out, the page still offers a "Sign in" button — it hands off.** It
  links to `index.html?signin=1&next=profile.html`; `app.js` opens the dialog on
  arrival and sends them back here once they're in. (`log.html` does the same
  with `next=log.html`.) The hand-off lives in **`app.js`, outside the
  `if (realAuth)` gate** so it works in demo mode too, and:
  - `next` is parked in **sessionStorage**, not carried in the URL, because the
    OAuth round-trip drops the query string entirely (`redirectTo` is
    `origin + pathname`) — this is what makes Google and email land in the same
    place.
  - It is matched against a **fixed list of the site's own pages**. A raw
    `?next=` would be an open redirect; a hostile one is dropped while
    `signin=1` is still honoured, so the worst a crafted link does is open the
    real sign-in dialog.
  - It is **stamped and expires after 10 minutes**, and is cleared when the
    dialog closes unused. The clock is not belt-and-braces: abandoning at
    Google's consent screen navigates the page away so **no `close` event ever
    fires**, and without it that destination would hijack an unrelated sign-in
    later in the same tab.
  - The button is **not shown when auth is unreachable** — the `unreachable`
    branch already says so, and a sign-in button there would just fail.
- Supabase resolves **asynchronously**, so the page renders a loading state
  first and `MiseAuth.onChange` drives the real render. A **15s** last-resort
  timeout stops it spinning forever (same timer in `profile.js`, `log.js` and
  `forum.js` — change one, change all three). Two things about it are
  deliberate and were got wrong once:
  - **It only fires on a slow-but-alive network.** A genuinely offline device
    fails the jsDelivr script tag fast, and `auth.js`'s `onerror` notifies
    immediately — so a longer wait costs an offline visitor nothing, while 8s
    was routinely outrun by a cold SDK fetch on a thin connection.
  - **It only says "can't reach the sign-in service" when the SDK never
    landed** (`unreachable = !MiseAuth.isReady()`). If the client exists,
    `getSession` is merely slow, and it renders the ordinary signed-out view —
    which `onChange` corrects moments later. It used to claim "can't reach"
    unconditionally, which was both false on a cold load *and* hid the Sign in
    button at exactly the moment someone wanted it.
- **Standing allergies** are the one filter saved to an account: the board loads
  with them on, every visit. Changing a chip on the *board* is session-only and
  never rewrites the account — a temporary "what's this look like without dairy"
  must not un-set an allergy someone lives with. They're the baseline, so they
  don't count toward the filter badge, and **"clear all filters" resets to them
  rather than wiping them**. A favorite that contradicts one is flagged on the
  page, since the board hides it and it would otherwise sit there looking safe.
- Sections render independently (`renderTarget()` etc.) so typing in the calorie
  form doesn't redraw the page. **On a keystroke, only the result updates
  (`updateTargetResult()` rewrites `#nut-output` + the save button) — the input
  DOM is left alone.** It used to call the full `renderTarget()` on every
  keystroke and re-focus by hand, but that rebuilt the `<input>`s mid-typing and
  ate digits/decimals and jumped the caret (`type=number` has no `selectionStart`
  to restore) — badly on mobile. Don't route the input handler back through
  `renderTarget()`. Chip/unit clicks still do a full `renderTarget()` (fine —
  they're not per-keystroke), which is why the weight field shows a rounded
  integer after one.

**The log ("the log") — `log.html` + `log.js` + `progress.js`**
- Weight, lifts and runs. **One typed, append-only log** per person at
  `mise-log-<id>` (`{ id, d, t, … }`, `t` = `weight` | `lift` | `run`), so
  another kind is a new `t` and a new form — not a fourth storage key and a
  migration. **Canonical units are always kg and km**; the toggle only converts
  for display, so switching it can never corrupt history.
- **Free, and the Plus benefit costs no new gate:** a weigh-in writes
  `weightKg` into the nutrition profile, and `MiseStore.calorieTarget()` is
  already gated — so "your target follows your body" is paid for nothing.
  `maybeSyncWeight()` runs on **render**, not just on submit, or the page would
  show a target computed from a weight typed weeks ago while claiming to follow
  the log. It always syncs the *newest* weigh-in, so a backdated entry can't
  overwrite today and a deletion falls back correctly.
- **Tone is deliberate: a log, not a coach.** No streaks, no confetti, no
  goal-weight countdown, nothing congratulatory. Weight tracking is a known
  route into disordered eating and `nutrition.js` already takes that seriously.
  Everything user-facing leads with the **7-day trend, never the last reading** —
  bodyweight swings 1-2kg on water and food alone, which is more than a good
  week of real change. `MiseProgress.warnings()` flags losing faster than ~1% of
  bodyweight/week. Keep all of it.
- **The trend maths has a trap.** A trailing average lags its window by about
  half its width, and at the start of a log the window is truncated so it lags
  *less* — so comparing two trend points and dividing by the calendar gap
  under-reports the rate by ~9% on a month-old log, which would make the safety
  warning fire late. `trend()` therefore returns `at` (the mean date of the
  averaged points — what the average actually describes) and `change()` measures
  `perWeek` off those centroids. Don't "simplify" it back.
- **`epley1RM` refuses over 10 reps** rather than guessing: the formula drifts
  badly and confidently past there. It's a tracking number, and the copy says
  plainly it is **not a lift to attempt**.
- The chart is hand-rolled inline SVG (no build step, no dependencies — same
  call as `pdf.js`). Raw readings faint, trend solid; `role="img"` plus a
  summary, with the history list as the real text alternative.

**Auth**
- `auth.js` — Supabase sign-in (email/password + Google + Apple OAuth). While
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` are empty it loads nothing external and the
  site falls back to the demo name-only profile. Setup steps are in the file's
  header comment; the Supabase JS SDK is injected from jsDelivr only when
  configured. **`MiseAuth.client()` exposes the Supabase client so `store.js`
  can read/write the profile tables under the signed-in user's RLS** (see
  **Profile backend** below): favorites, allergies, the nutrition profile, the
  log, and ratings/reviews are now Supabase-backed and shared across visitors,
  no longer browser-only.
  **Password recovery** lives here too: `resetPassword(email)` sends the
  "set a new password" email (worded so it never confirms whether an address has
  an account) and `updatePassword(pw)` completes it. A page opened from the email
  link is a **temporary recovery session** — `onRecovery(fn)`/the `inRecovery`
  flag hold back the normal signed-in path (via the `PASSWORD_RECOVERY` event and
  a `type=recovery` URL check) so the board shows the "set a new password" form
  instead of quietly signing the user in. The three sign-in dialog views
  (`#auth-real`, `#auth-reset`, `#auth-newpass`) are switched by
  `updateAuthUI(view)` in `app.js`.
  **Email-confirmation landing:** `signUp()` sets `emailRedirectTo` to the board
  URL plus a `?mise_confirmed=1` marker — without an explicit redirect Supabase
  falls back to its dashboard Site URL (the github.io org **root**, which 404s).
  On load `app.js` reads the marker (and any `error`/`error_code` params from an
  expired link) *before* Supabase's async init clears them, then shows a small
  self-dismissing `showToast()` notice: "Email confirmed!" once the code exchange
  signs them in, or a generic "that link didn't work" for an expired/used link.
  The toast is built in JS (no HTML markup) and styled `.toast` in `styles.css`;
  the error variant uses an amber accent, **not `--chile`** (reserved for
  allergens).
  **Account deletion** lives here too: `deleteAccount()` invokes the
  `delete-account` Edge Function (see below) — one of the project's two
  server-side pieces (the other is `instacart-proxy/`), because removing a
  Supabase auth user needs the admin key, which must
  never reach the browser. The profile page's danger zone deletes the auth user
  FIRST (that call is authorized by the live session), then wipes local data via
  `MiseStore.deleteUserData(who)` and signs out; a failed server call deletes
  nothing and offers a retry. In demo mode (no Supabase) it's local-only:
  `deleteUserData` + `clearAccount`. Either way it redirects to the board with a
  `?mise_deleted=1` marker that `app.js` turns into a goodbye toast (same landing
  pattern as `mise_confirmed`, but mode-independent so demo deletes greet too).
- `supabase/functions/delete-account/` — the Edge Function (Deno/TypeScript) plus
  its `README.md` (deploy + security notes) and `supabase/config.toml`. Deployed
  separately with the Supabase CLI, **not** part of the static bundle. Security
  rests on two things: the service_role key stays server-side (auto-injected env
  var, never committed), and the user id comes from the caller's **verified
  token**, never the request body — so a caller can only delete themselves.
  `verify_jwt = false` for this function is deliberate (lets the CORS preflight
  through; the function verifies the token itself). If the project migrates off
  legacy keys later, see the README's note about setting the admin key explicitly.
- `instacart-proxy/` — the project's **second** server-side piece: a small
  Cloudflare Worker (`worker.js` + `wrangler.toml` + `README.md`), deployed with
  `wrangler`, **not** part of the static bundle. It exists only to hold the
  secret Instacart API key server-side: `grocery.js` POSTs it a shopping list,
  it forwards to Instacart with the key and returns the cart URL, storing
  nothing. Security is an origin allowlist that **rejects** unknown origins (a
  browser-only CORS header doesn't stop `curl`), plus body/item/name caps and
  per-field sanitization; add a Cloudflare rate-limiting rule before wiring
  `INSTACART_ENDPOINT` in `grocery.js`. Inert until that endpoint is set.

**Profile backend (Supabase Postgres) — `supabase/migrations/`**
- `20260718000000_profile_backend.sql` — 6 tables + a public aggregate view that
  hold everything `store.js` used to keep only in localStorage: **private**
  (`favorites`, `allergies`, `nutrition_profiles`, `log_entries`) and **shared**
  (`ratings`, `reviews`) plus `recipe_rating_summary` (a `security_invoker` view
  for cheap board aggregates). Applied to the live project via the SQL editor;
  the file is the checked-in record. **Idempotent** (drops each policy before
  recreating) — safe to re-run.
- `20260719000000_community_recipes.sql` — **community recipes.** `user_recipes`
  (world-readable via an RLS policy that auto-hides a recipe once 3 distinct users
  report it, owner-writable), `recipe_reports` (author-private; reporter identity
  never leaks — the count is read through a `security definer`
  `community_report_count(id)` so the read policy can consult it without granting
  anyone `select` on the table), and the **`recipe-photos` Storage bucket** +
  policies (public read; a user writes only under their own `<uid>/` folder).
  Same idempotent, run-in-the-SQL-editor deal. **The bucket must exist for photo
  uploads** — the migration creates it. Until this is applied, `loadCommunity`
  gets a "table not found" error, swallows it, and the board runs house-only.
- `20260719000001_forum.sql` — **the forum.** `forum_threads` + `forum_replies`
  (flat; both world-readable with the same auto-hide-past-3-reports RLS,
  author-writable), `forum_reports` (author-private; count read via
  `security definer` `forum_report_count(kind, id)`), and `forum_thread_meta`
  (a `security_invoker` view: reply count + last activity per thread, for the
  list). Same idempotent SQL-editor deal. Until applied, `loadForumThreads` gets
  a "table not found" error, swallows it, and the forum shows empty.
- `20260719000002_content_moderation.sql` — **content moderation.** The
  `has_banned_word()` function (whole-word + leetspeak match against a slur/
  profanity pattern) plus BEFORE INSERT/UPDATE triggers on `user_recipes`,
  `forum_threads`, `forum_replies` that reject (SQLSTATE 23514) banned content in
  the author name, recipe object, or thread/reply text. **The real enforcement**
  (the client `moderation.js` check is bypassable). **Its pattern is duplicated in
  `moderation.js`'s `BODY` — keep in sync.** Idempotent SQL-editor deal.
- **Security is RLS-only** — the anon key is public, so the policies are the
  whole fence. Private tables: owner-only (`auth.uid() = user_id`), and the anon
  role's default grants are **revoked** so a signed-out request hard-denies
  (42501) rather than relying on RLS to filter to zero. ratings/reviews:
  world-readable, author-writable. Don't loosen these without re-verifying.
- The client talks straight to Postgres (no server) via `MiseAuth.client()`;
  `store.js` does all reads/writes. Account deletion needs no per-table cleanup:
  every table is `on delete cascade` from `auth.users`, so deleting the auth
  user (the Edge Function above) removes all their rows.
- Known v1 gaps: write-through is best-effort (no retry queue — a push that
  fails on a blip isn't retried, though localStorage holds the value until the
  next sync); the first-sign-in local→server merge is coded but lightly tested.
- **Email confirmation is ON**, so you can't create a usable test session by
  `signUp()` alone (no session until confirmed) — test the signed-in path by
  actually signing in.

**Mobile apps (Android + iOS)**
- `app/` — Capacitor project (app id `com.deadliftdigital.mise`, both
  platforms). The repo root is the source of truth; `app/scripts/sync-web.js`
  copies the web files into `app/www/` (gitignored) and `npm run sync` then runs
  `cap sync` for both. **If you add a new top-level web file, add it to that
  script's `FILES` allowlist or it won't ship in the apps.**
  - `app/android/` — **built and verified** on Android 15 (API 35, a TCL
    T513V). Build output is
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
- **The status bar (both platforms) — `--inset-top` in `styles.css`.** The apps
  draw **edge-to-edge**, so the strip behind the status bar is the page's to
  paint. Read the inset through `var(--inset-top)`, never `env()` directly:
  Capacitor's built-in `SystemBars` plugin sets `--safe-area-inset-top` on
  `<html>` for Android and `env()` is the iOS path, so the token is
  `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))` — 0 on the web,
  where every rule below is a no-op. Three pieces work together; changing one
  alone reintroduces a bug that was actually shipped:
  - `body` pads by `--inset-top`, and the 5px rule lives on **`.masthead`, not
    `body`** — on `body` its border painted a dark sliver behind the status bar
    (the one strip that should read as page). This is what Jake reported.
  - `body::before` is a fixed paper strip of `--inset-top` at `z-index: 38`
    (over `.mobile-bar` 30 and `.plan-bar` 35, under the `.rail` drawer 40,
    which pads its own top). body's padding scrolls away; this doesn't. Without
    it the ink filter bar slides under the status bar and Android keeps drawing
    its **dark** icons on near-black — measured, unreadable.
  - `.mobile-bar` sticks at `top: var(--inset-top)` with **no** inset padding.
    It used to be `top: 0` plus `padding-top: env(...)`, which put that padding
    there at every scroll position — once Android reported a real inset the bar
    carried 24px of dead space above "Filter recipes" while sitting mid-page.
  - **Android only reports an inset at all on WebView ≥ 140** with
    `viewport-fit=cover` (Capacitor passes insets through; below that it pads
    the WebView itself and reports 0). Both paths are correct — don't "fix" the
    zero case. Verify on a real device: `adb exec-out screencap` and read the
    pixels, since the top few rows are exactly what's in question.

**Docs / meta**
- `README.md` — public-facing readme (recipe count is patched by the tool).
- `AGENTS.md` — short mirror of this file for other agent tools; keep in sync.
- `HANDOFF.md` — running session-to-session status note (what's live vs
  demo/empty-constant, accounts Jake has, traps). **CLAUDE.md is the authority**;
  HANDOFF is a snapshot and goes stale — re-fetch git before trusting it.
- `AUDIT.md` — the 18 Jul 2026 whole-site audit checklist (findings + which
  waves fixed what).
- `recipe-inbox/links.md` — drop-box for recipe URLs (see below).
- `tools/add-recipes.js` — the recipe-ingest tool (see below).

## Navigation — one band, all six pages

`<nav class="mainnav">` sits directly under the masthead on **every** HTML file
and is **plain static markup — no JS, no shared module**. Five sections, always
in this order: THE RECIPES · THE FORUM · THE LOG · YOUR KITCHEN · PREP GEAR.
`legal.html` is reachable from the footer only, so it carries the band with no
item marked.

- **Adding or renaming a section means editing all six files.** There is no
  `nav.js` on purpose: gating would drag `auth.js` onto `products.html` and
  `legal.html`, which load no JS at all today. Keep the block identical.
- **Mark the current page with `aria-current="page"`** — that attribute *is* the
  styling hook, so a missing one is both an a11y and a visual bug. Subpages no
  longer carry a `.mast-meta` page-name chip; the marker says it instead.
- **The current page wears the card tape** — manila, Permanent Marker, the same
  −1.6deg tilt as the protein flag on a recipe ticket, and it shrinks with them
  under 768px so both read as one roll of tape. Every nav label is therefore
  wrapped in a `<span>`: the tape styles the span so the strip hugs the words
  instead of filling the 44px touch target. **Keep the span** — without it the
  tape becomes a 44px manila slab, and `display: inline-block` on it is what
  makes the tilt and vertical padding apply at all.
- **Hover is bold + ink** (`font-weight: 700`), and `:focus-visible` gets the
  identical treatment — the affordance shouldn't depend on owning a mouse. The
  current page is excluded: it's a marker, not a target, and its tape is
  Permanent Marker, which has no bold but would happily be faked into a smear.
- **Weight 700 is in every page's IBM Plex Mono request for that hover alone.**
  The sheet otherwise tops out at 500, and a synthesised bold smears at 11px.
  **If the hover style ever changes, drop `;700` from the font URL in all six
  files** rather than shipping a font nobody renders. Plex Mono is monospaced,
  so 400 → 700 holds the same advance width and the links either side don't
  shift — a proportional face here would reflow the row on every hover.
- Known, measured, and deliberately not fixed: the 700 face **lazy-loads**, so
  the first nav hover of a first-ever visit briefly renders the Courier New
  fallback (different metrics, so it shifts) until the woff2 lands. After that
  it's an HTTP-cache read and imperceptible. The fixes are worse than the bug —
  a `<link rel="preload">` needs a hardcoded gstatic URL that Google rotates
  (stale = a 404 plus the flash back), and warming it with a hidden glyph
  injects a stray character into the a11y tree.
- **Nothing in the nav is gated.** The log, the forum and your kitchen each
  render their own signed-out state — the log and your kitchen with a **Sign in**
  button that hands off to the board and comes back (see the profile-page
  section) — so a signed-out visitor sees what's there. THE LOG used to be
  hidden until sign-in — that made a *free* feature invisible to exactly the
  people who hadn't signed up. Don't re-hide it.
- **Sections are plain text; only actions are boxed** (`.mast-link`). That split
  is the whole point: eight look-alike bordered chips in `.mast-meta` were what
  made the top right unreadable. Don't put a link back in the colophon.
- **The two action buttons live only on `index.html`** — SHARE A RECIPE
  (`app.js` unhides it once signed in) and `#auth-btn`, because the sign-in
  dialog is on the board (`auth.js` redirects OAuth to the site root).
- Mobile: `.nav-sections` is `display: contents` so links and actions wrap as
  one flow; it becomes a real flex row at 768px. Don't give the actions their
  own row back — that cost 127px of nav above the first recipe.
- **In the apps the same nav is a bottom tab bar** (`.is-native`, bottom of
  `styles.css`). The web keeps the band; only the phone gets tabs. Measured
  before: the first recipe card started 620px down a 360×800 screen, 78% of it;
  after, 290px. Four things about it are load-bearing:
  - **`.nav-sections` is what's fixed to the bottom, not `.mainnav`.** That's
    what makes this need zero HTML: the action buttons are its *sibling*, so
    they stay in flow up top instead of riding down with the tabs, and the five
    pages with no actions get an empty `.mainnav-inner` that collapses itself.
  - **The lift that puts SIGN IN on the wordmark's line is on `.nav-actions`,
    not `.mainnav`.** `.nav-actions` only exists on the board, so the other
    five pages can't get dragged up into their mastheads. Don't move it.
  - **`z-index: 36`** — over `.plan-bar` (35), under the `.rail` drawer (40),
    which is a full-screen overlay and should cover the tabs.
  - **The bar absorbs `env(safe-area-inset-bottom)` itself**, so `.plan-bar`,
    `.apply-btn` and `.footer` clear `--tabbar-h` *plus* that inset and must not
    pad for it a second time.
  - **Every link carries two labels**: `<span class="nav-full">THE RECIPES</span>`
    for the web and `<span class="nav-tab">RECIPES</span>` for the tab bar — a
    ~72px tab can't hold "YOUR KITCHEN" at a legible size. Exactly one is ever
    rendered, and `display: none` keeps the other out of the **accessibility
    tree** too, so a screen reader announces what's on screen rather than both.
    Add a section and you write both labels.
  - Because of that, **the tape rule sets no `display`**. An explicit one there
    would out-specify the `.nav-full` / `.nav-tab` hiding and un-hide the wrong
    label on the current tab. The span is a flex item, so it's blockified
    anyway and the tilt still applies.

## Cache-busting — do not skip this

Asset links in `index.html`, `products.html`, `profile.html`, `log.html`,
`forum.html` and `legal.html` carry `?v=N` query strings (e.g. `app.js?v=37`,
`styles.css?v=35`).
GitHub Pages sets long
cache headers, so **if you change a file, bump its `?v=N` everywhere it's
referenced**, or returning visitors get a stale cache (this has caused real
breakage — a stale `recipes.js` against fresh HTML). Note `styles.css` is
referenced from **all six** HTML files (index, profile, log, products, legal,
forum) — keep the versions in step. The recipe tool bumps `recipes.js?v=` for you (in
both `index.html` and `profile.html`, which both load it); everything else is
manual.

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
   re-interleaves the library by protein, rewrites `recipes.js` **and
   `recipes.json`** (same data, so they can't drift — the JSON file is what
   lets an already-installed app pick up the new recipes; see `recipe-sync.js`),
   and patches the counts + bumps `recipes.js?v=` in **`index.html` and
   `profile.html`** (both load it) and the counts in `README.md`. It also
   enforces a unit whitelist and per-batch id/name uniqueness, and type-checks
   the numeric fields. **Fix anything it rejects rather than forcing it** —
   it writes nothing if any check fails.
6. Verify in a browser (count went up, the new recipes open, filters catch their
   allergens), then move the processed links in `links.md` from **To add** to
   **Added** as `- <url> → <recipe-id>`. Leave bad links under To add with a note
   about what went wrong (paywall, not a recipe, single-serving drink, …).
7. Commit and push when Jake asks for it (his usual flow) — that deploys the
   live site.

Recipe data is illustrative demo content with an allergy disclaimer in the
footer; keep allergen tagging **conservative** — over-tag rather than under-tag
when uncertain.
