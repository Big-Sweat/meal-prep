/* Ad config — the shared NETWORK_AD_HTML embed for BOTH ad placements.

   The site has two ad surfaces, both suppressed for Plus and both honouring
   this constant: the SPONSORED ticket every 12 recipes on the board, and the
   page-turn interstitial a free reader meets on "Next" (app.js). (The old
   before-you-print interstitial is gone — that one is unrelated: print and PDF
   are Plus-only now, and Plus removes ads, so it could never fire.)

   MONETIZATION: paste an ad network's embed HTML into NETWORK_AD_HTML and it
   renders inside both placements instead of a house ad. While it is empty they
   show house ads — a pick from `PRODUCTS` with your affiliate link.

   Note most networks (AdSense included) require their script to be able to size
   its own container; the ticket is a plain block, so test the embed on a phone
   width before trusting it.
*/

var NETWORK_AD_HTML = "";
