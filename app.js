/* ============================================================
   FORGE — app shell + router
   ============================================================ */
const App = {
  version: '0.1.0',
  route: null,
};

/* ---------------------------------------------------------------
   Tiny helpers (used everywhere from here on)
   --------------------------------------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escape user text before putting it into HTML. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

/** Short toast at the bottom of the screen. */
function toast(msg, ms = 1900) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast-host').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/** Light haptic-ish feedback. iOS Safari ignores vibrate, but harmless. */
function tick() { if (navigator.vibrate) navigator.vibrate(8); }

/** "Monday 14 Apr" */
function prettyDate(d = new Date()) {
  return d.toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'short' });
}

/* ---------------- form helpers ---------------- */

/** Read a form into a plain object, coercing numbers and blanks→null. */
function readForm(form) {
  const out = {};
  $$('[name]', form).forEach(el => {
    if (el.type === 'radio' && !el.checked) return;
    let v = el.value;
    if (el.dataset.type === 'number') {
      v = v === '' ? null : Number(v);
      if (v !== null && !isFinite(v)) v = null;
    } else if (v === '') {
      v = el.dataset.type === 'text' ? '' : null;
    }
    out[el.name] = v;
  });
  return out;
}

/** Current settings merged with unsaved form input — for live previews. */
function draft(form) {
  return { ...Store.s, ...readForm(form) };
}

const fmtKg = kg => kg == null ? '—' : `${Calc.r(kg,1)} kg <span class="unit-hint">(${Calc.r(Calc.kgToLb(kg),1)} lb)</span>`;
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : '—';

function kv(label, value, tone) {
  return `<div class="kv"><span>${label}</span><b class="${tone ? 'tone-'+tone : ''}">${value}</b></div>`;
}
/* ---------------- shared render blocks ---------------- */

function macroGrid(t) {
  if (!t) return '';
  return `
    <div class="macro-grid">
      <div class="macro k"><div class="macro-v">${t.kcal}</div><div class="macro-l">kcal</div></div>
      <div class="macro p"><div class="macro-v">${t.protein}</div><div class="macro-l">protein</div></div>
      <div class="macro c"><div class="macro-v">${t.carbs}</div><div class="macro-l">carbs</div></div>
      <div class="macro f"><div class="macro-v">${t.fat}</div><div class="macro-l">fat</div></div>
    </div>`;
}

function planBlock(p) {
  const pl = Calc.plan(p);
  if (!pl) return `<div class="verdict tone-dim">Add a target date and your measurements to see a projection.</div>`;
  if (pl.expired) return `<div class="verdict tone-bad">Your target date has passed. Pick a new one.</div>`;

  return `
    <div class="verdict tone-${pl.tone}">
      <b>${pl.verdict}</b> — you need to drop <b>${pl.fatToLoseKg} kg</b>
      in <b>${pl.weeksLeft} weeks</b> (${pl.rateKgPerWeek} kg/wk = ${pl.pctPerWeek}% of bodyweight per week).
      ${pl.pctPerWeek > 0.9
        ? `<br><br>At a muscle-sparing pace you'd realistically hit ${pl.targetBf}% around <b>${fmtDate(pl.realisticDate)}</b>.`
        : ''}
    </div>
    <div style="margin-top:12px">
      ${kv('Current body fat', pl.currentBf + '%')}
      ${kv('Target body fat', pl.targetBf + '%')}
      ${kv('Lean mass now', pl.lbm + ' kg')}
      ${kv('Projected lean mass', pl.projectedLbm + ' kg' + (pl.lbmGain > 0 ? ` (+${pl.lbmGain})` : ''))}
      ${kv('Goal weight', pl.goalWeight + ' kg')}
      ${kv('Daily deficit needed', pl.dailyDeficit > 0 ? pl.dailyDeficit + ' kcal' : 'none')}
    </div>`;
}

/** Turns a <form> into live-updating: re-renders #preview on every keystroke. */
function livePreview(form, build) {
  const paint = () => { $('#preview').innerHTML = build(draft(form)); };
  form.addEventListener('input', paint);
  form.addEventListener('change', () => {
    $$('.seg-opt', form).forEach(o => o.classList.toggle('on', $('input', o).checked));
    paint();
  });
  paint();
}

/* ---------------- ring renderer ---------------- */
function ringSVG({ pct, color = 'var(--accent)', size = 92, stroke = 9, big, small }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1.15, pct || 0));       // allow slight overshoot
  const off = c * (1 - Math.min(p, 1));
  const over = p > 1;
  return `
    <div class="ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <circle class="ring-c" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"></circle>
        <circle class="ring-v" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"
          stroke="${over ? 'var(--danger)' : color}"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
      </svg>
      <div class="ring-txt"><b>${big}</b><small>${small}</small></div>
    </div>`;
}

function macroBar(cls, label, have, target) {
  const pct = target ? have / target : 0;
  const over = pct > 1.02;
  return `
    <div class="mbar ${cls} ${over ? 'over' : ''}">
      <div class="mbar-top"><span>${label}</span>
        <b>${Math.round(have)}<span style="color:var(--dim)"> / ${Math.round(target)} g</span></b></div>
      <div class="mbar-track"><i class="mbar-fill" style="width:${Math.min(100, pct*100).toFixed(1)}%"></i></div>
    </div>`;
}

/* ---------------- day navigation state ---------------- */
App.day = Store.dayKey();

function dayLabel(day) {
  const today = Store.dayKey();
  const diff  = Store.daysBetween(day, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return fmtDate(day);
}

function dateNav(onChange) {
  return `
    <div class="datenav">
      <button id="dn-prev" aria-label="Previous day">‹</button>
      <div class="dn-label">${dayLabel(App.day)}<small>${fmtDate(App.day)}</small></div>
      <button id="dn-next" aria-label="Next day"
        ${App.day >= Store.dayKey() ? 'disabled' : ''}>›</button>
    </div>`;
}

function wireDateNav(repaint) {
  $('#dn-prev')?.addEventListener('click', () => { App.day = Store.addDays(App.day, -1); repaint(); });
  $('#dn-next')?.addEventListener('click', () => {
    if (App.day >= Store.dayKey()) return;
    App.day = Store.addDays(App.day, 1); repaint();
  });
}

/* ---------------------------------------------------------------
   SCREENS
   Each screen: { title, sub(), action(), render(), mount() }
     title  – big header text
     sub    – small grey line under it (optional fn)
     action – HTML injected top-right (optional fn)
     render – returns the HTML string for the body
     mount  – runs after HTML is inserted; attach listeners here
   --------------------------------------------------------------- */
const Screens = {

  /* ---------------- TODAY ---------------- */
  today: {
    title: 'Today',
    sub: () => prettyDate(),
    render: () => `<div id="today-root"><div class="spinner">Loading…</div></div>`,
    async mount() { await paintToday(); }
  },

  /* ---------------- FOOD ---------------- */
  food: {
    title: 'Food',
    sub: () => 'Meal log',
    render: () => `<div id="food-root"><div class="spinner">Loading…</div></div>`,
    async mount() { await paintFood(); }
  },

  /* ---------------- TRAIN ---------------- */
  train: {
    title: 'Train',
    sub: () => 'Planner & log',
    render: () => `<div id="train-root"><div class="spinner">Loading…</div></div>`,
    async mount() { await paintTrain(); }
  },

  /* ---------------- BODY ---------------- */
  body: {
    title: 'Body',
    sub: () => 'Weight, composition & measurements',
    render: () => `<div id="body-root"><div class="spinner">Loading…</div></div>`,
    async mount() { await paintBody(); }
  },

  /* ---------------- MORE / SETTINGS ---------------- */
  settings: {
    title: 'More',
    sub: () => 'Setup, data and diagnostics',
    render() {
      const s  = Store.s;
      const sm = Calc.summary(s);
      const t  = sm.targets;

      return `
      <div class="stack">

        <div class="card">
          <div class="card-head"><p class="card-title">Setup</p></div>

          <a class="row" href="#/profile">
            <div class="row-main">
              <div class="row-title">Profile</div>
              <div class="row-sub">${s.heightCm ?? '—'} cm · ${s.weightKg ?? '—'} kg · ${sm.age || '—'} yrs</div>
            </div>
            <div class="row-value chev"></div>
          </a>

          <a class="row" href="#/measure">
            <div class="row-main">
              <div class="row-title">Measurements</div>
              <div class="row-sub">${sm.bodyFat != null
                ? sm.bodyFat + '% body fat · ' + (sm.leanMass ?? '—') + ' kg lean'
                : 'Not measured yet'}</div>
            </div>
            <div class="row-value chev"></div>
          </a>

          <a class="row" href="#/goal">
            <div class="row-main">
              <div class="row-title">Goal &amp; targets</div>
              <div class="row-sub">${Calc.MODES[s.goalMode]?.label ?? '—'} → ${s.targetBodyFatPct ?? '—'}%
                by ${s.targetDate ? fmtDate(s.targetDate) : 'no date'}</div>
            </div>
            <div class="row-value chev"></div>
          </a>

          <a class="row" href="#/exercises">
            <div class="row-main">
              <div class="row-title">Exercise history</div>
              <div class="row-sub">Personal records and progress trends</div>
            </div>
            <div class="row-value chev"></div>
          </a>
        </div>

        <div class="card">
          <div class="card-head"><p class="card-title">Daily targets</p></div>
          ${t ? macroGrid(t) : '<p class="hint">Complete your profile first.</p>'}
        </div>

        <div class="card">
          <div class="card-head"><p class="card-title">Body snapshot</p></div>
          ${kv('BMI', sm.bmi ?? '—', sm.bmiCat.tone)}
          ${kv('Body fat', sm.bodyFat != null ? sm.bodyFat + '%' : '—')}
          ${kv('Lean mass', sm.leanMass ? sm.leanMass + ' kg' : '—')}
          ${kv('Waist-to-height', sm.whtr ?? '—', sm.whtrCat.tone)}
        </div>

        <div class="card">
          <div class="card-head"><p class="card-title">Data</p></div>
          <p class="hint" style="margin-bottom:12px">
            Everything lives only on this phone. Export regularly — if you delete the
            app from your home screen, the data goes with it.</p>
          <button class="btn btn-block" id="export-btn">Export backup</button>
          <button class="btn btn-block btn-ghost" id="import-btn" style="margin-top:8px">Restore from backup</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>

        <div class="card">
          <div class="card-head"><p class="card-title">Diagnostics</p></div>
          ${kv('App version', App.version)}
          ${kv('Installed', isStandalone() ? 'Yes ✓' : 'No — open via Safari')}
          <div class="kv"><span>Offline cache</span><b id="sw-state">checking…</b></div>
          <div class="kv"><span>Storage used</span><b id="storage-state">—</b></div>
        </div>

        <button class="btn btn-block" id="force-update">Check for update</button>
        <button class="btn btn-block btn-danger" id="hard-reset">Clear cache &amp; reload</button>
        <p class="hint" style="text-align:center">Clearing the cache does <strong>not</strong> delete your data.</p>

      </div>`;
    },

    async mount() {
      /* ---- diagnostics ---- */
      const swEl = $('#sw-state');
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        swEl.textContent = reg && navigator.serviceWorker.controller ? 'Active ✓'
                         : reg ? 'Installing…' : 'Not registered';
      } else {
        swEl.textContent = 'Unsupported';
      }

      if (navigator.storage?.estimate) {
        const { usage } = await navigator.storage.estimate();
        $('#storage-state').textContent = ((usage || 0) / 1024).toFixed(0) + ' KB';
      }

      /* ---- export ---- */
      $('#export-btn').addEventListener('click', async () => {
        try {
          const data = await Store.exportAll();
          const json = JSON.stringify(data, null, 2);
          const name = `forge-backup-${Store.dayKey()}.json`;
          const file = new File([json], name, { type: 'application/json' });

          /* Share sheet is the reliable path inside an iOS home-screen app */
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: name });
            return;
          }
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          toast('Backup downloaded');
        } catch (e) {
          if (e.name !== 'AbortError') toast('Export failed: ' + e.message);
        }
      });

      /* ---- import ---- */
      $('#import-btn').addEventListener('click', () => $('#import-file').click());
      $('#import-file').addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        if (!confirm('Replace ALL current data with this backup?')) { ev.target.value = ''; return; }
        try {
          const json = JSON.parse(await f.text());
          await Store.importAll(json);
          toast('Restored — reloading');
          setTimeout(() => location.reload(), 900);
        } catch (e) {
          toast('Import failed: ' + e.message);
        }
      });

      /* ---- update controls ---- */
      $('#force-update').addEventListener('click', async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) return toast('No service worker');
        await reg.update();
        toast('Checked. Force-quit and reopen to apply.');
      });

      $('#hard-reset').addEventListener('click', async () => {
        if (!confirm('Clear the offline cache and reload? Your data is kept.')) return;
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.unregister();
        location.reload();
      });
    }
  }
};

/* ============================================================
   PROFILE
   ============================================================ */
Screens.profile = {
  title: 'Profile', tab: 'settings', back: '#/settings',
  sub: () => 'The numbers everything else is built from',
  render() {
    const s = Store.s;
    const acts = Calc.ACTIVITY.map(a =>
      `<option value="${a.v}" ${Number(s.activity) === a.v ? 'selected' : ''}>${a.label} — ${a.hint}</option>`
    ).join('');
    return `
    <form id="profile-form" class="stack" onsubmit="return false">

      <div class="card">
        <label class="field"><span>Name (optional)</span>
          <input name="name" data-type="text" value="${esc(s.name)}" placeholder="You"></label>

        <div class="field">
          <span style="display:block;font-size:13px;color:var(--dim);margin-bottom:6px;font-weight:600">Sex</span>
          <div class="seg" style="grid-template-columns:1fr 1fr;display:grid">
            <label class="seg-opt ${s.sex !== 'female' ? 'on' : ''}">
              <input type="radio" name="sex" value="male" ${s.sex !== 'female' ? 'checked' : ''}>
              <span class="dot"></span><b>Male</b></label>
            <label class="seg-opt ${s.sex === 'female' ? 'on' : ''}">
              <input type="radio" name="sex" value="female" ${s.sex === 'female' ? 'checked' : ''}>
              <span class="dot"></span><b>Female</b></label>
          </div>
        </div>

        <div class="field-row">
          <label class="field"><span>Birth year</span>
            <input name="birthYear" data-type="number" type="number" inputmode="numeric"
                   value="${s.birthYear ?? ''}" placeholder="2000"></label>
          <label class="field"><span>Height (cm)</span>
            <input name="heightCm" data-type="number" type="number" inputmode="decimal" step="0.5"
                   value="${s.heightCm ?? ''}" placeholder="178"></label>
        </div>

        <label class="field"><span>Weight (kg)</span>
          <input name="weightKg" data-type="number" type="number" inputmode="decimal" step="0.1"
                 value="${s.weightKg ?? ''}" placeholder="80"></label>

        <label class="field"><span>Activity level</span>
          <select name="activity" data-type="number">${acts}</select></label>

        <label class="field" style="margin-bottom:0"><span>Training experience</span>
          <select name="experience">
            <option value="novice"       ${s.experience==='novice'?'selected':''}>Novice — under 1 year</option>
            <option value="intermediate" ${s.experience==='intermediate'?'selected':''}>Intermediate — 1–3 years</option>
            <option value="advanced"     ${s.experience==='advanced'?'selected':''}>Advanced — 3+ years</option>
          </select></label>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Live calculation</p></div>
        <div id="preview"></div>
      </div>

      <div class="sticky-save">
        <button class="btn btn-primary btn-block" id="save">Save profile</button>
      </div>
    </form>`;
  },
  mount() {
    const form = $('#profile-form');

    livePreview(form, p => {
      const sm = Calc.summary(p);
      return kv('Age', sm.age || '—')
           + kv('BMI', sm.bmi ?? '—', sm.bmiCat.tone)
           + kv('BMI category', sm.bmiCat.label, sm.bmiCat.tone)
           + kv('BMR', sm.targets ? sm.targets.bmr + ' kcal' : '—')
           + kv('Maintenance (TDEE)', sm.targets ? sm.targets.tdee + ' kcal' : '—');
    });

    $('#save').addEventListener('click', async () => {
      const v = readForm(form);
      if (!v.heightCm || !v.weightKg) return toast('Height and weight are required');

      const wasNew = !Store.s.onboarded;
      Store.set({ ...v, onboarded: true });

      /* also log today's weight into history, so Phase 5 charts have data */
      const day = Store.dayKey();
      const row = (await Store.get('metrics', day)) || { day };
      await Store.put('metrics', { ...row, weightKg: v.weightKg });

      toast('Profile saved');
      location.hash = wasNew ? '#/measure' : '#/settings';
    });
  }
};

/* ============================================================
   MEASUREMENTS  →  body fat, lean mass, waist-to-height
   ============================================================ */
Screens.measure = {
  title: 'Measurements', tab: 'settings', back: '#/settings',
  sub: () => 'Tape method — more useful than the scale',
  render() {
    const s = Store.s;
    const female = s.sex === 'female';
    return `
    <form id="measure-form" class="stack" onsubmit="return false">

      <div class="card">
        <p class="hint" style="margin-bottom:14px">
          Measure relaxed, first thing in the morning, before eating.
          Waist at navel level, neck just below the Adam's apple.
        </p>

        <div class="field-row">
          <label class="field"><span>Waist (cm)</span>
            <input name="waistCm" data-type="number" type="number" inputmode="decimal" step="0.5"
                   value="${s.waistCm ?? ''}" placeholder="84"></label>
          <label class="field"><span>Neck (cm)</span>
            <input name="neckCm" data-type="number" type="number" inputmode="decimal" step="0.5"
                   value="${s.neckCm ?? ''}" placeholder="38"></label>
        </div>

        ${female ? `
        <label class="field"><span>Hip (cm)</span>
          <input name="hipCm" data-type="number" type="number" inputmode="decimal" step="0.5"
                 value="${s.hipCm ?? ''}" placeholder="96"></label>` : ''}

        <label class="field" style="margin-bottom:0">
          <span>Known body fat % (optional — overrides the estimate)</span>
          <input name="bodyFatPct" data-type="number" type="number" inputmode="decimal" step="0.1"
                 value="${s.bodyFatPct ?? ''}" placeholder="leave blank to estimate"></label>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Composition</p></div>
        <div id="preview"></div>
      </div>

      <div class="sticky-save">
        <button class="btn btn-primary btn-block" id="save">Save measurements</button>
      </div>
    </form>`;
  },
  mount() {
    const form = $('#measure-form');

    livePreview(form, p => {
      const sm = Calc.summary(p);
      let html =
          kv('Body fat', sm.bodyFat != null ? sm.bodyFat + '%' : '—',
             sm.bodyFat == null ? 'dim' : 'good')
        + kv('Estimate source', sm.bfSource === 'manual' ? 'Entered manually'
                              : sm.bfSource === 'tape' ? 'US Navy tape' : '—')
        + kv('Lean mass', sm.leanMass ? sm.leanMass + ' kg' : '—')
        + kv('Fat mass', sm.fatMass ? sm.fatMass + ' kg' : '—')
        + kv('BMI', sm.bmi ?? '—', sm.bmiCat.tone)
        + kv('Waist-to-height', sm.whtr ?? '—', sm.whtrCat.tone)
        + kv('WHtR rating', sm.whtrCat.label, sm.whtrCat.tone);

      if (sm.abs) {
        html += sm.abs.visible
          ? `<div class="verdict tone-good" style="margin-top:12px">
               You're at or below the ${sm.abs.threshold}% mark where abs are typically visible.
               Focus on building now.</div>`
          : `<div class="verdict tone-warn" style="margin-top:12px">
               <b>${sm.abs.pctToGo}% body fat to go</b> to reach ~${sm.abs.threshold}%
               (about ${sm.abs.kgToLose} kg of fat, roughly ${sm.abs.weeks} weeks at a
               muscle-sparing pace).</div>`;
      }
      return html;
    });

    $('#save').addEventListener('click', async () => {
      const v = readForm(form);
      Store.set(v);

      const day = Store.dayKey();
      const row = (await Store.get('metrics', day)) || { day };
      await Store.put('metrics', {
        ...row,
        weightKg:   Store.s.weightKg,
        waistCm:    v.waistCm ?? null,
        neckCm:     v.neckCm ?? null,
        hipCm:      v.hipCm ?? null,
        bodyFatPct: Calc.bodyFat({ ...Store.s, ...v }).pct ?? null
      });

      toast('Saved');
      location.hash = '#/goal';
    });
  }
};

/* ============================================================
   GOAL + TARGETS
   ============================================================ */
Screens.goal = {
  title: 'Goal', tab: 'settings', back: '#/settings',
  sub: () => 'Strategy and daily targets',
  render() {
    const s = Store.s;
    const modeOpt = (key) => {
      const m = Calc.MODES[key];
      const on = s.goalMode === key;
      const sign = m.deltaPct > 0 ? '+' : '';
      return `
      <label class="seg-opt ${on ? 'on' : ''}">
        <input type="radio" name="goalMode" value="${key}" ${on ? 'checked' : ''}>
        <span class="dot"></span>
        <span><b>${m.label} <span class="tag">${sign}${Math.round(m.deltaPct*100)}% kcal</span></b>
        <small>${m.blurb}</small></span>
      </label>`;
    };
    return `
    <form id="goal-form" class="stack" onsubmit="return false">

      <div class="card" id="suggest-card"></div>

      <div class="card">
        <div class="card-head"><p class="card-title">Strategy</p></div>
        <div class="seg">
          ${modeOpt('cut')}${modeOpt('recomp')}${modeOpt('leanBulk')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Target</p></div>
        <div class="field-row">
          <label class="field"><span>Target body fat %</span>
            <input name="targetBodyFatPct" data-type="number" type="number" inputmode="decimal" step="0.5"
                   value="${s.targetBodyFatPct ?? ''}" placeholder="11"></label>
          <label class="field"><span>Target date</span>
            <input name="targetDate" type="date" min="${Store.dayKey()}"
                   value="${s.targetDate ?? ''}"></label>
        </div>
        <button class="btn btn-sm btn-ghost" id="plus5">Set 5 months from today</button>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Projection</p></div>
        <div id="preview"></div>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Manual overrides</p></div>
        <p class="hint" style="margin-bottom:12px">Leave blank to let the app calculate.</p>
        <div class="field-row">
          <label class="field" style="margin-bottom:0"><span>Calories</span>
            <input name="kcalOverride" data-type="number" type="number" inputmode="numeric"
                   value="${s.kcalOverride ?? ''}" placeholder="auto"></label>
          <label class="field" style="margin-bottom:0"><span>Protein (g)</span>
            <input name="proteinOverride" data-type="number" type="number" inputmode="numeric"
                   value="${s.proteinOverride ?? ''}" placeholder="auto"></label>
        </div>
      </div>

      <div class="sticky-save">
        <button class="btn btn-primary btn-block" id="save">Save goal</button>
      </div>
    </form>`;
  },
  mount() {
    const form = $('#goal-form');

    const paintSuggestion = (p) => {
      const sg = Calc.suggestMode(p);
      const m  = Calc.MODES[sg.mode];
      $('#suggest-card').innerHTML = `
        <div class="card-head"><p class="card-title">Recommended for you</p></div>
        <div class="verdict tone-good">${sg.why}</div>
        ${p.goalMode !== sg.mode
          ? `<button class="btn btn-sm btn-block" id="apply-suggest" style="margin-top:12px">
               Switch to ${m.label}</button>`
          : ''}`;
      $('#apply-suggest')?.addEventListener('click', () => {
        const radio = $(`input[name="goalMode"][value="${sg.mode}"]`, form);
        radio.checked = true;
        form.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };

    livePreview(form, p => {
      paintSuggestion(p);
      const t = Calc.targets(p);
      return planBlock(p)
        + `<div style="margin-top:14px"><p class="card-title" style="margin-bottom:6px">Daily targets</p></div>`
        + macroGrid(t)
        + (t ? `<div style="margin-top:12px">
                  ${kv('Maintenance', t.tdee + ' kcal')}
                  ${kv('Daily delta', (t.deltaKcal > 0 ? '+' : '') + t.deltaKcal + ' kcal')}
                  ${kv('Protein', t.proteinPerKg + ' g/kg bodyweight')}
                  ${t.overridden ? kv('Note', 'Manual calorie override active', 'warn') : ''}
                </div>` : '');
    });

    $('#plus5').addEventListener('click', () => {
      $('input[name="targetDate"]', form).value = Store.addDays(Store.dayKey(), 152);
      form.dispatchEvent(new Event('input', { bubbles: true }));
    });

    $('#save').addEventListener('click', () => {
      Store.set(readForm(form));
      toast('Goal saved');
      location.hash = '#/today';
    });
  }
};
/* ============================================================
   ADD FOOD
   ============================================================ */
Screens.add = {
  title: 'Add food', tab: 'food', back: '#/food',
  sub() {
    const c = App.addCtx || {};
    return Food.mealLabel(c.meal) + ' · ' + dayLabel(c.day || Store.dayKey());
  },
  render: () => `<div id="add-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    if (!App.addCtx) App.addCtx = { day: Store.dayKey(), meal: 'snack' };
    App.addState = { view: 'pick', src: 'lib', food: null, query: '', results: null, busy: false };
    await paintAdd();
  }
};
/* ============================================================
   FOOD — day view painter
   Called by Screens.food.mount() and after every mutation.
   ============================================================ */
