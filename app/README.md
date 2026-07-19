# Mise — Android + iOS app

A Capacitor shell around the Mise web app. The files in the **repo root are the
single source of truth**: edit the site as normal, then `npm run sync` here to
pull those exact files into both apps. There is no second copy of the recipes,
the filters, or the scaling math to maintain.

All 131 recipes ship **inside the app** (~7MB with photos), so browsing,
filtering, scaling, and the weekly plan work with no network at all — verified
on Android with airplane mode on. With a connection, `recipe-sync.js` quietly
checks for recipes added to the site since this build and applies them the
*next* time the app opens (never mid-session) — see CLAUDE.md.

- App ID: `com.deadliftdigital.mise` (both platforms)
- App name: Mise

| | Android | iOS |
| --- | --- | --- |
| Project | `app/android/` | `app/ios/` |
| Status | **built and run** on Android 15 (API 35) | **scaffolded, never compiled** |
| Needs | Android Studio (installed) | **a Mac with Xcode** |

## Build and run — Android

```bash
cd app
npm install          # first time only
npm run sync         # copy the web app in + sync native projects
npm run open         # opens the project in Android Studio
```

In Android Studio: pick a device or emulator and press Run. To produce an
uploadable file: **Build → Generate Signed App Bundle** (create a keystore when
prompted and *keep it safe* — it's the only way to update the app later).

After any change to the website files, re-run `npm run sync`.

### Building from the command line

Android Studio writes `android/local.properties` for you when you open the
project. To build without opening it, that file must exist and point at the SDK:

```
sdk.dir=C:/Users/jake/AppData/Local/Android/Sdk
```

**Use forward slashes.** It's a Java properties file, where `\` is an escape
character — `C:\Users\jake\…` silently parses as `C:Usersjake…` and the build
dies with a misleading `java.io.IOException: Invalid file path`. The file is
gitignored (it's machine-specific).

Then, since `java` isn't on PATH — Studio keeps its own JDK:

```bash
cd app/android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="/c/Users/jake/AppData/Local/Android/Sdk"
./gradlew assembleDebug
```

### Where the APK goes, and why it isn't in `build/`

This repo sits inside **OneDrive**, which is hostile to building. A build emits
thousands of files into `build/`; OneDrive immediately opens them to sync, and
Gradle can't then delete its own intermediates — the build dies on
`mergeDebugResources` with `Unable to delete directory`. (Confirmed here: the
first build passed, every one after it failed, and OneDrive was the only process
holding the files.)

So `android/build.gradle` sends build output **outside the synced tree**:

```
%TEMP%/mise-gradle-build/app/outputs/apk/debug/app-debug.apk
```

Override with `-PmiseBuildDir=/some/path`. This also spares OneDrive ~1GB of
throwaway artifacts per build.

**The real fix is to move this repo out of OneDrive** (e.g. `C:\Users\jake\GitHub\meal-prep`)
— synced folders and build tools mix badly, and `node_modules` is syncing too.
The redirect above is a workaround, not a cure.

## Build and run — iOS

**This cannot be done on Windows.** Apple only permits iOS apps to be compiled
on macOS with Xcode; there is no legitimate workaround. Everything else is
already done — the project, the OAuth URL scheme, and the iOS UI fixes are
committed and the web assets sync from Windows fine.

On a Mac:

```bash
brew install node          # if needed
cd app
npm install
npm run sync:ios           # copies the web app into ios/App/App/public
npm run open:ios           # opens ios/App/App.xcworkspace in Xcode
```

In Xcode: select a simulator or a connected iPhone and press ▶. Capacitor 8
uses **Swift Package Manager**, not CocoaPods, so there is no `pod install`
step — dependencies resolve on first open.

To ship: Xcode → Product → Archive → Distribute App. Needs an **Apple Developer
account ($99/year)** — the same one that unlocks "Sign in with Apple" in the
Supabase dashboard. Signing is per-Apple-ID, so the first build on a Mac will
ask you to pick a team.

### iOS setup checklist for a real device

1. Xcode → App target → Signing & Capabilities → pick your team.
2. For Sign in with Apple: add the **Sign in with Apple** capability there, and
   configure the Apple provider in the Supabase dashboard.
3. Google sign-in needs no iOS-side change — it uses the same
   `com.deadliftdigital.mise://auth` scheme already in `Info.plist`, which is
   also already on the Supabase redirect allow-list.

## Play Store / App Store

- **Google Play** — needs a Play Console account ($25, one time). Upload the
  signed `.aab`.
- **App Store** — needs the Apple Developer Program ($99/year).

### Turning on the website's download links

The site has a "MYSE ON YOUR PHONE" block ready to go, but it **renders nothing
until a store URL exists** — there is no "coming soon", no dead link. Once a
listing is live, paste its URL into `apps.js` in the repo root:

```js
var IOS_APP_URL     = "https://apps.apple.com/app/id<YOUR_NUMERIC_APP_ID>";
var ANDROID_APP_URL = "https://play.google.com/store/apps/details?id=com.deadliftdigital.mise";
```

Fill in one and only that button appears. Two caveats, both easy to trip on:

1. **Bump `apps.js?v=1` in index.html** when you edit it, or returning visitors
   keep the cached empty file and never see the block.
2. **The store badges are optional — but all-or-nothing.** Checked against both
   companies' own docs: neither *requires* a badge to link (Google's "Linking to
   Google Play" page documents plain https URLs; Apple has no rule against a
   text link). So the plain type buttons are fine as-is. If you do want the real
   badges, you must use their downloadable artwork unmodified — never redraw or
   rebuild it in CSS, which is why there are no Apple/Google logos in this repo.
   Then the strict rules apply: Apple wants its badge **first** in a lineup,
   Google wants its badge **the same size or larger** than the others (those two
   rules fight — lay it out carefully). Artwork:
   <https://developer.apple.com/app-store/marketing/guidelines/> and
   <https://partnermarketinghub.withgoogle.com/brands/google-play/visual-identity/badge-guidelines/>
   (the old `play.google.com/intl/en_us/badges` generator is retired and
   redirects; don't hotlink Google's hosted images — those URLs expire in 24h).

## Mise Plus — the paid tier

The whole flow is built and works on a phone today, but **in demo mode: it
charges nothing** and says so on the purchase screen. Real money needs a store
account, which is the one thing that can't be faked.

**Free forever** — browsing all recipes, every filter, search, ratings, reviews,
favorites, and making an account. Accounts are deliberately *not* paywalled:
they're the container a purchase restores into on a new phone, and charging for
signup would kill the ratings/reviews/favorites the site already has.

**Plus unlocks** (one entitlement, bought either way):
- Printing a recipe or the weekly plan
- Downloading a recipe PDF
- The weekly plan + combined shopping list. Note *adding* to the plan stays
  free — the wall is on opening it, so people build the basket first and meet
  the paywall where the value actually is.
- The goals profile and daily calorie target — and with it, the "% of your day"
  reading on every recipe card. A lapsed subscriber keeps their saved profile;
  it simply stops displaying until they come back.
- No sponsored tickets on the board

**Two ways to buy:** `$2.99/month` (`mise_plus_monthly`) or `$29.99 once`
(`mise_plus_lifetime`). Both grant the same entitlement. Prices are display
labels in `subscription.js`; the store is the source of truth once billing is
live, so keep them in step.

**Ads:** two placements, both suppressed for Plus and both honouring
`NETWORK_AD_HTML` in `ads.js` (house ads from `products.js` until it's set) — a
`SPONSORED` ticket every 12 recipes, and a page-turn interstitial when a free
reader taps "Next". (The old before-you-print interstitial is gone: print is
Plus-only and Plus removes ads, so it could never have fired.)

**A "restore purchase" path exists** because both stores require you to offer one.

**What it takes to charge real money**
1. **Google Play Console account** ($25 one-time) **plus a Google payments /
   merchant profile** — a separate step, and without it you can't price
   anything. iOS additionally needs the Apple Developer Program ($99/year).
2. Add a billing plugin and upload **one** build containing the Play Billing
   Library to a track (internal testing is enough). Play Console won't let you
   create a subscription product until such a build exists — this is the gate
   most people hit.
3. Create **both** products and mark each **ACTIVE**: `mise_plus_monthly`
   (subscription, $2.99/month) and `mise_plus_lifetime` (one-time /
   non-consumable, $29.99). An inactive or unpropagated product makes queries
   return an empty list *with no error*, which looks exactly like a code bug.
4. Wire the SDK and set `BILLING_ANDROID_KEY` / `BILLING_IOS_KEY` in
   `subscription.js`. Non-empty key turns demo mode off. The app only calls
   `MiseSub.isAdFree() / purchase() / restore()`, so nothing else changes.

**Testing is easier than the folklore says.** It's widely repeated that billing
only works if you install from Play. Google's own testing doc says otherwise:
license testers *"can sideload apps for testing, even for apps using debug
builds with debug signatures"*. So once 1–3 are done, the same `adb install`
debug APK we put on the phone can complete a real, free test purchase — provided
the package name matches the Play Console app, your account is added under
**Play Console → Settings → License testing**, and the device has the Play Store
and is signed in as that tester. Allow a few hours after the first upload for
propagation.

**Play Billing vs Stripe:** since the Epic v. Google settlement Google no longer
*requires* Play Billing, so external checkout is allowed. At $0.99 Play was the
clear call — its 15% all-in (~$0.15) beat Stripe's flat $0.30. At $2.99/$29.99
the fee math flips: Stripe (~$0.30 + ~2.9%, so ~$0.39 monthly / ~$1.16 lifetime)
undercuts Play's 15% (~$0.45 / ~$4.50). We still use Play Billing via RevenueCat,
but for friction not fees — it's the native in-app path, sidesteps external-link
compliance, and RevenueCat validates receipts, which a static site can't.

**Why a billing service rather than raw Play Billing:** purchases have to be
verified server-side or a rooted device can spoof them, and a static site has no
server. A service like RevenueCat does that validation and covers both stores
with one entitlement check.

## Release builds (the one to actually keep on a phone)

```bash
cd app/android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="/c/Users/jake/AppData/Local/Android/Sdk"
./gradlew assembleRelease
# -> %TEMP%/mise-gradle-build/app/outputs/apk/release/app-release.apk
```

**For a Play Store upload, build an App Bundle, not an APK**, and bump the
version first — Play rejects an AAB whose `versionCode` isn't higher than the
last one uploaded:

```bash
cd app && npm run bump        # versionCode n -> n+1 in android/app/build.gradle
npm run sync                  # copy the latest web files into the build
cd android && ./gradlew bundleRelease
# -> %TEMP%/mise-gradle-build/app/outputs/bundle/release/app-release.aab
```

Run `npm run bump` once per upload, not per local rebuild — rebuilding a
version you haven't uploaded yet needs no bump.

Signing is wired up already: `app/build.gradle` reads `android/keystore.properties`,
and if that file is missing (a fresh clone, CI) the release build just comes out
unsigned instead of failing.

**Two files you must never commit and must back up:**

| File | What it is |
| --- | --- |
| `app/android/mise-release.jks` | the signing key |
| `app/android/keystore.properties` | its passwords |

Both are gitignored. **The keystore is the only way to ship an update Android
will accept as the same app** — lose it and every user has to uninstall and
reinstall, losing their data. They currently sit inside OneDrive, which at least
means they're backed up; if this ever becomes a real product, move them somewhere
deliberate and rotate the password (it was generated during setup and is in the
session transcript).

Debug and release are signed with **different keys**, so Android won't upgrade
one to the other — switching requires an uninstall, which wipes app data
(favourites, plan, sign-in session). Pick one and stay on it.

If you publish to Play, turn on **Play App Signing**: Google holds the real app
key and this one becomes just an upload key, which is recoverable if lost.

### Do not publish the debug APK

It is tempting to just put `app-debug.apk` on the site as a direct download.
Don't: debug builds are signed with a throwaway debug key and are marked
debuggable, which lets anyone attach a debugger and read app data. They also get
no auto-updates and force users through "install unknown apps" warnings. If you
ever do want direct distribution, build a **release-signed** APK and host that —
but the stores are the right path.

**On the "minimum functionality" policy:** both stores reject apps that are just
a website in a wrapper (Google's minimum-functionality rule, Apple's guideline
4.2). This app is not one — the entire recipe library is bundled and works
offline, which is the value both policies ask for. Keep it that way.

## Platform-specific behavior (see `native.js` in the repo root)

The web app runs unmodified except where the platforms genuinely differ:

| Web | iOS + Android |
| --- | --- |
| Google sign-in redirects the page | Opens the **system browser** (Chrome Custom Tab / SFSafariViewController), returns via the `com.deadliftdigital.mise://auth` deep link. Google rejects OAuth inside an embedded WebView, so this is mandatory. |
| "Download PDF" saves a blob | Writes the PDF and opens the **OS share sheet** (Print, Files/Drive, messaging). |
| Recipe "Print" opens the print dialog | Shares the PDF — neither WKWebView nor Android's WebView implements `window.print()`. |
| Plan "PRINT / SAVE PDF" | Becomes **"SHARE PLAN"** — sends the shopping list + recipes as text. |
| — | Hardware **back** closes the open dialog or filter panel instead of quitting. **Android only** — iOS has no such key and the listener is scoped accordingly. |

`native.js` no-ops entirely on the web (`MiseNative.isNative === false`) and
exposes `MiseNative.platform` (`ios` / `android` / `web`).

### iOS-specific fixes already in the CSS

- **Input zoom.** iOS zooms the page when a focused input is under 16px and
  never zooms back. All six fields were 14.5–15px. Bumped to 16px inside
  `@supports (-webkit-touch-callout: none)`, which matches iOS only — the web
  and Android renderings stay pixel-identical (verified: still 15px in Chrome).
- **Safe areas.** The plan bar was pinned to `bottom: 0`, i.e. under the home
  indicator. Fixed furniture now pads by `env(safe-area-inset-*)`, plus
  `viewport-fit=cover` on the viewport meta. Applied to all platforms, not just
  iOS — Android's gesture bar benefits too, and `env()` is 0 where there is no
  inset, so desktop is unaffected.
- **Text rescaling on rotate** — `-webkit-text-size-adjust: 100%`.

## Known gaps

- **Icon:** the adaptive icon (Android 8+, so effectively everyone) is the Myse
  mark — paper, a strip of manila tape, the wordmark's M and green dot, drawn as
  vectors in `res/drawable/mise_icon_*.xml`. The raster fallbacks in `mipmap-*/`
  are still Capacitor's default, which only Android 7 devices would ever see;
  regenerate them with Studio's Image Asset tool if you care.
- **Splash screen** is still the Capacitor default.
- The plan is shared as text on Android, not as a PDF.
