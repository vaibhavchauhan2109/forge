/* ============================================================
   FORGE — food library, logging and nutrition lookup
   ============================================================ */
const Food = (() => {

  const MEALS = [
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'lunch',     label: 'Lunch' },
    { key: 'dinner',    label: 'Dinner' },
    { key: 'snack',     label: 'Snacks' }
  ];

  const mealLabel = k => MEALS.find(m => m.key === k)?.label ?? 'Other';

  const blank = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

  /* ---------------- macro math ---------------- */

  /** per-100g values × grams → absolute macros for one entry */
  function scale(per100, grams) {
    const f = (Number(grams) || 0) / 100;
    return {
      kcal:    (per100.kcal    || 0) * f,
      protein: (per100.protein || 0) * f,
      carbs:   (per100.carbs   || 0) * f,
      fat:     (per100.fat     || 0) * f,
      fiber:   (per100.fiber   || 0) * f
    };
  }

  function sum(entries) {
    return (entries || []).reduce((t, e) => ({
      kcal:    t.kcal    + (e.kcal    || 0),
      protein: t.protein + (e.protein || 0),
      carbs:   t.carbs   + (e.carbs   || 0),
      fat:     t.fat     + (e.fat     || 0),
      fiber:   t.fiber   + (e.fiber   || 0)
    }), blank());
  }

  /** kcal derived from macros — used to sanity-check dodgy database entries */
  const kcalFromMacros = m => m.protein * 4 + m.carbs * 4 + m.fat * 9;

  /* ---------------- logging ---------------- */

  async function entriesFor(day) {
    const rows = await Store.byDay('meals', day);
    return rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  }

  async function dayTotals(day) {
    return sum(await entriesFor(day));
  }

  /** Group a day's entries by meal, in MEALS order */
  async function dayByMeal(day) {
    const rows = await entriesFor(day);
    return MEALS.map(m => ({
      ...m,
      entries: rows.filter(r => r.meal === m.key),
      totals:  sum(rows.filter(r => r.meal === m.key))
    }));
  }

  /**
   * Log food. Macros are SNAPSHOTTED onto the entry, so editing the
   * library food later never rewrites your history.
   */
  async function addEntry({ day, meal, name, brand = '', grams = null,
                            servingLabel = '', macros, foodId = null }) {
    const entry = {
      id: Store.uid(),
      ts: Date.now(),
      day: day || Store.dayKey(),
      meal: meal || 'snack',
      name, brand, grams, servingLabel, foodId,
      kcal:    Math.round(macros.kcal),
      protein: Math.round(macros.protein * 10) / 10,
      carbs:   Math.round(macros.carbs   * 10) / 10,
      fat:     Math.round(macros.fat     * 10) / 10,
      fiber:   Math.round((macros.fiber || 0) * 10) / 10
    };
    await Store.put('meals', entry);
    if (foodId) bumpUse(foodId);
    return entry;
  }

  const removeEntry = id => Store.del('meals', id);
  const getEntry    = id => Store.get('meals', id);
  const updateEntry = e  => Store.put('meals', e);

  /** Copy every entry from one day to another — "same as yesterday" */
  async function copyDay(fromDay, toDay) {
    const rows = await entriesFor(fromDay);
    const clones = rows.map(r => ({ ...r, id: Store.uid(), day: toDay, ts: Date.now() }));
    if (clones.length) await Store.putMany('meals', clones);
    return clones.length;
  }

  /* ---------------- food library ---------------- */

  async function saveFood(f) {
    const existing = f.id ? await Store.get('foods', f.id) : null;
    const food = {
      id:       f.id || Store.uid(),
      name:     f.name,
      brand:    f.brand || '',
      barcode:  f.barcode || null,
      per100:   { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, ...f.per100 },
      servingG:     f.servingG ?? null,
      servingLabel: f.servingLabel || '',
      favorite: f.favorite ?? existing?.favorite ?? false,
      uses:     existing?.uses ?? 0,
      lastUsed: existing?.lastUsed ?? null,
      source:   f.source || 'manual'
    };
    await Store.put('foods', food);
    return food;
  }

  const deleteFood = id => Store.del('foods', id);
  const getFood    = id => Store.get('foods', id);
  const allFoods   = ()  => Store.all('foods');

  async function bumpUse(id) {
    const f = await Store.get('foods', id);
    if (!f) return;
    f.uses = (f.uses || 0) + 1;
    f.lastUsed = Date.now();
    await Store.put('foods', f);
  }

  async function toggleFavorite(id) {
    const f = await Store.get('foods', id);
    if (!f) return null;
    f.favorite = !f.favorite;
    await Store.put('foods', f);
    return f;
  }

  /** Search your own library. Favourites first, then most-used. */
  async function searchLibrary(q = '', limit = 40) {
    const needle = q.trim().toLowerCase();
    const rows = await allFoods();
    const hits = needle
      ? rows.filter(f => (f.name + ' ' + f.brand).toLowerCase().includes(needle))
      : rows;
    hits.sort((a, b) =>
      (b.favorite - a.favorite) ||
      ((b.uses || 0) - (a.uses || 0)) ||
      a.name.localeCompare(b.name)
    );
    return hits.slice(0, limit);
  }

  /** Recently logged foods — the fast path for repeat meals. */
  async function recentFoods(limit = 10) {
    const rows = await allFoods();
    return rows.filter(f => f.lastUsed)
               .sort((a, b) => b.lastUsed - a.lastUsed)
               .slice(0, limit);
  }

  /* ---------------- Open Food Facts ----------------
     Free, no API key, no account, CORS-enabled.
     Only used when you're online; everything else works offline. */

  const OFF_BASE   = 'https://world.openfoodfacts.org';
  const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_quantity,serving_size,quantity';

  function fetchJSON(url, ms = 9000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(() => clearTimeout(t));
  }

  /** Map an Open Food Facts product onto our food shape. */
  function fromOFF(p) {
    const n = p.nutriments || {};

    /* kcal can arrive as kcal, or only as kJ */
    let kcal = num(n['energy-kcal_100g']);
    if (kcal == null) {
      const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g']);
      if (kj != null) kcal = kj / 4.184;
    }

    const per100 = {
      kcal:    kcal ?? 0,
      protein: num(n.proteins_100g)      ?? 0,
      carbs:   num(n.carbohydrates_100g) ?? 0,
      fat:     num(n.fat_100g)           ?? 0,
      fiber:   num(n.fiber_100g)         ?? 0
    };

    /* if the DB has no energy, derive it from the macros */
    if (!per100.kcal) per100.kcal = kcalFromMacros(per100);

    return {
      name:    (p.product_name || 'Unnamed product').trim().slice(0, 70),
      brand:   (p.brands || '').split(',')[0].trim().slice(0, 40),
      barcode: p.code || null,
      per100,
      servingG:     num(p.serving_quantity),
      servingLabel: (p.serving_size || '').trim().slice(0, 24),
      source:  'openfoodfacts',
      /* rough quality flag — OFF is crowd-sourced and sometimes empty */
      incomplete: !per100.protein && !per100.carbs && !per100.fat
    };
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) && v !== '' && v !== null ? n : null;
  }

  /** Barcode → product. Returns null if not in the database. */
  async function lookupBarcode(code) {
    const clean = String(code).replace(/\D/g, '');
    if (clean.length < 6) throw new Error('Barcode looks too short');
    const json = await fetchJSON(
      `${OFF_BASE}/api/v2/product/${clean}.json?fields=${OFF_FIELDS}`
    );
    if (json.status !== 1 || !json.product) return null;
    return fromOFF(json.product);
  }

  /** Free-text product search. */
  async function searchOFF(query, page = 1) {
    const q = query.trim();
    if (q.length < 2) return [];
    const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}`
              + `&search_simple=1&action=process&json=1&page_size=25&page=${page}`
              + `&fields=${OFF_FIELDS}`;
    const json = await fetchJSON(url);
    return (json.products || [])
      .map(fromOFF)
      .filter(f => !f.incomplete && f.per100.kcal > 0);
  }

  /* ---------------- starter library ----------------
     Values are per 100 g. Seeded once so the app is usable immediately. */

  const SEED = [
    /* name, kcal, P, C, F, fiber, servingG, servingLabel */
    ['Chicken breast, raw',        120, 22.5,  0,   2.6, 0,   150, '1 breast'],
    ['Chicken breast, cooked',     165, 31,    0,   3.6, 0,   120, '1 breast'],
    ['Beef mince 5% fat',          137, 21,    0,   5,   0,   150, ''],
    ['Salmon fillet',              208, 20,    0,   13,  0,   130, '1 fillet'],
    ['Tuna, canned in water',      116, 26,    0,   1,   0,   100, '1 can'],
    ['Egg, whole',                 143, 12.6,  0.7, 9.5, 0,   50,  '1 egg'],
    ['Egg white',                  52,  11,    0.7, 0.2, 0,   33,  '1 white'],
    ['Greek yogurt, 0%',           59,  10,    3.6, 0.4, 0,   170, '1 pot'],
    ['Cottage cheese',             98,  11,    3.4, 4.3, 0,   200, ''],
    ['Whey protein powder',        380, 78,    8,   5,   0,   30,  '1 scoop'],
    ['Milk, semi-skimmed',         50,  3.4,   4.8, 2,   0,   250, '1 glass'],
    ['Cheddar cheese',             402, 25,    1.3, 33,  0,   30,  '1 slice'],
    ['White rice, cooked',         130, 2.7,   28,  0.3, 0.4, 200, ''],
    ['Basmati rice, dry',          350, 8,     78,  1,   1.5, 75,  ''],
    ['Oats, dry',                  379, 13,    67,  6.5, 10,  50,  ''],
    ['Pasta, dry',                 371, 13,    75,  1.5, 3,   80,  ''],
    ['Wholemeal bread',            247, 13,    41,  3.4, 6,   40,  '1 slice'],
    ['Potato, boiled',             87,  2,     20,  0.1, 1.8, 250, ''],
    ['Sweet potato, baked',        90,  2,     21,  0.15,3.3, 200, ''],
    ['Olive oil',                  884, 0,     0,   100, 0,   14,  '1 tbsp'],
    ['Peanut butter',              588, 25,    20,  50,  6,   32,  '2 tbsp'],
    ['Almonds',                    579, 21,    22,  50,  12.5,28,  '1 handful'],
    ['Avocado',                    160, 2,     9,   15,  7,   150, '1 avocado'],
    ['Banana',                     89,  1.1,   23,  0.3, 2.6, 120, '1 medium'],
    ['Apple',                      52,  0.3,   14,  0.2, 2.4, 180, '1 medium'],
    ['Broccoli',                   34,  2.8,   7,   0.4, 2.6, 150, ''],
    ['Spinach',                    23,  2.9,   3.6, 0.4, 2.2, 100, ''],
    ['Dark chocolate 85%',         592, 10,    22,  50,  11,  20,  '2 squares']
  ];

  async function seedIfEmpty() {
    const existing = await allFoods();
    if (existing.length) return 0;
    const rows = SEED.map(([name, kcal, protein, carbs, fat, fiber, servingG, servingLabel]) => ({
      id: Store.uid(),
      name, brand: '', barcode: null,
      per100: { kcal, protein, carbs, fat, fiber },
      servingG, servingLabel,
      favorite: false, uses: 0, lastUsed: null, source: 'seed'
    }));
    await Store.putMany('foods', rows);
    return rows.length;
  }

  /* ---------------- public API ---------------- */
  return {
    MEALS, mealLabel, blank, scale, sum, kcalFromMacros,
    entriesFor, dayTotals, dayByMeal, addEntry, removeEntry, getEntry, updateEntry, copyDay,
    saveFood, deleteFood, getFood, allFoods, toggleFavorite,
    searchLibrary, recentFoods, seedIfEmpty,
    lookupBarcode, searchOFF, fromOFF
  };
})();