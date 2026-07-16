# Mise — Android + iOS app

A Capacitor shell around the Mise web app. The files in the **repo root are the
single source of truth**: edit the site as normal, then `npm run sync` here to
pull those exact files into both apps. There is no second copy of the recipes,
the filters, or the scaling math to maintain.

All 131 recipes ship **inside the app** (~7MB with photos), so browsing,
filtering, scaling, and the weekly plan work with no network at all — verified
on Android with airplane mode on.

- App ID: `com.deadliftdigital.mise` (both platforms)
- App name: Mise

| | Android | iOS |
| --- | --- | --- |
| Project | `app/android/` | `app/ios/` |
| Status | **built and run** on Android 16 (API 36) | **scaffolded, never compiled** |
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

- **Untested on a device.** The native paths above are written but nothing has
  been run on an emulator or phone yet — that needs Android Studio. Test Google
  sign-in first; it's the most intricate path.
- **Icon:** the adaptive icon (Android 8+, so effectively everyone) is the Mise
  mark — paper, a strip of manila tape, the wordmark's M and green dot, drawn as
  vectors in `res/drawable/mise_icon_*.xml`. The raster fallbacks in `mipmap-*/`
  are still Capacitor's default, which only Android 7 devices would ever see;
  regenerate them with Studio's Image Asset tool if you care.
- **Splash screen** is still the Capacitor default.
- The plan is shared as text on Android, not as a PDF.
