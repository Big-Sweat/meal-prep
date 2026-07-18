#!/usr/bin/env node
/* Bump the Android versionCode before a release upload.
 *
 * Play rejects an AAB whose versionCode isn't strictly greater than the last
 * one already uploaded to the app. The number lives in
 * app/android/app/build.gradle (`versionCode <n>`); this reads it, adds one,
 * and writes it back — nothing else. versionName (the human-facing "1.0"
 * label) is deliberately left alone: Play doesn't care about it, so bump that
 * by hand only when you want a new marketing version.
 *
 * Usage, from app/:
 *     npm run bump
 * then build the AAB the usual way (see README, "Release builds"). Run it once
 * per upload — NOT per local rebuild. Rebuilding the same version you haven't
 * uploaded yet is fine and needs no bump.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const gradle = path.join(__dirname, "..", "android", "app", "build.gradle");
const src = fs.readFileSync(gradle, "utf8");

const m = src.match(/versionCode\s+(\d+)/);
if (!m) {
  console.error("bump-version: couldn't find `versionCode <n>` in " + gradle);
  process.exit(1);
}

const from = parseInt(m[1], 10);
const to = from + 1;
// Replace only the first (and only) occurrence in defaultConfig.
fs.writeFileSync(gradle, src.replace(/versionCode\s+\d+/, "versionCode " + to));

console.log("versionCode " + from + " -> " + to);
