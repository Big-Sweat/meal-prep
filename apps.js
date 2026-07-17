/* Mise — mobile app download links.

   The "get the app" block on the site reads these two constants. While BOTH are
   empty the block does not render at all — no dead links, no "coming soon"
   promise. Fill one in and it appears; fill both and both buttons appear.

   ─────────────────────────────────────────────────────────────────────────
   THESE ARE EMPTY BECAUSE NOTHING IS PUBLISHED YET (as of Jul 2026).
   The Android build is a *debug* APK and the iOS app has never been compiled.
   Do not paste a guess here — an App Store / Play URL only exists once the
   listing is live. See app/README.md for how to get there.
   ─────────────────────────────────────────────────────────────────────────

   ANDROID_APP_URL — after publishing on Google Play, the listing URL is built
   from the package name in the manifest:
       https://play.google.com/store/apps/details?id=com.deadliftdigital.mise

   IOS_APP_URL — after publishing, App Store Connect assigns a numeric "Apple
   ID" (not the bundle id). The canonical form carries a storefront and a
   cosmetic name slug; only the id segment actually resolves:
       https://apps.apple.com/us/app/mise/id<YOUR_NUMERIC_APP_ID>
   Generate the real link from App Store Marketing Tools rather than hand-typing:
       https://toolbox.marketingtools.apple.com/en-us/app-store

   WHEN YOU EDIT THIS FILE, BUMP THE CACHE VERSION. index.html loads
   `apps.js?v=1`. Change a URL here without bumping that to ?v=2 and every
   returning visitor keeps the cached empty file and never sees the block. (This
   bit during testing — it is the same rule as the rest of the site; see
   CLAUDE.md.)

   ON THE STORE BADGES — checked against both companies' own docs (Jul 2026):
   neither Apple nor Google *requires* a badge in order to link. Google's
   "Linking to Google Play" page documents plain https URLs, and Apple has no
   rule against a text link (it only instructs that badges be included in
   marketing materials). So the plain type buttons this site ships are fine.

   The rules bite only IF you use their artwork — and then they are strict:
     - Use the real downloadable asset. Never redraw, recolor, tilt or animate
       it, and never build a lookalike in CSS. That is why there are no Apple or
       Google logos in this repo.
     - Apple: min 40px tall onscreen, clear space = 1/4 badge height, one per
       layout, App Store badge placed FIRST when shown beside other stores, and
       never translate "App Store". Say "Download on the App Store", never "at".
       Artwork + rules: https://developer.apple.com/app-store/marketing/guidelines/
     - Google: min 0.3in/7.6mm tall, clear space = 1/4 badge height, and the Play
       badge must be the SAME SIZE OR LARGER than other stores' badges — which
       directly conflicts with Apple's "first in the lineup", so lay them out
       carefully. The old play.google.com/intl/en_us/badges generator is RETIRED
       and now redirects; get artwork from the Partner Marketing Hub:
       https://partnermarketinghub.withgoogle.com/brands/google-play/visual-identity/badge-guidelines/
       Don't hotlink Google's hosted images — those URLs expire in 24h. Download
       and self-host.
     - Google's current legal-line tool emits "Google Play is a trademark of
       Google LLC." The widely copied "Google Play and the Google Play logo are
       trademarks of Google LLC." is legacy text from the retired generator.
*/

var IOS_APP_URL = "";
var ANDROID_APP_URL = "";

/* ANDROID_APK_URL — direct download of the RELEASE-SIGNED APK, for the
   "continue in the app" hand-off on Android browsers (see the banner in
   app.js). This is NOT a store listing, so it does not light up the footer
   block above — sideloading is a stopgap until the Play listing exists, at
   which point ANDROID_APP_URL replaces it and this can go away.
   The URL is GitHub's "latest release" redirect, so publishing a newer release
   with an asset named mise.apk updates every install link at once.
   NEVER point this at a debug APK — debug builds are debuggable and signed with
   a throwaway key (see app/README.md, "Do not publish the debug APK"). */
var ANDROID_APK_URL = "https://github.com/Big-Sweat/meal-prep/releases/latest/download/mise.apk";
