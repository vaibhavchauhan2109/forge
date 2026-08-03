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
      category: f.category || existing?.category || '',
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
      ? rows.filter(f => (f.name + ' ' + f.brand + ' ' + (f.category || ''))
          .toLowerCase().includes(needle))
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
/* ---------------- food packs (versioned, run once each) ----------------
     Tuple: [name, category, kcal, protein, carbs, fat, fiber, servingG, servingLabel]
     All values per 100 g AS EATEN unless the name says "dry". */

  const PACKS = {

  'indian-grains': [
    ['Chapati / roti (whole wheat)','Roti',275,9.5,55,2.5,6.5,40,'1 roti'],
    ['Phulka (no oil)','Roti',260,9,53,1.5,6,35,'1 phulka'],
    ['Tandoori roti','Roti',290,9,57,3,6,60,'1 roti'],
    ['Missi roti','Roti',300,11,48,7,7,60,'1 roti'],
    ['Bajra roti','Roti',250,7,50,3,9,50,'1 roti'],
    ['Jowar roti','Roti',255,7,52,2,7,50,'1 roti'],
    ['Paratha, plain','Roti',320,8,45,12,6,70,'1 paratha'],
    ['Aloo paratha','Roti',250,6,35,9,4,120,'1 paratha'],
    ['Naan','Roti',310,9,53,6,2.5,90,'1 naan'],
    ['Puri','Roti',400,8,45,21,4,25,'1 puri'],
    ['Bhatura','Roti',375,8,44,19,3,80,'1 bhatura'],

    ['Basmati rice, cooked','Rice',130,2.7,28,0.3,0.4,200,'1 katori'],
    ['Jeera rice','Rice',165,3,30,4,0.7,200,'1 katori'],
    ['Veg pulao','Rice',155,3.5,26,4.5,1.5,250,'1 plate'],
    ['Veg biryani','Rice',170,4,25,6,2,300,'1 plate'],
    ['Chicken biryani','Rice',190,9,22,7,1.5,300,'1 plate'],
    ['Curd rice','Rice',135,3.5,20,4.5,0.6,250,'1 bowl'],
    ['Lemon rice','Rice',175,3,28,5.5,1,200,'1 plate'],
    ['Khichdi (moong dal)','Rice',120,4.5,19,2.8,2,250,'1 bowl'],

    ['Poha, cooked','Breakfast',130,2.5,24,3,1.2,200,'1 plate'],
    ['Upma, cooked','Breakfast',145,3.5,22,4.5,1.5,200,'1 plate'],
    ['Daliya, cooked','Breakfast',110,3.5,21,1,3,250,'1 bowl'],

    ['Besan chilla','Chilla',180,8.5,18,8,3.5,80,'1 chilla'],
    ['Besan paneer chilla','Chilla',215,13,14,12,3,120,'1 chilla'],
    ['Moong dal chilla','Chilla',165,9,20,5,3.5,90,'1 chilla'],
    ['Oats chilla','Chilla',160,7,20,5,3,100,'1 chilla'],

    ['Idli','South Indian',130,4,26,0.4,1,45,'1 idli'],
    ['Dosa, plain','South Indian',165,4,30,3.5,1.2,100,'1 dosa'],
    ['Masala dosa','South Indian',200,4.5,30,7,2,200,'1 dosa'],
    ['Rava dosa','South Indian',220,4,32,8,1.2,100,'1 dosa'],
    ['Uttapam','South Indian',150,4.5,25,3.5,1.5,120,'1 uttapam'],
    ['Appam','South Indian',145,3,29,2,0.8,80,'1 appam'],
    ['Medu vada','South Indian',300,7,32,16,3,40,'1 vada'],
    ['Dhokla','Snack',150,5,20,5,2,120,'1 plate'],

    ['Whole wheat atta, dry','Flour',340,12,69,2,11,30,''],
    ['Besan (gram flour), dry','Flour',387,22,58,6.7,11,40,''],
    ['Sooji / rava, dry','Flour',360,12.7,73,1,3.5,40,''],
    ['Ragi flour, dry','Flour',328,7.3,72,1.3,11,30,''],
    ['Poha, dry','Flour',350,7,77,1.2,1.5,50,''],
    ['Puffed rice / murmura','Snack',400,7.5,88,1,1,30,'']
  ],

  'indian-protein': [
    ['Toor / arhar dal tadka','Dal',118,6,14.5,3.5,3.5,150,'1 katori'],
    ['Dal fry','Dal',130,6,15,4.5,3.5,150,'1 katori'],
    ['Dal makhani','Dal',175,7,17,9,5,150,'1 katori'],
    ['Moong dal, cooked','Dal',105,6.5,14,2.5,3,150,'1 katori'],
    ['Masoor dal, cooked','Dal',110,7,15,2.5,3.5,150,'1 katori'],
    ['Chana dal, cooked','Dal',130,7,17,3.5,4,150,'1 katori'],
    ['Urad dal, cooked','Dal',125,7,16,3.5,4,150,'1 katori'],
    ['Panchmel dal','Dal',125,6.5,15,4,4,150,'1 katori'],
    ['Sambar','Dal',85,3.5,11,2.5,2.5,200,'1 katori'],
    ['Kadhi','Dal',90,3.5,7,5,0.6,200,'1 katori'],
    ['Rajma curry','Legume',145,7,18,5,6,200,'1 katori'],
    ['Chole / chana masala','Legume',165,7.5,20,6,6,200,'1 katori'],
    ['Lobia curry','Legume',140,7,19,4,6,200,'1 katori'],
    ['Kala chana, boiled','Legume',164,9,27,2.6,7.6,150,'1 katori'],
    ['Sprouted moong, raw','Legume',30,3,6,0.2,1.8,100,''],
    ['Sprouts chaat','Legume',90,6,13,1.5,4,150,'1 bowl'],
    ['Toor dal, dry','Dal',343,22,63,1.5,15,50,''],
    ['Moong dal, dry','Dal',348,24,63,1.2,16,50,''],
    ['Chana dal, dry','Dal',360,20,60,5,17,50,''],
    ['Rajma, dry','Legume',333,24,60,1,25,50,''],

    ['Paneer, full fat','Paneer',296,18,3.5,23,0,100,''],
    ['Paneer, low fat','Paneer',206,24,3.5,11,0,100,''],
    ['Homemade dahi (full-fat milk)','Dairy',98,4.5,5.5,6,0,150,'1 katori'],
    ['Homemade dahi (toned milk)','Dairy',62,3.6,5,3,0,150,'1 katori'],
    ['Hung curd','Dairy',130,9,6,8,0,100,''],
    ['Buttermilk / chaas','Dairy',25,1.5,2.5,1,0,200,'1 glass'],
    ['Sweet lassi','Dairy',110,3,17,3,0,250,'1 glass'],
    ['Milk, full fat','Dairy',66,3.4,5,3.8,0,200,'1 glass'],
    ['Milk, toned','Dairy',50,3.3,5,1.7,0,200,'1 glass'],
    ['Ghee','Fat',900,0,0,100,0,5,'1 tsp'],
    ['Khoya / mawa','Dairy',400,15,25,26,0,30,''],
    ['Processed cheese slice','Dairy',310,20,3,24,0,20,'1 slice'],

    ['Chicken curry (home style)','Chicken',180,15,4,11,1,200,'1 katori'],
    ['Butter chicken','Chicken',240,14,6,17,1,200,'1 katori'],
    ['Chicken tikka / tandoori','Chicken',195,25,2,9,0,150,''],
    ['Chicken keema','Chicken',220,18,3,15,1,150,'1 katori'],
    ['Chicken thigh, cooked','Chicken',209,26,0,11,0,120,''],
    ['Chicken soup','Chicken',45,4,2,2,0,250,'1 bowl'],
    ['Egg curry','Egg',155,8,5,11,1,200,'1 katori'],
    ['Egg bhurji','Egg',180,11,3,14,1,150,''],
    ['Omelette (2 eggs)','Egg',190,12,1,15,0,120,'1 omelette'],
    ['Fish curry','Fish',130,14,4,6,0.5,200,'1 katori'],
    ['Fish fry (rohu)','Fish',200,22,4,11,0,120,''],
    ['Rohu, raw','Fish',97,17,0,3,0,150,''],
    ['Surmai / kingfish, raw','Fish',105,20,0,2.5,0,150,''],
    ['Prawn curry','Fish',130,15,4,6,0.5,200,'1 katori'],
    ['Prawns, raw','Fish',85,20,0,0.5,0,150,''],
    ['Mutton curry','Mutton',250,17,4,18,1,200,'1 katori'],
    ['Mutton keema','Mutton',260,18,3,20,0.5,150,'1 katori'],

    ['Soya chunks, dry','Soya',345,52,33,0.5,13,30,''],
    ['Soya chunk curry','Soya',130,12,8,5,3,200,'1 katori'],
    ['Tofu','Soya',76,8,1.9,4.8,0.3,100,''],
    ['Sattu (roasted gram flour)','Flour',400,22,58,7,18,30,'']
  ],

  'indian-sabzi-snacks': [
    ['Mixed veg sabzi','Sabzi',95,2.5,10,5,3,150,'1 katori'],
    ['Aloo gobhi','Sabzi',110,2.5,12,6,3,150,'1 katori'],
    ['Bhindi masala','Sabzi',105,2,9,7,3.5,150,'1 katori'],
    ['Baingan bharta','Sabzi',105,1.8,9,7,3,150,'1 katori'],
    ['Jeera aloo','Sabzi',130,2,18,6,2,150,'1 katori'],
    ['Aloo matar','Sabzi',120,3,15,5.5,3.5,150,'1 katori'],
    ['Lauki sabzi','Sabzi',70,1.2,6,4.5,1.5,150,'1 katori'],
    ['Cabbage sabzi','Sabzi',75,1.8,7,4.5,2.5,150,'1 katori'],
    ['Tinda / parwal sabzi','Sabzi',80,1.5,7,5,2,150,'1 katori'],
    ['Kaddu / pumpkin sabzi','Sabzi',85,1.2,10,4.5,1.5,150,'1 katori'],
    ['Mushroom masala','Sabzi',90,3,6,6,1.5,150,'1 katori'],
    ['Palak sabzi','Sabzi',85,3,6,5,2.5,150,'1 katori'],
    ['Methi sabzi','Sabzi',95,3.5,7,5.5,3,150,'1 katori'],
    ['Sarson ka saag','Sabzi',110,4,7,7,4,200,'1 katori'],
    ['Veg kofta curry','Sabzi',190,4,14,13,3,200,'1 katori'],
    ['Palak paneer','Paneer',180,9,6,13,2.5,200,'1 katori'],
    ['Paneer bhurji','Paneer',240,15,5,18,1,150,''],
    ['Matar paneer','Paneer',190,9,10,13,3,200,'1 katori'],
    ['Kadai paneer','Paneer',210,11,8,15,2,200,'1 katori'],
    ['Shahi paneer','Paneer',260,10,10,20,2,200,'1 katori'],

    ['Samosa','Snack',300,5,32,17,2,60,'1 samosa'],
    ['Pakora','Snack',320,7,28,20,3,50,''],
    ['Aloo tikki','Snack',200,3,25,10,2.5,80,'1 tikki'],
    ['Vada pav','Snack',290,7,40,11,3,150,'1 vada pav'],
    ['Pav bhaji','Snack',150,3.5,18,7,3,300,'1 plate'],
    ['Bhel puri','Snack',220,5,35,7,3,150,'1 plate'],
    ['Chana chaat','Snack',140,7,18,4,5,150,'1 bowl'],
    ['Roasted chana','Snack',380,22,58,5,15,40,'1 handful'],
    ['Roasted peanuts','Snack',585,26,16,49,8,30,'1 handful'],
    ['Makhana, roasted','Snack',350,9.7,77,0.1,14,25,'1 bowl'],
    ['Sev / namkeen','Snack',550,12,45,36,4,20,''],
    ['Papad, roasted','Snack',350,20,50,4,10,12,'1 papad'],
    ['Marie biscuit','Snack',440,7,75,12,2,12,'1 biscuit'],
    ['Rusk','Snack',400,10,72,8,3,15,'1 rusk'],

    ['Gulab jamun','Sweet',300,4,40,14,0.5,40,'1 piece'],
    ['Rasgulla','Sweet',190,4,35,4,0,50,'1 piece'],
    ['Jalebi','Sweet',350,3,55,14,0.5,40,''],
    ['Besan laddoo','Sweet',420,8,48,22,2,40,'1 laddoo'],
    ['Besan barfi','Sweet',400,8,45,21,2,30,'1 piece'],
    ['Suji halwa','Sweet',320,4,40,16,1,100,'1 katori'],
    ['Gajar halwa','Sweet',250,4,30,12,2,100,'1 katori'],
    ['Kheer','Sweet',150,4,22,5,0.5,150,'1 katori'],
    ['Jaggery','Sweet',383,0.4,98,0.1,0,10,''],
    ['Sugar','Sweet',400,0,100,0,0,5,'1 tsp'],
    ['Honey','Sweet',304,0.3,82,0,0,20,'1 tbsp'],

    ['Mango','Fruit',60,0.8,15,0.4,1.6,200,'1 medium'],
    ['Papaya','Fruit',43,0.5,11,0.3,1.7,150,'1 bowl'],
    ['Guava','Fruit',68,2.6,14,1,5.4,120,'1 guava'],
    ['Pomegranate','Fruit',83,1.7,19,1.2,4,150,'1 bowl'],
    ['Watermelon','Fruit',30,0.6,8,0.2,0.4,250,'1 bowl'],
    ['Orange','Fruit',47,0.9,12,0.1,2.4,150,'1 orange'],
    ['Sweet lime (mosambi)','Fruit',43,0.8,9.3,0.3,2.8,150,'1 fruit'],
    ['Grapes','Fruit',69,0.7,18,0.2,0.9,100,''],
    ['Dates','Fruit',282,2.5,75,0.4,8,24,'3 dates'],
    ['Coconut, fresh','Fruit',354,3.3,15,33,9,30,''],

    ['Onion','Vegetable',40,1.1,9,0.1,1.7,100,''],
    ['Tomato','Vegetable',18,0.9,3.9,0.2,1.2,100,''],
    ['Cucumber','Vegetable',15,0.7,3.6,0.1,0.5,150,''],
    ['Carrot','Vegetable',41,0.9,10,0.2,2.8,100,''],
    ['Beetroot','Vegetable',43,1.6,10,0.2,2.8,100,''],
    ['Green peas','Vegetable',81,5.4,14,0.4,5,100,''],
    ['Capsicum','Vegetable',27,1,6,0.2,2,100,''],
    ['Bottle gourd, raw','Vegetable',14,0.6,3.4,0.1,0.5,150,''],
    ['Cauliflower, raw','Vegetable',25,1.9,5,0.3,2,150,''],

    ['Coriander / mint chutney','Condiment',40,2,5,1.5,2,30,''],
    ['Coconut chutney','Condiment',180,3,8,15,5,40,''],
    ['Tamarind chutney','Condiment',200,0.5,50,0.2,1,20,''],
    ['Mixed pickle / achar','Condiment',150,1,8,13,2,15,'1 tsp'],
    ['Tomato ketchup','Condiment',100,1,24,0.1,0.5,15,''],
    ['Mayonnaise','Condiment',680,1,3,74,0,15,''],
    ['Mustard oil','Fat',884,0,0,100,0,5,'1 tsp'],
    ['Coconut oil','Fat',862,0,0,100,0,5,'1 tsp'],
    ['Sunflower oil','Fat',884,0,0,100,0,5,'1 tsp'],

    ['Masala chai (sugar & milk)','Drink',60,1.6,8,2,0,150,'1 cup'],
    ['Black coffee','Drink',2,0.1,0,0,0,200,'1 cup'],
    ['Green tea','Drink',1,0,0,0,0,200,'1 cup'],
    ['Nimbu pani (with sugar)','Drink',40,0.1,10,0,0,250,'1 glass'],
    ['Coconut water','Drink',19,0.7,3.7,0.2,1.1,250,'1 glass']
  ]

  };

  /** Adds a pack once. Skips foods you already have by name. */
  async function seedPack(key) {
    const pack = PACKS[key];
    if (!pack) return 0;
    const done = (await Store.get('kv', 'foodPacks'))?.value || [];
    if (done.includes(key)) return 0;

    const have = new Set((await allFoods()).map(f => f.name.toLowerCase()));
    const rows = pack
      .filter(t => !have.has(String(t[0]).toLowerCase()))
      .map(([name, category, kcal, protein, carbs, fat, fiber, servingG, servingLabel]) => ({
        id: Store.uid(),
        name, brand: '', barcode: null, category,
        per100: { kcal, protein, carbs, fat, fiber },
        servingG: servingG || null,
        servingLabel: servingLabel || '',
        favorite: false, uses: 0, lastUsed: null, source: key
      }));

    if (rows.length) await Store.putMany('foods', rows);
    await Store.put('kv', { key: 'foodPacks', value: [...done, key] });
    return rows.length;
  }

  /** Every pack we ship. Safe to call on every boot. */
  async function seedAllPacks() {
    let n = 0;
    for (const key of Object.keys(PACKS)) n += await seedPack(key);
    return n;
  }

  /* ---------------- public API ---------------- */
  return {
    MEALS, mealLabel, blank, scale, sum, kcalFromMacros,
    entriesFor, dayTotals, dayByMeal, addEntry, removeEntry, getEntry, updateEntry, copyDay,
    saveFood, deleteFood, getFood, allFoods, toggleFavorite,
    searchLibrary, recentFoods, seedIfEmpty, seedPack, seedAllPacks, PACKS,
    lookupBarcode, searchOFF, fromOFF
  };
})();