async function paintFood() {
  const root = $('#food-root');
  if (!root) return;

  const t      = Calc.targets(Store.s);
  const meals  = await Food.dayByMeal(App.day);
  const totals = Food.sum(meals.flatMap(m => m.entries));
  const any    = meals.some(m => m.entries.length);

  const kTar = t ? t.kcal : 0;
  const pTar = t ? t.protein : 0;
  const kLeft = Math.round(kTar - totals.kcal);
  const pLeft = Math.round(pTar - totals.protein);

  /* ---- summary ---- */
  const summary = t ? `
    <div class="card">
      <div class="ring-wrap">
        ${ringSVG({
          pct: kTar ? totals.kcal / kTar : 0,
          big: Math.round(totals.kcal),
          small: 'of ' + kTar
        })}
        <div class="mbars">
          ${macroBar('p', 'Protein', totals.protein, pTar)}
          ${macroBar('c', 'Carbs',   totals.carbs,   t.carbs)}
          ${macroBar('f', 'Fat',     totals.fat,     t.fat)}
        </div>
      </div>
      <div style="margin-top:14px">
        ${kv('Calories left', kLeft >= 0 ? kLeft + ' kcal' : Math.abs(kLeft) + ' kcal over',
             kLeft >= 0 ? 'good' : 'bad')}
        ${kv('Protein left', pLeft > 0 ? pLeft + ' g' : 'target hit ✓',
             pLeft > 0 ? 'warn' : 'good')}
        ${totals.fiber ? kv('Fibre', Math.round(totals.fiber) + ' g') : ''}
      </div>
    </div>` : `
    <div class="card">
      <p class="hint">Set up your profile and goal to see targets.</p>
      <a class="btn btn-sm btn-block" href="#/profile" style="margin-top:10px">Open profile</a>
    </div>`;

  /* ---- undo bar ---- */
  const undo = App.lastDeleted ? `
    <div class="verdict tone-warn" style="margin-bottom:12px;display:flex;
         align-items:center;justify-content:space-between;gap:10px">
      <span>Removed ${esc(App.lastDeleted.name)}</span>
      <button class="btn btn-sm" id="undo-del">Undo</button>
    </div>` : '';

  /* ---- meal sections ---- */
  const sections = meals.map(m => `
    <div class="meal">
      <div class="meal-head">
        <h3>${m.label}</h3>
        <span class="meal-kcal">${m.entries.length
          ? Math.round(m.totals.kcal) + ' kcal · ' + Math.round(m.totals.protein) + ' g P'
          : ''}</span>
      </div>
      <div class="meal-body">
        ${m.entries.length
          ? m.entries.map(e => `
            <div class="fentry">
              <div class="fentry-main">
                <div class="fentry-name">${esc(e.name)}</div>
                <div class="fentry-sub">${esc(entryAmount(e))}${e.brand ? ' · ' + esc(e.brand) : ''}</div>
              </div>
              <div class="fentry-macros">
                <div class="fentry-k">${Math.round(e.kcal)}</div>
                <div class="fentry-p">${Math.round(e.protein)} g P</div>
              </div>
              <button class="fentry-del" data-del="${e.id}" aria-label="Remove">×</button>
            </div>`).join('')
          : `<div class="meal-empty">Nothing logged</div>`}
        <button class="meal-add" data-add="${m.key}">+ Add to ${m.label.toLowerCase()}</button>
      </div>
    </div>`).join('');

  /* ---- footer ---- */
  const footer = `
    <div class="stack" style="margin-top:6px">
      ${!any ? `<button class="btn btn-block" id="copy-yday">Copy yesterday's food</button>` : ''}
      ${any  ? `<button class="btn btn-block btn-ghost" id="copy-yday">Copy yesterday on top</button>` : ''}
    </div>`;

  root.innerHTML = dateNav() + undo + summary
                 + `<div style="height:16px"></div>` + sections + footer;

  /* keep the header subtitle in sync with the visible day */
  $('#screen-sub').textContent = dayLabel(App.day);

  /* ---------------- wiring ---------------- */

  wireDateNav(() => { App.lastDeleted = null; paintFood(); });

  /* add → goes to the Add Food screen with context */
  $$('[data-add]').forEach(b => b.addEventListener('click', () => {
    App.addCtx = { day: App.day, meal: b.dataset.add };
    location.hash = '#/add';
  }));

  /* delete with undo */
  $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const entry = await Food.getEntry(b.dataset.del);
    await Food.removeEntry(b.dataset.del);
    App.lastDeleted = entry;
    tick();
    await paintFood();
  }));

  $('#undo-del')?.addEventListener('click', async () => {
    const e = App.lastDeleted;
    App.lastDeleted = null;
    if (e) await Food.updateEntry(e);
    await paintFood();
  });

  /* copy yesterday */
  $('#copy-yday')?.addEventListener('click', async () => {
    const from = Store.addDays(App.day, -1);
    const n = await Food.copyDay(from, App.day);
    toast(n ? `Copied ${n} item${n > 1 ? 's' : ''}` : 'Nothing logged yesterday');
    if (n) await paintFood();
  });
}
/* ============================================================
   TRAIN — hub
   ============================================================ */
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDur(sec) {
  if (!sec) return '—';
  const m = Math.round(sec / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

/** working sets + total kg for one session */
function sessionStats(s) {
  const work = (s.sets || []).filter(x => !x.warmup);
  const kg = work.reduce((a, x) => a + (x.weightKg || 0) * (x.reps || 0), 0);
  const exCount = new Set(work.map(x => x.exerciseId)).size;
  return { sets: work.length, kg: Math.round(kg), exercises: exCount };
}

async function paintTrain() {
  const root = $('#train-root');
  if (!root) return;

  const [active, tpls, recent] = await Promise.all([
    Train.getActive(),
    Train.allTemplates(),
    Train.recentSessions(6)
  ]);

  const today = Store.dayKey();
  const vol   = await Train.volumeByMuscle(Store.addDays(today, -6), today);
  const dow   = new Date().getDay();
  const todayTpl = tpls.find(t => t.dayHint === dow);

  /* ---------- resume banner ---------- */
  const banner = active ? `
    <div class="banner">
      <div class="banner-main">
        <div class="banner-title">${esc(active.name)}</div>
        <div class="banner-sub">In progress · ${(active.sets || []).filter(s => !s.warmup).length} sets logged</div>
      </div>
      <button class="btn btn-primary btn-sm" id="resume">Resume</button>
    </div>` : '';

  /* ---------- today ---------- */
  const todayCard = active ? '' : `
    <div class="card">
      <div class="card-head">
        <p class="card-title">${DOW[dow]} — today</p>
        ${todayTpl ? `<span class="tag">scheduled</span>` : ''}
      </div>
      ${todayTpl ? `
        <div class="tpl-name">${esc(todayTpl.name)}</div>
        <div class="tpl-sub" style="margin-bottom:14px">
          ${todayTpl.slots.length} exercises ·
          ${todayTpl.slots.reduce((n, s) => n + (s.sets || 0), 0)} sets</div>
        <button class="btn btn-primary btn-block" data-start="${todayTpl.id}">
          Start ${esc(todayTpl.name)}</button>
      ` : `
        <p class="hint" style="margin-bottom:14px">
          Nothing scheduled for ${DOW[dow]}. Pick a workout below, or train freestyle.</p>
      `}
      <button class="btn btn-block btn-ghost" id="freestyle" style="margin-top:8px">
        Freestyle session</button>
    </div>`;

  /* ---------- templates ---------- */
  const tplCard = `
    <div class="card" style="padding:0">
      <div class="card-head" style="padding:16px 16px 10px;margin:0">
        <p class="card-title">My workouts</p>
        <button class="btn btn-sm btn-ghost" id="new-tpl">+ New</button>
      </div>
      ${tpls.length ? tpls.map(t => `
        <div class="tpl">
          <div class="tpl-main">
            <div class="tpl-name">${esc(t.name)}
              ${t.dayHint != null ? `<span class="daytag">${DOW[t.dayHint]}</span>` : ''}</div>
            <div class="tpl-sub">${esc(t.slots.map(s => s.exerciseName).slice(0, 3).join(' · '))}${t.slots.length > 3 ? ' …' : ''}</div>
          </div>
          <div class="tpl-actions">
            <button class="btn btn-sm btn-ghost" data-edit="${t.id}">Edit</button>
            <button class="btn btn-sm btn-primary" data-start="${t.id}">Start</button>
          </div>
        </div>`).join('')
      : `<div class="meal-empty">No workouts yet — tap “+ New”.</div>`}
    </div>`;

  /* ---------- weekly volume ---------- */
  const totalSets = Object.values(vol).reduce((a, b) => a + b, 0);
  const volCard = `
    <div class="card">
      <div class="card-head">
        <p class="card-title">Sets per muscle · last 7 days</p>
        <span class="tag">${totalSets} total</span>
      </div>
      ${Train.MUSCLES.map(m => {
        const n = vol[m.key] || 0;
        const pct = Math.min(100, (n / m.mav) * 100);
        const cls = n === 0 ? 'low' : n < m.mev ? 'low' : n > m.mav ? 'high' : '';
        return `
        <div class="volrow">
          <span class="vl">${m.label}</span>
          <span class="voltrack">
            <i class="${cls}" style="width:${pct.toFixed(0)}%"></i>
            <span class="mark" style="left:${((m.mev / m.mav) * 100).toFixed(0)}%"></span>
          </span>
          <span class="vv">${n}</span>
        </div>`;
      }).join('')}
      <p class="hint" style="margin-top:12px;font-size:12px">
        The tick marks the minimum effective volume. Grey = under it,
        amber = above the productive ceiling.</p>
    </div>`;

  /* ---------- recent sessions ---------- */
  const recentCard = `
    <div class="card" style="padding:0">
      <div class="card-head" style="padding:16px 16px 10px;margin:0">
        <p class="card-title">Recent sessions</p>
      </div>
      ${recent.length ? recent.map(s => {
        const st = sessionStats(s);
        return `
        <button class="pick" data-sess="${s.id}">
          <div class="pick-main">
            <div class="pick-name">${esc(s.name)}</div>
            <div class="pick-sub">${dayLabel(s.day)} · ${st.exercises} exercises · ${fmtDur(s.durationSec)}</div>
          </div>
          <div class="pick-k">${st.sets} sets<b>${st.kg.toLocaleString()} kg</b></div>
        </button>`;
      }).join('')
      : `<div class="meal-empty">No sessions logged yet</div>`}
    </div>`;

  root.innerHTML = `<div class="stack">
    ${banner}${todayCard}${tplCard}${volCard}${recentCard}
  </div>`;

  /* ---------------- wiring ---------------- */

  $('#resume')?.addEventListener('click', () => { location.hash = '#/session'; });

  $$('[data-start]').forEach(b => b.addEventListener('click', async () => {
    const existing = await Train.getActive();
    if (existing && !confirm('You have a session in progress. Discard it and start this one?')) return;
    const tpl = await Train.getTemplate(b.dataset.start);
    await Train.startSession(tpl);
    tick();
    location.hash = '#/session';
  }));

  $('#freestyle')?.addEventListener('click', async () => {
    const existing = await Train.getActive();
    if (existing && !confirm('You have a session in progress. Discard it and start fresh?')) return;
    await Train.startSession(null);
    location.hash = '#/session';
  });

  $('#new-tpl')?.addEventListener('click', () => {
    App.tplId = null;
    location.hash = '#/template';
  });

  $$('[data-edit]').forEach(b => b.addEventListener('click', () => {
    App.tplId = b.dataset.edit;
    location.hash = '#/template';
  }));

  $$('[data-sess]').forEach(b => b.addEventListener('click', () => {
    App.sessionId = b.dataset.sess;
    location.hash = '#/history';
  }));
}
/* ============================================================
   TODAY — dashboard
   ============================================================ */
function smartMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

/** Consecutive days with at least one food entry (today may still be empty). */
async function logStreak() {
  const today = Store.dayKey();
  const rows  = await Store.byDay('meals', Store.addDays(today, -90), today);
  const days  = new Set(rows.map(r => r.day));
  let d = today, n = 0;
  if (!days.has(d)) d = Store.addDays(d, -1);   // don't punish an unfinished today
  while (days.has(d)) { n++; d = Store.addDays(d, -1); }
  return n;
}

async function paintToday() {
  const root = $('#today-root');
  if (!root) return;

  const day    = Store.dayKey();
  const t      = Calc.targets(Store.s);
  const totals = await Food.dayTotals(day);
  const sm     = Calc.summary(Store.s);
  const streak = await logStreak();
  const [activeSess, tpls, lastSess] = await Promise.all([
    Train.getActive(), Train.allTemplates(), Train.recentSessions(1)
  ]);
  const dowT = new Date().getDay();
  const todayTpl = tpls.find(t => t.dayHint === dowT);
  const hour   = new Date().getHours();

  const kTar  = t ? t.kcal : 0;
  const pTar  = t ? t.protein : 0;
  const kLeft = Math.round(kTar - totals.kcal);
  const pLeft = Math.round(pTar - totals.protein);
  const pPct  = pTar ? totals.protein / pTar : 0;

  /* ---- nudge logic ---- */
  let nudge = '';
  if (t && hour >= 18 && pPct < 0.7) {
    nudge = `<div class="verdict tone-warn" style="margin-top:14px">
      <b>${pLeft} g protein still to go</b> and it's getting late.
      A shake or 200 g of Greek yoghurt closes most of that gap.</div>`;
  } else if (t && pPct >= 1) {
    nudge = `<div class="verdict tone-good" style="margin-top:14px">
      <b>Protein target hit.</b> ${kLeft >= 0 ? kLeft + ' kcal still available.' : 'You\'re over on calories — keep it light.'}</div>`;
  } else if (t && kLeft < 0) {
    nudge = `<div class="verdict tone-bad" style="margin-top:14px">
      <b>${Math.abs(kLeft)} kcal over target.</b> One day won't undo anything — get back on it tomorrow.</div>`;
  }

  /* ---- nutrition card ---- */
  const nutrition = t ? `
    <div class="card">
      <div class="card-head">
        <p class="card-title">Nutrition</p>
        <a href="#/food" style="color:var(--accent);font-size:13px;font-weight:700">Open log ›</a>
      </div>

      <div style="display:flex;gap:12px;justify-content:center;align-items:center">
        ${ringSVG({ pct: kTar ? totals.kcal / kTar : 0, size: 104, stroke: 10,
                    big: Math.round(totals.kcal), small: 'of ' + kTar + ' kcal' })}
        ${ringSVG({ pct: pPct, size: 104, stroke: 10, color: 'var(--protein)',
                    big: Math.round(totals.protein) + 'g', small: 'of ' + pTar + 'g protein' })}
      </div>

      <div class="mbars" style="margin-top:18px">
        ${macroBar('c', 'Carbs', totals.carbs, t.carbs)}
        ${macroBar('f', 'Fat',   totals.fat,   t.fat)}
      </div>

      ${nudge}

      <button class="btn btn-primary btn-block" id="quick-log" style="margin-top:14px">
        + Log ${Food.mealLabel(smartMeal()).toLowerCase()}
      </button>
    </div>` : `
    <div class="card">
      <p class="hint">Finish your profile to get calorie and protein targets.</p>
      <a class="btn btn-primary btn-sm btn-block" href="#/profile" style="margin-top:12px">Set up profile</a>
    </div>`;

  /* ---- goal card ---- */
  const pl = sm.plan;
  const goalCard = pl && !pl.expired ? `
    <div class="card">
      <div class="card-head">
        <p class="card-title">Goal</p>
        <a href="#/goal" style="color:var(--accent);font-size:13px;font-weight:700">Edit ›</a>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${pl.daysLeft}</div><div class="stat-label">days left</div></div>
        <div class="stat"><div class="stat-value">${pl.currentBf}%</div><div class="stat-label">body fat</div></div>
        <div class="stat"><div class="stat-value">${pl.fatToLoseKg > 0 ? pl.fatToLoseKg : 0}</div><div class="stat-label">kg to go</div></div>
      </div>
      <div class="verdict tone-${pl.tone}" style="margin-top:14px">
        <b>${pl.verdict}</b> — ${pl.targetBf}% body fat by ${fmtDate(Store.s.targetDate)}
        needs about ${pl.rateKgPerWeek} kg/week.
      </div>
      ${sm.abs && !sm.abs.visible ? `<div style="margin-top:12px">
        ${kv('Abs threshold', '~' + sm.abs.threshold + '%')}
        ${kv('Body fat to lose', sm.abs.pctToGo + '%')}
        ${kv('Estimate at safe pace', '~' + sm.abs.weeks + ' weeks')}
      </div>` : ''}
    </div>` : `
    <div class="card">
      <div class="card-head"><p class="card-title">Goal</p></div>
      <p class="hint">${pl?.expired ? 'Your target date has passed.' : 'No goal set yet.'}</p>
      <a class="btn btn-sm btn-block" href="#/goal" style="margin-top:12px">Set a goal</a>
    </div>`;

  /* ---- training placeholder ---- */
  const last = lastSess[0];
  const training = `
    <div class="card">
      <div class="card-head">
        <p class="card-title">Training</p>
        <a href="#/train" style="color:var(--accent);font-size:13px;font-weight:700">Open ›</a>
      </div>
      ${activeSess ? `
        <div class="tpl-name">${esc(activeSess.name)}</div>
        <div class="tpl-sub" style="margin-bottom:12px">
          In progress · ${(activeSess.sets || []).filter(x => !x.warmup).length} sets logged</div>
        <a class="btn btn-primary btn-block" href="#/session">Resume session</a>
      ` : todayTpl ? `
        <div class="tpl-name">${esc(todayTpl.name)}</div>
        <div class="tpl-sub" style="margin-bottom:12px">
          Scheduled for ${DOW[dowT]} · ${todayTpl.slots.length} exercises ·
          ${todayTpl.slots.reduce((n, x) => n + x.sets, 0)} sets</div>
        <button class="btn btn-primary btn-block" id="t-start" data-tpl="${todayTpl.id}">
          Start ${esc(todayTpl.name)}</button>
      ` : `
        <p class="hint" style="margin-bottom:12px">
          Rest day — nothing scheduled for ${DOW[dowT]}.${
          last ? ` Last session: ${esc(last.name)}, ${dayLabel(last.day)}.` : ''}</p>
        <a class="btn btn-block btn-ghost" href="#/train">Choose a workout</a>
      `}
    </div>`;

  /* ---- habits ---- */
  const habits = `
    <div class="card">
      <div class="card-head"><p class="card-title">Consistency</p></div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${streak}</div><div class="stat-label">day streak</div></div>
        <div class="stat"><div class="stat-value">${sm.bmi ?? '—'}</div><div class="stat-label">BMI</div></div>
        <div class="stat"><div class="stat-value">${Store.s.weightKg ?? '—'}</div><div class="stat-label">kg</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <a class="btn btn-sm btn-ghost" href="#/measure" style="flex:1">Log measurements</a>
        <a class="btn btn-sm btn-ghost" href="#/food" style="flex:1">Food log</a>
      </div>
    </div>`;

  root.innerHTML = `<div class="stack">${nutrition}${goalCard}${training}${habits}</div>`;

  $('#quick-log')?.addEventListener('click', () => {
    App.addCtx = { day: Store.dayKey(), meal: smartMeal() };
    location.hash = '#/add';
  });

  $('#t-start')?.addEventListener('click', async () => {
    const tpl = await Train.getTemplate($('#t-start').dataset.tpl);
    await Train.startSession(tpl);
    location.hash = '#/session';
  });
}

