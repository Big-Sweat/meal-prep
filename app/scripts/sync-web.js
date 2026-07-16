/* Copy the web app from the repo root into app/www/ so Capacitor can bundle it.
   The repo root stays the single source of truth: edit the site as usual, then
   `npm run sync` here to pull those exact files into the Android app.

   Explicit allowlist - never copy .git, node_modules, tools, or the inbox. */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const WWW = path.join(__dirname, "..", "www");

const FILES = [
  "index.html",
  "products.html",
  "styles.css",
  "app.js",
  "recipes.js",
  "products.js",
  "ads.js",
  "apps.js",
  "auth.js",
  "pdf.js",
  "native.js"
];

const DIRS = ["assets"];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

let bytes = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    console.error("missing web file: " + f);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(WWW, f));
  bytes += fs.statSync(src).size;
}

for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) copyDir(src, path.join(WWW, d));
}

// The app bundles everything, so recipes work with no network at all.
const recipeCount = (fs.readFileSync(path.join(WWW, "recipes.js"), "utf8").match(/"id":/g) || []).length;

console.log(
  "synced " + FILES.length + " files + " + DIRS.join(", ") +
  " -> app/www (" + Math.round(bytes / 1024) + "KB, " + recipeCount + " recipes bundled offline)"
);
