/* Exercise MiseProgress against hand-worked expectations. */
const fs = require("fs");
const path = require("path").join(__dirname, "..", "progress.js");
eval(fs.readFileSync(path, "utf8"));

let pass = 0, fail = 0;
function ok(name, actual, expected, tol) {
  const good = tol !== undefined
    ? Math.abs(actual - expected) <= tol
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (good) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n         got:      " + JSON.stringify(actual) + "\n         expected: " + JSON.stringify(expected)); }
}

console.log("\n-- epley1RM ------------------------------------------");
ok("1 rep is its own 1RM", MiseProgress.epley1RM(100, 1), 100);
ok("100kg x 5 -> 116.67", MiseProgress.epley1RM(100, 5), 116.6667, 0.001);
ok("100kg x 10 -> 133.3 (boundary allowed)", MiseProgress.epley1RM(100, 10), 133.3333, 0.001);
ok("11 reps refused, not guessed", MiseProgress.epley1RM(100, 11), null);
ok("zero weight -> null", MiseProgress.epley1RM(0, 5), null);
ok("zero reps -> null", MiseProgress.epley1RM(100, 0), null);

console.log("\n-- volume / pace -------------------------------------");
ok("3x5x100 = 1500", MiseProgress.volume(3, 5, 100), 1500);
ok("junk -> 0", MiseProgress.volume(0, 5, 100), 0);
ok("5km in 25min = 5.0 min/km", MiseProgress.pace(5, 25), 5);
ok("formatPace 6.4 -> 6:24", MiseProgress.formatPace(6.4), "6:24");
ok("formatPace rounds 5.999 -> 6:00 not 5:60", MiseProgress.formatPace(5.999), "6:00");
ok("formatPace null -> dash", MiseProgress.formatPace(null), "—");

console.log("\n-- trend (trailing window, irregular logging) --------");
// Five consecutive days, noisy around 80.
const daily = [
  { d: "2026-07-01", v: 80 },
  { d: "2026-07-02", v: 82 },
  { d: "2026-07-03", v: 79 },
  { d: "2026-07-04", v: 81 },
  { d: "2026-07-05", v: 78 }
];
const t = MiseProgress.trend(daily);
ok("first point averages only itself", t[0].v, 80, 0.001);
ok("2nd = mean(80,82)", t[1].v, 81, 0.001);
ok("5th = mean of all 5 (inside 7d window)", t[4].v, 80, 0.001);
ok("trend keeps the raw value alongside", t[4].raw, 78);
ok("trend reports how many points it averaged", t[4].n, 5);
// `at` directly: the mean DATE of the averaged points — what the average
// describes. Five consecutive days ending Jul 5 average out to Jul 3, i.e. the
// plotted point lags what it measures by two days. This is the value change()
// measures rates from; if `at` drifts, every rate silently drifts with it.
ok("at = mean date of the window (Jul 1-5 -> Jul 3)", t[4].at, Date.parse("2026-07-03T00:00:00Z"));
ok("at of a 1-point window is that point's own date", t[0].at, Date.parse("2026-07-01T00:00:00Z"));

// windowDays override: a 3-day window over the same data must only see 3 points.
const t3 = MiseProgress.trend(daily, 3);
ok("windowDays=3: last point averages only Jul 3-5", t3[4].v, (79 + 81 + 78) / 3, 0.001);
ok("windowDays=3: reports 3 points averaged", t3[4].n, 3);

// Two weigh-ins on the SAME day (the log allows it) must both join the window.
const dupDay = [
  { d: "2026-07-01", v: 80 },
  { d: "2026-07-01", v: 82 },
  { d: "2026-07-02", v: 84 }
];
const td = MiseProgress.trend(dupDay);
ok("same-day duplicates both counted", td[2].n, 3);
ok("same-day duplicates averaged, not corrupted", td[2].v, 82, 0.001);

// A gap longer than the window: old readings must NOT be averaged in.
const gapped = [
  { d: "2026-01-01", v: 100 },
  { d: "2026-07-01", v: 80 },
  { d: "2026-07-02", v: 80 }
];
const tg = MiseProgress.trend(gapped);
ok("6-month-old reading excluded from window", tg[2].v, 80, 0.001);
ok("...and it only averaged the 2 in-window points", tg[2].n, 2);

// Unsorted input must not corrupt the window.
const unsorted = [
  { d: "2026-07-05", v: 78 },
  { d: "2026-07-01", v: 80 },
  { d: "2026-07-03", v: 79 }
];
ok("unsorted input is sorted first", MiseProgress.trend(unsorted).map(p => p.d),
   ["2026-07-01", "2026-07-03", "2026-07-05"]);

