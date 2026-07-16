# Mise — handoff

**Snapshot: 16 July 2026.** Written to hand to a new session. It will rot —
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

### Two branches, diverged

| Branch | Contents |
| --- | --- |
| `main` | everything below **except** the calorie target. This is what's live. |
| `profiles` | the nutrition profile + its Plus gate. Pushed to `origin/profiles`, **deliberately unmerged** — Jake asked for it to stay there. Not live. |

They have diverged (2 commits each way), so merging is a real merge, not a
fast-forward. The working tree is currently on `profiles`.

To ship the calorie target: `git checkout main && git merge profiles`, push.
Otherwise leave HEAD where it is.

### Other agents work in this repo at the same time

Commits from `LocoCodo1415` and PR merges (`food-images`) land mid-task. This has
cost real work three times: uncommitted changes were wiped when the tree moved
under them; two pushes were rejected and needed hand-resolved rebases; and the
tree was switched onto `profiles` mid-task, so two commits landed somewhere I
didn't expect and I reported a wrong hash as a result.

**So:** commit as soon as a unit of work is verified. Expect `git push` to be
rejected — `git pull --rebase` and re-verify. Run `git branch` and `git status`
before assuming anything about where you are. Re-read files you didn't just
write.

---

## 2. What Mise is

A meal-prep recipe library: a static site (plain HTML/CSS/vanilla JS, **no build
step, no dependencies**) plus Capacitor Android and iOS apps that share the same
code. The repo root is the single source of truth; `app/scripts/sync-web.js`
copies the web files into the app bundles.

**Design** follows `CLAUDEwebdesign copy (1).md` in the repo root. (Trap: a
similarly-named `.docx` sits beside it and is a wrong-file paste from an
unrelated project — ignore it.) The look is a "kitchen prep ticket": flour paper
`#F5F2EA`, olive-black ink `#26291F`, one kale-green accent `#3A6B35`, manila
tape labels `#EAD9A8`, and chile red `#A93B22` reserved strictly for allergen
semantics.

---

## 3. What works

- **131 recipes**, each with a photo. Filter by allergy (US big-9, tagged
  per-ingredient), protein, ingredient, difficulty, meal type. Live search.
- **Serving scaling** with proper fractions (1½ cups, ⅔ tbsp).
- **Weekly plan** with a combined shopping list that aggregates quantities
  across recipes.
- **PDF export** — a dependency-free generator (`pdf.js`) using the PDF base-14
  Courier fonts, so no font embedding.
- **Accounts** — real Supabase auth. Email/password and Google both tested
  end-to-end. Apple's button is built and waits on the developer account.
- **Ratings, reviews, favorites** — per user, currently in localStorage.
- **Prep-gear page** — affiliate product page (`products.html`).
- **Android app** — built, release-signed, installed and verified on a real
  phone (TCL K33 5G, Android 15). Works fully offline.

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

`$0.99/month` or `$4.99 once` — same entitlement either way.

- **Paid:** print, PDF download, the weekly plan view, the calorie target
  (on the `profiles` branch), no ads.
- **Free forever:** browsing, every filter, search, ratings, reviews, favorites,
  **and accounts**.

Two deliberate decisions worth not undoing:

1. **Never paywall signup.** An account is the container a purchase restores
   into on a new phone; charging for it strands the ratings/reviews/favorites.
2. **Adding to the plan is free; opening it is gated.** People build the basket,
   then meet the wall where the value actually is (the shopping list).

`isPlus()` is the single gate. Call sites use `requirePlus()`, which opens the
upgrade dialog and returns `true` when the caller should stop.

The old pre-print ad interstitial was **deleted** — print is Plus-only and Plus
removes ads, so only the people exempt from it could reach it. Don't reintroduce
it without changing that logic. The in-feed `SPONSORED` ticket (every 12 recipes)
is now the sole ad slot.

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
- **Play Billing can be tested on a sideloaded debug APK.** The common belief
  that you must install from Play is wrong: license testers bypass the
  install-source check, once the package and an ACTIVE product exist in Play
  Console. Google's words: *"you can sideload apps for testing, even for apps
  using debug builds with debug signatures."*
- **Play Billing is no longer mandatory** post-Epic settlement — but at $0.99 it
  still wins: Play takes 15% all-in; Stripe's flat $0.30 alone is ~30%.
- **Store badges are not required** to link to either store (checked against both
  companies' docs). If you *do* use them you must use their artwork unmodified —
  which is why there are no Apple/Google logos in this repo.

---

## 7. Traps that have already bitten

- **Bump `?v=N`** on any JS/CSS you change, in *both* `index.html` and
  `products.html` (they share `styles.css`). Stale caches have caused real
  breakage twice — including a "fix" that appeared to work because the browser
  was serving the old file.
- **OneDrive fights Gradle.** This repo lives in OneDrive, which opens `build/`
  files to sync while Gradle is still using them; every rebuild after the first
  died. Build output is redirected to `%TEMP%/mise-gradle-build`. Moving the repo
  out of OneDrive is the real fix.
- **`local.properties` needs forward slashes.** It's a Java properties file, so
  `C:\Users\...` silently parses as `C:Users...` and the build dies with a
  misleading `Invalid file path`.
- **The keystore is irreplaceable.** `app/android/mise-release.jks` +
  `keystore.properties` — gitignored, local only, currently in OneDrive (which at
  least backs them up). **Lose it and the app can never be updated.** Rotate the
  password before this is a real product; the current one was generated in a
  session transcript.
- **Photos stay WebP.** They were 1536×1024 PNGs at ~2.6MB each — 82MB total, an
  87MB APK, and multi-megabyte images shipped to phones. `tools/optimize-images.js`
  converts; run it on anything you add. Note `app.js` requests `.webp`, so a PNG
  dropped in silently 404s and hides its frame.
- **An incremental APK lies about its size.** AGP patches the zip in place and
  leaves dead space; a clean build showed 10.7MB where the incremental read 87MB.

---

## 8. Adding recipes

Don't hand-edit `recipes.js`. Paste URLs into `recipe-inbox/links.md` and ask to
"process the recipe inbox", or build objects and run
`node tools/add-recipes.js <file.json>`. The tool enforces hidden-allergen rules
per ingredient (soy sauce = soy + wheat; coconut is *not* a tree nut), sets
`allergens` to the exact union, computes `difficulty`, checks macros and
collisions, and patches counts + cache versions. **Fix what it rejects rather
than forcing it** — it writes nothing if any check fails.

When importing from a URL: use the *facts* (ingredients, quantities, times) but
**rewrite all prose** — other sites' recipe descriptions are copyrighted.

---

## 9. Best next step

**The $25 Play Console account** is the highest-leverage move available: it turns
on Plus billing, unblocks the app download links, and lets the phone already in
Jake's hand make real test purchases as a license tester.

After that, the obvious open thread: ratings/reviews/favorites still live in
`localStorage`, so they aren't shared between visitors. Moving them to Supabase
tables is the known next step, and the auth to do it is already working.

---

## 10. How Jake works

Fast, iterative, feature at a time. He'll say "push it" and expect it live
shortly after. He wants things **verified, not claimed** — this project has a
habit of things that look done but aren't (invisible images, stale caches, a
"fixed" build that was reading cached CSS), so drive the real thing and show the
result rather than reporting success from a green exit code.