/** "150 g" / "1 scoop (30 g)" / "1 serving" */
function entryAmount(e) {
  if (e.grams && e.servingLabel) return `${e.servingLabel} (${Math.round(e.grams)} g)`;
  if (e.grams) return `${Math.round(e.grams)} g`;
  return e.servingLabel || '1 serving';
}

/* ============================================================
   ADD FOOD — painters
   ============================================================ */
async function paintAdd() {
  return App.addState.view === 'portion' ? paintPortion() : paintPick();
}

/* ---------- meal selector (shared by both steps) ---------- */
function mealChips() {
  const cur = App.addCtx.meal;
  return `<div class="chips" style="margin-bottom:14px">${
    Food.MEALS.map(m =>
      `<button class="chip ${m.key === cur ? 'on' : ''}" data-meal="${m.key}">${m.label}</button>`
    ).join('')}</div>`;
}

function wireMealChips() {
  $$('[data-meal]').forEach(b => b.addEventListener('click', () => {
    App.addCtx.meal = b.dataset.meal;
    $$('[data-meal]').forEach(x => x.classList.toggle('on', x === b));
    $('#screen-sub').textContent =
      Food.mealLabel(App.addCtx.meal) + ' · ' + dayLabel(App.addCtx.day);
  }));
}

/* ---------- list rows ---------- */
function libRow(f) {
  const p = f.per100 || {};
  return `
    <button class="pick" data-lib="${f.id}">
      <div class="pick-main">
        <div class="pick-name">${f.favorite ? '<span class="star">★</span> ' : ''}${esc(f.name)}</div>
        <div class="pick-sub">${esc(f.brand || 'per 100 g')}${f.servingLabel ? ' · ' + esc(f.servingLabel) : ''}</div>
      </div>
      <div class="pick-k">${Math.round(p.kcal || 0)} kcal<b>${Math.round(p.protein || 0)} g P</b></div>
    </button>`;
}

