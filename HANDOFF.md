# Mise — handoff

**Snapshot: 17 July 2026.** Written to hand to a new session. It will rot —
`CLAUDE.md` in this repo is the authoritative, maintained guide, and this file
is only the parts a newcomer needs *first*: what's live, what isn't, and why.
If the two disagree, believe `CLAUDE.md`.

- **Repo:** `github.com/Big-Sweat/meal-prep`
- **Live:** <https://big-sweat.github.io/meal-prep/> — pushes to `main` deploy
  automatically. There is no CI. What's in the repo is what ships.
- **Local:** `python -m http.server 8347` (there's a `.claude/launch.json` entry
  named `mise-static`).

---

## 1. Read this before touching anything

### The tree is clean; everything is merged and live

As of this snapshot `main` is the only meaningful branch: working tree clean,
no open PRs, and everything below is committed, merged, and live. There is **no
"unmerged feature branch" to know about** — that was true in the previous
handoff and no longer is. Still: **`git fetch` + `git status` + `gh pr list`
before assuming anything**, because —

### Other people work in this repo at the same time

Jake merges his own PRs between turns without always saying so, and other agents
/ Codex sessions push too (past branch names: `food-images`, `aside_fixes`,
`codex/*`; commits from `LocoCodo1415`). This has cost real work several times:
uncommitted changes wiped when the tree moved under them; pushes rejected and
hand-rebased; the tree switched onto another branch mid-task; and **two separate
`?v=N` cache-version collisions where two branches independently picked the same
next number and git merged the line with _no conflict_, silently shipping stale
assets.**

**So:** commit as soon as a unit of work is verified. Expect `git push` to be
rejected — `git pull --rebase` and re-verify. After any rebase, **diff your
changed JS/CSS against `origin/main`** — a clean rebase does not mean the `?v=`
numbers are right. Re-read files you didn't just write.

---

## 2. What Mise is

A meal-prep recipe library: a static site (plain HTML/CSS/vanilla JS, **no build
step, no dependencies**) plus a Capacitor Android app (iOS scaffolded, never
compiled) that shares the same code. The repo root is the single source of
truth; `app/scripts/sync-web.js` copies the web files into the app bundle.

**Four pages**, all sharing `styles.css`:
- `index.html` — the board (recipes, filters, search) — `app.js`
- `profile.html` — **"your kitchen"**, the per-account page — `profile.js`
- `log.html` — **"the log"**, weight/lifts/runs — `log.js`
- `products.html` — affiliate prep gear — `products.js`

`app.js` binds `index.html`'s DOM at module scope, so it can **only** run on the
board — that's why `profile.js`/`log.js` exist rather than a shared flag. Shared
logic lives in modules both pages load: `store.js` (the only place per-user
storage keys are written), `plus-ui.js` (the one upgrade dialog), `nutrition.js`
and `progress.js` (pure maths), `subscription.js`, `auth.js`, `native.js`,
`recipe-sync.js`.

**Design** follows `CLAUDEwebdesign copy (1).md` in the repo root. (Trap: a
similarly-named `.docx` sits beside it and is a wrong-file paste from an
unrelated project — ignore it.) The look is a "kitchen prep ticket": flour paper
`#F5F2EA`, olive-black ink `#26291F`, one kale-green accent `#3A6B35`, manila
tape labels `#EAD9A8` (in Permanent Marker), and chile red `#A93B22` reserved
strictly for allergen semantics.

---

## 3. What works (all live)

- **131 recipes**, each with a photo. Filter by allergy (US big-9, tagged
  per-ingredient), protein, ingredient, difficulty, meal type, and **goal**
  (cut/maintain/bulk, by calorie band). Live search. Prominent per-serving
  macros on each card.
- **Serving scaling** with proper fractions (1½ cups, ⅔ tbsp).
- **Weekly plan** with a combined shopping list that aggregates quantities.
- **PDF export** — dependency-free generator (`pdf.js`), PDF base-14 Courier, no
  font embedding.
