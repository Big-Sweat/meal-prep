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
- **No app icon or splash yet** — still the default Capacitor icon. Replace the
  files under `android/app/src/main/res/` (Android Studio's Image Asset tool is
  the easy way) before shipping.
- The plan is shared as text on Android, not as a PDF.
