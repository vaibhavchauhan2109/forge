/* ============================================================
   FORGE — training engine
   ============================================================ */
const Train = (() => {

  /* Weekly set landmarks per muscle (rough, per Israetel-style guidance) */
  const MUSCLES = [
    { key: 'chest',      label: 'Chest',      mev: 10, mav: 20 },
    { key: 'back',       label: 'Back',       mev: 10, mav: 22 },
    { key: 'shoulders',  label: 'Shoulders',  mev: 8,  mav: 20 },
    { key: 'biceps',     label: 'Biceps',     mev: 8,  mav: 18 },
    { key: 'triceps',    label: 'Triceps',    mev: 8,  mav: 18 },
    { key: 'quads',      label: 'Quads',      mev: 8,  mav: 18 },
    { key: 'hamstrings', label: 'Hamstrings', mev: 6,  mav: 16 },
    { key: 'glutes',     label: 'Glutes',     mev: 6,  mav: 16 },
    { key: 'calves',     label: 'Calves',     mev: 6,  mav: 16 },
    { key: 'core',       label: 'Core',       mev: 6,  mav: 16 }
  ];

  const muscleLabel = k => MUSCLES.find(m => m.key === k)?.label ?? k;

  /* ---------------- exercise library ---------------- */
  /* name, muscle, equipment, compound(1/0), repMin, repMax */
  const SEED_EX = [
    ['Barbell bench press','chest','barbell',1,5,8],
    ['Incline barbell press','chest','barbell',1,6,10],
    ['Dumbbell bench press','chest','dumbbell',1,8,12],
    ['Incline dumbbell press','chest','dumbbell',1,8,12],
    ['Machine chest press','chest','machine',1,8,12],
    ['Cable fly','chest','cable',0,12,15],
    ['Pec deck','chest','machine',0,12,15],
    ['Push-up','chest','bodyweight',1,10,20],
    ['Dip','chest','bodyweight',1,6,12],

    ['Deadlift','back','barbell',1,3,6],
    ['Rack pull','back','barbell',1,4,8],
    ['Barbell row','back','barbell',1,6,10],
    ['Pull-up','back','bodyweight',1,5,10],
    ['Chin-up','back','bodyweight',1,5,10],
    ['Lat pulldown','back','cable',1,8,12],
    ['Seated cable row','back','cable',1,8,12],
    ['Dumbbell row','back','dumbbell',1,8,12],
    ['Chest-supported row','back','machine',1,8,12],
    ['Straight-arm pulldown','back','cable',0,12,15],
    ['Face pull','back','cable',0,12,20],

    ['Overhead press','shoulders','barbell',1,5,8],
    ['Seated dumbbell press','shoulders','dumbbell',1,8,12],
    ['Machine shoulder press','shoulders','machine',1,8,12],
    ['Lateral raise','shoulders','dumbbell',0,12,20],
    ['Cable lateral raise','shoulders','cable',0,12,20],
    ['Rear delt fly','shoulders','dumbbell',0,12,20],

    ['Barbell curl','biceps','barbell',0,8,12],
    ['Dumbbell curl','biceps','dumbbell',0,8,12],
    ['Incline dumbbell curl','biceps','dumbbell',0,10,15],
    ['Hammer curl','biceps','dumbbell',0,10,15],
    ['Cable curl','biceps','cable',0,10,15],
    ['Preacher curl','biceps','machine',0,10,15],

    ['Close-grip bench press','triceps','barbell',1,6,10],
    ['Triceps pushdown','triceps','cable',0,10,15],
    ['Overhead cable extension','triceps','cable',0,10,15],
    ['Skull crusher','triceps','barbell',0,8,12],
    ['Dumbbell kickback','triceps','dumbbell',0,12,20],

    ['Barbell squat','quads','barbell',1,5,8],
    ['Front squat','quads','barbell',1,5,8],
    ['Leg press','quads','machine',1,8,15],
    ['Hack squat','quads','machine',1,8,12],
    ['Bulgarian split squat','quads','dumbbell',1,8,12],
    ['Walking lunge','quads','dumbbell',1,10,15],
    ['Goblet squat','quads','dumbbell',1,10,15],
    ['Leg extension','quads','machine',0,12,20],

    ['Romanian deadlift','hamstrings','barbell',1,6,10],
    ['Stiff-leg deadlift','hamstrings','barbell',1,6,10],
    ['Lying leg curl','hamstrings','machine',0,10,15],
    ['Seated leg curl','hamstrings','machine',0,10,15],
    ['Nordic curl','hamstrings','bodyweight',0,5,10],

    ['Barbell hip thrust','glutes','barbell',1,8,12],
    ['Cable kickback','glutes','cable',0,12,20],
    ['Glute bridge','glutes','bodyweight',0,12,20],

    ['Standing calf raise','calves','machine',0,10,15],
    ['Seated calf raise','calves','machine',0,12,20],

    ['Hanging leg raise','core','bodyweight',0,10,15],
    ['Cable crunch','core','cable',0,12,20],
    ['Ab wheel rollout','core','bodyweight',0,8,15],
    ['Plank (seconds)','core','bodyweight',0,30,60],
    ['Russian twist','core','bodyweight',0,15,25]
  ];

  async function seedExercises() {
    const have = await Store.all('exercises');
    if (have.length) return 0;
    const rows = SEED_EX.map(([name, muscle, equipment, compound, repMin, repMax]) => ({
      id: Store.uid(), name, muscle, equipment,
      isCompound: !!compound, repMin, repMax,
      custom: false, notes: ''
    }));
    await Store.putMany('exercises', rows);
    return rows.length;
  }

  const allExercises = () => Store.all('exercises');
  const getExercise  = id => Store.get('exercises', id);

  async function saveExercise(ex) {
    const row = {
      id: ex.id || Store.uid(),
      name: ex.name.trim(),
      muscle: ex.muscle || 'chest',
      equipment: ex.equipment || 'barbell',
      isCompound: !!ex.isCompound,
      repMin: ex.repMin ?? 8,
      repMax: ex.repMax ?? 12,
      custom: ex.custom ?? true,
      notes: ex.notes || ''
    };
    await Store.put('exercises', row);
    return row;
  }

  const deleteExercise = id => Store.del('exercises', id);

  async function searchExercises(q = '', muscle = null) {
    const needle = q.trim().toLowerCase();
    let rows = await allExercises();
    if (muscle) rows = rows.filter(e => e.muscle === muscle);
    if (needle) rows = rows.filter(e => e.name.toLowerCase().includes(needle));
    return rows.sort((a, b) => a.muscle.localeCompare(b.muscle) || a.name.localeCompare(b.name));
  }

  /** name → id map, for seeding and lookups */
  async function exerciseMap() {
    const rows = await allExercises();
    const byId = {}, byName = {};
    rows.forEach(e => { byId[e.id] = e; byName[e.name.toLowerCase()] = e; });
    return { byId, byName, rows };
  }

  /* ---------------- templates ---------------- */
  /* name, dayHint(0=Sun..6=Sat|null), slots: [exName, sets, repMin, repMax, rir, restSec] */
  const SEED_TPL = [
    ['Upper A', 1, [
      ['Barbell bench press',      4, 5, 8,  2, 180],
      ['Barbell row',              4, 6, 10, 2, 150],
      ['Seated dumbbell press',    3, 8, 12, 2, 120],
      ['Lat pulldown',             3, 8, 12, 2, 120],
      ['Barbell curl',             3, 8, 12, 1, 90],
      ['Triceps pushdown',         3, 10, 15, 1, 90]
    ]],
    ['Lower A', 2, [
      ['Barbell squat',            4, 5, 8,  2, 210],
      ['Romanian deadlift',        3, 6, 10, 2, 180],
      ['Leg press',                3, 10, 15, 2, 150],
      ['Lying leg curl',           3, 10, 15, 1, 90],
      ['Standing calf raise',      4, 10, 15, 1, 60],
      ['Hanging leg raise',        3, 10, 15, 1, 60]
    ]],
    ['Upper B', 4, [
      ['Overhead press',           4, 5, 8,  2, 180],
      ['Pull-up',                  4, 5, 10, 2, 150],
      ['Incline dumbbell press',   3, 8, 12, 2, 120],
      ['Seated cable row',         3, 8, 12, 2, 120],
      ['Lateral raise',            3, 12, 20, 1, 60],
      ['Incline dumbbell curl',    3, 10, 15, 1, 90],
      ['Overhead cable extension', 3, 10, 15, 1, 90]
    ]],
    ['Lower B', 5, [
      ['Deadlift',                 3, 3, 6,  2, 240],
      ['Bulgarian split squat',    3, 8, 12, 2, 150],
      ['Leg extension',            3, 12, 20, 1, 90],
      ['Seated leg curl',          3, 10, 15, 1, 90],
      ['Barbell hip thrust',       3, 8, 12, 2, 120],
      ['Seated calf raise',        4, 12, 20, 1, 60],
      ['Cable crunch',             3, 12, 20, 1, 60]
    ]]
  ];

  async function seedTemplates() {
    const have = await Store.all('templates');
    if (have.length) return 0;
    const { byName } = await exerciseMap();

    const rows = SEED_TPL.map(([name, dayHint, slots], i) => ({
      id: Store.uid(),
      name,
      dayHint,
      order: i,
      createdAt: Date.now(),
      slots: slots.map(([exName, sets, repMin, repMax, rir, restSec]) => {
        const ex = byName[exName.toLowerCase()];
        return {
          exerciseId: ex ? ex.id : null,
          exerciseName: exName,
          sets, repMin, repMax, rir, restSec, note: ''
        };
      }).filter(s => s.exerciseId)
    }));

    await Store.putMany('templates', rows);
    return rows.length;
  }

  /** Run both seeders in the right order. */
  async function seedIfEmpty() {
    const n = await seedExercises();
    const t = await seedTemplates();
    return { exercises: n, templates: t };
  }

  async function allTemplates() {
    const rows = await Store.all('templates');
    return rows.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  }

  const getTemplate = id => Store.get('templates', id);

  async function saveTemplate(tpl) {
    const row = {
      id: tpl.id || Store.uid(),
      name: (tpl.name || 'Untitled').trim(),
      dayHint: tpl.dayHint ?? null,
      order: tpl.order ?? 99,
      createdAt: tpl.createdAt || Date.now(),
      slots: (tpl.slots || []).map(s => ({
        exerciseId: s.exerciseId,
        exerciseName: s.exerciseName,
        sets: s.sets ?? 3,
        repMin: s.repMin ?? 8,
        repMax: s.repMax ?? 12,
        rir: s.rir ?? 2,
        restSec: s.restSec ?? 120,
        note: s.note || ''
      }))
    };
    await Store.put('templates', row);
    return row;
  }

  const deleteTemplate = id => Store.del('templates', id);

  async function duplicateTemplate(id) {
    const t = await getTemplate(id);
    if (!t) return null;
    return saveTemplate({ ...t, id: null, name: t.name + ' copy', order: (t.order ?? 99) + 0.5 });
  }

  /* ---------------- sessions ---------------- */

  let _cache = null;
  const invalidate = () => { _cache = null; };

  async function allSessions() {
    if (!_cache) {
      _cache = (await Store.all('sessions'))
        .sort((a, b) => b.day.localeCompare(a.day) || (b.ts || 0) - (a.ts || 0));
    }
    return _cache;
  }

  const getSession = id => Store.get('sessions', id);

  async function saveSession(s) {
    await Store.put('sessions', s);
    invalidate();
    return s;
  }

  async function deleteSession(id) {
    await Store.del('sessions', id);
    invalidate();
  }

  async function sessionsBetween(from, to) {
    return (await allSessions()).filter(s => s.day >= from && s.day <= to);
  }

  const recentSessions = async (n = 10) => (await allSessions()).slice(0, n);

  /* ---------------- active (in-progress) session ----------------
     Stored in kv so it survives closing the app mid-workout. */

  const ACTIVE = 'activeSession';

  async function getActive() {
    const row = await Store.get('kv', ACTIVE);
    return row ? row.value : null;
  }

  const setActive = s => Store.put('kv', { key: ACTIVE, value: s });
  const clearActive = () => Store.del('kv', ACTIVE);

  async function startSession(template) {
    const s = {
      id: Store.uid(),
      day: Store.dayKey(),
      ts: Date.now(),
      startedAt: Date.now(),
      templateId: template?.id || null,
      name: template?.name || 'Freestyle session',
      plan: template ? template.slots.map(x => ({ ...x })) : [],
      sets: [],
      notes: '',
      done: false
    };
    await setActive(s);
    return s;
  }

  async function finishSession(s) {
    const done = {
      ...s,
      done: true,
      ts: Date.now(),
      durationSec: Math.round((Date.now() - (s.startedAt || Date.now())) / 1000)
    };
    /* drop entirely empty sessions rather than saving noise */
    if (!done.sets.length) { await clearActive(); return { session: null, prs: [] }; }
    await saveSession(done);
    const prs = await detectPRs(done);
    await clearActive();
    return { session: done, prs };
  }

  /* ---------------- progression ---------------- */

  /** Estimated 1RM (Epley). For bodyweight work, the score is just reps. */
  const setScore = s =>
    (s.weightKg > 0) ? s.weightKg * (1 + (s.reps || 0) / 30) : (s.reps || 0);

  const e1rm = s => (s.weightKg > 0 ? Math.round(setScore(s) * 10) / 10 : 0);

  /** Smallest sensible jump for this exercise. */
  function increment(ex) {
    if (!ex) return 2.5;
    if (ex.equipment === 'dumbbell') return 2;      // 1 kg per hand
    if (ex.equipment === 'bodyweight') return 0;    // add reps instead
    return ex.isCompound ? 2.5 : 1.25;
  }

  /** Most recent session containing working sets of this exercise. */
  async function lastPerformance(exerciseId) {
    const sessions = await allSessions();
    for (const s of sessions) {
      const sets = (s.sets || []).filter(x => x.exerciseId === exerciseId && !x.warmup);
      if (sets.length) return { day: s.day, sessionId: s.id, sets };
    }
    return null;
  }

  /**
   * The progression rule:
   *  • every set hit the top of the rep range at or below target RIR → add weight
   *  • fell below the bottom of the range → repeat the same weight
   *  • somewhere in between → same weight, one more rep
   */
  async function suggest(exerciseId, slot = {}) {
    const ex = await getExercise(exerciseId);
    const repMin = slot.repMin ?? ex?.repMin ?? 8;
    const repMax = slot.repMax ?? ex?.repMax ?? 12;
    const targetRir = slot.rir ?? 2;
    const inc = increment(ex);
    const last = await lastPerformance(exerciseId);

    if (!last) {
      return {
        weightKg: null, reps: repMax, last: null,
        note: `First time logging this. Pick a weight you can control for ${repMin}–${repMax} reps with about ${targetRir} left in the tank.`
      };
    }

    const top = Math.max(...last.sets.map(s => s.weightKg || 0));
    const atTop = last.sets.filter(s => (s.weightKg || 0) === top);
    const minReps = Math.min(...atTop.map(s => s.reps || 0));
    const rirs = atTop.map(s => s.rir).filter(v => v != null);
    const avgRir = rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null;

    const summary = `${last.day}: ${atTop.length}×${minReps}${top ? ' @ ' + top + ' kg' : ''}`;

    if (minReps >= repMax && (avgRir === null || avgRir <= targetRir)) {
      return inc > 0
        ? { weightKg: top + inc, reps: repMin, last, note: `Cleared ${repMax} reps on every set — add ${inc} kg. ${summary}` }
        : { weightKg: top, reps: minReps + 1, last, note: `Bodyweight: add a rep. ${summary}` };
    }
    if (minReps < repMin) {
      return { weightKg: top, reps: repMin, last, note: `Short of ${repMin} last time — repeat and build. ${summary}` };
    }
    return { weightKg: top, reps: Math.min(minReps + 1, repMax), last,
             note: `Same weight, one more rep than last time. ${summary}` };
  }

  /* ---------------- PRs ---------------- */

  async function detectPRs(sess) {
    const prev = (await allSessions()).filter(s => s.id !== sess.id);
    const groups = {};
    (sess.sets || []).filter(s => !s.warmup && s.reps > 0)
      .forEach(s => { (groups[s.exerciseId] ||= []).push(s); });

    const prs = [];
    for (const [exId, sets] of Object.entries(groups)) {
      const bestNow = Math.max(...sets.map(setScore));
      let bestBefore = 0;
      prev.forEach(s => (s.sets || [])
        .filter(x => x.exerciseId === exId && !x.warmup)
        .forEach(x => { bestBefore = Math.max(bestBefore, setScore(x)); }));
      if (bestNow > bestBefore + 0.05) {
        const isWeighted = sets.some(s => s.weightKg > 0);
        prs.push({
          exerciseId: exId,
          name: sets[0].exerciseName,
          type: isWeighted ? 'e1RM' : 'reps',
          value: Math.round(bestNow * 10) / 10,
          previous: Math.round(bestBefore * 10) / 10,
          isFirst: bestBefore === 0
        });
      }
    }
    return prs;
  }

  /** Best-ever numbers for one exercise. */
  async function bestFor(exerciseId) {
    const sessions = await allSessions();
    let bestWeight = 0, bestReps = 0, best = 0, bestDay = null, totalSets = 0;
    sessions.forEach(s => (s.sets || [])
      .filter(x => x.exerciseId === exerciseId && !x.warmup)
      .forEach(x => {
        totalSets++;
        bestWeight = Math.max(bestWeight, x.weightKg || 0);
        bestReps = Math.max(bestReps, x.reps || 0);
        const sc = setScore(x);
        if (sc > best) { best = sc; bestDay = s.day; }
      }));
    if (!totalSets) return null;
    return { bestWeight, bestReps, e1rm: Math.round(best * 10) / 10, bestDay, totalSets };
  }

  /* ---------------- volume ---------------- */

  /** Working sets per muscle group between two days. */
  async function volumeByMuscle(from, to) {
    const [sessions, { byId }] = await Promise.all([sessionsBetween(from, to), exerciseMap()]);
    const out = {};
    MUSCLES.forEach(m => { out[m.key] = 0; });
    sessions.forEach(s => (s.sets || [])
      .filter(x => !x.warmup)
      .forEach(x => {
        const m = byId[x.exerciseId]?.muscle;
        if (m && out[m] != null) out[m]++;
      }));
    return out;
  }

  /** Total kg lifted (sets × reps × weight) in a range. */
  async function tonnage(from, to) {
    const sessions = await sessionsBetween(from, to);
    return Math.round(sessions.reduce((t, s) =>
      t + (s.sets || []).filter(x => !x.warmup)
           .reduce((a, x) => a + (x.weightKg || 0) * (x.reps || 0), 0), 0));
  }

  /* ---------------- public API ---------------- */
  return {
    MUSCLES, muscleLabel,
    seedIfEmpty, seedExercises, seedTemplates,
    allExercises, getExercise, saveExercise, deleteExercise, searchExercises, exerciseMap,
    allTemplates, getTemplate, saveTemplate, deleteTemplate, duplicateTemplate,
    allSessions, getSession, saveSession, deleteSession, sessionsBetween, recentSessions,
    getActive, setActive, clearActive, startSession, finishSession,
    setScore, e1rm, increment, lastPerformance, suggest, detectPRs, bestFor,
    volumeByMuscle, tonnage, invalidate
  };
})();