function offRow(f, i) {
  const p = f.per100 || {};
  return `
    <button class="pick" data-off="${i}">
      <div class="pick-main">
        <div class="pick-name">${esc(f.name)}</div>
        <div class="pick-sub">${esc(f.brand || 'unbranded')}${f.servingG ? ' · serving ' + Math.round(f.servingG) + ' g' : ''}</div>
      </div>
      <div class="pick-k">${Math.round(p.kcal || 0)} kcal<b>${Math.round(p.protein || 0)} g P</b></div>
    </button>`;
}

function wirePickRows() {
  $$('[data-lib]').forEach(b => b.addEventListener('click', async () => {
    const f = await Food.getFood(b.dataset.lib);
    if (f) openPortion(f, false);
  }));
  $$('[data-off]').forEach(b => b.addEventListener('click', () => {
    const f = App.addState.results?.[Number(b.dataset.off)];
    if (f) openPortion(f, true);
  }));
}

function openPortion(food, isNew) {
  const s = App.addState;
  s.food  = food;
  s.isNew = !!isNew;
  s.grams = food.servingG || 100;
  s.view  = 'portion';
  paintAdd();
}

/* ============================================================
   STEP 1 — pick a food
   ============================================================ */
async function paintPick() {
  const root = $('#add-root');
  const s = App.addState;

  const tabs = `
    <div class="srctabs">
      <button class="srctab ${s.src === 'lib'   ? 'on' : ''}" data-src="lib">My foods</button>
      <button class="srctab ${s.src === 'off'   ? 'on' : ''}" data-src="off">Search web</button>
      <button class="srctab ${s.src === 'quick' ? 'on' : ''}" data-src="quick">Quick add</button>
    </div>`;

  let body = '';

  if (s.src === 'lib') {
    const rows = await Food.searchLibrary(s.query);
    body = `
      <div class="searchbar">
        <input id="q" type="search" placeholder="Search my foods…" value="${esc(s.query)}"
               autocomplete="off" enterkeyhint="search">
        ${s.query ? `<button class="sb-clear" id="q-clear">×</button>` : ''}
      </div>
      <div id="lib-list">${
        rows.length ? `<div class="picker">${rows.map(libRow).join('')}</div>`
                    : `<div class="empty"><h3>No matches</h3>
                         <p class="hint">Try “Search web” or “Quick add”.</p></div>`}</div>`;
  }

  if (s.src === 'off') {
    body = `
      <div class="searchbar">
        <input id="q" type="search" placeholder="Product name, e.g. skyr" value="${esc(s.query)}"
               autocomplete="off" enterkeyhint="search">
      </div>
      <button class="btn btn-primary btn-block btn-sm" id="off-go" style="margin-bottom:14px">Search</button>

      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><p class="card-title">Or enter a barcode</p></div>
        <div style="display:flex;gap:8px">
          <input id="bc" type="text" inputmode="numeric" placeholder="5000112637922"
                 autocomplete="off" style="flex:1">
          <button class="btn btn-sm" id="bc-go">Look&nbsp;up</button>
        </div>
        <p class="hint" style="margin-top:8px">Type the digits printed under the barcode.</p>
      </div>

      ${!navigator.onLine
        ? `<div class="verdict tone-warn">You're offline — web search needs a connection.</div>`
        : ''}
      <div id="off-results">${
        s.results === null ? ''
        : s.results.length ? `<div class="picker">${s.results.map(offRow).join('')}</div>`
        : `<div class="empty"><h3>Nothing found</h3>
             <p class="hint">Use Quick add instead.</p></div>`}</div>`;
  }

  if (s.src === 'quick') {
    body = `
      <form id="quick-form" class="card" onsubmit="return false">
        <p class="hint" style="margin-bottom:14px">
          Straight macros, no database. Good for restaurant food or a rough guess.</p>
        <label class="field"><span>Name</span>
          <input name="name" data-type="text" placeholder="Chicken shawarma"></label>
        <div class="field-row">
          <label class="field"><span>Calories</span>
            <input name="kcal" data-type="number" type="number" inputmode="numeric" placeholder="0"></label>
          <label class="field"><span>Protein (g)</span>
            <input name="protein" data-type="number" type="number" inputmode="decimal" placeholder="0"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Carbs (g)</span>
            <input name="carbs" data-type="number" type="number" inputmode="decimal" placeholder="0"></label>
          <label class="field" style="margin-bottom:0"><span>Fat (g)</span>
            <input name="fat" data-type="number" type="number" inputmode="decimal" placeholder="0"></label>
        </div>
        <div id="quick-preview" style="margin-top:14px"></div>
        <button class="btn btn-primary btn-block" id="quick-add" style="margin-top:14px">Add to log</button>
      </form>`;
  }

  root.innerHTML = mealChips() + tabs + body;
  wireMealChips();
  wirePickRows();

  $$('[data-src]').forEach(b => b.addEventListener('click', () => {
    s.src = b.dataset.src;
    s.results = null;
    paintAdd();
  }));

  /* ---- library live filter ---- */
  if (s.src === 'lib') {
    $('#q').addEventListener('input', async (e) => {
      s.query = e.target.value;
      const rows = await Food.searchLibrary(s.query);
      $('#lib-list').innerHTML = rows.length
        ? `<div class="picker">${rows.map(libRow).join('')}</div>`
        : `<div class="empty"><h3>No matches</h3><p class="hint">Try “Search web”.</p></div>`;
      wirePickRows();
    });
    $('#q-clear')?.addEventListener('click', () => { s.query = ''; paintAdd(); });
  }

  /* ---- web search ---- */
  if (s.src === 'off') {
    const runSearch = async () => {
      s.query = $('#q').value;
      if (s.query.trim().length < 2) return toast('Type at least 2 characters');
      $('#off-results').innerHTML = `<div class="spinner">Searching…</div>`;
      try {
        s.results = await Food.searchOFF(s.query);
        paintAdd();
      } catch (err) {
        $('#off-results').innerHTML =
          `<div class="verdict tone-bad">Search failed — ${esc(err.message)}</div>`;
      }
    };

    $('#off-go').addEventListener('click', runSearch);
    $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

    const lookup = async () => {
      const code = $('#bc').value.trim();
      if (!code) return toast('Enter the barcode digits');
      $('#off-results').innerHTML = `<div class="spinner">Looking up ${esc(code)}…</div>`;
      try {
        const food = await Food.lookupBarcode(code);
        if (!food) {
          $('#off-results').innerHTML =
            `<div class="verdict tone-warn">Not in the database. Use Quick add,
               then save it to My foods for next time.</div>`;
          return;
        }
        openPortion(food, true);
      } catch (err) {
        $('#off-results').innerHTML =
          `<div class="verdict tone-bad">Lookup failed — ${esc(err.message)}</div>`;
      }
    };

    $('#bc-go').addEventListener('click', lookup);
    $('#bc').addEventListener('keydown', e => { if (e.key === 'Enter') lookup(); });
  }

  /* ---- quick add ---- */
  if (s.src === 'quick') {
    const form = $('#quick-form');

    const paintQ = () => {
      const v = readForm(form);
      const macros = {
        kcal:    v.kcal    || 0,
        protein: v.protein || 0,
        carbs:   v.carbs   || 0,
        fat:     v.fat     || 0
      };
      if (!macros.kcal) macros.kcal = Food.kcalFromMacros(macros);
      $('#quick-preview').innerHTML = macroGrid({
        kcal: Math.round(macros.kcal),
        protein: Math.round(macros.protein),
        carbs: Math.round(macros.carbs),
        fat: Math.round(macros.fat)
      });
    };

    form.addEventListener('input', paintQ);
    paintQ();

    $('#quick-add').addEventListener('click', async () => {
      const v = readForm(form);
      const macros = {
        kcal:    v.kcal    || 0,
        protein: v.protein || 0,
        carbs:   v.carbs   || 0,
        fat:     v.fat     || 0,
        fiber:   0
      };
      if (!macros.kcal) macros.kcal = Food.kcalFromMacros(macros);
      if (!macros.kcal) return toast('Enter calories or macros');

      await Food.addEntry({
        day:  App.addCtx.day,
        meal: App.addCtx.meal,
        name: (v.name || 'Quick add').trim(),
        servingLabel: '1 serving',
        macros
      });
      tick();
      toast('Added');
      location.hash = '#/food';
    });
  }
}

/* ============================================================
   STEP 2 — choose the portion
   ============================================================ */
function paintPortion() {
  const root = $('#add-root');
  const s = App.addState;
  const f = s.food;
  const p = f.per100 || {};

  /* quick amount buttons — serving size first if the food has one */
  const presets = [];
  if (f.servingG) {
    presets.push({ g: f.servingG,     label: (f.servingLabel || '1 serving') });
    presets.push({ g: f.servingG * 2, label: '2 ×' });
  }
  [50, 100, 150, 200, 250].forEach(g => presets.push({ g, label: g + ' g' }));

  root.innerHTML = `
    <button class="btn btn-sm btn-ghost" id="back-pick" style="margin-bottom:14px">
      ‹ Choose a different food</button>

    ${mealChips()}

    <div class="card">
      <div class="row" style="padding-top:0">
        <div class="row-main">
          <div class="row-title">${esc(f.name)}</div>
          <div class="row-sub">${esc(f.brand || '')}${f.brand ? ' · ' : ''}per 100 g:
            ${Math.round(p.kcal)} kcal, ${Calc.r(p.protein,1)} P, ${Calc.r(p.carbs,1)} C, ${Calc.r(p.fat,1)} F</div>
        </div>
        ${!s.isNew ? `<button class="btn btn-sm btn-ghost" id="fav-btn">${f.favorite ? '★' : '☆'}</button>` : ''}
      </div>

      <label class="field" style="margin:14px 0 10px">
        <span>Amount (grams)</span>
        <input id="g" type="number" inputmode="decimal" step="1" value="${Math.round(s.grams)}">
      </label>

      <div class="chips">
        ${presets.map(pr =>
          `<button class="chip" data-g="${pr.g}">${esc(pr.label)}</button>`).join('')}
      </div>

      <div id="portion-preview" style="margin-top:16px"></div>

      ${s.isNew ? `
      <label class="seg-opt on" style="margin-top:16px" id="save-lib-wrap">
        <input type="checkbox" id="save-lib" checked style="display:none">
        <span class="dot"></span>
        <span><b>Save to My foods</b><small>So you can log it instantly next time, offline.</small></span>
      </label>` : ''}
    </div>

    <div class="sticky-save">
      <button class="btn btn-primary btn-block" id="log-btn">Add to ${Food.mealLabel(App.addCtx.meal).toLowerCase()}</button>
    </div>`;

  wireMealChips();

  const gInput = $('#g');

  const paintPreview = () => {
    const grams = Number(gInput.value) || 0;
    const m = Food.scale(p, grams);
    $('#portion-preview').innerHTML = macroGrid({
      kcal: Math.round(m.kcal),
      protein: Math.round(m.protein),
      carbs: Math.round(m.carbs),
      fat: Math.round(m.fat)
    }) + (m.fiber ? `<div style="margin-top:10px">${kv('Fibre', Calc.r(m.fiber,1) + ' g')}</div>` : '');
    $$('[data-g]').forEach(b =>
      b.classList.toggle('on', Math.round(Number(b.dataset.g)) === Math.round(grams)));
  };

  gInput.addEventListener('input', paintPreview);
  paintPreview();

  $$('[data-g]').forEach(b => b.addEventListener('click', () => {
    gInput.value = Math.round(Number(b.dataset.g));
    s.grams = Number(gInput.value);
    paintPreview();
  }));

  $('#back-pick').addEventListener('click', () => { s.view = 'pick'; paintAdd(); });

  /* toggle checkbox styling */
  $('#save-lib-wrap')?.addEventListener('click', () => {
    setTimeout(() => $('#save-lib-wrap').classList.toggle('on', $('#save-lib').checked), 0);
  });

  $('#fav-btn')?.addEventListener('click', async () => {
    const updated = await Food.toggleFavorite(f.id);
    if (updated) { s.food = updated; $('#fav-btn').textContent = updated.favorite ? '★' : '☆'; }
  });

  $('#log-btn').addEventListener('click', async () => {
    const grams = Number(gInput.value) || 0;
    if (grams <= 0) return toast('Enter an amount');

    let food = f;
    if (s.isNew && $('#save-lib')?.checked) food = await Food.saveFood(f);

    await Food.addEntry({
      day:  App.addCtx.day,
      meal: App.addCtx.meal,
      name: food.name,
      brand: food.brand,
      grams,
      servingLabel: (food.servingG && Math.round(grams) === Math.round(food.servingG))
        ? (food.servingLabel || '') : '',
      macros: Food.scale(food.per100, grams),
      foodId: food.id || null
    });

    tick();
    toast('Added');
    location.hash = '#/food';
  });
}

/* ============================================================
   TEMPLATE EDITOR
   ============================================================ */
Screens.template = {
  title: () => (App.tplState?.tpl?.id ? 'Edit workout' : 'New workout'),
  tab: 'train', back: '#/train',
  sub: () => App.tplState?.view === 'pick' ? 'Choose an exercise' : 'Structure & progression',
  render: () => `<div id="tpl-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    let tpl = App.tplId ? await Train.getTemplate(App.tplId) : null;
    if (!tpl) {
      const all = await Train.allTemplates();
      tpl = { id: null, name: '', dayHint: null, order: all.length, slots: [] };
    }
    App.tplState = { tpl: JSON.parse(JSON.stringify(tpl)), view: 'edit', q: '', muscle: null };
    await paintTemplate();
  }
};

