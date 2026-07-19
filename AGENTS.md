# Mise — meal-prep recipe library (agent notes)

`CLAUDE.md` is the canonical guide — read it first. This is the short version.

Static site, **no build step, no dependencies**. Six pages: `index.html` (the
board — `app.js`), `profile.html` (**"your kitchen"**, the per-account page —
`profile.js`), `log.html` (**"the log"** — weight/lifts/runs — `log.js`),
`forum.html` (**the forum** — threads/replies, standalone — `forum.js`),
`products.html` (affiliate prep gear — `products.js`), and `legal.html` (privacy
& disclosures, static), over `styles.css` + `recipes.js` (the data).

Shared modules: `store.js` (`MiseStore` — **the only place a per-user storage
key is written down**, plus the big-9 `ALLERGENS` list; both pages read it.
Synchronous API, but localStorage is now a **cache** hydrated from Supabase on
sign-in and written through, so profile data — favorites, allergies, nutrition,
log, ratings, reviews — persists across devices and survives a cache wipe; RLS
tables in `supabase/migrations/`),
`plus-ui.js` (`MisePlusUI` — the one upgrade dialog, shared; `require()` is the
gate, and it builds its own markup), `community-ui.js` (`MiseCommunityUI` — the
community-recipe submit/edit + report dialog, shared and self-building;
downscales the photo to WebP in-browser), `moderation.js` (`MiseModeration` —
shared banned-word check that blocks slurs/profanity in recipe text, forum posts
and display names; client UX gate only — the `has_banned_word()` DB trigger in
`20260719000002_content_moderation.sql` is the real fence, **keep its word list
in sync**), `subscription.js` (`MiseSub` — the
entitlement; `isPlus()` is THE gate), `nutrition.js` (pure calorie maths),
`progress.js` (pure trend/1RM/pace maths — **`node tools/test-progress.js`**),
`auth.js` (Supabase sign-in — configured and live; `MiseAuth.client()` backs store.js),
`pdf.js` (recipe PDF), `ads.js` (`NETWORK_AD_HTML` — the shared embed for the
site's **two** ad slots: the in-feed SPONSORED ticket and the page-turn
interstitial), `grocery.js` (`MiseGrocery` — plan → Instacart/Walmart/Amazon
hand-off, Plus-gated, demo until its store ids are set), `apps.js` (store links —
both empty because nothing is published; the footer block hides itself rather
than show a dead link, and the buttons carry no Apple/Google logos on purpose),
`native.js` (iOS + Android adaptations, no-op on web), `recipe-sync.js`
(native-only: fetches `recipes.json` — data only, never `recipes.js`, never
`eval` — so an already-installed app can pick up new recipes without a new
release; applies only at the START of the next open, never mid-session).

Two server-side pieces, both deployed separately from the static bundle:
`supabase/functions/delete-account/` (Edge Function — deletes the caller's own
auth user via the admin key) and `instacart-proxy/` (Cloudflare Worker — holds
the secret Instacart key for `grocery.js`).

**`app.js` binds `index.html`'s DOM at module scope — never load it on another
page.** That's why `profile.js` exists.