- **Accounts** — real Supabase auth (email/password + Google tested end-to-end;
  Apple built, waits on the developer account).
- **Ratings, reviews, favorites** — per user, **persisted in Supabase** (RLS
  tables) with localStorage as a write-through cache; they follow a person
  across devices and survive a cache wipe. Ratings/reviews are shared across
  visitors. See `supabase/migrations/` and `store.js`.
- **"Your kitchen" (`profile.html`)** — standing allergies (the one filter saved
  to an account, on by default every visit), the calorie target, your
  favorites, and your ratings & reviews. Free; only the calorie card is gated.
- **"The log" (`log.html`)** — weight, lifts (est. 1RM), runs (pace), with a
  7-day weight trend that also feeds the calorie target. Free. **It is a log,
  not a coach** — no streaks/goals/congrats; always leads with the trend, never
  the last weigh-in. Don't change `progress.js` without reading CLAUDE.md; it
  has tests (`node tools/test-progress.js`).
- **Recipe auto-sync** — the Android app fetches `recipes.json` from the live
  site and picks up new recipes on its **next open** (never mid-session), so
  adding a recipe on the site no longer needs an app rebuild. See §8 and
  `recipe-sync.js`.
- **Android app** — built, release-signed, installed and verified on Jake's
  phone (TCL K33 5G, Android 15). Works fully offline; recipes ship bundled.
- **Phone layout** — board is 2-column on phones (blurb dropped, in the modal
  instead); recipe/plan modal headers pin the tape label + close × to the
  corners so nothing pushes the × off-screen.

---

## 4. What's demo-mode — and the one constant that fixes each

Nothing here is broken. Each waits on an account only Jake can open. Every one of
these files documents its own setup in its header.

| Feature | Constant | File | Blocked on |
| --- | --- | --- | --- |
| Mise Plus billing | `BILLING_ANDROID_KEY` / `BILLING_IOS_KEY` | `subscription.js` | Play Console ($25) |
| App download links | `IOS_APP_URL` / `ANDROID_APP_URL` | `apps.js` | nothing published |
| Real ads | `NETWORK_AD_HTML` | `ads.js` | an ad network |
| Affiliate income | `AFFILIATE_TAG` | `products.js` | Amazon Associates |

**The empty-constant pattern is the map.** Each feature renders nothing, or an
honest demo, until its constant is filled — no dead links, no fake charges.

**Accounts Jake has:** Supabase, Google Cloud OAuth client.
**Accounts he does not:** Play Console, Apple Developer, Amazon Associates, any
ad network. Check before proposing anything that needs one.

**iOS** is configured but has never been compiled — Apple only permits that on
macOS with Xcode. It's a hard constraint, not a gap.

---

## 5. Mise Plus (the paid tier)

`$2.99/month` or `$29.99 once` — same entitlement either way.

- **Paid:** print, PDF download, the weekly plan view, the calorie target, no
  ads. (The calorie target is **live now** — it merged; the previous handoff
  had it stuck on an unmerged branch.)
- **Free forever:** browsing, every filter, search, ratings, reviews, favorites,
  standing allergies, **the whole profile page, the log, and accounts**.

Two deliberate decisions worth not undoing:

1. **Never paywall signup.** An account is the container a purchase restores
   into on a new phone; charging for it strands the ratings/reviews/favorites.
2. **Adding to the plan is free; opening it is gated.** People build the basket,
   then meet the wall where the value actually is (the shopping list).

`MiseSub.isPlus()` is the single entitlement gate. The dialog that sells it
lives in `plus-ui.js`; call sites use `MisePlusUI.require()`, which opens it and
returns `true` when the caller should stop. The calorie-target gate specifically
lives once in `MiseStore.calorieTarget()`, so the board and profile page follow
it automatically. A weigh-in in the log updates the stored weight for free, so
"your target follows your body" costs no new gate.

