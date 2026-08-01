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
    sub: () => 'Planner & session log',
    render: () => `
      <div class="empty">
        <h3>Workout planner</h3>
        <p class="hint">Coming in Phase 4: templates, set logging, RIR, auto progression.</p>
      </div>`
  },

  /* ---------------- BODY ---------------- */
  body: {
    title: 'Body',
    sub: () => 'Weight, BMI & measurements',
    render: () => `
      <div class="empty">
        <h3>Body metrics</h3>
        <p class="hint">Coming in Phase 5: weight trend, BMI, waist-to-height, progress photos.</p>
      </div>`
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
  const training = `
    <div class="card">
      <div class="card-head"><p class="card-title">Training</p><span class="tag">Phase 4</span></div>
      <p class="hint">Planner and session logger coming next.</p>
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

  /* header */
  $('#screen-title').textContent = screen.title;
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