async function paintTemplate() {
  const st = App.tplState;
  if (st.view === 'pick')  return paintExPicker();
  if (st.view === 'newex') return paintNewExercise();
  return paintTplEdit();
}

/* ---------------- edit view ---------------- */
function paintTplEdit() {
  const st = App.tplState, t = st.tpl;

  const dayOpts = ['<option value="">No fixed day</option>']
    .concat(DOW.map((d, i) => `<option value="${i}" ${t.dayHint === i ? 'selected' : ''}>${d}</option>`))
    .join('');

  const restOpts = g => [45, 60, 90, 120, 150, 180, 240]
    .map(v => `<option value="${v}" ${v === g ? 'selected' : ''}>${v}s</option>`).join('');

  $('#tpl-root').innerHTML = `
    <div class="stack">
      <div class="card">
        <label class="field"><span>Workout name</span>
          <input id="tpl-name" data-type="text" value="${esc(t.name)}" placeholder="Upper A"></label>
        <label class="field" style="margin-bottom:0"><span>Scheduled day</span>
          <select id="tpl-day">${dayOpts}</select></label>
      </div>

      <div class="card" style="padding:0">
        <div class="card-head" style="padding:16px 16px 10px;margin:0">
          <p class="card-title">Exercises (${t.slots.length})</p>
          <span class="tag">${t.slots.reduce((n, s) => n + (+s.sets || 0), 0)} sets</span>
        </div>
        ${t.slots.length ? t.slots.map((s, i) => `
          <div class="slot">
            <div class="slot-top">
              <span class="slot-name">${i + 1}. ${esc(s.exerciseName)}</span>
              <button class="iconbtn" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="iconbtn" data-down="${i}" ${i === t.slots.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="iconbtn danger" data-rm="${i}">×</button>
            </div>
            <div class="slot-grid">
              <div><label>Sets</label>
                <input type="number" inputmode="numeric" min="1" max="10"
                       data-i="${i}" data-k="sets" value="${s.sets}"></div>
              <div><label>Rep min</label>
                <input type="number" inputmode="numeric" min="1" max="50"
                       data-i="${i}" data-k="repMin" value="${s.repMin}"></div>
              <div><label>Rep max</label>
                <input type="number" inputmode="numeric" min="1" max="60"
                       data-i="${i}" data-k="repMax" value="${s.repMax}"></div>
              <div><label>RIR</label>
                <input type="number" inputmode="numeric" min="0" max="5"
                       data-i="${i}" data-k="rir" value="${s.rir}"></div>
              <div><label>Rest</label>
                <select data-i="${i}" data-k="restSec">${restOpts(+s.restSec)}</select></div>
            </div>
          </div>`).join('')
        : `<div class="meal-empty">No exercises yet</div>`}
        <button class="meal-add" id="add-ex">+ Add exercise</button>
      </div>

      <div class="sticky-save">
        <button class="btn btn-primary btn-block" id="tpl-save">
          ${t.id ? 'Save changes' : 'Create workout'}</button>
      </div>

      ${t.id ? `
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" id="tpl-dup" style="flex:1">Duplicate</button>
        <button class="btn btn-danger btn-sm" id="tpl-del" style="flex:1">Delete</button>
      </div>` : ''}
    </div>`;

  $('#tpl-name').addEventListener('input', e => { st.tpl.name = e.target.value; });
  $('#tpl-day').addEventListener('change', e => {
    st.tpl.dayHint = e.target.value === '' ? null : Number(e.target.value);
  });

  $$('[data-k]').forEach(el => el.addEventListener('input', () => {
    const i = Number(el.dataset.i);
    const v = Number(el.value);
    if (isFinite(v)) st.tpl.slots[i][el.dataset.k] = v;
  }));

  $$('[data-up]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.up);
    [st.tpl.slots[i - 1], st.tpl.slots[i]] = [st.tpl.slots[i], st.tpl.slots[i - 1]];
    paintTplEdit();
  }));

  $$('[data-down]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.down);
    [st.tpl.slots[i + 1], st.tpl.slots[i]] = [st.tpl.slots[i], st.tpl.slots[i + 1]];
    paintTplEdit();
  }));

  $$('[data-rm]').forEach(b => b.addEventListener('click', () => {
    st.tpl.slots.splice(Number(b.dataset.rm), 1);
    paintTplEdit();
  }));

  $('#add-ex').addEventListener('click', () => {
    st.view = 'pick'; st.q = ''; st.muscle = null;
    $('#screen-sub').textContent = 'Choose an exercise';
    paintTemplate();
  });

  $('#tpl-save').addEventListener('click', async () => {
    if (!st.tpl.name.trim())  return toast('Give the workout a name');
    if (!st.tpl.slots.length) return toast('Add at least one exercise');
    const saved = await Train.saveTemplate(st.tpl);
    App.tplId = saved.id;
    toast('Saved');
    location.hash = '#/train';
  });

  $('#tpl-dup')?.addEventListener('click', async () => {
    await Train.duplicateTemplate(st.tpl.id);
    toast('Duplicated');
    location.hash = '#/train';
  });

  $('#tpl-del')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${st.tpl.name}"? Logged sessions are kept.`)) return;
    await Train.deleteTemplate(st.tpl.id);
    toast('Deleted');
    location.hash = '#/train';
  });
}

/* ---------------- exercise picker ---------------- */
function exPickRow(e) {
  return `
    <button class="pick" data-ex="${e.id}">
      <div class="pick-main">
        <div class="pick-name">${esc(e.name)}${e.custom ? ' <span class="tag">custom</span>' : ''}</div>
        <div class="pick-sub">${Train.muscleLabel(e.muscle)} · ${esc(e.equipment)}${e.isCompound ? ' · compound' : ''}</div>
      </div>
      <div class="pick-k">${e.repMin}–${e.repMax}<b>reps</b></div>
    </button>`;
}

async function paintExPicker() {
  const st = App.tplState;
  const rows = await Train.searchExercises(st.q, st.muscle);

  $('#tpl-root').innerHTML = `
    <button class="btn btn-sm btn-ghost" id="pick-back" style="margin-bottom:14px">
      ‹ Back to workout</button>

    <div class="searchbar">
      <input id="ex-q" type="search" placeholder="Search exercises…"
             value="${esc(st.q)}" autocomplete="off" enterkeyhint="search">
      ${st.q ? `<button class="sb-clear" id="ex-clear">×</button>` : ''}
    </div>

    <div class="chips" style="margin-bottom:14px">
      <button class="chip ${!st.muscle ? 'on' : ''}" data-m="">All</button>
      ${Train.MUSCLES.map(m =>
        `<button class="chip ${st.muscle === m.key ? 'on' : ''}" data-m="${m.key}">${m.label}</button>`
      ).join('')}
    </div>

    <div id="ex-list">
      ${rows.length
        ? `<div class="picker">${rows.map(exPickRow).join('')}</div>`
        : `<div class="empty"><h3>No matches</h3>
             <p class="hint">Create it as a custom exercise below.</p></div>`}
    </div>

    <button class="btn btn-block btn-ghost" id="new-ex" style="margin-top:14px">
      + Create custom exercise</button>`;

  $('#pick-back').addEventListener('click', () => {
    st.view = 'edit';
    $('#screen-sub').textContent = 'Structure & progression';
    paintTemplate();
  });

  $('#ex-q').addEventListener('input', async e => {
    st.q = e.target.value;
    const list = await Train.searchExercises(st.q, st.muscle);
    $('#ex-list').innerHTML = list.length
      ? `<div class="picker">${list.map(exPickRow).join('')}</div>`
      : `<div class="empty"><h3>No matches</h3></div>`;
    wireExRows();
  });

  $('#ex-clear')?.addEventListener('click', () => { st.q = ''; paintExPicker(); });

  $$('[data-m]').forEach(b => b.addEventListener('click', () => {
    st.muscle = b.dataset.m || null;
    paintExPicker();
  }));

  $('#new-ex').addEventListener('click', () => { st.view = 'newex'; paintTemplate(); });

  wireExRows();
}

function wireExRows() {
  $$('[data-ex]').forEach(b => b.addEventListener('click', async () => {
    const st = App.tplState;
    const ex = await Train.getExercise(b.dataset.ex);
    if (!ex) return;
    st.tpl.slots.push({
      exerciseId: ex.id,
      exerciseName: ex.name,
      sets: 3,
      repMin: ex.repMin,
      repMax: ex.repMax,
      rir: 2,
      restSec: ex.isCompound ? 150 : 90,
      note: ''
    });
    st.view = 'edit';
    tick();
    $('#screen-sub').textContent = 'Structure & progression';
    paintTemplate();
  }));
}