The old *pre-print* ad interstitial was **deleted** — print is Plus-only and Plus
removes ads, so only people exempt from it could reach it. Don't reintroduce it.
Two ad slots ship now (both suppressed for Plus): the in-feed `SPONSORED` ticket
every 12 recipes, and a separate page-turn interstitial on "Next". (Superseded
note — see AUDIT.md / CLAUDE.md for the current ad policy.)

---

## 6. Facts that were verified, not remembered

Checked against primary sources with adversarial verification. Don't "correct"
these from memory:

- **Mifflin-St Jeor** (`nutrition.js`): `10·kg + 6.25·cm − 5·age`, `+5` male /
  `−161` female. Confirmed digit-for-digit against Am J Clin Nutr 1990;51:241-247
  and the Academy of Nutrition and Dietetics EAL. Activity multipliers 1.2–1.9
  are **convention, not from the paper**, and add more error than the equation.
- **Calorie floors** 1200 (female) / 1500 (male) — bottom of the 2013
  AHA/ACC/TOS ranges. Targets are clamped and say so. Under-18s are refused with
  an explanation, not a validation error.
- **Weight-trend maths** (`progress.js`): a trailing mean lags its window by
  ~half its width, and at the start of a log the window is truncated so it lags
  *less* — comparing two trend points over the calendar gap under-reports the
  rate by ~9% on a month-old log, which would make the safety warning fire late.
  `trend()` returns the window centroid; `change()` measures the rate off that.
  Don't "simplify" it back. `epley1RM` refuses over 10 reps rather than guessing.
- **Play Billing can be tested on a sideloaded debug APK.** License testers
  bypass the install-source check, once the package + an ACTIVE product exist in
  Play Console. Google's words: *"you can sideload apps for testing, even for
  apps using debug builds with debug signatures."*
