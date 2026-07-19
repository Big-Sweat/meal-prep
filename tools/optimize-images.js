/* Re-encode recipe photos from PNG to WebP.
 *
 * Photos stored as PNG are enormous (~2.6MB each here) because PNG is lossless
 * and built for flat graphics, not photographs. WebP at q80 gives ~90% off with
 * no change in pixel dimensions — and since the cards render these at ~400px and
 * the recipe modal at ~810px, the source is downscaled on display anyway, so the
 * compression is invisible.
 *
 * sharp isn't a dependency of this repo (nothing else needs a build step), so
 * install it wherever you like and point NODE_PATH at it:
 *
 *   npm install sharp --prefix /tmp/img
 *   NODE_PATH=/tmp/img/node_modules node tools/optimize-images.js
 *
 * Pass --keep-png to leave the originals in place.
 */

const fs = require("fs");
const path = require("path");

let sharp;
try {
  sharp = require("sharp");
} catch (e) {
  console.error("sharp not found. See the header of this file for how to run it.");
  process.exit(1);
}

const QUALITY = 80;
const DIR = path.join(__dirname, "..", "assets", "recipes");
const keepPng = process.argv.includes("--keep-png");

(async () => {
  // .png/.jpg/.jpeg, any case — "run it on any photo you add" means any photo,
  // not only lowercase PNGs.
  const sources = fs.readdirSync(DIR).filter((f) => /\.(png|jpe?g)$/i.test(f));
  if (!sources.length) {
    console.log("no PNG/JPEG sources left in assets/recipes — nothing to do");
    return;
  }

  let before = 0;
  let after = 0;
  let done = 0;
  const failed = [];

  for (const file of sources) {
    const src = path.join(DIR, file);
    const dest = src.replace(/\.(png|jpe?g)$/i, ".webp");
    try {
      const origBytes = fs.statSync(src).size;

      // No resize: keep the source dimensions, just change the container.
      await sharp(src).webp({ quality: QUALITY }).toFile(dest);

      const newBytes = fs.statSync(dest).size;
      before += origBytes;
      after += newBytes;
      done++;

      if (!keepPng) fs.unlinkSync(src);

      console.log(
        "  " + file.replace(/\.(png|jpe?g)$/i, "") +
        "  " + (origBytes / 1048576).toFixed(2) + "MB -> " + (newBytes / 1024).toFixed(0) + "KB"
      );
    } catch (e) {
      // One unreadable file must not abort the rest of the batch. The original
      // is left in place (unlink only runs after a successful convert).
      failed.push(file);
      console.error("  " + file + "  FAILED: " + e.message);
    }
  }

  console.log(
    "\n" + done + " of " + sources.length + " images  |  " +
    (before / 1048576).toFixed(1) + "MB -> " + (after / 1048576).toFixed(1) + "MB  (-" +
    (before ? (100 - (after / before) * 100).toFixed(1) : "0") + "%)"
  );
  if (failed.length) console.error("failed (originals kept): " + failed.join(", "));
  if (!keepPng && done) console.log("converted originals deleted. app.js must reference .webp");
})();