/* ---------------- custom exercise form ---------------- */
function paintNewExercise() {
  const st = App.tplState;

  $('#tpl-root').innerHTML = `
    <button class="btn btn-sm btn-ghost" id="ne-back" style="margin-bottom:14px">
      ‹ Back to exercises</button>

    <form id="ne-form" class="card" onsubmit="return false">
      <label class="field"><span>Exercise name</span>
        <input name="name" data-type="text" placeholder="Smith machine row"></label>

      <div class="field-row">
        <label class="field"><span>Muscle</span>
          <select name="muscle">
            ${Train.MUSCLES.map(m => `<option value="${m.key}">${m.label}</option>`).join('')}
          </select></label>
        <label class="field"><span>Equipment</span>
          <select name="equipment">
            <option value="barbell">Barbell</option>
            <option value="dumbbell">Dumbbell</option>
            <option value="machine">Machine</option>
            <option value="cable">Cable</option>
            <option value="bodyweight">Bodyweight</option>
          </select></label>
      </div>

      <div class="field-row">
        <label class="field"><span>Rep min</span>
          <input name="repMin" data-type="number" type="number" inputmode="numeric" value="8"></label>
        <label class="field"><span>Rep max</span>
          <input name="repMax" data-type="number" type="number" inputmode="numeric" value="12"></label>
      </div>

      <label class="seg-opt" id="ne-comp-wrap" style="margin-bottom:0">
        <input type="checkbox" id="ne-comp" style="display:none">
        <span class="dot"></span>
        <span><b>Compound lift</b>
          <small>Multi-joint. Gets bigger weight jumps: 2.5 kg instead of 1.25 kg.</small></span>
      </label>

      <button class="btn btn-primary btn-block" id="ne-save" style="margin-top:16px">
        Create &amp; add</button>
    </form>`;

  $('#ne-back').addEventListener('click', () => { st.view = 'pick'; paintTemplate(); });

  $('#ne-comp-wrap').addEventListener('click', () => {
    setTimeout(() => $('#ne-comp-wrap').classList.toggle('on', $('#ne-comp').checked), 0);
  });

  $('#ne-save').addEventListener('click', async () => {
    const v = readForm($('#ne-form'));
    if (!v.name || !v.name.trim()) return toast('Name it first');
    const ex = await Train.saveExercise({
      name: v.name,
      muscle: v.muscle,
      equipment: v.equipment,
      repMin: v.repMin || 8,
      repMax: v.repMax || 12,
      isCompound: $('#ne-comp').checked,
      custom: true
    });
    st.tpl.slots.push({
      exerciseId: ex.id,
      exerciseName: ex.name,
      sets: 3,
      repMin: ex.repMin,
      repMax: ex.repMax,
      rir: 2,
      restSec: ex.isCompound ? 150 : 90,
      note: ''
    });
    st.view = 'edit';
    toast('Added to library');
    paintTemplate();
  });
}

/* ============================================================
   LIVE SESSION LOGGER
   ============================================================ */
Screens.session = {
  title: () => App.sess?.session?.name || 'Session',
  tab: 'train', back: '#/train',
  sub: () => App.sess?.view === 'pick' ? 'Add an exercise' : 'Tap ✓ to log each set',
  render: () => `<div id="sess-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    const s = await Train.getActive();
    if (!s) { toast('No session in progress'); location.hash = '#/train'; return; }
    App.sess = { session: s, view: 'log', sug: {}, warm: {}, q: '', muscle: null, result: null };
    if (!App.timerInt) App.timerInt = setInterval(tickClocks, 250);
    await paintSession();
  }
};

async function paintSession() {
  const st = App.sess;
  if (st.view === 'pick') return paintSessionPick();
  if (st.view === 'done') return paintSessionDone();
  return paintSessionLog();
}

/* ---------------- helpers ---------------- */
function mmss(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function tickClocks() {
  const st = App.sess;
  const el = $('#elapsed');
  if (el && st?.session) {
    el.textContent = mmss(Math.round((Date.now() - st.session.startedAt) / 1000));
  }
  if (App.rest) {
    const left = Math.max(0, Math.round((App.rest.endsAt - Date.now()) / 1000));
    const v = $('#rest-val');
    if (v) v.textContent = mmss(left);
    const bar = $('#rest-bar');
    if (bar) bar.classList.toggle('ready', left === 0);
    if (left === 0 && !App.rest.fired) {
      App.rest.fired = true;
      if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
      const lbl = $('#rest-label');
      if (lbl) lbl.textContent = 'Rest done — go';
    }
  }
  if (!App.rest && !$('#elapsed')) { clearInterval(App.timerInt); App.timerInt = null; }
}

function startRest(sec) {
  if (!sec) return;
  App.rest = { endsAt: Date.now() + sec * 1000, dur: sec, fired: false };
  if (!App.timerInt) App.timerInt = setInterval(tickClocks, 250);
  paintRestBar();
}

function stopRest() {
  App.rest = null;
  $('#rest-bar')?.remove();
}

function paintRestBar() {
  if (!App.rest) return;
  let el = $('#rest-bar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rest-bar';
    el.className = 'timerbar';
    document.body.appendChild(el);
  }
  const left = Math.max(0, Math.round((App.rest.endsAt - Date.now()) / 1000));
  el.innerHTML = `
    <div>
      <b id="rest-val">${mmss(left)}</b>
      <div class="banner-sub" id="rest-label">Rest</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-sm" id="rest-plus">+30s</button>
      <button class="btn btn-sm btn-ghost" id="rest-skip">Skip</button>
    </div>`;
  $('#rest-plus').addEventListener('click', () => {
    App.rest.endsAt += 30000; App.rest.fired = false;
    $('#rest-label').textContent = 'Rest';
    $('#rest-bar').classList.remove('ready');
  });
  $('#rest-skip').addEventListener('click', stopRest);
}

/* ---------------- main log view ---------------- */
async function paintSessionLog() {
  const st = App.sess, s = st.session;

  /* one suggestion per exercise, computed once */
  for (const slot of s.plan) {
    if (!st.sug[slot.exerciseId]) st.sug[slot.exerciseId] = await Train.suggest(slot.exerciseId, slot);
  }

  const work = s.sets.filter(x => !x.warmup);
  const kg = Math.round(work.reduce((a, x) => a + (x.weightKg || 0) * (x.reps || 0), 0));

  const header = `
    <div class="card">
      <div class="stat-grid">
        <div class="stat"><div class="stat-value" id="elapsed">0:00</div><div class="stat-label">elapsed</div></div>
        <div class="stat"><div class="stat-value">${work.length}</div><div class="stat-label">sets</div></div>
        <div class="stat"><div class="stat-value">${kg.toLocaleString()}</div><div class="stat-label">kg lifted</div></div>
      </div>
    </div>`;

  const numStyle = 'appearance:none;border:0;background:transparent;color:var(--dim);' +
                   'font:inherit;font-weight:800;font-size:12px;cursor:pointer;padding:0';

  const blocks = s.plan.map((slot, si) => {
    const sug = st.sug[slot.exerciseId] || {};
    const logged = s.sets.filter(x => x.exerciseId === slot.exerciseId);
    const prev = logged[logged.length - 1];
    const rowCount = Math.max(slot.sets, logged.length);

    let rows = '';
    for (let i = 0; i < rowCount; i++) {
      const done = logged[i];
      const wKey = slot.exerciseId + ':' + i;
      const isWarm = done ? !!done.warmup : !!st.warm[wKey];
      const wVal = done ? done.weightKg : (prev ? prev.weightKg : (sug.weightKg ?? ''));
      const rVal = done ? done.reps     : (sug.reps ?? slot.repMax);
      const iVal = done ? (done.rir ?? '') : slot.rir;
      rows += `
        <div class="setrow ${done ? 'logged' : ''} ${isWarm ? 'warmup' : ''}">
          <button style="${numStyle}" data-warm="${wKey}" ${done ? 'disabled' : ''}
                  title="Tap to mark as warm-up">${isWarm ? 'W' : i + 1}</button>
          <input id="w-${slot.exerciseId}-${i}" type="number" inputmode="decimal" step="1.25"
                 value="${wVal}" placeholder="kg" ${done ? 'disabled' : ''}>
          <input id="r-${slot.exerciseId}-${i}" type="number" inputmode="numeric"
                 value="${rVal}" placeholder="reps" ${done ? 'disabled' : ''}>
          <input id="i-${slot.exerciseId}-${i}" type="number" inputmode="numeric" min="0" max="5"
                 value="${iVal}" placeholder="rir" ${done ? 'disabled' : ''}>
          <button class="ok" data-log="${slot.exerciseId}:${i}">✓</button>
        </div>`;
    }

    return `
      <div class="exblock">
        <div class="exhead">
          <div class="exhead-top">
            <div style="min-width:0">
              <div class="exname">${esc(slot.exerciseName)}</div>
              <div class="exmeta">${slot.sets}×${slot.repMin}–${slot.repMax} · RIR ${slot.rir} · rest ${slot.restSec}s</div>
            </div>
            <button class="iconbtn danger" data-rmex="${si}">×</button>
          </div>
          ${sug.note ? `<div class="exsuggest">${esc(sug.note)}</div>` : ''}
        </div>
        <div class="setlabels"><span></span><span>kg</span><span>reps</span><span>rir</span><span></span></div>
        ${rows}
        <div class="ex-actions">
          <button class="btn btn-sm btn-ghost" data-addset="${si}">+ Set</button>
          <button class="btn btn-sm btn-ghost" data-rmset="${si}"
                  ${slot.sets <= Math.max(1, logged.length) ? 'disabled' : ''}>− Set</button>
        </div>
      </div>`;
  }).join('');

  $('#sess-root').innerHTML = `
    ${header}
    ${blocks || `<div class="empty"><h3>Empty session</h3>
                   <p class="hint">Add your first exercise below.</p></div>`}

    <button class="btn btn-block btn-ghost" id="add-ex-sess" style="margin-bottom:14px">
      + Add exercise</button>

    <div class="card" style="margin-bottom:14px">
      <label class="field" style="margin:0"><span>Session notes</span>
        <textarea id="sess-notes" rows="2" placeholder="Felt strong, left knee tight…">${esc(s.notes || '')}</textarea></label>
    </div>

    <button class="btn btn-primary btn-block" id="finish">Finish workout</button>
    <button class="btn btn-block btn-danger" id="discard" style="margin-top:8px">Discard session</button>
    <div style="height:70px"></div>`;

  /* ---------------- wiring ---------------- */

  $$('[data-warm]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.warm;
    st.warm[k] = !st.warm[k];
    paintSessionLog();
  }));

  $$('[data-log]').forEach(b => b.addEventListener('click', async () => {
    const [exId, idxRaw] = b.dataset.log.split(':');
    const i = Number(idxRaw);
    const slot = s.plan.find(x => x.exerciseId === exId);
    const logged = s.sets.filter(x => x.exerciseId === exId);

    /* tapping a logged set un-logs it */
    if (logged[i]) {
      s.sets = s.sets.filter(x => x.id !== logged[i].id);
      await Train.setActive(s);
      return paintSessionLog();
    }

    const w = Number($(`#w-${exId}-${i}`).value);
    const r = Number($(`#r-${exId}-${i}`).value);
    const ri = $(`#i-${exId}-${i}`).value;
    if (!r || r <= 0) return toast('Enter reps');

    s.sets.push({
      id: Store.uid(),
      exerciseId: exId,
      exerciseName: slot.exerciseName,
      weightKg: isFinite(w) ? w : 0,
      reps: r,
      rir: ri === '' ? null : Number(ri),
      warmup: !!st.warm[exId + ':' + i],
      ts: Date.now()
    });
    await Train.setActive(s);
    tick();
    if (!st.warm[exId + ':' + i]) startRest(slot.restSec);
    paintSessionLog();
  }));

  $$('[data-addset]').forEach(b => b.addEventListener('click', async () => {
    s.plan[Number(b.dataset.addset)].sets++;
    await Train.setActive(s);
    paintSessionLog();
  }));

  $$('[data-rmset]').forEach(b => b.addEventListener('click', async () => {
    const slot = s.plan[Number(b.dataset.rmset)];
    slot.sets = Math.max(1, slot.sets - 1);
    await Train.setActive(s);
    paintSessionLog();
  }));

  $$('[data-rmex]').forEach(b => b.addEventListener('click', async () => {
    const si = Number(b.dataset.rmex);
    const slot = s.plan[si];
    if (!confirm(`Remove ${slot.exerciseName} from this session?`)) return;
    s.sets = s.sets.filter(x => x.exerciseId !== slot.exerciseId);
    s.plan.splice(si, 1);
    await Train.setActive(s);
    paintSessionLog();
  }));

  $('#sess-notes').addEventListener('input', async e => {
    s.notes = e.target.value;
    await Train.setActive(s);
  });

  $('#add-ex-sess').addEventListener('click', () => {
    st.view = 'pick'; st.q = ''; st.muscle = null;
    $('#screen-sub').textContent = 'Add an exercise';
    paintSession();
  });

  $('#finish').addEventListener('click', async () => {
    if (!work.length && !confirm('Nothing logged. Finish anyway? The session will be discarded.')) return;
    stopRest();
    const result = await Train.finishSession(s);
    st.result = result;
    st.view = 'done';
    if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
    paintSession();
  });

  $('#discard').addEventListener('click', async () => {
    if (!confirm('Discard this session? Everything logged in it is lost.')) return;
    stopRest();
    await Train.clearActive();
    location.hash = '#/train';
  });
}

/* ---------------- add an exercise mid-session ---------------- */
async function paintSessionPick() {
  const st = App.sess;
  const rows = await Train.searchExercises(st.q, st.muscle);

  $('#sess-root').innerHTML = `
    <button class="btn btn-sm btn-ghost" id="sp-back" style="margin-bottom:14px">
      ‹ Back to session</button>

    <div class="searchbar">
      <input id="sp-q" type="search" placeholder="Search exercises…"
             value="${esc(st.q)}" autocomplete="off" enterkeyhint="search">
    </div>

    <div class="chips" style="margin-bottom:14px">
      <button class="chip ${!st.muscle ? 'on' : ''}" data-m="">All</button>
      ${Train.MUSCLES.map(m =>
        `<button class="chip ${st.muscle === m.key ? 'on' : ''}" data-m="${m.key}">${m.label}</button>`
      ).join('')}
    </div>

    <div id="sp-list">
      ${rows.length ? `<div class="picker">${rows.map(exPickRow).join('')}</div>`
                    : `<div class="empty"><h3>No matches</h3></div>`}
    </div>`;

  const wireRows = () => $$('[data-ex]').forEach(b => b.addEventListener('click', async () => {
    const ex = await Train.getExercise(b.dataset.ex);
    if (!ex) return;
    st.session.plan.push({
      exerciseId: ex.id, exerciseName: ex.name,
      sets: 3, repMin: ex.repMin, repMax: ex.repMax,
      rir: 2, restSec: ex.isCompound ? 150 : 90, note: ''
    });
    await Train.setActive(st.session);
    st.view = 'log';
    tick();
    $('#screen-sub').textContent = 'Tap ✓ to log each set';
    paintSession();
  }));

  $('#sp-back').addEventListener('click', () => {
    st.view = 'log';
    $('#screen-sub').textContent = 'Tap ✓ to log each set';
    paintSession();
  });

  $('#sp-q').addEventListener('input', async e => {
    st.q = e.target.value;
    const list = await Train.searchExercises(st.q, st.muscle);
    $('#sp-list').innerHTML = list.length
      ? `<div class="picker">${list.map(exPickRow).join('')}</div>`
      : `<div class="empty"><h3>No matches</h3></div>`;
    wireRows();
  });

  $$('[data-m]').forEach(b => b.addEventListener('click', () => {
    st.muscle = b.dataset.m || null;
    paintSessionPick();
  }));

  wireRows();
}

