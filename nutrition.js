/* Myse — calorie-goal maths.
 *
 * Pure functions, no DOM, no storage: given a profile, return numbers. Kept
 * separate from the UI so the arithmetic can be checked on its own.
 *
 * THIS IS AN ESTIMATE, NOT A PRESCRIPTION. Every equation here is a population
 * average fitted to healthy adults; a real person can sit well off it. The UI
 * says so, and MiseNutrition.warnings() returns the cases where the number
 * should not be trusted at all.
 */

var MiseNutrition = (function () {
  "use strict";

  /* Mifflin-St Jeor (Am J Clin Nutr 1990;51:241-247). The Academy of Nutrition
     and Dietetics recommends it over Harris-Benedict for healthy adults, using
     ACTUAL body weight. Lands within 10% of measured RMR for ~82% of nonobese
     and ~70% of obese adults — i.e. it is a decent average, not your number.
       men:   10*kg + 6.25*cm - 5*age + 5
       women: 10*kg + 6.25*cm - 5*age - 161
     Published form: 9.99*kg + 6.25*cm - 4.92*age + 166*sex - 161 (sex: M=1,F=0);
     the rounded sex-split version above is the same equation and is what every
     calculator uses.

     `unspecified` is the midpoint of the two constants. Be honest about what
     that is: there is NO validated sex-neutral form of this equation, and the
     male/female gap is exactly 166 kcal/day (~9% of a typical BMR), so this
     option carries real error. It exists so someone who won't state a sex gets
     a usable number instead of a wall — the UI says as much. The properly
     sex-free option is Katch-McArdle (370 + 21.6 * lean mass kg), which needs a
     body-fat percentage most people don't have. */
  var SEX_CONSTANT = { male: 5, female: -161, unspecified: -78 };

  /* The activity multipliers are convention, not science: they are not in
     Mifflin's paper and no guideline body publishes them. They also introduce
     more error than the choice of BMR equation does — picking the wrong row
     here moves the answer by hundreds of kcal. Kept because every calculator
     uses them and there is no better simple option. */
  var ACTIVITY = {
    sedentary: { mult: 1.2,   label: "Sedentary",         hint: "desk job, little or no exercise" },
    light:     { mult: 1.375, label: "Lightly active",    hint: "light exercise 1–3 days a week" },
    moderate:  { mult: 1.55,  label: "Moderately active", hint: "moderate exercise 3–5 days a week" },
    very:      { mult: 1.725, label: "Very active",       hint: "hard exercise 6–7 days a week" },
    extra:     { mult: 1.9,   label: "Extra active",      hint: "hard daily exercise, or a physical job" }
  };

  /* Goal deltas. 3,500 kcal ≈ 1 lb of fat, so 500/day ≈ 1 lb/week — the rate
     usually described as sustainable. The bulk side is smaller on purpose:
     past roughly +500 the extra tends to arrive as fat rather than muscle. */
  var GOALS = {
    cut:      { delta: -500, label: "Cut",      hint: "lose fat — about 1 lb a week" },
    maintain: { delta: 0,    label: "Maintain", hint: "hold your current weight" },
    bulk:     { delta: 350,  label: "Bulk",     hint: "gain muscle — a lean surplus" }
  };

  /* Floors from the 2013 AHA/ACC/TOS obesity-management guideline, which
     prescribes 1,200-1,500 kcal/day for women and 1,500-1,800 for men when
     losing weight. These are the bottom of those ranges: below them it is hard
     to meet micronutrient needs and the guidance is that it should be medically
     supervised. We clamp rather than ever display a lower number. */
  var FLOOR = { female: 1200, male: 1500, unspecified: 1200 };

  var LIMITS = {
    age:      { min: 18, max: 100 },
    heightCm: { min: 120, max: 250 },
    weightKg: { min: 30,  max: 300 }
  };

  function lbToKg(lb) { return lb * 0.45359237; }
  function kgToLb(kg) { return kg / 0.45359237; }
  function inToCm(inches) { return inches * 2.54; }
  function cmToIn(cm) { return cm / 2.54; }

  function bmr(p) {
    var c = SEX_CONSTANT[p.sex];
    if (c === undefined) return null;
    return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + c;
  }

  function tdee(p) {
    var b = bmr(p);
    var a = ACTIVITY[p.activity];
    if (b === null || !a) return null;
    return b * a.mult;
  }

  /* The number the profile shows. Clamped at the floor — and `floored` is
     returned so the UI can say why, rather than silently showing a different
     figure than the maths implies. */
  function dailyCalories(p) {
    var t = tdee(p);
    var g = GOALS[p.goal];
    if (t === null || !g) return null;
    var target = t + g.delta;
    var floor = FLOOR[p.sex] || FLOOR.unspecified;
    return {
      bmr: Math.round(bmr(p)),
      tdee: Math.round(t),
      target: Math.round(Math.max(target, floor)),
      floored: target < floor,
      floor: floor,
      delta: g.delta
    };
  }

  /* Cases where the estimate should not be relied on. Returned rather than
     thrown: the UI shows them next to the number. */
  function warnings(p) {
    var out = [];
    if (p.sex === "unspecified") {
      out.push("Without a sex the equation has to split the difference, and male and female " +
        "differ by 166 kcal a day — so this number could be off by about 80 either way.");
    }
    if (p.age > 65) {
      // Older adults were underrepresented in both the derivation and the
      // validation cohorts; only ~43% of over-65s with obesity land within 10%.
      out.push("Over 65 this equation tends to overestimate, and older adults were barely " +
        "represented when it was built. Treat it as a loose starting point.");
    }
    if (p.activity === "extra") {
      // Mifflin puts only ~52% of athletes within 10% — a coin flip.
      out.push("If you train like an athlete, be sceptical: this equation only gets within " +
        "10% for about half of athletes. Track what actually happens and adjust.");
    }
    var bmi = p.weightKg / Math.pow(p.heightCm / 100, 2);
    if (bmi >= 35) {
      out.push("At a high BMI this equation drifts — it can underestimate by as much as 20%. " +
        "A dietitian can give you a far better number than any calculator.");
    }
    if (bmi < 17) {
      out.push("This estimate assumes a healthy adult weight range; please talk to a doctor before setting a target.");
    }
    return out;
  }

  /* Why a profile isn't usable yet — so the form can say "we can't do this for
     under-18s" instead of "fill in your age" at someone who just did. Returns
     null when the profile is fine. */
  function blocker(p) {
    if (!p) return "Fill in your age, height and weight to see your target.";
    var missing = ["age", "heightCm", "weightKg"].filter(function (k) {
      return typeof p[k] !== "number" || !isFinite(p[k]) || p[k] <= 0;
    });
    if (missing.length) return "Fill in your age, height and weight to see your target.";

    if (p.age < LIMITS.age.min) {
      return "This estimate is only for adults. Under 18, calorie needs depend on growth and " +
        "development — please get a target from a doctor rather than a calculator.";
    }
    if (p.age > LIMITS.age.max) return "Please enter an age between 18 and 100.";
    if (p.heightCm < LIMITS.heightCm.min || p.heightCm > LIMITS.heightCm.max) {
      return "That height looks off — check the units and try again.";
    }
    if (p.weightKg < LIMITS.weightKg.min || p.weightKg > LIMITS.weightKg.max) {
      return "That weight looks off — check the units and try again.";
    }
    return null;
  }

  function valid(p) {
    if (!p) return false;
    if (!GOALS[p.goal] || !ACTIVITY[p.activity] || SEX_CONSTANT[p.sex] === undefined) return false;
    var nums = ["age", "heightCm", "weightKg"];
    for (var i = 0; i < nums.length; i++) {
      var k = nums[i];
      var v = p[k];
      if (typeof v !== "number" || !isFinite(v)) return false;
      if (v < LIMITS[k].min || v > LIMITS[k].max) return false;
    }
    return true;
  }

  return {
    ACTIVITY: ACTIVITY,
    GOALS: GOALS,
    LIMITS: LIMITS,
    lbToKg: lbToKg, kgToLb: kgToLb, inToCm: inToCm, cmToIn: cmToIn,
    bmr: bmr,
    tdee: tdee,
    dailyCalories: dailyCalories,
    warnings: warnings,
    blocker: blocker,
    valid: valid
  };
})();
