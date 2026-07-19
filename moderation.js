/* Myse — content moderation (MiseModeration).
 *
 * A shared banned-word check for recipe text, forum posts, and display names.
 * Policy (19 Jul 2026): BLOCK on match, everywhere — recipe names/descriptions,
 * forum threads + replies, and the poster's display name.
 *
 * TWO LAYERS. This client check is for instant, friendly UX in the submit forms.
 * The REAL fence is the `has_banned_word()` Postgres trigger in
 * supabase/migrations/20260719000002_content_moderation.sql — because the anon
 * key is public, a hand-rolled API POST bypasses this file, so the DB rejects
 * banned content itself. **KEEP THE WORD LIST (`BODY`) BYTE-FOR-BYTE IN SYNC with
 * that migration's pattern** (the SQL uses \y where JS uses \b; everything else
 * is identical).
 *
 * MATCHING: whole-word and case-insensitive, so cooking words stay safe
 * ("asparagus", "bass", "class", "cockle", "molasses" don't trip "ass"/"cock"),
 * plus a light leetspeak fold so a$$ / sh1t / f4g are caught. Fully-masked
 * evasion (f*ck, f**k) is NOT caught here — the report + auto-hide system is the
 * backstop for whatever slips past. Known false positive: "faggots" the British
 * offal dish (the slur wins); whitelist it here + in the SQL if you need it.
 */
var MiseModeration = (function () {
  "use strict";

  // Banned roots + common inflections. MUST match the SQL function's pattern.
  var BODY = [
    // strong profanity
    "fuck(?:ing|in|ed|er|ers|s|wit|tard)?",
    "motherfuck(?:er|ers|ing|in)?",
    "shit(?:ty|ting|s|head|hole|bag)?",
    "bullshit",
    "bitch(?:es|ing|y)?",
    "cunt(?:s|y)?",
    "dick(?:s|head|wad|face)?",
    "cock(?:s|sucker|suckers)?",
    "puss(?:y|ies)",
    "ass(?:hole|holes|hat|wipe|es|clown)?",
    "(?:dumb|jack|bad|smart|fat|hard)ass(?:es)?",
    "bastard(?:s)?",
    "damn(?:ed)?",
    "goddamn(?:ed)?",
    "crap(?:py|s|ping)?",
    "piss(?:ing|ed|es|er)?",
    "prick(?:s)?",
    "slut(?:s|ty)?",
    "whore(?:s)?",
    "douche(?:bag|bags)?",
    "wank(?:er|ers|ing)?",
    "twat(?:s)?",
    "bollock(?:s)?",
    "bugger",
    "hell",
    // slurs (hate speech) — always blocked
    "nigg(?:er|ers|a|as|ah|ahs)",
    "fag(?:got|gots|gy|s)?",
    "retard(?:ed|s)?",
    "spic(?:s)?",
    "chink(?:s)?",
    "kike(?:s)?",
    "gook(?:s)?",
    "wetback(?:s)?",
    "trann(?:y|ies)",
    "dyke(?:s)?",
    "coon(?:s)?",
    "paki(?:s)?",
    "beaner(?:s)?",
    "raghead(?:s)?",
    "towelhead(?:s)?",
    "jap(?:s)?",
    "wop(?:s)?",
    "dago(?:s|es)?"
  ].join("|");

  var RX = new RegExp("\\b(?:" + BODY + ")\\b", "i");

  // Light leetspeak fold so a$$ / sh1t / f4g are caught. "1"->"i" (sh1t, b1tch);
  // "he11" isn't caught — an accepted v1 gap. Kept identical to the SQL
  // translate(low, '013457@$!', 'oieastasi').
  var LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
  function fold(s) {
    return String(s).toLowerCase().replace(/[013457@$!]/g, function (c) { return LEET[c] || c; });
  }

  // Returns the first offending match (string) or null when clean.
  function check(text) {
    if (text == null) return null;
    var m = RX.exec(String(text).toLowerCase());
    if (m) return m[0];
    m = RX.exec(fold(text));
    return m ? m[0] : null;
  }

  // Check several strings at once; returns the first hit or null.
  function checkAll() {
    for (var i = 0; i < arguments.length; i++) {
      var hit = check(arguments[i]);
      if (hit) return hit;
    }
    return null;
  }

  return { check: check, checkAll: checkAll };
})();