/* ---------------- finished summary ---------------- */
function paintSessionDone() {
  const { session, prs } = App.sess.result || {};

  if (!session) {
    $('#sess-root').innerHTML = `
      <div class="empty">
        <h3>Session discarded</h3>
        <p class="hint">Nothing was logged, so nothing was saved.</p>
      </div>
      <button class="btn btn-primary btn-block" id="done-btn">Back to Train</button>`;
    $('#done-btn').addEventListener('click', () => { location.hash = '#/train'; });
    return;
  }

  const stats = sessionStats(session);

  $('#sess-root').innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="card-head"><p class="card-title">${esc(session.name)}</p>
          <span class="tag">${dayLabel(session.day)}</span></div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-value">${stats.sets}</div><div class="stat-label">sets</div></div>
          <div class="stat"><div class="stat-value">${stats.exercises}</div><div class="stat-label">exercises</div></div>
          <div class="stat"><div class="stat-value">${fmtDur(session.durationSec)}</div><div class="stat-label">time</div></div>
        </div>
        <div style="margin-top:14px">
          ${kv('Total load', stats.kg.toLocaleString() + ' kg')}
          ${session.notes ? kv('Notes', esc(session.notes)) : ''}
        </div>
      </div>

      ${prs && prs.length ? `
        <div class="card">
          <div class="card-head"><p class="card-title">New records</p>
            <span class="pr">${prs.length} PR${prs.length > 1 ? 's' : ''}</span></div>
          ${prs.map(p => `
            <div class="row">
              <div class="row-main">
                <div class="row-title">${esc(p.name)}</div>
                <div class="row-sub">${p.isFirst ? 'First time logged'
                  : 'Previous best ' + p.previous + (p.type === 'e1RM' ? ' kg' : ' reps')}</div>
              </div>
              <div class="row-value tone-good">${p.value}${p.type === 'e1RM' ? ' kg' : ' reps'}</div>
            </div>`).join('')}
          <p class="hint" style="margin-top:10px;font-size:12px">
            Estimated 1RM from the Epley formula — weight × (1 + reps ÷ 30).</p>
        </div>` : `
        <div class="card">
          <p class="hint">No PRs this time. Consistency beats records — the volume still counts.</p>
        </div>`}

      <button class="btn btn-primary btn-block" id="done-btn">Done</button>
    </div>`;

  $('#done-btn').addEventListener('click', () => { location.hash = '#/train'; });
}

/* ============================================================
   SPARKLINE (reused in Phase 5)
   ============================================================ */
function sparkline(values, { h = 56, color = 'var(--accent)', fill = true } = {}) {
  if (!values || values.length < 2) return '';
  const w = 300;
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max - min) || 1;
  const pt = (v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 6) - 3;
    return [x, y];
  };
  const pts = values.map(pt).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = fill
    ? `<polygon points="0,${h} ${pts} ${w},${h}" fill="${color}" opacity="0.12"/>` : '';
  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none"
         style="display:block;overflow:visible">
      ${area}
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

/* ============================================================
   SESSION HISTORY DETAIL
   ============================================================ */
Screens.history = {
  title: () => App.histSession?.name || 'Session',
  tab: 'train', back: '#/train',
  sub: () => App.histSession ? dayLabel(App.histSession.day) : '',
  render: () => `<div id="hist-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    const s = await Train.getSession(App.sessionId);
    if (!s) { toast('Session not found'); location.hash = '#/train'; return; }
    App.histSession = s;
    $('#screen-title').textContent = s.name;
    $('#screen-sub').textContent = dayLabel(s.day);
    paintHistory();
  }
};

function paintHistory() {
  const s = App.histSession;
  const stats = sessionStats(s);

  /* group sets by exercise, in the order they were performed */
  const order = [];
  const groups = {};
  (s.sets || []).forEach(x => {
    if (!groups[x.exerciseId]) { groups[x.exerciseId] = []; order.push(x.exerciseId); }
    groups[x.exerciseId].push(x);
  });

  $('#hist-root').innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="stat-grid">
          <div class="stat"><div class="stat-value">${stats.sets}</div><div class="stat-label">sets</div></div>
          <div class="stat"><div class="stat-value">${fmtDur(s.durationSec)}</div><div class="stat-label">time</div></div>
          <div class="stat"><div class="stat-value">${stats.kg.toLocaleString()}</div><div class="stat-label">kg</div></div>
        </div>
        ${s.notes ? `<div style="margin-top:14px">${kv('Notes', esc(s.notes))}</div>` : ''}
      </div>

      ${order.map(exId => {
        const sets = groups[exId];
        const workSets = sets.filter(x => !x.warmup);
        const best = workSets.length ? Math.max(...workSets.map(Train.setScore)) : 0;
        return `
        <div class="exblock">
          <div class="exhead">
            <div class="exhead-top">
              <div>
                <div class="exname">${esc(sets[0].exerciseName)}</div>
                <div class="exmeta">${workSets.length} working sets${
                  best && workSets.some(x => x.weightKg > 0)
                    ? ' · best e1RM ' + Math.round(best * 10) / 10 + ' kg' : ''}</div>
              </div>
              <button class="btn btn-sm btn-ghost" data-exview="${exId}">Trend</button>
            </div>
          </div>
          ${sets.map((x, i) => `
            <div class="setrow ${x.warmup ? 'warmup' : ''}" style="grid-template-columns:26px 1fr">
              <span class="setnum">${x.warmup ? 'W' : i + 1}</span>
              <span style="font-size:15px">
                ${x.weightKg ? Calc.r(x.weightKg, 2) + ' kg × ' : ''}${x.reps} reps${
                  x.rir != null ? ' · RIR ' + x.rir : ''}</span>
            </div>`).join('')}
        </div>`;
      }).join('')}

      <button class="btn btn-block btn-primary" id="repeat">Repeat this workout</button>
      <button class="btn btn-block btn-danger" id="del-sess">Delete session</button>
    </div>`;

  $$('[data-exview]').forEach(b => b.addEventListener('click', () => {
    App.exId = b.dataset.exview;
    location.hash = '#/exercise';
  }));

  $('#repeat').addEventListener('click', async () => {
    const existing = await Train.getActive();
    if (existing && !confirm('Discard the session in progress and start this one?')) return;
    const { byId } = await Train.exerciseMap();
    const plan = order.map(exId => {
      const ex = byId[exId];
      const sets = groups[exId].filter(x => !x.warmup);
      return {
        exerciseId: exId,
        exerciseName: groups[exId][0].exerciseName,
        sets: Math.max(1, sets.length),
        repMin: ex?.repMin ?? 8,
        repMax: ex?.repMax ?? 12,
        rir: sets[0]?.rir ?? 2,
        restSec: ex?.isCompound ? 150 : 90,
        note: ''
      };
    });
    const fresh = await Train.startSession({ id: null, name: s.name, slots: plan });
    fresh.name = s.name;
    await Train.setActive(fresh);
    location.hash = '#/session';
  });

  $('#del-sess').addEventListener('click', async () => {
    if (!confirm('Delete this session permanently?')) return;
    await Train.deleteSession(s.id);
    toast('Deleted');
    location.hash = '#/train';
  });
}

/* ============================================================
   EXERCISE LIST + PROGRESS
   ============================================================ */
async function exerciseHistory(exId) {
  const sessions = await Train.allSessions();
  const out = [];
  sessions.forEach(s => {
    const sets = (s.sets || []).filter(x => x.exerciseId === exId && !x.warmup);
    if (sets.length) out.push({
      day: s.day, sessionId: s.id, sets,
      best: Math.max(...sets.map(Train.setScore)),
      topWeight: Math.max(...sets.map(x => x.weightKg || 0)),
      volume: sets.reduce((a, x) => a + (x.weightKg || 0) * (x.reps || 0), 0)
    });
  });
  return out;                     // newest first
}

Screens.exercises = {
  title: 'Exercise history', tab: 'settings', back: '#/settings',
  sub: () => 'Personal records & progress',
  render: () => `<div id="exs-root"><div class="spinner">Loading…</div></div>`,
  async mount() { App.exsQ = ''; await paintExerciseList(); }
};

async function paintExerciseList() {
  const [sessions, { byId }] = await Promise.all([Train.allSessions(), Train.exerciseMap()]);

  const seen = {};
  sessions.forEach(s => (s.sets || []).filter(x => !x.warmup).forEach(x => {
    const e = seen[x.exerciseId] ||= { id: x.exerciseId, name: x.exerciseName, last: s.day, best: 0, sets: 0 };
    e.best = Math.max(e.best, Train.setScore(x));
    e.sets++;
  }));

  const needle = (App.exsQ || '').toLowerCase();
  const rows = Object.values(seen)
    .filter(e => !needle || e.name.toLowerCase().includes(needle))
    .sort((a, b) => b.last.localeCompare(a.last));

  $('#exs-root').innerHTML = `
    <div class="searchbar">
      <input id="exs-q" type="search" placeholder="Search…" value="${esc(App.exsQ || '')}"
             autocomplete="off">
    </div>
    ${rows.length ? `<div class="picker">${rows.map(e => `
      <button class="pick" data-open="${e.id}">
        <div class="pick-main">
          <div class="pick-name">${esc(e.name)}</div>
          <div class="pick-sub">${Train.muscleLabel(byId[e.id]?.muscle || '')} · last ${dayLabel(e.last)} · ${e.sets} sets</div>
        </div>
        <div class="pick-k">${Math.round(e.best * 10) / 10}<b>best</b></div>
      </button>`).join('')}</div>`
    : `<div class="empty"><h3>Nothing logged yet</h3>
         <p class="hint">Complete a workout and your lifts will appear here.</p></div>`}`;

  $('#exs-q').addEventListener('input', e => { App.exsQ = e.target.value; paintExerciseList(); });
  $$('[data-open]').forEach(b => b.addEventListener('click', () => {
    App.exId = b.dataset.open;
    location.hash = '#/exercise';
  }));
}

Screens.exercise = {
  title: () => App.exName || 'Exercise',
  tab: 'settings', back: '#/exercises',
  sub: () => 'Progress & records',
  render: () => `<div id="ex-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    const ex = await Train.getExercise(App.exId);
    App.exName = ex?.name || 'Exercise';
    $('#screen-title').textContent = App.exName;
    const hist = await exerciseHistory(App.exId);
    const best = await Train.bestFor(App.exId);
    const trend = hist.slice().reverse().map(h => h.best);
    const weighted = hist.some(h => h.topWeight > 0);

    $('#ex-root').innerHTML = `
      <div class="stack">

        <div class="card">
          <div class="card-head"><p class="card-title">Records</p>
            ${ex ? `<span class="tag">${Train.muscleLabel(ex.muscle)}</span>` : ''}</div>
          ${best ? `
            ${kv('Best ' + (weighted ? 'e1RM' : 'set'),
                 weighted ? best.e1rm + ' kg' : best.bestReps + ' reps', 'good')}
            ${weighted ? kv('Heaviest set', Calc.r(best.bestWeight, 2) + ' kg') : ''}
            ${kv('Most reps', best.bestReps)}
            ${kv('Sets logged', best.totalSets)}
            ${kv('Achieved', fmtDate(best.bestDay))}
          ` : `<p class="hint">No data yet.</p>`}
        </div>

        ${trend.length > 1 ? `
        <div class="card">
          <div class="card-head">
            <p class="card-title">${weighted ? 'Estimated 1RM' : 'Reps'} trend</p>
            <span class="tag">${trend.length} sessions</span>
          </div>
          ${sparkline(trend, { color: 'var(--protein)' })}
          <div style="display:flex;justify-content:space-between;margin-top:8px;
                      font-size:11px;color:var(--dim)">
            <span>${fmtDate(hist[hist.length - 1].day)}</span>
            <span>${fmtDate(hist[0].day)}</span>
          </div>
        </div>` : ''}

        <div class="card" style="padding:0">
          <div class="card-head" style="padding:16px 16px 10px;margin:0">
            <p class="card-title">Session history</p></div>
          ${hist.length ? hist.map(h => `
            <button class="pick" data-sess="${h.sessionId}">
              <div class="pick-main">
                <div class="pick-name">${dayLabel(h.day)}</div>
                <div class="pick-sub">${h.sets.map(x =>
                  `${x.weightKg ? Calc.r(x.weightKg, 2) + '×' : ''}${x.reps}`).join(', ')}</div>
              </div>
              <div class="pick-k">${Math.round(h.best * 10) / 10}<b>${weighted ? 'e1RM' : 'reps'}</b></div>
            </button>`).join('')
          : `<div class="meal-empty">No sessions</div>`}
        </div>

      </div>`;

    $$('[data-sess]').forEach(b => b.addEventListener('click', () => {
      App.sessionId = b.dataset.sess;
      location.hash = '#/history';
    }));
  }
};

/* ============================================================
   BODY METRICS — engine + screen
   ============================================================ */

