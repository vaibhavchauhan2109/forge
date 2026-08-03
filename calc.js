/* ============================================================
   FORGE — body composition & nutrition math
   Pure functions only. No storage, no DOM.
   ============================================================ */
const Calc = (() => {

  const KCAL_PER_KG_FAT = 7700;   // ~3500 kcal per lb

  const ACTIVITY = [
    { v: 1.20,  label: 'Sedentary',   hint: 'Desk job, little movement' },
    { v: 1.375, label: 'Light',       hint: '2–3 sessions/week' },
    { v: 1.45,  label: 'Moderate',    hint: '4–5 sessions/week' },
    { v: 1.55,  label: 'Active',      hint: '6 sessions/week + 8k steps' },
    { v: 1.725, label: 'Very active', hint: 'Physical job + daily training' }
  ];

  /* Body fat % at which abs are typically visible */
  const ABS_THRESHOLD = { male: 11, female: 19 };

  const MODES = {
    cut:      { label: 'Cut',        deltaPct: -0.20, proteinPerKg: 2.2,
                blurb: 'Lose fat fast. Some strength risk.' },
    recomp:   { label: 'Recomp',     deltaPct: -0.05, proteinPerKg: 2.1,
                blurb: 'Lose fat and build muscle at once. Slower, best for abs + lean mass.' },
    leanBulk: { label: 'Lean bulk',  deltaPct:  0.10, proteinPerKg: 1.9,
                blurb: 'Prioritise muscle. Accept slight fat gain.' }
  };

  /* Realistic max lean mass gain, kg per month */
  const LBM_GAIN_CAP = { novice: 1.0, intermediate: 0.45, advanced: 0.2 };

  /* ---------------- unit helpers ---------------- */
  const kgToLb = kg => kg * 2.20462;
  const lbToKg = lb => lb / 2.20462;
  const cmToIn = cm => cm / 2.54;
  const inToCm = i  => i * 2.54;
  const r = (n, d = 0) => {
    const f = 10 ** d;
    return Math.round((n + Number.EPSILON) * f) / f;
  };

  const age = birthYear => new Date().getFullYear() - Number(birthYear || 0);

  /* ---------------- BMI ---------------- */
  function bmi(kg, cm) {
    if (!kg || !cm) return null;
    return kg / ((cm / 100) ** 2);
  }

  function bmiCategory(b) {
    if (b == null)  return { label: '—',          tone: 'dim' };
    if (b < 18.5)   return { label: 'Underweight', tone: 'warn' };
    if (b < 25)     return { label: 'Normal',      tone: 'good' };
    if (b < 30)     return { label: 'Overweight',  tone: 'warn' };
    return            { label: 'Obese',       tone: 'bad' };
  }

  /* Waist-to-height ratio — a better health signal than BMI for a lifter,
     because BMI can't tell muscle from fat. Target < 0.5. */
  function whtr(waistCm, heightCm) {
    if (!waistCm || !heightCm) return null;
    return waistCm / heightCm;
  }

  function whtrCategory(w) {
    if (w == null) return { label: '—',       tone: 'dim' };
    if (w < 0.43)  return { label: 'Very lean', tone: 'good' };
    if (w < 0.50)  return { label: 'Healthy',   tone: 'good' };
    if (w < 0.58)  return { label: 'Elevated',  tone: 'warn' };
    return           { label: 'High',      tone: 'bad' };
  }

  /* ---------------- body fat ---------------- */

  /** US Navy tape method. Inputs in cm. Accurate to roughly ±3%. */
  function navyBodyFat({ sex, waistCm, neckCm, heightCm, hipCm }) {
    if (!waistCm || !neckCm || !heightCm) return null;
    const log = Math.log10;
    let pct;
    if (sex === 'female') {
      if (!hipCm) return null;
      pct = 495 / (1.29579 - 0.35004 * log(waistCm + hipCm - neckCm)
                            + 0.22100 * log(heightCm)) - 450;
    } else {
      if (waistCm - neckCm <= 0) return null;
      pct = 495 / (1.0324 - 0.19077 * log(waistCm - neckCm)
                          + 0.15456 * log(heightCm)) - 450;
    }
    return (pct > 2 && pct < 60) ? pct : null;
  }

  /** Manual entry wins; otherwise fall back to the tape estimate. */
  function bodyFat(p) {
    if (p.bodyFatPct != null && p.bodyFatPct > 0)
      return { pct: p.bodyFatPct, source: 'manual' };
    const nav = navyBodyFat(p);
    if (nav != null) return { pct: nav, source: 'tape' };
    return { pct: null, source: null };
  }

  const leanMassKg = (kg, bfPct) => (kg && bfPct != null) ? kg * (1 - bfPct / 100) : null;
  const fatMassKg  = (kg, bfPct) => (kg && bfPct != null) ? kg * (bfPct / 100)     : null;

  /** Fat-free mass index — lean mass relative to height. The honest "how muscular" number. */
  function ffmi(leanKg, heightCm) {
    if (!leanKg || !heightCm) return null;
    return leanKg / ((heightCm / 100) ** 2);
  }

  /** Height-adjusted to a 1.8 m reference, so tall and short lifters compare fairly. */
  function ffmiNormalised(leanKg, heightCm) {
    const f = ffmi(leanKg, heightCm);
    return f == null ? null : f + 6.1 * (1.8 - heightCm / 100);
  }

  function ffmiCategory(f) {
    if (f == null)   return { label: '—',                tone: 'dim'  };
    if (f < 17)      return { label: 'Below average',    tone: 'dim'  };
    if (f < 18.5)    return { label: 'Average',          tone: 'dim'  };
    if (f < 20)      return { label: 'Fit',              tone: 'good' };
    if (f < 21.5)    return { label: 'Athletic',         tone: 'good' };
    if (f < 23)      return { label: 'Well built',       tone: 'good' };
    if (f < 25)      return { label: 'Advanced natural', tone: 'good' };
    return             { label: 'Beyond natural range', tone: 'warn' };
  }

  /** Lean mass required to reach a given FFMI at your height. */
  const leanForFFMI = (target, heightCm) =>
    (target && heightCm) ? target * ((heightCm / 100) ** 2) : null;

  /* ---------------- energy ---------------- */

  /** Mifflin–St Jeor — the standard when body fat is unknown. */
  function bmrMifflin({ sex, weightKg, heightCm, birthYear }) {
    if (!weightKg || !heightCm) return null;
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age(birthYear);
    return sex === 'female' ? base - 161 : base + 5;
  }

  /** Katch–McArdle — more accurate when we know lean mass. */
  function bmrKatch(lbm) {
    return lbm ? 370 + 21.6 * lbm : null;
  }

  /** Picks the best formula available for this profile. */
  function bmr(p) {
    const bf  = bodyFat(p).pct;
    const lbm = leanMassKg(p.weightKg, bf);
    return bmrKatch(lbm) ?? bmrMifflin(p);
  }

  function tdee(p) {
    const b = bmr(p);
    return b ? b * (Number(p.activity) || 1.45) : null;
  }

  /* ---------------- daily targets ---------------- */

  function targets(p) {
    const base = tdee(p);
    if (!base) return null;

    const mode = MODES[p.goalMode] || MODES.recomp;
    const bf   = bodyFat(p).pct;
    const lbm  = leanMassKg(p.weightKg, bf);

    /* calories */
    let kcal = p.kcalOverride ?? base * (1 + mode.deltaPct);
    /* safety floor: never below BMR — that's where muscle loss and misery live */
    const floor = Math.max(bmr(p) * 1.05, p.sex === 'female' ? 1200 : 1500);
    kcal = Math.max(kcal, floor);
    kcal = Math.round(kcal / 10) * 10;

    /* protein — scaled to lean mass when there's a lot of fat to lose,
       otherwise to bodyweight. Higher when in a deficit (muscle sparing). */
    let protein;
    if (p.proteinOverride) {
      protein = p.proteinOverride;
    } else if (bf != null && bf > 25 && lbm) {
      protein = 2.6 * lbm;
    } else {
      protein = mode.proteinPerKg * p.weightKg;
    }
    protein = Math.round(Math.max(protein, 1.6 * p.weightKg) / 5) * 5;

    /* fat — floor for hormones, ~22% of calories otherwise */
    let fat = Math.max(0.6 * p.weightKg, kcal * 0.22 / 9);

    /* carbs get the remainder */
    let carbs = (kcal - protein * 4 - fat * 9) / 4;
    if (carbs < 30) {                      // squeeze fat before starving carbs
      fat   = Math.max(0.5 * p.weightKg, (kcal - protein * 4 - 30 * 4) / 9);
      carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
    }

    return {
      bmr:       Math.round(bmr(p)),
      tdee:      Math.round(base),
      kcal,
      protein,
      fat:       Math.round(fat),
      carbs:     Math.round(carbs),
      deltaKcal: Math.round(kcal - base),
      proteinPerKg: r(protein / p.weightKg, 2),
      mode:      mode.label,
      modeBlurb: mode.blurb,
      overridden: p.kcalOverride != null
    };
  }

  /** kg per week implied by a daily calorie delta. */
  const weeklyRate = dailyDeltaKcal => (dailyDeltaKcal * 7) / KCAL_PER_KG_FAT;

  /* ---------------- goal planning ---------------- */

  /**
   * Works out whether "target body fat % by target date" is actually possible,
   * assuming lean mass is held (or gained, if bulking/recomping).
   */
  function plan(p) {
    const bf = bodyFat(p).pct;
    if (bf == null || !p.weightKg || !p.targetDate) return null;

    const daysLeft = Store.daysBetween(Store.dayKey(), p.targetDate);
    if (daysLeft <= 0) return { expired: true, daysLeft };

    const weeksLeft  = daysLeft / 7;
    const monthsLeft = daysLeft / 30.44;

    const lbm       = leanMassKg(p.weightKg, bf);
    const cap       = LBM_GAIN_CAP[p.experience] ?? 0.45;
    /* only assume muscle gain if we're not in a hard cut */
    const lbmGain   = p.goalMode === 'cut' ? 0 : cap * monthsLeft * 0.7; // 70% of theoretical max
    const goalLbm   = lbm + lbmGain;

    const goalWeight  = goalLbm / (1 - p.targetBodyFatPct / 100);
    const fatToLoseKg = p.weightKg - goalWeight;

    const rateKgPerWeek = fatToLoseKg / weeksLeft;
    const pctPerWeek    = (rateKgPerWeek / p.weightKg) * 100;
    const dailyDeficit  = Math.round((rateKgPerWeek * KCAL_PER_KG_FAT) / 7);

    /* verdict on the required rate */
    let verdict, tone;
    if (fatToLoseKg <= 0)      { verdict = 'Already there — switch to lean bulk'; tone = 'good'; }
    else if (pctPerWeek < 0.35){ verdict = 'Comfortable';        tone = 'good'; }
    else if (pctPerWeek < 0.65){ verdict = 'On track';           tone = 'good'; }
    else if (pctPerWeek < 0.90){ verdict = 'Aggressive';         tone = 'warn'; }
    else if (pctPerWeek < 1.20){ verdict = 'Very aggressive';    tone = 'warn'; }
    else                       { verdict = 'Not realistic';      tone = 'bad';  }

    /* what date is realistic at a muscle-sparing 0.65%/week? */
    const safeRate      = p.weightKg * 0.0065;
    const realisticWeeks = fatToLoseKg > 0 ? fatToLoseKg / safeRate : 0;
    const realisticDate  = Store.addDays(Store.dayKey(), Math.round(realisticWeeks * 7));

    return {
      expired: false,
      daysLeft, weeksLeft: r(weeksLeft, 1), monthsLeft: r(monthsLeft, 1),
      currentBf: r(bf, 1),
      targetBf: p.targetBodyFatPct,
      lbm: r(lbm, 1),
      projectedLbm: r(goalLbm, 1),
      lbmGain: r(lbmGain, 1),
      goalWeight: r(goalWeight, 1),
      fatToLoseKg: r(fatToLoseKg, 1),
      rateKgPerWeek: r(rateKgPerWeek, 2),
      pctPerWeek: r(pctPerWeek, 2),
      dailyDeficit,
      verdict, tone,
      realisticWeeks: Math.round(realisticWeeks),
      realisticDate
    };
  }

  /** How far you are from visible abs, right now. */
  function absOutlook(p) {
    const bf = bodyFat(p).pct;
    const threshold = ABS_THRESHOLD[p.sex] ?? 11;
    if (bf == null) return null;
    const toGo = bf - threshold;
    if (toGo <= 0) return { visible: true, threshold, pctToGo: 0, weeks: 0 };
    const lbm       = leanMassKg(p.weightKg, bf);
    const goalWt    = lbm / (1 - threshold / 100);
    const kgToLose  = p.weightKg - goalWt;
    const weeks     = Math.ceil(kgToLose / (p.weightKg * 0.0065));
    return { visible: false, threshold, pctToGo: r(toGo, 1), kgToLose: r(kgToLose, 1), weeks };
  }

  /** Suggests the right mode for where you are right now. */
  function suggestMode(p) {
    const bf = bodyFat(p).pct;
    if (bf == null) return { mode: 'recomp', why: 'Add measurements for a proper recommendation.' };
    const male = p.sex !== 'female';
    const hi   = male ? 18 : 26;
    const mid  = male ? 13 : 21;
    if (bf >= hi)  return { mode: 'cut',      why: `At ${r(bf,1)}% the fastest route to abs is a proper cut. Muscle will still grow if protein and training are dialled in.` };
    if (bf >= mid) return { mode: 'recomp',   why: `At ${r(bf,1)}% you're in the sweet spot for recomp — abs and lean mass at the same time.` };
    return           { mode: 'leanBulk', why: `At ${r(bf,1)}% you're already lean. Build now, reveal later with a short cut.` };
  }

  /** One object with everything the dashboard screens need. */
  function summary(p) {
    const bfInfo = bodyFat(p);
    const b      = bmi(p.weightKg, p.heightCm);
    const w      = whtr(p.waistCm, p.heightCm);
    return {
      age:      age(p.birthYear),
      bmi:      b ? r(b, 1) : null,
      bmiCat:   bmiCategory(b),
      whtr:     w ? r(w, 3) : null,
      whtrCat:  whtrCategory(w),
      bodyFat:  bfInfo.pct != null ? r(bfInfo.pct, 1) : null,
      bfSource: bfInfo.source,
      leanMass: r(leanMassKg(p.weightKg, bfInfo.pct) ?? 0, 1) || null,
      fatMass:  r(fatMassKg(p.weightKg, bfInfo.pct) ?? 0, 1) || null,
      ffmi:     r(ffmi(leanMassKg(p.weightKg, bfInfo.pct), p.heightCm) ?? 0, 1) || null,
      ffmiNorm: r(ffmiNormalised(leanMassKg(p.weightKg, bfInfo.pct), p.heightCm) ?? 0, 1) || null,
      ffmiCat:  ffmiCategory(ffmi(leanMassKg(p.weightKg, bfInfo.pct), p.heightCm)),
      targets:  targets(p),
      plan:     plan(p),
      abs:      absOutlook(p),
      suggest:  suggestMode(p)
    };
  }

  return {
    KCAL_PER_KG_FAT, ACTIVITY, MODES, LBM_GAIN_CAP, ABS_THRESHOLD,
    kgToLb, lbToKg, cmToIn, inToCm, r, age,
    bmi, bmiCategory, whtr, whtrCategory,
    navyBodyFat, bodyFat, leanMassKg, fatMassKg,
    ffmi, ffmiNormalised, ffmiCategory, leanForFFMI,
    bmrMifflin, bmrKatch, bmr, tdee, targets, weeklyRate,
    plan, absOutlook, suggestMode, summary
  };
})();