- **Play Billing is no longer mandatory** post-Epic settlement. At $0.99 it won
  on fees (15% all-in beat Stripe's flat $0.30); at $2.99/$29.99 that flips and
  Stripe is cheaper. We keep Play/RevenueCat for friction, not fees — native
  in-app path + server-side receipt validation a static site can't do.
- **Store badges are not required** to link to either store (checked against both
  companies' docs). If you *do* use them you must use their artwork unmodified —
  which is why there are no Apple/Google logos in this repo.

---

## 7. Traps that have already bitten

- **Bump `?v=N`** on any JS/CSS you change, in **every** HTML file that
  references it — `styles.css` is now in **all four** (`index`, `profile`,
  `log`, `products`). Stale caches have caused real breakage repeatedly,
  including a "fix" that looked done because the browser served the old file,
  and silent version collisions between concurrent branches (see §1). Live
  versions at this snapshot: `styles.css?v=23`, `app.js?v=24`, `recipes.js?v=8`,
  `recipe-sync.js?v=1`.
- **Verify computed style, not the attribute.** A `hidden` attribute can be set
  while the element still renders — an author `display` rule (`.mast-link`)
  silently beat the UA `[hidden]` rule and showed the log link while signed out.
  Caught only via a real-device screenshot, not the DOM check. The fix now in
  place: `[hidden] { display: none !important; }`. Check `getComputedStyle`, not
  `element.hidden`.
- **The phone has a RELEASE build; don't push a debug APK.** A debug APK is
  signature-mismatched and forces an uninstall that wipes the WebView's
  localStorage (favorites, plan, profile, log). Always `assembleRelease`. Before
  `adb install -r`, verify the new APK's cert matches the installed one
  (`apksigner verify --print-certs` on both, diff the SHA-256). `dumpsys
  package | grep signatures=` prints a Java hashCode, **not** a real
  fingerprint — don't compare against that.
- **JS `console.log` does not reach `logcat`** on this phone's release build
  (Capacitor's own native logging does). Never root-caused. To verify on-device
  behavior, write to a file via the Filesystem plugin and `adb pull` it (that's
  how recipe-sync was confirmed).
- **OneDrive fights Gradle.** This repo lives in OneDrive, which opens `build/`
  files to sync while Gradle uses them; rebuilds after the first died. Build
  output is redirected to `%TEMP%/mise-gradle-build`. Moving the repo out of
  OneDrive is the real fix.
- **`local.properties` needs forward slashes** — it's a Java properties file, so
  `C:\Users\...` parses as `C:Users...` and the build dies on `Invalid file
  path`. Also: **no `java` on PATH** — use Android Studio's JDK
  (`JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`).
- **The keystore is irreplaceable.** `app/android/mise-release.jks` +
  `keystore.properties` — gitignored, local only, in OneDrive (which backs them
  up). **Lose it and the app can never be updated.** Rotate the password before
  this is a real product; the current one was generated in a session transcript.
- **Photos stay WebP.** They were 1536×1024 PNGs at ~2.6MB each. `app.js`
  requests `.webp`, so a PNG dropped in silently 404s and hides its frame. Run
  `tools/optimize-images.js` on anything you add.
- **An incremental APK lies about its size.** AGP patches the zip in place; a
  clean build showed 10.7MB where the incremental read 87MB. A web-only change
  can also rebuild in ~2s ("6 executed, 279 up-to-date") — legitimate, but
  verify the fix actually landed by unzipping the APK and grepping, not by the
  build log.

---

## 8. Adding recipes

Don't hand-edit `recipes.js`. Paste URLs into `recipe-inbox/links.md` and ask to
"process the recipe inbox", or build objects and run
`node tools/add-recipes.js <file.json>`. The tool enforces hidden-allergen rules
per ingredient (soy sauce = soy + wheat; coconut is *not* a tree nut), sets
`allergens` to the exact union, computes `difficulty`, checks macros and
collisions, and **writes both `recipes.js` and `recipes.json`** (same data, from
the same string, so they can't drift) plus patches counts + cache versions.
**Fix what it rejects rather than forcing it** — it writes nothing if any check
fails.

`recipes.json` is what makes recipes flow to the installed app automatically
(via `recipe-sync.js`, native-only, data-only fetch — never `eval`, never
`recipes.js`). So: add a recipe, push to `main`, and the app picks it up on next
open. No rebuild needed for recipe-only changes. (A change to app *code* still
needs the full rebuild/reinstall in §on the phone below.)

When importing from a URL: use the *facts* (ingredients, quantities, times) but
**rewrite all prose** — other sites' recipe descriptions are copyrighted.

---

## 9. Best next steps

- **The $25 Play Console account** is still the highest-leverage move: it turns
  on Plus billing, unblocks the app download links, and lets the phone already
  in Jake's hand make real test purchases as a license tester.
- **Profile data is now Supabase-backed** (done, shipped): favorites, allergies,
  the nutrition profile, the log, and ratings/reviews persist in RLS tables with
  localStorage as a write-through cache — cross-device, cache-wipe-proof, and
  ratings/reviews shared across visitors. `store.js` stayed synchronous; tables
  in `supabase/migrations/`. Remaining hardening: a write-through **retry queue**
  (best-effort pushes aren't retried today), and the first-sign-in local→server
  merge is coded but lightly tested.
- **Known small polish, not started:** `.card:hover` lifts a card, and `:hover`
  sticks on touch — so a tapped card stays raised after the modal closes on
  Android. A couple of lines in the phone media query; Jake's aware, deferred.

---

## 10. How Jake works

Fast, iterative, feature at a time. He'll say **"push it"** to push/deploy and
**"call it"** to stop; wait for those rather than assuming. He merges his own
PRs between turns. He wants things **verified, not claimed** — this project has
a habit of things that look done but aren't (invisible images, stale caches, a
"fixed" build reading cached CSS, a `hidden` element that still rendered), so
drive the real thing and show the result rather than reporting success from a
green exit code. When something's genuinely his call (a design fork, an account
he'd have to open), ask; otherwise pick the sensible default and say what you
picked.
