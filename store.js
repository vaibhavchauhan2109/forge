/* ============================================================
   FORGE — storage engine (IndexedDB)
   One place for all persistence. Everything is local to the phone.
   ============================================================ */
const Store = (() => {

  const DB_NAME = 'forge';
  const DB_VER  = 1;

  /* All object stores are created up front so we never need a migration
     mid-project. Adding fields to records later is free; adding stores is not. */
  const SCHEMA = {
    kv:        { keyPath: 'key' },                       // settings, profile, goals
    foods:     { keyPath: 'id',  indexes: ['name'] },     // your personal food library
    meals:     { keyPath: 'id',  indexes: ['day'] },      // logged food entries
    sessions:  { keyPath: 'id',  indexes: ['day'] },      // completed workouts
    templates: { keyPath: 'id' },                         // workout templates
    exercises: { keyPath: 'id',  indexes: ['muscle'] },   // exercise library
    metrics:   { keyPath: 'day' },                        // one body-metrics row per day
    photos:    { keyPath: 'id' }                          // progress photos (blobs)
  };

  let db = null;

  /* ---------------- low level ---------------- */

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, def] of Object.entries(SCHEMA)) {
          if (d.objectStoreNames.contains(name)) continue;
          const os = d.createObjectStore(name, { keyPath: def.keyPath });
          (def.indexes || []).forEach(ix => os.createIndex(ix, ix, { unique: false }));
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror   = () => reject(req.error);
    });
  }

  function tx(name, mode) {
    return open().then(d => d.transaction(name, mode).objectStore(name));
  }

  const wrap = req => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });

  /* ---------------- generic CRUD ---------------- */

  const put   = (store, obj)  => tx(store, 'readwrite').then(os => wrap(os.put(obj)));
  const get   = (store, key)  => tx(store, 'readonly').then(os => wrap(os.get(key)));
  const del   = (store, key)  => tx(store, 'readwrite').then(os => wrap(os.delete(key)));
  const all   = (store)       => tx(store, 'readonly').then(os => wrap(os.getAll()));
  const clear = (store)       => tx(store, 'readwrite').then(os => wrap(os.clear()));

  /** Bulk write in a single transaction (much faster than N puts). */
  function putMany(store, arr) {
    return open().then(d => new Promise((res, rej) => {
      const t  = d.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      arr.forEach(o => os.put(o));
      t.oncomplete = () => res(arr.length);
      t.onerror    = () => rej(t.error);
    }));
  }

  /** Everything with .day between from and to (inclusive), e.g. '2025-04-01'. */
  function byDay(store, from, to = from) {
    return tx(store, 'readonly').then(os =>
      wrap(os.index('day').getAll(IDBKeyRange.bound(from, to)))
    );
  }

  /* ---------------- ids & dates ---------------- */

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /** Local-time YYYY-MM-DD. Never use toISOString() — it shifts by timezone. */
  function dayKey(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function addDays(dayStr, n) {
    const [y, m, d] = dayStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dayKey(dt);
  }

  function daysBetween(a, b) {
    const p = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
    return Math.round((p(b) - p(a)) / 86400000);
  }

  /* ---------------- settings (cached, sync reads) ----------------
     Screens render synchronously, so settings live in memory after boot
     and are written through to IndexedDB whenever they change.        */

  const DEFAULTS = {
    /* profile */
    name:       '',
    sex:        'male',            // 'male' | 'female'
    birthYear:  2000,
    heightCm:   178,
    weightKg:   80,
    units:      'metric',          // display only; storage is always kg/cm
    activity:   1.45,              // see Calc.ACTIVITY
    experience: 'intermediate',    // novice | intermediate | advanced

    /* body composition (null = unknown) */
    bodyFatPct: null,
    neckCm:     null,
    waistCm:    null,
    hipCm:      null,

    /* goal */
    goalMode:         'recomp',    // cut | recomp | leanBulk
    targetBodyFatPct: 11,
    targetDate:       null,        // 'YYYY-MM-DD'

    /* target overrides — null means "let the app calculate it" */
    kcalOverride:    null,
    proteinOverride: null,

    /* misc */
    reminders: {},                 // Phase 6
    createdAt: null,
    schema:    1
  };

  let settings = { ...DEFAULTS };

  async function loadSettings() {
    const row = await get('kv', 'settings');
    settings = { ...DEFAULTS, ...(row ? row.value : {}) };
    if (!settings.createdAt) {
      settings.createdAt = dayKey();
      await saveSettings();
    }
    return settings;
  }

  function saveSettings() {
    return put('kv', { key: 'settings', value: settings });
  }

  /** Merge a patch into settings and persist. Returns the new settings. */
  function set(patch) {
    Object.assign(settings, patch);
    saveSettings();
    return settings;
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    await open();
    await loadSettings();
    return settings;
  }

  /* ---------------- backup / restore (used properly in Phase 7) ---------------- */

  /** Everything except photos (blobs need special handling). */
  async function exportAll() {
    const out = { app: 'forge', exportedAt: new Date().toISOString(), data: {} };
    for (const name of Object.keys(SCHEMA)) {
      if (name === 'photos') continue;
      out.data[name] = await all(name);
    }
    return out;
  }

  async function importAll(json, { wipe = true } = {}) {
    if (!json || json.app !== 'forge') throw new Error('Not a Forge backup file');
    for (const [name, rows] of Object.entries(json.data)) {
      if (!SCHEMA[name]) continue;
      if (wipe) await clear(name);
      if (rows.length) await putMany(name, rows);
    }
    await loadSettings();
  }

  /* ---------------- public API ---------------- */
  return {
    boot, open,
    put, get, del, all, clear, putMany, byDay,
    uid, dayKey, addDays, daysBetween,
    set, saveSettings, loadSettings,
    exportAll, importAll,
    DEFAULTS,
    /** live settings object — read synchronously as Store.s.weightKg */
    get s() { return settings; }
  };
})();