console.log("\n-- change --------------------------------------------");
ok("single point -> null (nothing honest to say)", MiseProgress.change([{ d: "2026-07-01", v: 80 }], 28), null);
ok("empty -> null", MiseProgress.change([], 28), null);

const month = [];
for (let i = 0; i < 30; i++) {
  const day = String(i + 1).padStart(2, "0");
  month.push({ d: "2026-06-" + day, v: 90 - i * 0.1 });   // steady -0.1/day = -0.7/wk
}
const c = MiseProgress.change(month, 28);
ok("28-day window is marked complete", c.complete, true);
ok("spans 28 days", c.spanDays, 28);
// trend-to-trend, not raw-to-raw: the early window is truncated so it lags less,
// which is exactly why perWeek is measured off the window centroids instead.
ok("delta is the real trend movement", c.delta, -2.55, 0.05);
ok("perWeek recovers the TRUE -0.7/wk despite the lag", c.perWeek, -0.7, 0.005);

const shortLog = [{ d: "2026-07-01", v: 80 }, { d: "2026-07-04", v: 79 }];
const cs = MiseProgress.change(shortLog, 28);
ok("short history flagged incomplete", cs.complete, false);
ok("...but still reports its real span", cs.spanDays, 3);

// Two entries on one day span zero days: no honest rate exists, so null —
// not an Infinity from dividing by the zero-day span.
ok("same-day-only log -> null (zero span)",
   MiseProgress.change([{ d: "2026-07-01", v: 80 }, { d: "2026-07-01", v: 79 }], 28), null);

// A long log: both windows are full, so the lag cancels and the naive span is
// already right. This is the case that hid the bug — only ~28-35 day logs show it.
const long = [];
for (let i = 0; i < 90; i++) {
  const dt = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  long.push({ d: dt, v: 90 - i * 0.1 });
}
const cl = MiseProgress.change(long, 28);
ok("long log: perWeek still -0.7/wk", cl.perWeek, -0.7, 0.005);
ok("long log: delta is a clean -2.8 (windows both full)", cl.delta, -2.8, 0.02);

console.log("\n-- warnings (safety) ---------------------------------");
ok("steady 0.7kg/wk at 90kg: no warning", MiseProgress.warnings(month).length, 0);

// ~2% of bodyweight per week — should warn.
const crash = [];
for (let i = 0; i < 30; i++) {
  const day = String(i + 1).padStart(2, "0");
  crash.push({ d: "2026-06-" + day, v: 90 - i * 0.26 });  // -1.82/wk on ~82kg = 2.2%
}
const w = MiseProgress.warnings(crash);
ok("rapid loss warns", w.length, 1);
ok("...and names the reason", /1% of bodyweight a week/.test(w[0] || ""), true);

ok("too little history -> silent, not alarmist", MiseProgress.warnings(shortLog).length, 0);
ok("gaining fast is not warned about here", MiseProgress.warnings(month.map(p => ({ d: p.d, v: 90 + (90 - p.v) * 3 }))).length, 0);

// The threshold is a fraction of bodyweight, so the same kg/wk must warn for a
// light person and not for a heavy one. 0.85 kg/wk = 1.7% at 50kg, 0.57% at 150kg.
function ramp(start, perDay) {
  const a = [];
  for (let i = 0; i < 30; i++) a.push({ d: "2026-06-" + String(i + 1).padStart(2, "0"), v: start - i * perDay });
  return a;
}
ok("0.85kg/wk warns at 50kg (1.7% of bodyweight)", MiseProgress.warnings(ramp(50, 0.85 / 7)).length, 1);
ok("0.85kg/wk is silent at 150kg (0.6% of bodyweight)", MiseProgress.warnings(ramp(150, 0.85 / 7)).length, 0);

// The threshold itself, from both sides. For a steady ramp from 100kg the
// final trend value is 100 - 26*perDay, so the boundary rate solves
// 7*perDay = 0.01*(100 - 26*perDay) -> perDay = 1/7.26. Exact equality is a
// floating-point coin flip by design (strict <), so probe 1% either side.
const boundaryPerDay = 1 / 7.26;
ok("just UNDER 1%/wk stays silent", MiseProgress.warnings(ramp(100, boundaryPerDay * 0.99)).length, 0);
ok("just OVER 1%/wk warns", MiseProgress.warnings(ramp(100, boundaryPerDay * 1.01)).length, 1);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