/** All metric rows, oldest first. */
async function allMetrics() {
  return (await Store.all('metrics')).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Exponential moving average. Raw scale weight swings ±1.5 kg on water alone,
 * so the smoothed line is the only number worth reacting to.
 */
function emaSeries(values, alpha = 0.2) {
  let prev = null;
  return values.map(v => {
    if (v == null) return prev;
    prev = prev == null ? v : alpha * v + (1 - alpha) * prev;
    return prev;
  });
}

/** Least-squares slope per day over [{x:dayIndex, y:value}]. */
function slopePerDay(points) {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  points.forEach(p => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; });
  return den ? num / den : 0;
}

/** Current smoothed weight and the trend over the last `window` days. */
function trendSummary(metrics, key = 'weightKg', window = 21) {
  const rows = metrics.filter(m => m[key] != null);
  if (!rows.length) return null;
  const smooth = emaSeries(rows.map(m => m[key]));
  const first = rows[0].day;
  const pts = rows.map((m, i) => ({ x: Store.daysBetween(first, m.day), y: smooth[i] }));
  const recent = pts.filter(p => p.x >= (pts[pts.length - 1].x - window));
  const perDay = slopePerDay(recent);
  return {
    latest: rows[rows.length - 1][key],
    latestDay: rows[rows.length - 1].day,
    smooth: smooth[smooth.length - 1],
    perWeek: perDay * 7,
    entries: rows.length,
    firstDay: first,
    rows, smoothArr: smooth
  };
}

/** Multi-series line chart, no dependencies. */
function lineChart(series, { h = 110 } = {}) {
  const all = series.flatMap(s => s.values.filter(v => v != null));
  if (all.length < 2) return `<p class="hint">Log at least two entries to see a chart.</p>`;
  const min = Math.min(...all), max = Math.max(...all);
  const span = (max - min) || 1;
  const w = 300;
  const n = Math.max(...series.map(s => s.values.length));
  const X = i => (i / (n - 1 || 1)) * w;
  const Y = v => h - ((v - min) / span) * (h - 12) - 6;

  const body = series.map(s => {
    const pts = s.values.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)
                        .filter(Boolean).join(' ');
    if (!pts) return '';
    const area = s.fill
      ? `<polygon points="0,${h} ${pts} ${w},${h}" fill="${s.color}" opacity="0.10"/>` : '';
    return area + `<polyline points="${pts}" fill="none" stroke="${s.color}"
      stroke-width="${s.width || 2.5}" ${s.dash ? 'stroke-dasharray="4 5"' : ''}
      stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none"
         style="display:block;overflow:visible">${body}</svg>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-top:6px">
      <span>low ${Calc.r(min, 1)}</span><span>high ${Calc.r(max, 1)}</span>
    </div>`;
}

/* ---------------- the screen ---------------- */
async function paintBody() {
  const root = $('#body-root');
  if (!root) return;

  const range = App.bodyRange ?? 90;
  const all = await allMetrics();
  const cutoff = range ? Store.addDays(Store.dayKey(), -range) : '0000-00-00';
  const metrics = all.filter(m => m.day >= cutoff);

  const wt = trendSummary(metrics, 'weightKg');
  const bf = trendSummary(metrics, 'bodyFatPct');
  const ws = trendSummary(metrics, 'waistCm');
  const s = Store.s;
  const today = Store.dayKey();
  const todayRow = all.find(m => m.day === today);

  const rateTone = !wt ? 'dim'
    : Math.abs(wt.perWeek) < 0.1 ? 'dim'
    : (s.goalMode === 'leanBulk' ? (wt.perWeek > 0 ? 'good' : 'warn')
                                 : (wt.perWeek < 0 ? 'good' : 'warn'));

  /* ---- quick log ---- */
  const quickLog = `
    <div class="card">
      <div class="card-head"><p class="card-title">Log for today</p>
        <span class="tag">${todayRow ? 'logged' : 'not logged'}</span></div>
      <div class="field-row">
        <label class="field" style="margin-bottom:0"><span>Weight (kg)</span>
          <input id="q-weight" type="number" inputmode="decimal" step="0.1"
                 value="${todayRow?.weightKg ?? ''}" placeholder="${s.weightKg ?? '80'}"></label>
        <label class="field" style="margin-bottom:0"><span>Waist (cm)</span>
          <input id="q-waist" type="number" inputmode="decimal" step="0.5"
                 value="${todayRow?.waistCm ?? ''}" placeholder="optional"></label>
      </div>
      <button class="btn btn-primary btn-block" id="q-save" style="margin-top:14px">
        ${todayRow ? 'Update today' : 'Save'}</button>
      <p class="hint" style="margin-top:10px;font-size:12px">
        Weigh in first thing, after the toilet, before food or water. Same conditions every time.</p>
    </div>`;

  /* ---- weight trend ---- */
  const weightCard = `
    <div class="card">
      <div class="card-head"><p class="card-title">Weight trend</p>
        <div class="chips">
          ${[30, 90, 0].map(r =>
            `<button class="chip ${range === r ? 'on' : ''}" data-range="${r}">${r || 'All'}</button>`
          ).join('')}
        </div>
      </div>
      ${wt ? `
        <div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:14px">
          <div>
            <div style="font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1">
              ${Calc.r(wt.smooth, 1)}<span style="font-size:16px;color:var(--dim)"> kg</span>
            </div>
            <div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">
              smoothed trend</div>
          </div>
          <div style="margin-left:auto;text-align:right">
            <div class="tone-${rateTone}" style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums">
              ${wt.perWeek >= 0 ? '+' : ''}${Calc.r(wt.perWeek, 2)} kg</div>
            <div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">
              per week</div>
          </div>
        </div>

        ${lineChart([
          { values: wt.rows.map(r => r.weightKg), color: 'var(--dim)', width: 1.5 },
          { values: wt.smoothArr, color: 'var(--accent)', width: 3, fill: true }
        ])}

        <div style="margin-top:14px">
          ${kv('Last weigh-in', Calc.r(wt.latest, 1) + ' kg · ' + dayLabel(wt.latestDay))}
          ${kv('Entries in range', wt.entries)}
          ${kv('Rate as % bodyweight', Calc.r((wt.perWeek / (wt.smooth || 1)) * 100, 2) + '% / week',
               rateTone)}
        </div>

        <p class="hint" style="margin-top:12px;font-size:12px">
          Grey is raw scale weight, orange is the smoothed trend. Judge progress on orange only —
          daily swings of ±1.5 kg are water and food, not fat.</p>
      ` : `<p class="hint">No weigh-ins in this range yet.</p>`}
    </div>`;

  /* ---- composition ---- */
  const sm = Calc.summary(s);
  const compCard = `
    <div class="card">
      <div class="card-head"><p class="card-title">Composition</p>
        <a href="#/measure" style="color:var(--accent);font-size:13px;font-weight:700">Full measure ›</a></div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${sm.bodyFat ?? '—'}<span style="font-size:13px">%</span></div>
          <div class="stat-label">body fat</div></div>
        <div class="stat"><div class="stat-value">${sm.leanMass ?? '—'}</div>
          <div class="stat-label">lean kg</div></div>
        <div class="stat"><div class="stat-value">${sm.fatMass ?? '—'}</div>
          <div class="stat-label">fat kg</div></div>
      </div>
      ${bf && bf.entries > 1 ? `
        <div style="margin-top:16px">
          ${lineChart([{ values: bf.smoothArr, color: 'var(--protein)', width: 3, fill: true }])}
          <div style="margin-top:10px">
            ${kv('Body fat trend', (bf.perWeek >= 0 ? '+' : '') + Calc.r(bf.perWeek, 2) + '% / week',
                 bf.perWeek < 0 ? 'good' : 'warn')}
          </div>
        </div>` : `<p class="hint" style="margin-top:12px">
            Log waist and neck twice or more to see a body-fat trend.</p>`}
      <div style="margin-top:14px">
        ${kv('BMI', sm.bmi ?? '—', sm.bmiCat.tone)}
        ${kv('Waist-to-height', sm.whtr ?? '—', sm.whtrCat.tone)}
        ${kv('Rating', sm.whtrCat.label, sm.whtrCat.tone)}
      </div>
    </div>`;

  /* ---- measurements ---- */
  const firstWaist = ws?.rows[0];
  const lastWaist = ws?.rows[ws.rows.length - 1];
  const waistDelta = (firstWaist && lastWaist && ws.rows.length > 1)
    ? lastWaist.waistCm - firstWaist.waistCm : null;

  const measureCard = `
    <div class="card">
      <div class="card-head"><p class="card-title">Measurements</p></div>
      ${kv('Waist', s.waistCm ? s.waistCm + ' cm' : '—')}
      ${kv('Neck', s.neckCm ? s.neckCm + ' cm' : '—')}
      ${s.sex === 'female' ? kv('Hip', s.hipCm ? s.hipCm + ' cm' : '—') : ''}
      ${waistDelta != null
        ? kv('Waist change in range',
             (waistDelta >= 0 ? '+' : '') + Calc.r(waistDelta, 1) + ' cm',
             waistDelta < 0 ? 'good' : 'warn')
        : ''}
      ${ws && ws.entries > 1 ? `<div style="margin-top:14px">${
        lineChart([{ values: ws.smoothArr, color: 'var(--carb)', width: 3, fill: true }])
      }</div>` : ''}
      <p class="hint" style="margin-top:12px;font-size:12px">
        Waist shrinking while weight holds steady is recomposition — the best possible signal.</p>
    </div>`;

  /* ---- history ---- */
  const hist = all.slice().reverse().slice(0, 40);
  const histCard = `
    <div class="card" style="padding:0">
      <div class="card-head" style="padding:16px 16px 10px;margin:0">
        <p class="card-title">History</p><span class="tag">${all.length} entries</span></div>
      ${hist.length ? hist.map(m => `
        <div class="fentry">
          <div class="fentry-main">
            <div class="fentry-name">${dayLabel(m.day)}</div>
            <div class="fentry-sub">${[
              m.weightKg != null ? Calc.r(m.weightKg, 1) + ' kg' : null,
              m.waistCm != null ? 'waist ' + Calc.r(m.waistCm, 1) : null,
              m.neckCm != null ? 'neck ' + Calc.r(m.neckCm, 1) : null,
              m.bodyFatPct != null ? Calc.r(m.bodyFatPct, 1) + '% bf' : null
            ].filter(Boolean).join(' · ') || 'empty'}</div>
          </div>
          <button class="fentry-del" data-delm="${m.day}" aria-label="Delete">×</button>
        </div>`).join('')
      : `<div class="meal-empty">Nothing logged yet</div>`}
    </div>`;

  root.innerHTML = `<div class="stack">
    ${quickLog}${weightCard}${compCard}${measureCard}${histCard}
  </div>`;

  /* ---------------- wiring ---------------- */

  $$('[data-range]').forEach(b => b.addEventListener('click', () => {
    App.bodyRange = Number(b.dataset.range);
    paintBody();
  }));

  $('#q-save').addEventListener('click', async () => {
    const w = Number($('#q-weight').value);
    const waist = $('#q-waist').value === '' ? null : Number($('#q-waist').value);
    if (!w && waist == null) return toast('Enter a weight or waist measurement');

    const row = (await Store.get('metrics', today)) || { day: today };
    if (w) row.weightKg = w;
    if (waist != null) row.waistCm = waist;

    /* recompute body fat from whatever we now know */
    const merged = { ...s, weightKg: row.weightKg ?? s.weightKg,
                     waistCm: row.waistCm ?? s.waistCm };
    const est = Calc.bodyFat(merged);
    if (est.pct != null) row.bodyFatPct = Calc.r(est.pct, 1);

    await Store.put('metrics', row);

    /* keep the live profile in sync so targets recalculate */
    const patch = {};
    if (w) patch.weightKg = w;
    if (waist != null) patch.waistCm = waist;
    if (Object.keys(patch).length) Store.set(patch);

    tick();
    toast('Logged');
    await paintBody();
  });

  $$('[data-delm]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this entry?')) return;
    await Store.del('metrics', b.dataset.delm);
    await paintBody();
  }));
}

/** True when launched from the home screen icon (not in Safari). */
function isStandalone() {
  return window.navigator.standalone === true ||
         window.matchMedia('(display-mode: standalone)').matches;
}

/* ---------------------------------------------------------------
   ROUTER  (hash based: #/today, #/food, …)
   --------------------------------------------------------------- */
function currentRouteName() {
  const name = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
  return Screens[name] ? name : 'today';
}

function render() {
  const name   = currentRouteName();
  const screen = Screens[name];
  App.route = name;
  if (name !== 'food') App.lastDeleted = null;
  if (name !== 'session') stopRest();

  /* header */
  $('#screen-title').textContent =
    typeof screen.title === 'function' ? screen.title() : screen.title;
  const sub = screen.sub ? screen.sub() : '';
  $('#screen-sub').textContent = sub;
  $('#screen-sub').style.display = sub ? '' : 'none';
  $('#bar-action').innerHTML = screen.action ? screen.action() : '';

  /* back button (only on sub-screens) */
  const back = $('#back-btn');
  if (screen.back) {
    back.hidden = false;
    back.onclick = () => { location.hash = screen.back; };
  } else {
    back.hidden = true;
    back.onclick = null;
  }

  /* body */
  $('#view').innerHTML = screen.render();

  /* tab highlight — sub-screens declare which tab they belong to */
  const tab = screen.tab || name;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

  window.scrollTo(0, 0);
  document.title = 'Forge — ' + screen.title;
  screen.mount?.();
}

window.addEventListener('hashchange', () => { tick(); render(); });

window.addEventListener('DOMContentLoaded', async () => {
  $('#view').innerHTML = '<div class="empty"><h3>Loading…</h3></div>';

  try {
    await Store.boot();
    await Food.seedIfEmpty();
    await Train.seedIfEmpty();
  } catch (err) {
    $('#view').innerHTML =
      `<div class="empty"><h3>Storage unavailable</h3>
       <p class="hint">${esc(err.message)}</p></div>`;
    return;
  }

  if (!location.hash) history.replaceState(null, '', '#/today');
  render();

  /* first run → straight to profile setup */
  if (!Store.s.onboarded) {
    location.hash = '#/profile';
    toast('Set up your profile to start');
  }
});
