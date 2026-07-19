/* Myse prep-gear data.
   MONETIZATION: replace AFFILIATE_TAG below with your Amazon Associates tag
   (e.g. "mise0a-20") and every link on the gear page becomes an affiliate
   link. Until then links ship as plain Amazon searches with NO tag param —
   never a dead placeholder id (same empty-constant pattern as billing/apps). */

var AFFILIATE_TAG = ""; // <-- put your Associates tag here to activate affiliate links

var PRODUCTS = [
  {
    category: "Containers",
    items: [
      {
        name: "Two-compartment glass containers",
        blurb: "The workhorse. Glass survives the microwave, oven, and dishwasher without staining or warping, and the divider keeps saucy things off crispy things until lunch.",
        priceBand: "$25–40 / SET",
        search: "glass meal prep containers 2 compartment"
      },
      {
        name: "32-oz deli container set",
        blurb: "The restaurant standard for a reason: one lid fits every size, they stack forever, and they hold a week of soups, grains, and sauces for pocket change.",
        priceBand: "$15–25 / SET",
        search: "deli containers 32 oz with lids"
      },
      {
        name: "Wide-mouth quart mason jars",
        blurb: "Overnight oats, layered salads packed dressing-down, pickled onions. Wide mouths so a spoon and a hand both fit.",
        priceBand: "$15–25 / 12",
        search: "wide mouth mason jars quart 12 pack"
      },
      {
        name: "Reusable silicone freezer bags",
        blurb: "Freeze chili, salsa chicken, and sauces flat so they stack like files and thaw in minutes. Replaces a drawer of single-use bags.",
        priceBand: "$20–35 / SET",
        search: "reusable silicone freezer bags gallon"
      }
    ]
  },
  {
    category: "Tools",
    items: [
      {
        name: "Digital kitchen scale",
        blurb: "The only honest way to portion. Every macro number on this site assumes somebody weighed something once.",
        priceBand: "$10–20",
        search: "digital kitchen food scale grams"
      },
      {
        name: "Instant-read thermometer",
        blurb: "Chicken at 165°F without cutting it open and drying it out. Pays for itself the first Sunday you don't overcook two pounds of thighs.",
        priceBand: "$15–35",
        search: "instant read meat thermometer"
      },
      {
        name: "Half-sheet pans, two of them",
        blurb: "Every sheet-pan recipe on the board wants a full-size rimmed half-sheet — and a second one so the vegetables aren't crowded onto the chicken's pan.",
        priceBand: "$20–30 / 2",
        search: "half sheet pan aluminum 2 pack"
      },
      {
        name: "8-inch chef's knife",
        blurb: "Sunday prep is an hour of chopping. A sharp mid-priced chef's knife makes it forty-five minutes.",
        priceBand: "$30–60",
        search: "8 inch chef knife"
      },
      {
        name: "Oversized cutting board",
        blurb: "Big enough that the onions, the peppers, and the pile of chicken all fit without a landslide onto the counter.",
        priceBand: "$20–40",
        search: "extra large cutting board with juice groove"
      },
      {
        name: "Masking tape and a marker",
        blurb: "Date every container the moment it's sealed. It is the entire reason this site looks the way it does.",
        priceBand: "$8–12",
        search: "masking tape food labels marker"
      }
    ]
  },
  {
    category: "Appliances",
    items: [
      {
        name: "6-quart slow cooker",
        blurb: "The pot roast, salsa chicken, shredded beef tacos, and pulled pork on the board all cook themselves in one of these while you're at work.",
        priceBand: "$35–60",
        search: "6 quart slow cooker programmable"
      },
      {
        name: "Rice cooker with keep-warm",
        blurb: "Most bowls on the board sit on rice. A cheap cooker makes it perfectly and holds it warm while you deal with everything else.",
        priceBand: "$25–50",
        search: "rice cooker keep warm 6 cup"
      }
    ]
  }
];

function productUrl(p) {
  var base = "https://www.amazon.com/s?k=" + encodeURIComponent(p.search);
  // No tag until a real one is set: a placeholder/empty tag is a dead affiliate
  // id, so ship a plain search instead (matches how apps.js/ads.js stay inert).
  var tag = (AFFILIATE_TAG || "").trim();
  if (!tag || tag === "YOUR-AFFILIATE-TAG-20") return base;
  return base + "&tag=" + encodeURIComponent(tag);
}
