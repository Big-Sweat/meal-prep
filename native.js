/* Mise — Android adaptations.
   Loads on the website too, where every branch below is skipped: on the web
   `window.MiseNative.isNative` is false and nothing else runs. */
(function () {
  "use strict";

  var Cap = window.Capacitor;
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

  window.MiseNative = { isNative: isNative };
  if (!isNative) return;

  var P = Cap.Plugins || {};
  document.documentElement.classList.add("is-native");

  /* Hardware back button. Without this, back drops straight out of the app
     even with a recipe open. Close what's on top instead; exit only from the
     bare board. */
  if (P.App) {
    P.App.addListener("backButton", function () {
      var dialogs = ["ad-modal", "auth-modal", "recipe-modal", "plan-modal"];
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
      P.App.exitApp();
    });
  }

  /* A blob download never lands anywhere the user can find it in a WebView.
     Write the file, then hand it to Android's share sheet — which carries
     Print, Save to Drive, and messaging as targets. */
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
