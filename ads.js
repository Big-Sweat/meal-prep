/* Pre-print ad slot config — now the IN-FEED ad slot.

   The site's only ad placement is the SPONSORED ticket that appears every 12
   recipes on the board. (The old before-you-print interstitial is gone: print
   and PDF are Plus-only now, and Plus removes ads, so it could never fire.)

   MONETIZATION: paste an ad network's embed HTML into NETWORK_AD_HTML and it
   renders inside the sponsored ticket instead of a house ad. While it is empty
   the slot shows house ads — a pick from `PRODUCTS` with your affiliate link.

   Note most networks (AdSense included) require their script to be able to size
   its own container; the ticket is a plain block, so test the embed on a phone
   width before trusting it.
*/

var NETWORK_AD_HTML = "";
