/* Mise — progress maths.
 *
 * Pure functions, no DOM, no storage: given logged entries, return numbers.
 * Same deal as nutrition.js — kept separate so the arithmetic can be checked
 * on its own, and so the honest caveats live next to the formulas rather than
 * getting lost in render code.
 *
 * THE HONEST VERSION OF WHAT'S HERE:
 *   - Weight trend is a trailing average, because a single weigh-in is mostly
 *     noise (see TREND_DAYS).
 *   - Estimated 1RM is Epley's formula, which is a decent guess under ~10 reps
 *     and drifts badly over it. It is a TRACKING number, not a lift to attempt.
 *   - Pace is just division and is the only thing here that's exact.
 */

var MiseProgress = (function () {
  "use strict";

  /* Day-to-day bodyweight swings ~1-2kg on hydration, gut contents, glycogen
     and sodium alone — comfortably more than a week of real change. So a raw
     daily line mostly plots noise, and reading it as progress is how people end
     up panicking on a Tuesday. Everything user-facing uses this trailing window
     instead. Seven days also spans a full week, which cancels the
     weekday/weekend eating cycle.

     A trailing WINDOW, not "the last 7 entries": people don't weigh in daily,
     and averaging seven readings spread over two months would be meaningless. */
  var TREND_DAYS = 7;

  /* Losing faster than this is worth a word. The 2013 AHA/ACC/TOS guideline
     builds its deficits around ~0.5-1 kg (1-2 lb) a week, and nutrition.js's
     cut delta (-500 kcal/day) targets the bottom of that. Past roughly 1% of
     bodyweight a week, more of the loss is lean mass, and the gallstone risk
     rises. Expressed as a fraction of bodyweight because 1 kg/week means very
     different things at 50 kg and 150 kg. */
  var FAST_LOSS_FRACTION = 0.01;

  function toDay(d) { return Date.parse(d + "T00:00:00Z"); }
  var DAY_MS = 86400000;

  function byDate(a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; }

  /* Average of every point inside the trailing window ending at each point.
     Returns one trend value per input point, so raw and trend can be drawn
     against the same x positions.

     `at` is the mean of the averaged points' dates — the date the average
     actually describes, which is NOT the date it's plotted at. A trailing mean
     lags its window by about half its width, and at the very start of a log the
     window is truncated so it lags less. change() needs `at` to measure a real
     rate; without it, a month-old log under-reports how fast someone is losing
     by ~9%, which would make the warning below fire late. */
  function trend(points, windowDays) {
    var w = windowDays || TREND_DAYS;
    var sorted = points.slice().sort(byDate);
    return sorted.map(function (p, i) {
      var from = toDay(p.d) - (w - 1) * DAY_MS;
      var sum = 0, n = 0, daySum = 0;
      for (var j = i; j >= 0; j--) {
        if (toDay(sorted[j].d) < from) break;
        sum += sorted[j].v;
        daySum += toDay(sorted[j].d);
        n++;
      }
      return { d: p.d, v: sum / n, raw: p.v, n: n, at: daySum / n };
    });
  }

  /* Change between the trend now and the trend as it was `days` ago — not
     first-vs-last raw, which just subtracts one noisy number from another.
     Returns null when there isn't enough history to say anything honest. */
  function change(points, days) {
    if (!points || points.length < 2) return null;
    var t = trend(points);
    var last = t[t.length - 1];
    var cutoff = toDay(last.d) - days * DAY_MS;
    var earlier = null;
    for (var i = t.length - 1; i >= 0; i--) {
      if (toDay(t[i].d) <= cutoff) { earlier = t[i]; break; }
    }
    // No reading old enough: fall back to the oldest we have, and say so.
    var from = earlier || t[0];
    var spanDays = Math.round((toDay(last.d) - toDay(from.d)) / DAY_MS);
    if (spanDays <= 0) return null;

    /* Rate is measured between what the two averages actually describe (`at`),
       not between the dates they're plotted at — see trend(). perWeek is
       computed here rather than by each caller so there's one definition of
       "how fast", and the safety check below can't quietly use a different one. */
    var effectiveDays = (last.at - from.at) / DAY_MS;
    return {
      delta: last.v - from.v,
      from: from.v,
      to: last.v,
      spanDays: spanDays,
      perWeek: effectiveDays > 0 ? (last.v - from.v) / effectiveDays * 7 : null,
      complete: !!earlier          // false => the window is shorter than asked
    };
  }

  /* Cases worth a quiet word. Returned, never thrown — the UI shows them
     alongside the number, the way nutrition.js does. Deliberately not
     congratulatory in either direction: this is a log, not a coach. */
  function warnings(points) {
    var out = [];
    var c = change(points, 28);
    if (!c || c.spanDays < 14 || c.perWeek === null) return out;   // too little history to judge a rate

    var limit = c.to * FAST_LOSS_FRACTION;

    if (c.perWeek < -limit) {
      out.push("Your trend is dropping faster than about 1% of bodyweight a week. " +
        "Sustained, that tends to cost muscle as well as fat and raises the risk of " +
        "gallstones — it's worth easing off, or talking to a doctor if it isn't deliberate.");
    }
    return out;
  }

  /* Epley (1985): 1RM ≈ w × (1 + reps/30). Within a few percent up to about 10
     reps; past that it overestimates, badly and confidently, which is why
     anything higher is refused rather than guessed at. A single rep is its own
     1RM by definition.

     This is a number for watching a line move. It is NOT a lift to go and
     attempt — a true 1RM test is a coached, warmed-up, spotted affair. */
  var MAX_REPS_1RM = 10;

  function epley1RM(kg, reps) {
    if (!(kg > 0) || !(reps >= 1)) return null;
    if (reps > MAX_REPS_1RM) return null;
    if (reps === 1) return kg;
    return kg * (1 + reps / 30);
  }

  // Total load shifted in a set: the honest, assumption-free volume number.
  function volume(sets, reps, kg) {
    if (!(sets > 0) || !(reps > 0) || !(kg > 0)) return 0;
    return sets * reps * kg;
  }

  /* Distance conversions. kg/lb already live in MiseNutrition, so they aren't
     duplicated here; km/mi are run-domain and belong with the pace maths.
     1 mile = 1609.344 m exactly, by the 1959 international yard agreement. */
  function kmToMi(km) { return km / 1.609344; }
  function miToKm(mi) { return mi * 1.609344; }

  // Minutes per km. The one exact thing in this file.
  function pace(km, mins) {
    if (!(km > 0) || !(mins > 0)) return null;
    return mins / km;
  }

  // 6.4 -> "6:24"
  function formatPace(minsPerKm) {
    if (minsPerKm === null || !isFinite(minsPerKm)) return "—";
    var m = Math.floor(minsPerKm);
    var s = Math.round((minsPerKm - m) * 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  return {
    TREND_DAYS: TREND_DAYS,
    MAX_REPS_1RM: MAX_REPS_1RM,
    trend: trend,
    change: change,
    warnings: warnings,
    epley1RM: epley1RM,
    volume: volume,
    kmToMi: kmToMi, miToKm: miToKm,
    pace: pace,
    formatPace: formatPace
  };
})();