**Community recipes** (user-submitted): `store.js` fetches the world-readable
list and the board merges it into `RECIPES`, **mixed in** with house recipes and
flagged with a COMMUNITY stamp (`state.communityOnly` is an optional "just
community" filter), so the modal/plan/reviews/PDF work on them unchanged. Instant
publish + report (a recipe auto-hides once 3 users report it); one uploaded
photo, downscaled client-side and stored in a Supabase Storage bucket. Backend =
`supabase/migrations/20260719000000_community_recipes.sql` (apply in the SQL
editor; it also creates the `recipe-photos` bucket). Posting is **free**;
until the migration is applied the board runs house-only.

**Forum** (`forum.html` + `forum.js`): a standalone page (no `app.js`, no
`recipes.js`) for meal-prep + fitness discussion. Threads + flat replies from
Supabase via `MiseStore` (`loadForumThreads`/`fetchThread`/`createThread`/…),
hash-routed (`#t-<id>`). Reading is public; posting needs an account and the
**first sign-in happens on the board** (OAuth redirect = site root), so
signed-out visitors get a "sign in from the board" prompt. Instant post + report
+ auto-hide, same as community recipes. Backend =
`supabase/migrations/20260719000001_forum.sql` (SQL editor); until applied the
forum shows empty.

Also: `app/` (Capacitor project: `app/android/` builds and runs, `app/ios/` needs
a Mac with Xcode — see `app/README.md`; **add any new top-level web file to
`app/scripts/sync-web.js` or it won't ship in the apps**),
`assets/recipes/<id>.webp` (optional card images — **WebP, not PNG**; run
`tools/optimize-images.js` on any new photo). Live via GitHub Pages at
https://big-sweat.github.io/meal-prep/ — pushes to `main` deploy automatically.
Design rules: `CLAUDEwebdesign copy (1).md`.

Local preview: `python -m http.server 8347` (launch.json name `mise-static`).

**Navigation:** `<nav class="mainnav">` under the masthead on all six pages —
static markup, no JS, no shared module (gating would drag `auth.js` onto
`products.html`/`legal.html`, which load none). Five sections, fixed order: THE
RECIPES · THE FORUM · THE LOG · YOUR KITCHEN · PREP GEAR. **Adding or renaming
one means editing all six files**, and the current page needs
`aria-current="page"` — that attribute is also the styling hook. The current
page wears the recipe card's masking tape (manila, Permanent Marker, same tilt);
that's why every label is wrapped in a `<span>` — the tape styles the span so it
hugs the words instead of filling the 44px touch target, so **keep the span**.
Hover and `:focus-visible` turn a section **bold + ink** (`font-weight: 700`);
the current page is excluded. Weight 700 is in the IBM Plex Mono request for
that hover alone — **change the hover, drop `;700` from all six files.** Plex
Mono is monospaced, so bolding doesn't reflow the row.
Nothing is gated: each destination renders its own signed-out state, so don't
re-hide THE LOG. **profile.html and log.html offer a "Sign in" button that hands
off** to `index.html?signin=1&next=<page>` — the dialog only exists on the board
(OAuth redirect = site root), so `app.js` opens it on arrival and returns them.
`next` rides in sessionStorage (the OAuth round-trip drops the query string),
is checked against a fixed page list (open redirect), and expires after 10 min.
Sections are plain text; only actions
(SHARE A RECIPE, sign-in — `index.html` only) are boxed. Don't put links back
in the `.mast-meta` colophon; eight look-alike chips there is what this replaced.

**Cache-busting:** asset links in all six HTML files carry `?v=N`. Bump the
version anywhere a file you changed is referenced, or returning visitors get
stale caches. `styles.css` is linked from **all six** HTML files — keep them in
step (and `recipes.js` from `index.html` **and** `profile.html`). This bites
during local testing too: a reload will re-run a cached `.js` while the server
has the new one, so a fix looks like it failed.

**The log is a log, not a coach.** No streaks, no goal-weight countdown, nothing
congratulatory; always lead with the 7-day trend, never the last weigh-in. Weight
tracking is a known route into disordered eating and `nutrition.js` already
treats that seriously. See CLAUDE.md before changing anything in `progress.js`.

**Paid vs free:** Plus buys print, PDF, the weekly plan, the calorie target, and
no ads. Free forever: browsing, filters, search, ratings, reviews, favorites,
standing allergies, the whole profile page, **the log**, **posting community
recipes**, **the forum**, and accounts — **never paywall signup**, it's what a purchase restores
into. The log being free costs
nothing: a weigh-in updates the nutrition profile and `calorieTarget()` is
already gated, so "your target follows your body" is a Plus benefit for free.

**Adding recipes:** don't hand-edit `recipes.js`. Build recipe objects in the
schema (see CLAUDE.md), save as a JSON array, and run
`node tools/add-recipes.js <file>` — it audits allergens, computes difficulty
and the allergen union, checks macros/collisions, merges, writes both
`recipes.js` and `recipes.json` from the same data, and patches counts + cache
version. Fix what it rejects; it writes nothing on failure.

**Recipe inbox** (`recipe-inbox/links.md`): when asked to "process the recipe
inbox", follow the full 7-step workflow in CLAUDE.md — fetch, **rewrite (don't
copy) the prose**, tag big-9 allergens conservatively, adapt for meal prep, run
the tool, verify in a browser, then move links to **Added**. Commit/push only
when Jake asks.
