/* Mise — native (iOS + Android) adaptations.
   Loads on the website too, where every branch below is skipped: on the web
   `window.MiseNative.isNative` is false and nothing else runs. */
(function () {
  "use strict";

  var Cap = window.Capacitor;
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var platform = (Cap && Cap.getPlatform && Cap.getPlatform()) || "web";

  window.MiseNative = { isNative: isNative, platform: platform };
  if (!isNative) return;

  var P = Cap.Plugins || {};
  document.documentElement.classList.add("is-native");
  document.documentElement.classList.add("is-" + platform); // is-ios / is-android

  /* Hardware back button — Android only; iOS has no such key and never fires
     this. Without it, back drops straight out of the app even with a recipe
     open. Close what's on top instead; exit only from the bare board. */
  if (platform === "android" && P.App) {
    P.App.addListener("backButton", function () {
      // Close whatever is on top. Pages carry different subsets of these — a
      // missing id just means that dialog isn't on this page.
      var dialogs = ["sub-modal", "auth-modal", "recipe-modal", "plan-modal"];
      for (var i = 0; i < dialogs.length; i++) {
        var d = document.getElementById(dialogs[i]);
        if (d && d.open) { d.close(); return; }
      }
      var rail = document.getElementById("filter-rail");
      if (rail && rail.classList.contains("open")) {
        var closeBtn = document.getElementById("close-filters");
        if (closeBtn) closeBtn.click();
        return;
      }
      /* Only the board is the app's root. From the gear list or your kitchen,
         back belongs to the board — dropping out of the app entirely from a
         sub-page is jarring. The filter rail is the board's tell; testing for it
         beats parsing the path, which differs between the app and the site. */
      if (!rail) { window.history.back(); return; }
      P.App.exitApp();
    });
  }

  /* A blob download never lands anywhere the user can find it in a WebView, and
     neither WKWebView (iOS) nor Android's WebView implements window.print().
     Write the file, then hand it to the OS share sheet — which carries Print,
     Save to Files/Drive, and messaging as targets on both platforms. */
  function shareFile(bytes, filename, title) {
    if (!P.Filesystem || !P.Share) return Promise.reject(new Error("native plugins unavailable"));
    return P.Filesystem.writeFile({ path: filename, data: btoa(bytes), directory: "CACHE" })
      .then(function () { return P.Filesystem.getUri({ path: filename, directory: "CACHE" }); })
      .then(function (res) {
        return P.Share.share({ title: title, url: res.uri, dialogTitle: title });
      });
  }

  window.MiseNative.sharePDF = function (model, filename, title) {
    // MisePDF sanitizes to ASCII, so btoa on its output is safe.
    return shareFile(window.MisePDF.buildRecipePDF(model), filename || "recipe.pdf", title || "Recipe");
  };

  window.MiseNative.shareText = function (title, text) {
    if (!P.Share) return Promise.reject(new Error("share plugin unavailable"));
    return P.Share.share({ title: title, text: text, dialogTitle: title });
  };

  /* The recipe "Download PDF" button goes through MisePDF.download; repoint it
     at the share sheet so the file is reachable. */
  if (window.MisePDF) {
    window.MisePDF.download = function (model, filename) {
      window.MiseNative.sharePDF(model, filename || "recipe.pdf", model.name);
    };
  }
})();
