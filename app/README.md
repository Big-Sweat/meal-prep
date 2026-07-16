# Mise — Android app

A Capacitor shell around the Mise web app. The files in the **repo root are the
single source of truth**: edit the site as normal, then `npm run sync` here to
pull those exact files into the app. There is no second copy of the recipes,
the filters, or the scaling math to maintain.

All 131 recipes ship **inside the app** (~557KB), so browsing, filtering,
scaling, and the weekly plan work with no network at all.

- App ID: `com.deadliftdigital.mise`
- App name: Mise

## What you need to build it

Not installed on this machine yet:

1. **Android Studio** — https://developer.android.com/studio (~1GB; bundles the
   JDK and Android SDK). Install it, open it once, and let it finish its first-run
   SDK download.

That's the only prerequisite. Node is already here.

## Build and run

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

## Play Store

Needs a Google Play Console account ($25, one time). Upload the signed `.aab`,
fill in the listing (icon, screenshots, description, privacy policy).

**On the "minimum functionality" policy:** Google rejects apps that are just a
website in a wrapper. This app is not one — the entire recipe library is bundled
and works offline, which is the value the policy asks for. Keep it that way.

## Android-specific behavior (see `native.js` in the repo root)

The web app runs unmodified except where Android genuinely differs:

| Web | Android |
| --- | --- |
| Google sign-in redirects the page | Opens the **system browser**, returns via the `com.deadliftdigital.mise://auth` deep link. Google rejects OAuth inside a WebView, so this is mandatory. |
| "Download PDF" saves a blob | Writes the PDF and opens the **share sheet** (Print, Drive, messaging are all targets). |
| Recipe "Print" opens the print dialog | Shares the PDF — Android WebViews have no `window.print()`. |
| Plan "PRINT / SAVE PDF" | Becomes **"SHARE PLAN"** — sends the shopping list + recipes as text. |
| — | Hardware **back** closes the open dialog or filter panel instead of quitting. |

`native.js` no-ops entirely on the web (`MiseNative.isNative === false`).

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
