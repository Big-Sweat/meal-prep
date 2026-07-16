/* Mise — the log page.
 *
 * Weight, lifts and runs. Shares its data through store.js, its maths through
 * progress.js, and its paywall through plus-ui.js. app.js is not loaded here
 * (it binds index.html's DOM at module scope), and neither is recipes.js — this
 * page has no use for 448KB of recipe data.
 *
 * THE PAGE IS FREE. Logging your own body is not a thing to charge for, and a
 * log is what brings someone back daily. The Plus benefit falls out of the
 * existing gate for nothing: a weigh-in updates the nutrition profile, and
 * MiseStore.calorieTarget() already decides who may see the resulting number —
 * so "your target follows your weight" is paid without a single new gate.
 *
 * TONE, DELIBERATELY: this is a log, not a coach. No streaks, no confetti, no
 * goal-weight countdown, and nothing congratulatory in either direction.
 * Weight tracking is a known route into disordered eating, and nutrition.js
 * already refuses under-18s and warns about exactly this. Everything
 * user-facing leads with the 7-day trend rather than the last reading, because
 * a single weigh-in is mostly water (see progress.js). Keep all of that.
 */
(function () {
  "use strict";

  var host = document.getElementById("log");

  var realAuth = typeof MiseAuth !== "undefined" && MiseAuth.enabled;
  var account = realAuth ? null : MiseStore.account();
  var ready = !realAuth;
  var unreachable = false;

  var UNITS_PREFIX = "mise-log-units-";
  var units = "imperial";        // resolved per account once we know who it is

  var COMMON_LIFTS = [
    "Back squat", "Front squat", "Bench press", "Overhead press",
    "Deadlift", "Romanian deadlift", "Barbell row", "Pull-up", "Dip", "Lunge"
  ];

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function me() { return MiseStore.who(account); }
  function $(sel) { return host.querySelector(sel); }

  /* Local date, not UTC. `new Date().toISOString()` would file a Tuesday-evening
     weigh-in in the US as Wednesday, and a log that disagrees with the calendar
     on the wall is worse than useless. */
  function todayLocal() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function loadUnits() {
    try {
      var saved = localStorage.getItem(UNITS_PREFIX + me());
      if (saved === "metric" || saved === "imperial") { units = saved; return; }
    } catch (e) { /* ignore */ }
    // Fall back to whatever they picked in the nutrition profile, if any.
    var n = MiseStore.nutrition(me());
    units = (n && n.units) ? n.units : "imperial";
  }

  function saveUnits() {
    try { localStorage.setItem(UNITS_PREFIX + me(), units); } catch (e) { /* ignore */ }
  }

  var imperial = function () { return units === "imperial"; };

  // Display helpers — storage is always kg/km, these are the only converters.
  function showKg(kg) { return imperial() ? MiseNutrition.kgToLb(kg) : kg; }
  function readKg(v) { return imperial() ? MiseNutrition.lbToKg(v) : v; }
  function showKm(km) { return imperial() ? MiseProgress.kmToMi(km) : km; }
  function readKm(v) { return imperial() ? MiseProgress.miToKm(v) : v; }
  function wUnit() { return imperial() ? "lb" : "kg"; }
  function dUnit() { return imperial() ? "mi" : "km"; }

  function round1(n) { return Math.round(n * 10) / 10; }

  function prettyDate(d) {
    var parts = d.split("-");
    var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return parseInt(parts[2], 10) + " " + MON[parseInt(parts[1], 10) - 1];
  }

  /* ---------- the chart ----------
     Hand-rolled inline SVG: this project has no build step and no
     dependencies, and a charting library would be several times the weight of
     the entire site. Same reasoning as pdf.js.

     Raw readings are drawn faint and the trend solid, because the trend is the
     part worth reading — see progress.js. The <svg> carries role="img" and a
     one-line summary; the history list underneath is the real text
     alternative, so nothing here is chart-only. */
  function chartSVG(raw, opts) {
    var W = 640, H = 200;
    var padL = 44, padR = 12, padT = 14, padB = 24;
    if (raw.length < 2) return "";

    var t = MiseProgress.trend(raw);
    var xs = raw.map(function (p) { return Date.parse(p.d + "T00:00:00Z"); });
    var all = raw.map(function (p) { return p.v; }).concat(t.map(function (p) { return p.v; }));
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minV = Math.min.apply(null, all), maxV = Math.max.apply(null, all);

    // A flat line should sit in the middle, not fill the box with noise.
    var span = maxV - minV;
    if (span < 1e-9) { minV -= 1; maxV += 1; span = 2; }
    else { minV -= span * 0.12; maxV += span * 0.12; span = maxV - minV; }

    var spanX = (maxX - minX) || 1;
    function x(d) { return padL + ((Date.parse(d + "T00:00:00Z") - minX) / spanX) * (W - padL - padR); }
    function y(v) { return padT + (1 - (v - minV) / span) * (H - padT - padB); }

    var fmt = opts.format || function (v) { return round1(v); };

    var gridY = [minV + span * 0.5, maxV - span * 0.06, minV + span * 0.06];
    var grid = gridY.map(function (v) {
      return '<line x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) +
        '" y2="' + y(v).toFixed(1) + '" class="chart-grid"/>' +
        '<text x="' + (padL - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" class="chart-tick">' +
        esc(fmt(v)) + "</text>";
    }).join("");

    var dots = raw.map(function (p) {
      return '<circle cx="' + x(p.d).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="2.5" class="chart-dot"/>';
    }).join("");

    var line = t.map(function (p, i) {
      return (i ? "L" : "M") + x(p.d).toFixed(1) + " " + y(p.v).toFixed(1);
    }).join(" ");

    var first = raw[0].d, last = raw[raw.length - 1].d;

    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" ' +
        'aria-label="' + esc(opts.label || "Trend chart") + '" preserveAspectRatio="none">' +
      grid +
      dots +
      '<path d="' + line + '" class="chart-line"/>' +
      '<text x="' + padL + '" y="' + (H - 6) + '" class="chart-tick chart-tick--x">' + esc(prettyDate(first)) + "</text>" +
      '<text x="' + (W - padR) + '" y="' + (H - 6) + '" class="chart-tick chart-tick--x" text-anchor="end">' + esc(prettyDate(last)) + "</text>" +
    "</svg>" +
    '<p class="chart-key mono"><span class="chart-key-dot"></span> EACH READING &nbsp; ' +
      '<span class="chart-key-line"></span> ' + MiseProgress.TREND_DAYS + "-DAY TREND</p>";
  }

  /* ---------- shell ---------- */

  function render() {
    if (!ready) {
      host.innerHTML = '<p class="kit-loading mono">LOADING YOUR LOG&hellip;</p>';
      return;
    }
    if (!account) { renderSignedOut(); return; }
    loadUnits();

    host.innerHTML =
      '<div class="kit-grid">' +
        '<aside class="kit-id" id="log-side"></aside>' +
        '<div class="kit-sections">' +
          '<section class="kit-section" id="log-weight"></section>' +
          '<section class="kit-section" id="log-lifts"></section>' +
          '<section class="kit-section" id="log-runs"></section>' +
        "</div>" +
      "</div>";

    renderSide();
    renderWeight();
    renderLifts();
    renderRuns();
  }

  function renderSignedOut() {
    host.innerHTML =
      '<div class="kit-empty-page">' +
        '<span class="modal-tape">THE LOG</span>' +
        (unreachable
          ? "<h2>Can&rsquo;t reach the sign-in service</h2>" +
            '<p class="kit-empty-line">Your log needs your account, and we couldn&rsquo;t get to it — ' +
              "you may be offline. The recipes themselves work without a connection.</p>"
          : "<h2>You&rsquo;re not signed in</h2>" +
            '<p class="kit-empty-line">The log keeps your weigh-ins, lifts and runs, and it&rsquo;s free. ' +
              "Sign in from the board to start one.</p>") +
        '<a class="kit-cta" href="index.html">&larr; Back to the recipes</a>' +
      "</div>";
  }

  /* ---------- the side card ---------- */

  function renderSide() {
    var weights = MiseStore.logOfType(me(), "weight").map(function (e) { return { d: e.d, v: e.kg }; });
    var t = weights.length ? MiseProgress.trend(weights) : [];
    var now = t.length ? t[t.length - 1].v : null;

    var since = todayLocal();
    var weekAgo = new Date(Date.parse(since + "T00:00:00Z") - 6 * 86400000).toISOString().slice(0, 10);
    var runsWeek = MiseStore.logOfType(me(), "run").filter(function (e) { return e.d >= weekAgo; });
    var liftsWeek = MiseStore.logOfType(me(), "lift").filter(function (e) { return e.d >= weekAgo; });
    var km = runsWeek.reduce(function (n, e) { return n + e.km; }, 0);
    var vol = liftsWeek.reduce(function (n, e) { return n + MiseProgress.volume(e.sets, e.reps, e.kg); }, 0);

    $("#log-side").innerHTML =
      '<div class="kit-card kit-card--id">' +
        '<span class="tape mono" aria-hidden="true">THIS WEEK</span>' +
        (now !== null
          ? '<p class="log-side-label mono">WEIGHT TREND</p>' +
            '<p class="kit-name">' + round1(showKg(now)) + '<span class="log-side-unit">' + wUnit() + "</span></p>"
          : '<p class="log-side-none">No weigh-ins yet.</p>') +
        '<p class="auth-stats mono">' +
          runsWeek.length + " RUN" + (runsWeek.length === 1 ? "" : "S") + " · " + round1(showKm(km)) + " " + dUnit().toUpperCase() +
          "<br>" + liftsWeek.length + " LIFT" + (liftsWeek.length === 1 ? "" : "S") + " · " +
          Math.round(showKg(vol)).toLocaleString() + " " + wUnit().toUpperCase() + " MOVED" +
        "</p>" +
        '<div class="kit-plus">' +
          '<p class="log-side-label mono">UNITS</p>' +
          '<div class="chip-row">' +
            '<button type="button" class="chip nut-unit' + (imperial() ? " on" : "") + '" data-units="imperial">lb / mi</button>' +
            '<button type="button" class="chip nut-unit' + (imperial() ? "" : " on") + '" data-units="metric">kg / km</button>' +
          "</div>" +
        "</div>" +
        '<a class="log-side-link mono" href="profile.html">YOUR KITCHEN &rarr;</a>' +
      "</div>";

    $("#log-side").querySelectorAll("[data-units]").forEach(function (b) {
      b.addEventListener("click", function () {
        units = this.getAttribute("data-units");
        saveUnits();
        render();   // every number on the page is in these units
      });
    });
  }

  /* ---------- weight ---------- */

  /* Always syncs the NEWEST weigh-in, never "the one just added": a backdated
     entry then can't overwrite today's weight, and deleting the latest falls
     back to the one before it.

     Called from renderWeight() rather than from each handler, so it also runs
     on a plain page load. Without that, this card can show a target computed
     from a weight someone typed into their profile weeks ago while claiming
     the target follows their weigh-ins — the page would be contradicting
     itself. Once you're logging, the log is what you weigh; type a different
     number in the profile and the next weigh-in wins, which is the promise.
     Idempotent, so calling it on every render costs a no-op write at worst. */
  function maybeSyncWeight() {
    var ws = MiseStore.logOfType(me(), "weight");
    if (!ws.length) return;
    MiseStore.syncNutritionWeight(me(), ws[ws.length - 1].kg);
  }

  function renderWeight() {
    maybeSyncWeight();
    var entries = MiseStore.logOfType(me(), "weight");
    var points = entries.map(function (e) { return { d: e.d, v: e.kg }; });
    var t = points.length ? MiseProgress.trend(points) : [];
    var now = t.length ? t[t.length - 1] : null;
    var c = MiseProgress.change(points, 28);
    var warns = MiseProgress.warnings(points);
    var target = MiseStore.calorieTarget(me());
    var hasProfile = !!MiseStore.nutrition(me());

    var deltaLine = "";
    if (c) {
      var d = showKg(c.delta);
      var dir = c.delta > 0 ? "up" : c.delta < 0 ? "down" : "level";
      deltaLine = '<p class="log-delta mono">' +
        (dir === "level" ? "LEVEL" : dir.toUpperCase() + " " + round1(Math.abs(d)) + " " + wUnit().toUpperCase()) +
        " OVER " + c.spanDays + " DAYS" + (c.complete ? "" : " (ALL YOU'VE LOGGED)") + "</p>";
    }

    $("#log-weight").innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">WEIGHT</span>' +
        "<h2>What you weigh</h2>" +
        '<p class="kit-lede">Weigh yourself whenever you like &mdash; the number that matters is the ' +
          MiseProgress.TREND_DAYS + "-day trend, not today&rsquo;s reading. Bodyweight swings a " +
          "kilo or two on water and food alone, which is more than a good week of real change.</p>" +

        (now !== null
          ? '<div class="nut-result">' +
              '<p class="nut-result-label mono">YOUR TREND</p>' +
              '<p class="nut-big">' + round1(showKg(now.v)) + ' <span class="nut-big-unit">' + wUnit() + "</span></p>" +
              deltaLine +
              (now.n === 1
                ? '<p class="log-note">That&rsquo;s one reading, so it&rsquo;s just that reading. ' +
                  "A few more and the trend starts meaning something.</p>"
                : "") +
              warns.map(function (w) { return '<p class="nut-warn">' + esc(w) + "</p>"; }).join("") +
            "</div>" +
            chartSVG(points, {
              label: "Weight over time, with the " + MiseProgress.TREND_DAYS + "-day trend. " +
                (c ? "Trend " + round1(showKg(now.v)) + " " + wUnit() + "." : ""),
              format: function (v) { return round1(showKg(v)); }
            })
          : '<p class="kit-none">Nothing logged yet. Put a number in below and the trend builds itself.</p>') +

        // The loop the calorie target opens — only meaningful once a profile exists.
        (hasProfile
          ? '<p class="log-link mono">' +
              (target
                ? "YOUR CALORIE TARGET FOLLOWS THIS &middot; NOW " + target + " KCAL/DAY"
                : "YOUR CALORIE TARGET FOLLOWS THIS &middot; <span class=\"log-link-locked\">MISE PLUS TO SEE IT</span>") +
            "</p>"
          : '<p class="log-link mono log-link--muted">SET UP A CALORIE TARGET IN ' +
            '<a href="profile.html">YOUR KITCHEN</a> AND IT WILL FOLLOW THESE WEIGH-INS</p>') +

        '<form class="log-form" id="weight-form">' +
          '<label class="nut-field"><span class="mono">DATE</span>' +
            '<input type="date" id="w-date" max="' + todayLocal() + '" value="' + todayLocal() + '" required></label>' +
          '<label class="nut-field"><span class="mono">WEIGHT</span>' +
            '<span class="nut-pair"><input type="number" id="w-kg" step="0.1" min="1" inputmode="decimal" placeholder="' +
              (imperial() ? "175" : "80") + '" required><em>' + wUnit() + "</em></span></label>" +
          '<button type="submit" class="ing-add">Log it</button>' +
        "</form>" +
        '<p class="log-err" id="w-err" hidden></p>' +

        (entries.length ? historyHTML(entries.slice().reverse(), function (e) {
          return round1(showKg(e.kg)) + " " + wUnit();
        }) : "") +
      "</div>";

    $("#weight-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var date = $("#w-date").value;
      var val = parseFloat($("#w-kg").value);
      var err = $("#w-err");
      if (!date || !isFinite(val) || val <= 0) return;
      if (date > todayLocal()) { showErr(err, "That date is in the future."); return; }
      var kg = readKg(val);
      // The same bounds nutrition.js uses, so the log can't feed it a body it
      // would refuse to compute for.
      if (kg < MiseNutrition.LIMITS.weightKg.min || kg > MiseNutrition.LIMITS.weightKg.max) {
        showErr(err, "That weight looks off — check the units and try again.");
        return;
      }
      MiseStore.addLogEntry(me(), { d: date, t: "weight", kg: kg });
      renderWeight();   // re-syncs the profile weight on the way through
      renderSide();
    });

    wireDelete("#log-weight", function () { renderWeight(); renderSide(); });
  }

  function showErr(el, msg) {
    el.hidden = false;
    el.textContent = msg;
  }

  /* ---------- lifts ---------- */

  function renderLifts() {
    var entries = MiseStore.logOfType(me(), "lift");

    // Best estimated 1RM per exercise, and the heaviest actually lifted.
    var best = {};
    entries.forEach(function (e) {
      var est = MiseProgress.epley1RM(e.kg, e.reps);
      var b = best[e.ex] || (best[e.ex] = { ex: e.ex, est: null, top: 0, when: e.d });
      if (est !== null && (b.est === null || est > b.est)) { b.est = est; b.when = e.d; }
      if (e.kg > b.top) b.top = e.kg;
    });
    var prs = Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return (b.est || b.top) - (a.est || a.top); });

    $("#log-lifts").innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">LIFTS</span>' +
        "<h2>What you lifted</h2>" +
        '<p class="kit-lede">Sets, reps and load. The estimated 1RM is Epley&rsquo;s formula &mdash; ' +
          "a decent guess up to about " + MiseProgress.MAX_REPS_1RM + " reps and useless past it, so " +
          "higher-rep sets don&rsquo;t get one. It&rsquo;s a number for watching a line move, " +
          "<strong>not a lift to go and attempt</strong>.</p>" +

        (prs.length
          ? '<p class="modal-section-title">Your best</p>' +
            '<ul class="kit-list log-pr-list">' +
              prs.map(function (b) {
                return "<li><div class=\"log-pr\">" +
                  '<span class="kit-row-name">' + esc(b.ex) + "</span>" +
                  '<span class="kit-row-meta mono">' +
                    (b.est !== null ? "EST. 1RM " + round1(showKg(b.est)) + " " + wUnit().toUpperCase() + " · " : "") +
                    "TOP SET " + round1(showKg(b.top)) + " " + wUnit().toUpperCase() +
                  "</span>" +
                "</div></li>";
              }).join("") +
            "</ul>"
          : "") +

        '<form class="log-form log-form--wide" id="lift-form">' +
          '<label class="nut-field"><span class="mono">DATE</span>' +
            '<input type="date" id="l-date" max="' + todayLocal() + '" value="' + todayLocal() + '" required></label>' +
          '<label class="nut-field nut-field--grow"><span class="mono">LIFT</span>' +
            '<input type="text" id="l-ex" list="lift-names" maxlength="40" placeholder="Back squat" required></label>' +
          '<datalist id="lift-names">' +
            COMMON_LIFTS.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") +
          "</datalist>" +
          '<label class="nut-field nut-field--sm"><span class="mono">SETS</span>' +
            '<input type="number" id="l-sets" min="1" max="99" inputmode="numeric" placeholder="3" required></label>' +
          '<label class="nut-field nut-field--sm"><span class="mono">REPS</span>' +
            '<input type="number" id="l-reps" min="1" max="99" inputmode="numeric" placeholder="5" required></label>' +
          '<label class="nut-field"><span class="mono">LOAD</span>' +
            '<span class="nut-pair"><input type="number" id="l-kg" step="0.5" min="1" inputmode="decimal" placeholder="' +
              (imperial() ? "225" : "100") + '" required><em>' + wUnit() + "</em></span></label>" +
          '<button type="submit" class="ing-add">Log it</button>' +
        "</form>" +
        '<p class="log-err" id="l-err" hidden></p>' +

        (entries.length ? historyHTML(entries.slice().reverse(), function (e) {
          var est = MiseProgress.epley1RM(e.kg, e.reps);
          return esc(e.ex) + " · " + e.sets + "×" + e.reps + " @ " + round1(showKg(e.kg)) + " " + wUnit() +
            (est !== null ? ' <span class="log-hist-note">≈' + round1(showKg(est)) + " 1RM</span>" : "");
        }) : "") +
      "</div>";

    $("#lift-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var err = $("#l-err");
      var date = $("#l-date").value;
      var ex = $("#l-ex").value.trim();
      var sets = parseInt($("#l-sets").value, 10);
      var reps = parseInt($("#l-reps").value, 10);
      var val = parseFloat($("#l-kg").value);
      if (!date || !ex || !(sets > 0) || !(reps > 0) || !isFinite(val) || val <= 0) return;
      if (date > todayLocal()) { showErr(err, "That date is in the future."); return; }
      MiseStore.addLogEntry(me(), {
        d: date, t: "lift", ex: ex, sets: sets, reps: reps, kg: readKg(val)
      });
      renderLifts();
      renderSide();
    });

    wireDelete("#log-lifts", function () { renderLifts(); renderSide(); });
  }

  /* ---------- runs ---------- */

  function renderRuns() {
    var entries = MiseStore.logOfType(me(), "run");
    // Pace, so the chart shows effort rather than how far you felt like going.
    var points = entries.map(function (e) { return { d: e.d, v: MiseProgress.pace(e.km, e.mins) }; })
      .filter(function (p) { return p.v !== null; });

    var totalKm = entries.reduce(function (n, e) { return n + e.km; }, 0);
    var bestPace = null;
    entries.forEach(function (e) {
      var p = MiseProgress.pace(e.km, e.mins);
      if (p !== null && (bestPace === null || p < bestPace)) bestPace = p;
    });

    // Pace is per km or per mile depending on the toggle; convert before formatting.
    function paceIn(p) { return imperial() ? p * 1.609344 : p; }

    $("#log-runs").innerHTML =
      '<div class="kit-card">' +
        '<span class="tape mono" aria-hidden="true">RUNS</span>' +
        "<h2>How far you ran</h2>" +
        '<p class="kit-lede">Distance and time; pace is the two divided. The chart tracks pace, ' +
          "not distance &mdash; a short quick run and a long slow one aren&rsquo;t the same thing, " +
          "and pace is the one that says whether the engine is changing.</p>" +

        (entries.length
          ? '<div class="nut-result">' +
              '<p class="nut-result-label mono">BEST PACE</p>' +
              '<p class="nut-big">' + MiseProgress.formatPace(paceIn(bestPace)) +
                ' <span class="nut-big-unit">/' + dUnit() + "</span></p>" +
              '<p class="nut-math mono">' + entries.length + " RUN" + (entries.length === 1 ? "" : "S") +
                " · " + round1(showKm(totalKm)) + " " + dUnit().toUpperCase() + " TOTAL</p>" +
            "</div>" +
            (points.length > 1
              ? chartSVG(points, {
                  label: "Running pace over time, with the " + MiseProgress.TREND_DAYS + "-day trend. " +
                    "Best " + MiseProgress.formatPace(paceIn(bestPace)) + " per " + dUnit() + ".",
                  format: function (v) { return MiseProgress.formatPace(paceIn(v)); }
                })
              : "")
          : '<p class="kit-none">Nothing logged yet. Add a run below.</p>') +

        '<form class="log-form" id="run-form">' +
          '<label class="nut-field"><span class="mono">DATE</span>' +
            '<input type="date" id="r-date" max="' + todayLocal() + '" value="' + todayLocal() + '" required></label>' +
          '<label class="nut-field"><span class="mono">DISTANCE</span>' +
            '<span class="nut-pair"><input type="number" id="r-km" step="0.01" min="0.1" inputmode="decimal" placeholder="' +
              (imperial() ? "3.1" : "5") + '" required><em>' + dUnit() + "</em></span></label>" +
          '<label class="nut-field"><span class="mono">TIME</span>' +
            '<span class="nut-pair"><input type="number" id="r-mins" step="0.1" min="1" inputmode="decimal" placeholder="26" required><em>min</em></span></label>' +
          '<button type="submit" class="ing-add">Log it</button>' +
        "</form>" +
        '<p class="log-err" id="r-err" hidden></p>' +

        (entries.length ? historyHTML(entries.slice().reverse(), function (e) {
          var p = MiseProgress.pace(e.km, e.mins);
          return round1(showKm(e.km)) + " " + dUnit() + " · " + round1(e.mins) + " min" +
            (p !== null ? ' <span class="log-hist-note">' + MiseProgress.formatPace(paceIn(p)) + "/" + dUnit() + "</span>" : "");
        }) : "") +
      "</div>";

    $("#run-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var err = $("#r-err");
      var date = $("#r-date").value;
      var dist = parseFloat($("#r-km").value);
      var mins = parseFloat($("#r-mins").value);
      if (!date || !isFinite(dist) || dist <= 0 || !isFinite(mins) || mins <= 0) return;
      if (date > todayLocal()) { showErr(err, "That date is in the future."); return; }
      MiseStore.addLogEntry(me(), { d: date, t: "run", km: readKm(dist), mins: mins });
      renderRuns();
      renderSide();
    });

    wireDelete("#log-runs", function () { renderRuns(); renderSide(); });
  }

  /* ---------- shared history list ---------- */

  function historyHTML(entries, describe) {
    return '<p class="modal-section-title">History</p>' +
      '<ul class="kit-list log-hist">' +
        entries.map(function (e) {
          return "<li><div class=\"log-hist-row\">" +
            '<span class="log-hist-date mono">' + esc(prettyDate(e.d)) + "</span>" +
            '<span class="log-hist-what">' + describe(e) + "</span>" +
            '<button class="kit-review-del log-hist-del mono" data-del="' + esc(e.id) +
              '" type="button">DELETE</button>' +
          "</div></li>";
        }).join("") +
      "</ul>";
  }

  // Two presses, same as the review delete: nothing here is recoverable.
  function wireDelete(sectionSel, after) {
    host.querySelectorAll(sectionSel + " [data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (this.getAttribute("data-armed") !== "yes") {
          this.setAttribute("data-armed", "yes");
          this.classList.add("kit-review-del--arm");
          this.textContent = "SURE?";
          return;
        }
        MiseStore.removeLogEntry(me(), this.getAttribute("data-del"));
        after();
      });
      b.addEventListener("blur", function () {
        this.setAttribute("data-armed", "no");
        this.classList.remove("kit-review-del--arm");
        this.textContent = "DELETE";
      });
    });
  }

  /* ---------- boot ---------- */

  MisePlusUI.onChange(function () {
    if (account) renderWeight();   // the calorie-target line follows the entitlement
  });

  if (realAuth) {
    MiseAuth.onChange(function (user) {
      account = user ? { id: user.id, name: user.name, email: user.email } : null;
      ready = true;
      render();
    });
    setTimeout(function () {
      if (ready) return;
      ready = true;
      unreachable = true;
      render();
    }, 8000);
  }

  render();
})();
