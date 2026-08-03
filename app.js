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
    action: () => `<a class="btn btn-sm btn-ghost" href="#/plates">Plates</a>`,
    render: () => `<div id="train-root"><div class="spinner">Loading…</div></div>`,
    async mount() { await paintTrain(); }
  },

  /* ---------------- BODY ---------------- */
  body: {
    title: 'Body',
    sub: () => 'Weight, composition & measurements',
    action: () => `<a class="btn btn-sm btn-ghost" href="#/photos">Photos</a>`,
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

          <a class="row" href="#/review">
            <div class="row-main">
              <div class="row-title">Weekly review</div>
              <div class="row-sub">Adaptive TDEE and calorie adjustment</div>
            </div>
            <div class="row-value chev"></div>
          </a>

          <a class="row" href="#/meals">
            <div class="row-main">
              <div class="row-title">Saved meals</div>
              <div class="row-sub">Reusable meal combinations</div>
            </div>
            <div class="row-value chev"></div>
          </a>

          <a class="row" href="#/supplements">
            <div class="row-main">
              <div class="row-title">Supplements</div>
              <div class="row-sub">Your stack and daily schedule</div>
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

            ${(() => {
            const days = s.lastBackupAt
              ? Math.floor((Date.now() - s.lastBackupAt) / 86400000) : null;
            const tone = days == null ? 'bad' : days <= 7 ? 'good' : days <= 21 ? 'warn' : 'bad';
            const txt = days == null ? 'Never backed up'
                      : days === 0 ? 'Today'
                      : days + ' day' + (days === 1 ? '' : 's') + ' ago';
            return kv('Last backup', txt, tone);
          })()}

          <div style="height:12px"></div>

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
            Store.set({ lastBackupAt: Date.now() });
            return;
          }
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          Store.set({ lastBackupAt: Date.now() });
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
              <div class="fentry-main" data-ee="${e.id}" style="cursor:pointer">
                <div class="fentry-name">${esc(e.name)}</div>
                <div class="fentry-sub">${esc(entryAmount(e))}${e.brand ? ' · ' + esc(e.brand) : ''} ›</div>
              </div>
              <div class="fentry-macros">
                <div class="fentry-k">${Math.round(e.kcal)}</div>
                <div class="fentry-p">${Math.round(e.protein)} g P</div>
              </div>
              <button class="fentry-del" data-del="${e.id}" aria-label="Remove">×</button>
            </div>`).join('')
          : `<div class="meal-empty">Nothing logged</div>`}
        <div style="display:flex;border-top:1px solid var(--line)">
          <button class="meal-add" style="border-top:0;flex:1" data-add="${m.key}">+ Add</button>
          ${m.entries.length ? `
            <button class="meal-add" style="border-top:0;border-left:1px solid var(--line);flex:1"
                    data-save="${m.key}">Save as meal</button>` : ''}
        </div>
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

  $$('[data-save]').forEach(b => b.addEventListener('click', async () => {
    const mealKey = b.dataset.save;
    const group = meals.find(m => m.key === mealKey);
    if (!group || !group.entries.length) return;
    const name = prompt('Name this meal', group.entries.map(e => e.name).slice(0, 2).join(' + '));
    if (!name || !name.trim()) return;
    await MealTpl.save(MealTpl.fromEntries(name, mealKey, group.entries));
    tick();
    toast('Saved — find it under Add → Meals');
  }));

  $$('[data-ee]').forEach(b => b.addEventListener('click', () => {
    App.editId = b.dataset.ee;
    location.hash = '#/editentry';
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
        <a href="#/progress" style="color:var(--accent);font-size:13px;font-weight:700">Projection ›</a>
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
        <a class="btn btn-sm btn-ghost" href="#/review" style="flex:1">Weekly review</a>
      </div>
    </div>`;

  const backupDays = Store.s.lastBackupAt
    ? Math.floor((Date.now() - Store.s.lastBackupAt) / 86400000) : 999;
  const backupWarn = backupDays > 21 ? `
    <div class="verdict tone-bad">
      <b>${backupDays === 999 ? 'No backup yet' : 'Last backup was ' + backupDays + ' days ago'}.</b><br>
      All your data lives only on this phone. Delete the app and it's gone.
      <a href="#/settings" style="color:var(--accent);font-weight:700"> Export now ›</a>
    </div>` : '';

  root.innerHTML = `<div class="stack">
    ${backupWarn}${nutrition}
    <div id="water-card"></div>
    <div id="supp-card"></div>
    ${training}${goalCard}${habits}
  </div>`;

  $('#quick-log')?.addEventListener('click', () => {
    App.addCtx = { day: Store.dayKey(), meal: smartMeal() };
    location.hash = '#/add';
  });

  $('#t-start')?.addEventListener('click', async () => {
    const tpl = await Train.getTemplate($('#t-start').dataset.tpl);
    await Train.startSession(tpl);
    location.hash = '#/session';
  });
  await paintWaterCard();
  await paintSuppCard();
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
    <div class="srctabs" style="grid-template-columns:repeat(4,1fr)">
      <button class="srctab ${s.src === 'meals' ? 'on' : ''}" data-src="meals">Meals</button>
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

if (s.src === 'meals') {
    const tpls = await MealTpl.all();
    App.mealMult = App.mealMult || 1;
    body = `
      <div class="chips" style="margin-bottom:14px">
        ${[0.5, 1, 1.5, 2].map(m =>
          `<button class="chip ${App.mealMult === m ? 'on' : ''}" data-mult="${m}">${m}×</button>`
        ).join('')}
      </div>
      ${tpls.length ? `<div class="picker">${tpls.map(t => {
        const tot = MealTpl.totals(t, App.mealMult || 1);
        return `
        <button class="pick" data-mt="${t.id}">
          <div class="pick-main">
            <div class="pick-name">${esc(t.name)}</div>
            <div class="pick-sub">${t.items.length} items · ${esc(t.items.map(i => i.name).slice(0,3).join(', '))}</div>
          </div>
          <div class="pick-k">${Math.round(tot.kcal)} kcal<b>${Math.round(tot.protein)} g P</b></div>
        </button>`;
      }).join('')}</div>`
      : `<div class="empty"><h3>No saved meals</h3>
           <p class="hint">Log a meal on the Food tab, then tap “Save as meal”.</p></div>`}`;
  }
  
  root.innerHTML = mealChips() + tabs + body;
  wireMealChips();
  wirePickRows();
  if (s.src === 'meals') wireMealsTab();

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
  action: () => `<a class="btn btn-sm btn-ghost" href="#/plates">Plates</a>`,
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
              m.bodyFatPct != null ? Calc.r(m.bodyFatPct, 1) + '% bf' : null,
              m.waterMl ? fmtMl(m.waterMl) + ' water' : null,
              m.supps ? Object.keys(m.supps).length + ' supps' : null
            ].filter(Boolean).join(' · ') || 'empty'}</div>
          </div>
          <button class="fentry-del" data-delm="${m.day}" aria-label="Delete">×</button>
        </div>`).join('')
      : `<div class="meal-empty">Nothing logged yet</div>`}
    </div>`;

  root.innerHTML = `<div class="stack">
    ${quickLog}${weightCard}${compCard}
    <div id="water-body"></div>
    ${measureCard}${histCard}
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
  await paintWaterBody(range);
}

/* ============================================================
   PROGRESS PHOTOS
   ============================================================ */

/** Downscale + re-encode so a photo costs ~150 KB instead of 4 MB. */
async function shrinkImage(file, max = 1280, quality = 0.82) {
  let bmp = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try { bmp = await createImageBitmap(file); }
    catch {
      /* last resort: decode through an <img> */
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      bmp = img;
    }
  }
  const iw = bmp.width, ih = bmp.height;
  const scale = Math.min(1, max / Math.max(iw, ih));
  const w = Math.round(iw * scale), h = Math.round(ih * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', quality));
  return { blob, w, h };
}

const Photos = {
  async add(file, tag = 'front') {
    const { blob, w, h } = await shrinkImage(file);
    const row = {
      id: Store.uid(), day: Store.dayKey(), ts: Date.now(),
      blob, w, h, tag, size: blob.size
    };
    await Store.put('photos', row);
    return row;
  },
  async all() {
    return (await Store.all('photos'))
      .sort((a, b) => b.day.localeCompare(a.day) || b.ts - a.ts);
  },
  get: id => Store.get('photos', id),
  del: id => Store.del('photos', id)
};

/** Blob URLs must be revoked or they leak memory on every repaint. */
function freePhotoUrls() {
  (App.photoUrls || []).forEach(u => URL.revokeObjectURL(u));
  App.photoUrls = [];
}
function photoUrl(blob) {
  const u = URL.createObjectURL(blob);
  (App.photoUrls ||= []).push(u);
  return u;
}

Screens.photos = {
  title: 'Progress photos', tab: 'body', back: '#/body',
  sub: () => App.photoState?.view === 'compare' ? 'Pick two to compare' : 'Same pose, same light, same time of day',
  render: () => `<div id="ph-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    App.photoState = { view: 'grid', id: null, pick: [] };
    await paintPhotos();
  }
};

async function paintPhotos() {
  const st = App.photoState;
  if (st.view === 'one')     return paintPhotoOne();
  if (st.view === 'compare') return paintPhotoCompare();
  return paintPhotoGrid();
}

async function paintPhotoGrid() {
  freePhotoUrls();
  const st = App.photoState;
  const rows = await Photos.all();
  const bytes = rows.reduce((a, r) => a + (r.size || 0), 0);

  /* group by day */
  const days = [];
  rows.forEach(r => {
    const g = days.find(d => d.day === r.day);
    if (g) g.items.push(r); else days.push({ day: r.day, items: [r] });
  });

  $('#ph-root').innerHTML = `
    <div class="card">
      <div class="card-head"><p class="card-title">Add a photo</p>
        <span class="tag">${rows.length} saved · ${(bytes / 1048576).toFixed(1)} MB</span></div>
      <div class="chips" style="margin-bottom:12px">
        ${['front', 'side', 'back'].map((t, i) =>
          `<button class="chip ${i === 0 ? 'on' : ''}" data-tag="${t}">${t}</button>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" id="ph-add">Take or choose photo</button>
      <input type="file" id="ph-file" accept="image/*" hidden>
      <p class="hint" style="margin-top:10px;font-size:12px">
        Photos are resized to 1280 px and stay on this phone only — they are
        <strong>not</strong> included in the JSON backup, so keep the originals in your camera roll.</p>
    </div>

    ${rows.length >= 2 ? `
      <button class="btn btn-block btn-ghost" id="ph-cmp" style="margin-bottom:14px">
        Compare two photos</button>` : ''}

    ${days.length ? days.map(g => `
      <div style="margin-bottom:16px">
        <p class="card-title" style="margin:0 0 8px 4px">${dayLabel(g.day)} · ${fmtDate(g.day)}</p>
        <div class="pgrid">
          ${g.items.map(p => `
            <div class="pcell" data-open="${p.id}">
              <img src="${photoUrl(p.blob)}" alt="${p.tag}" loading="lazy">
              <div class="pday">${p.tag}</div>
            </div>`).join('')}
        </div>
      </div>`).join('')
    : `<div class="empty"><h3>No photos yet</h3>
         <p class="hint">Front, side and back every 2 weeks. Photos show changes
         the scale completely hides.</p></div>`}`;

  let tag = 'front';
  $$('[data-tag]').forEach(b => b.addEventListener('click', () => {
    tag = b.dataset.tag;
    $$('[data-tag]').forEach(x => x.classList.toggle('on', x === b));
  }));

  $('#ph-add').addEventListener('click', () => $('#ph-file').click());

  $('#ph-file').addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    $('#ph-add').textContent = 'Processing…';
    try {
      await Photos.add(f, tag);
      tick();
      toast('Photo saved');
      await paintPhotos();
    } catch (err) {
      toast('Could not read that image');
      $('#ph-add').textContent = 'Take or choose photo';
    }
  });

  $('#ph-cmp')?.addEventListener('click', () => {
    st.view = 'compare'; st.pick = [];
    $('#screen-sub').textContent = 'Pick two to compare';
    paintPhotos();
  });

  $$('[data-open]').forEach(c => c.addEventListener('click', () => {
    st.id = c.dataset.open; st.view = 'one';
    paintPhotos();
  }));
}

async function paintPhotoOne() {
  freePhotoUrls();
  const st = App.photoState;
  const p = await Photos.get(st.id);
  if (!p) { st.view = 'grid'; return paintPhotos(); }
  const metric = await Store.get('metrics', p.day);

  $('#ph-root').innerHTML = `
    <button class="btn btn-sm btn-ghost" id="ph-back" style="margin-bottom:14px">‹ All photos</button>
    <img class="pbig" src="${photoUrl(p.blob)}" alt="${p.tag}">
    <div class="card" style="margin-top:14px">
      ${kv('Date', fmtDate(p.day))}
      ${kv('View', p.tag)}
      ${kv('Weight that day', metric?.weightKg ? Calc.r(metric.weightKg, 1) + ' kg' : '—')}
      ${kv('Body fat that day', metric?.bodyFatPct != null ? Calc.r(metric.bodyFatPct, 1) + '%' : '—')}
      ${kv('Waist that day', metric?.waistCm ? Calc.r(metric.waistCm, 1) + ' cm' : '—')}
      ${kv('File size', Math.round((p.size || 0) / 1024) + ' KB')}
    </div>
    <button class="btn btn-block" id="ph-share" style="margin-top:14px">Save to Photos / share</button>
    <button class="btn btn-block btn-danger" id="ph-del" style="margin-top:8px">Delete photo</button>`;

  $('#ph-back').addEventListener('click', () => {
    st.view = 'grid'; st.id = null; paintPhotos();
  });

  $('#ph-share').addEventListener('click', async () => {
    try {
      const file = new File([p.blob], `forge-${p.day}-${p.tag}.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Progress ${p.day}` });
      } else {
        const a = document.createElement('a');
        a.href = photoUrl(p.blob);
        a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Share failed');
    }
  });

  $('#ph-del').addEventListener('click', async () => {
    if (!confirm('Delete this photo permanently?')) return;
    await Photos.del(p.id);
    st.view = 'grid'; st.id = null;
    toast('Deleted');
    paintPhotos();
  });
}

async function paintPhotoCompare() {
  freePhotoUrls();
  const st = App.photoState;
  const rows = await Photos.all();

  const chosen = st.pick.map(id => rows.find(r => r.id === id)).filter(Boolean);
  let compareHTML = '';

  if (chosen.length === 2) {
    /* oldest on the left */
    const [a, b] = chosen.slice().sort((x, y) => x.day.localeCompare(y.day));
    const [ma, mb] = await Promise.all([Store.get('metrics', a.day), Store.get('metrics', b.day)]);
    const dw = (ma?.weightKg != null && mb?.weightKg != null)
      ? mb.weightKg - ma.weightKg : null;
    const dbf = (ma?.bodyFatPct != null && mb?.bodyFatPct != null)
      ? mb.bodyFatPct - ma.bodyFatPct : null;
    const gap = Store.daysBetween(a.day, b.day);

    compareHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="pcompare">
          <figure><img src="${photoUrl(a.blob)}" alt="before">
            <figcaption>${fmtDate(a.day)}<br>${ma?.weightKg ? Calc.r(ma.weightKg, 1) + ' kg' : '—'}</figcaption></figure>
          <figure><img src="${photoUrl(b.blob)}" alt="after">
            <figcaption>${fmtDate(b.day)}<br>${mb?.weightKg ? Calc.r(mb.weightKg, 1) + ' kg' : '—'}</figcaption></figure>
        </div>
        <div style="margin-top:14px">
          ${kv('Days apart', gap)}
          ${dw != null ? kv('Weight change', (dw >= 0 ? '+' : '') + Calc.r(dw, 1) + ' kg',
                            dw < 0 ? 'good' : 'warn') : ''}
          ${dbf != null ? kv('Body fat change', (dbf >= 0 ? '+' : '') + Calc.r(dbf, 1) + '%',
                             dbf < 0 ? 'good' : 'warn') : ''}
        </div>
        <button class="btn btn-sm btn-block btn-ghost" id="cmp-reset" style="margin-top:12px">
          Pick different photos</button>
      </div>`;
  }

  $('#ph-root').innerHTML = `
    <button class="btn btn-sm btn-ghost" id="cmp-back" style="margin-bottom:14px">‹ All photos</button>
    ${compareHTML}
    ${chosen.length < 2 ? `
      <p class="hint" style="margin-bottom:10px">
        Tap ${chosen.length === 0 ? 'the first' : 'the second'} photo
        (${chosen.length}/2 selected).</p>` : ''}
    <div class="pgrid">
      ${rows.map(p => {
        const i = st.pick.indexOf(p.id);
        return `
        <div class="pcell ${i > -1 ? 'sel' : ''}" data-pick="${p.id}">
          <img src="${photoUrl(p.blob)}" alt="${p.tag}" loading="lazy">
          ${i > -1 ? `<div class="pnum">${i + 1}</div>` : ''}
          <div class="pday">${fmtDate(p.day).replace(/\s\d{4}$/, '')}</div>
        </div>`;
      }).join('')}
    </div>`;

  $('#cmp-back').addEventListener('click', () => {
    st.view = 'grid'; st.pick = [];
    $('#screen-sub').textContent = 'Same pose, same light, same time of day';
    paintPhotos();
  });

  $('#cmp-reset')?.addEventListener('click', () => { st.pick = []; paintPhotos(); });

  $$('[data-pick]').forEach(c => c.addEventListener('click', () => {
    const id = c.dataset.pick;
    const i = st.pick.indexOf(id);
    if (i > -1) st.pick.splice(i, 1);
    else if (st.pick.length < 2) st.pick.push(id);
    else st.pick = [st.pick[1], id];
    paintPhotos();
  }));
}

/* ============================================================
   GOAL PROJECTION
   ============================================================ */

/** Chart with a real date axis, so two series with different dates line up. */
function dateChart({ from, to, series, h = 150, targetLine = null }) {
  const w = 300;
  const span = Math.max(1, Store.daysBetween(from, to));
  const vals = series.flatMap(s => s.points.map(p => p.value))
                     .concat(targetLine != null ? [targetLine] : []);
  if (vals.length < 2) return `<p class="hint">Not enough data yet.</p>`;

  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = ((max - min) * 0.15) || 1;
  min -= pad; max += pad;

  const X = day => (Store.daysBetween(from, day) / span) * w;
  const Y = v => h - ((v - min) / (max - min)) * (h - 14) - 7;

  const body = series.map(s => {
    if (!s.points.length) return '';
    const pts = s.points.map(p => `${X(p.day).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
    const x0 = X(s.points[0].day).toFixed(1);
    const x1 = X(s.points[s.points.length - 1].day).toFixed(1);
    const area = s.fill
      ? `<polygon points="${x0},${h} ${pts} ${x1},${h}" fill="${s.color}" opacity="0.10"/>` : '';
    return area + `<polyline points="${pts}" fill="none" stroke="${s.color}"
      stroke-width="${s.width || 2.5}" ${s.dash ? 'stroke-dasharray="5 5"' : ''}
      stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');

  const tl = targetLine != null
    ? `<line x1="0" y1="${Y(targetLine)}" x2="${w}" y2="${Y(targetLine)}"
             stroke="var(--protein)" stroke-width="1" stroke-dasharray="2 4" opacity="0.8"/>` : '';

  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none"
         style="display:block;overflow:visible">${tl}${body}</svg>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-top:6px">
      <span>${fmtDate(from)}</span><span>${fmtDate(to)}</span>
    </div>`;
}

Screens.progress = {
  title: 'Projection', tab: 'today', back: '#/today',
  sub: () => 'Where you are vs where you need to be',
  render: () => `<div id="prog-root"><div class="spinner">Loading…</div></div>`,
  async mount() { await paintProgress(); }
};

async function paintProgress() {
  const root = $('#prog-root');
  if (!root) return;

  const s = Store.s;
  if (!s.targetDate || !s.targetBodyFatPct) {
    root.innerHTML = `<div class="empty"><h3>No goal set</h3>
      <p class="hint">Set a target body fat and date first.</p></div>
      <a class="btn btn-primary btn-block" href="#/goal">Set a goal</a>`;
    return;
  }

  const metrics = await allMetrics();
  const bfRows = metrics.filter(m => m.bodyFatPct != null);
  const wtRows = metrics.filter(m => m.weightKg != null);
  const today = Store.dayKey();
  const target = s.targetBodyFatPct;

  /* ---- baseline ---- */
  const start = bfRows[0] || { day: s.createdAt || today, bodyFatPct: Calc.bodyFat(s).pct };
  const startBf = start.bodyFatPct;
  const startDay = start.day;

  if (startBf == null) {
    root.innerHTML = `<div class="empty"><h3>No body-fat data</h3>
      <p class="hint">Log waist and neck on the Body tab so we can estimate body fat.</p></div>
      <a class="btn btn-primary btn-block" href="#/measure">Add measurements</a>`;
    return;
  }

  /* ---- actual (smoothed) ---- */
  const bfSmooth = emaSeries(bfRows.map(r => r.bodyFatPct));
  const actual = bfRows.map((r, i) => ({ day: r.day, value: bfSmooth[i] }));
  const nowBf = actual.length ? actual[actual.length - 1].value : startBf;
  const nowDay = actual.length ? actual[actual.length - 1].day : startDay;

  /* ---- required trajectory ---- */
  const required = [
    { day: startDay, value: startBf },
    { day: s.targetDate, value: target }
  ];

  /* where should you be today? */
  const totalDays = Math.max(1, Store.daysBetween(startDay, s.targetDate));
  const elapsed = Math.max(0, Store.daysBetween(startDay, today));
  const frac = Math.min(1, elapsed / totalDays);
  const shouldBe = startBf + (target - startBf) * frac;
  const delta = nowBf - shouldBe;             // negative = ahead of schedule

  /* ---- projection from current rate ---- */
  const tr = trendSummary(metrics, 'bodyFatPct', 28);
  const perDay = tr ? tr.perWeek / 7 : 0;
  const daysLeft = Store.daysBetween(today, s.targetDate);
  const projectedAtTarget = nowBf + perDay * daysLeft;
  const projected = perDay !== 0
    ? [{ day: nowDay, value: nowBf }, { day: s.targetDate, value: projectedAtTarget }]
    : [];

  /* when will you actually hit the target at this rate? */
  let hitDay = null;
  if (perDay < -0.0005) {
    const d = Math.round((target - nowBf) / perDay);
    if (d >= 0 && d < 3000) hitDay = Store.addDays(nowDay, d);
  }

  /* ---- verdict ---- */
  let verdict, tone;
  if (nowBf <= target)             { verdict = 'Target reached — switch to building'; tone = 'good'; }
  else if (delta <= -0.4)          { verdict = 'Ahead of schedule';   tone = 'good'; }
  else if (delta <= 0.4)           { verdict = 'On schedule';         tone = 'good'; }
  else if (delta <= 1.2)           { verdict = 'Slightly behind';     tone = 'warn'; }
  else                             { verdict = 'Behind schedule';     tone = 'bad';  }

  /* ---- adherence ---- */
  const from30 = Store.addDays(today, -29);
  const [mealRows, sessions] = await Promise.all([
    Store.byDay('meals', from30, today),
    Train.sessionsBetween(from30, today)
  ]);
  const loggedDays = new Set(mealRows.map(r => r.day)).size;
  const weighDays = metrics.filter(m => m.day >= from30 && m.weightKg != null).length;
  const perWeek = Calc.r(sessions.length / (30 / 7), 1);

  /* ---- milestones ---- */
  const lean = Calc.leanMassKg(s.weightKg, nowBf);
  const months = [];
  for (let i = 1; i <= 6; i++) {
    const d = Store.addDays(startDay, Math.round(totalDays * (i / 6)));
    const bfAt = startBf + (target - startBf) * (i / 6);
    months.push({
      day: d,
      bf: Calc.r(bfAt, 1),
      weight: lean ? Calc.r(lean / (1 - bfAt / 100), 1) : null,
      past: d <= today
    });
  }

  const dot = c => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;
    background:${c};margin-right:5px;vertical-align:middle"></span>`;

  root.innerHTML = `
    <div class="stack">

      <div class="card">
        <div class="stat-grid">
          <div class="stat"><div class="stat-value">${elapsed}</div><div class="stat-label">days in</div></div>
          <div class="stat"><div class="stat-value">${Math.max(0, daysLeft)}</div><div class="stat-label">days left</div></div>
          <div class="stat"><div class="stat-value">${Math.round(frac * 100)}%</div><div class="stat-label">of timeline</div></div>
        </div>
        <div class="bar" style="margin-top:14px"><i style="width:${(frac * 100).toFixed(0)}%"></i></div>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Body fat vs plan</p>
          <span class="tag">target ${target}%</span></div>
        ${dateChart({
          from: startDay, to: s.targetDate, targetLine: target,
          series: [
            { points: required, color: 'var(--dim)', width: 2, dash: true },
            { points: projected, color: 'var(--fat)', width: 2, dash: true },
            { points: actual, color: 'var(--accent)', width: 3, fill: true }
          ]
        })}
        <div style="font-size:12px;color:var(--dim);margin-top:10px;line-height:1.7">
          ${dot('var(--accent)')}Your smoothed body fat<br>
          ${dot('var(--dim)')}Required trajectory<br>
          ${projected.length ? `${dot('var(--fat)')}Projected at current rate<br>` : ''}
          ${dot('var(--protein)')}Target
        </div>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Status</p></div>
        <div class="verdict tone-${tone}"><b>${verdict}</b> —
          you're at ${Calc.r(nowBf, 1)}%, the plan says ${Calc.r(shouldBe, 1)}% by now
          (${delta >= 0 ? '+' : ''}${Calc.r(delta, 1)} points ${delta > 0 ? 'behind' : 'ahead'}).</div>
        <div style="margin-top:14px">
          ${kv('Starting body fat', Calc.r(startBf, 1) + '% on ' + fmtDate(startDay))}
          ${kv('Current (smoothed)', Calc.r(nowBf, 1) + '%')}
          ${kv('Current rate', (tr ? (tr.perWeek >= 0 ? '+' : '') + Calc.r(tr.perWeek, 2) : '0') + '% / week',
               perDay < 0 ? 'good' : 'warn')}
          ${kv('Projected on target date', Calc.r(projectedAtTarget, 1) + '%',
               projectedAtTarget <= target + 0.3 ? 'good' : 'warn')}
          ${kv('Target reached', hitDay ? fmtDate(hitDay)
               : perDay >= 0 ? 'not at this rate' : '—',
               hitDay && hitDay <= s.targetDate ? 'good' : 'warn')}
        </div>
        ${perDay >= 0 && nowBf > target ? `
          <p class="hint" style="margin-top:12px;font-size:12px">
            Body fat isn't trending down. Either the deficit isn't real (check logging accuracy)
            or it's too small — drop calories by 150–200 and reassess in 2 weeks.</p>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Milestones</p></div>
        ${months.map(m => `
          <div class="kv" style="${m.past ? 'opacity:.5' : ''}">
            <span>${fmtDate(m.day)}${m.past ? ' ✓' : ''}</span>
            <b>${m.bf}%${m.weight ? ' · ' + m.weight + ' kg' : ''}</b>
          </div>`).join('')}
        <p class="hint" style="margin-top:12px;font-size:12px">
          Weights assume you hold your current ${Calc.r(lean || 0, 1)} kg of lean mass.
          Training hard and hitting protein is what makes that assumption true.</p>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Adherence · last 30 days</p></div>
        ${kv('Days food logged', loggedDays + ' / 30', loggedDays >= 24 ? 'good' : loggedDays >= 15 ? 'warn' : 'bad')}
        ${kv('Weigh-ins', weighDays + ' / 30', weighDays >= 15 ? 'good' : 'warn')}
        ${kv('Sessions per week', perWeek, perWeek >= 3 ? 'good' : 'warn')}
        ${kv('Total sessions', sessions.length)}
        <p class="hint" style="margin-top:12px;font-size:12px">
          Under 20 logged days a month means the calorie data isn't reliable enough
          to diagnose a stall.</p>
      </div>

      <a class="btn btn-block btn-ghost" href="#/goal">Adjust goal</a>
    </div>`;
}

/* ============================================================
   WEEKLY REVIEW — adaptive TDEE & calorie adjustment
   ============================================================ */

/** kg/week we're aiming for. Negative = losing. */
function targetWeeklyRate(s, plan) {
  if (plan && !plan.expired && plan.rateKgPerWeek > 0) return -plan.rateKgPerWeek;
  const bw = s.weightKg || 80;
  if (s.goalMode === 'cut')    return -0.0065 * bw;
  if (s.goalMode === 'recomp') return -0.0020 * bw;
  return  0.0025 * bw;                     // lean bulk
}

/** Nutrition totals per day for a window. */
async function nutritionWindow(from, to) {
  const rows = await Store.byDay('meals', from, to);
  const byDay = {};
  rows.forEach(r => {
    const d = (byDay[r.day] ||= { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    d.kcal += r.kcal || 0; d.protein += r.protein || 0;
    d.carbs += r.carbs || 0; d.fat += r.fat || 0;
  });
  const days = Object.values(byDay);
  const n = days.length;
  return {
    daysLogged: n,
    avgKcal:    n ? days.reduce((a, d) => a + d.kcal, 0) / n : null,
    avgProtein: n ? days.reduce((a, d) => a + d.protein, 0) / n : null,
    avgCarbs:   n ? days.reduce((a, d) => a + d.carbs, 0) / n : null,
    avgFat:     n ? days.reduce((a, d) => a + d.fat, 0) / n : null
  };
}

async function trainingWindow(from, to) {
  const sessions = await Train.sessionsBetween(from, to);
  let sets = 0, kg = 0;
  sessions.forEach(s => (s.sets || []).filter(x => !x.warmup).forEach(x => {
    sets++; kg += (x.weightKg || 0) * (x.reps || 0);
  }));
  return { sessions: sessions.length, sets, kg: Math.round(kg) };
}

/** Everything the review screen needs, plus the recommendation. */
async function buildReview() {
  const s = Store.s;
  const today = Store.dayKey();

  const curFrom = Store.addDays(today, -6);
  const prvFrom = Store.addDays(today, -13);
  const prvTo   = Store.addDays(today, -7);

  const [cur, prv, curT, prvT, metrics] = await Promise.all([
    nutritionWindow(curFrom, today),
    nutritionWindow(prvFrom, prvTo),
    trainingWindow(curFrom, today),
    trainingWindow(prvFrom, prvTo),
    allMetrics()
  ]);

  /* --- weight trend over 21 days --- */
  const win = Store.addDays(today, -20);
  const recent = metrics.filter(m => m.day >= win && m.weightKg != null);
  const tr = trendSummary(metrics.filter(m => m.day >= win), 'weightKg', 21);
  const spanDays = recent.length ? Store.daysBetween(recent[0].day, recent[recent.length - 1].day) : 0;

  const rateTrusted = recent.length >= 6 && spanDays >= 12;
  const actualRate = rateTrusted ? tr.perWeek : null;

  /* --- 14-day intake, for adaptive TDEE --- */
  const intake14 = await nutritionWindow(Store.addDays(today, -13), today);
  const intakeTrusted = intake14.daysLogged >= 8;

  /* --- adaptive TDEE: tdee = intake − (rate_per_day × 7700) --- */
  let tdeeReal = null;
  if (rateTrusted && intakeTrusted) {
    tdeeReal = Math.round(intake14.avgKcal - (actualRate / 7) * Calc.KCAL_PER_KG_FAT);
  }

  const targets = Calc.targets(s);
  const plan = Calc.plan(s);
  const targetRate = targetWeeklyRate(s, plan);

  /* --- recommendation --- */
  let rec = { kind: 'wait', title: 'Not enough data yet', body: '', kcal: null };

  const proteinRatio = (cur.avgProtein && targets) ? cur.avgProtein / targets.protein : null;

  if (!intakeTrusted) {
    rec = { kind: 'wait', title: 'Log more days first',
      body: `Only ${intake14.daysLogged} of the last 14 days have food logged. ` +
            `Eight is the minimum before the numbers mean anything.`, kcal: null };
  } else if (!rateTrusted) {
    rec = { kind: 'wait', title: 'Need more weigh-ins',
      body: `${recent.length} weigh-in${recent.length === 1 ? '' : 's'} in the last 3 weeks, ` +
            `spanning ${spanDays} days. Aim for 4–7 per week — daily is better. ` +
            `Weight is too noisy to read from a handful of points.`, kcal: null };
  } else if (proteinRatio != null && proteinRatio < 0.88) {
    rec = { kind: 'protein', title: 'Fix protein before calories',
      body: `You're averaging ${Math.round(cur.avgProtein)} g against a ${targets.protein} g target ` +
            `(${Math.round(proteinRatio * 100)}%). In a deficit that costs you muscle, which is ` +
            `exactly what you're trying to keep. Hit protein for two weeks, then adjust calories.`,
      kcal: null };
  } else {
    const gap = actualRate - targetRate;              // + = losing too slowly
    const recommended = Math.round((tdeeReal + (targetRate / 7) * Calc.KCAL_PER_KG_FAT) / 25) * 25;
    const change = recommended - targets.kcal;

    if (Math.abs(gap) < 0.08) {
      rec = { kind: 'hold', title: 'Hold everything',
        body: `You're moving at ${Calc.r(actualRate, 2)} kg/week against a target of ` +
              `${Calc.r(targetRate, 2)}. That's on the money — change nothing for another two weeks.`,
        kcal: null };
    } else if (Math.abs(change) < 60) {
      rec = { kind: 'hold', title: 'Close enough',
        body: `The maths suggests only a ${change >= 0 ? '+' : ''}${change} kcal change. ` +
              `That's inside the noise — keep going and reassess next week.`, kcal: null };
    } else {
      const clamped = Math.max(-300, Math.min(300, change));
      rec = {
        kind: change < 0 ? 'cut' : 'raise',
        title: `${change < 0 ? 'Reduce' : 'Increase'} calories by ${Math.abs(clamped)}`,
        body: `You're at ${Calc.r(actualRate, 2)} kg/week, target is ${Calc.r(targetRate, 2)}. ` +
              `Your real maintenance measures ${tdeeReal} kcal (the formula guessed ${targets.tdee}). ` +
              `That puts your target at ${targets.kcal + clamped} kcal/day.`,
        kcal: targets.kcal + clamped
      };
    }
  }

  const [waterCur, waterPrv, suppCur, suppPrv] = await Promise.all([
    Water.rangeStats(curFrom, today),
    Water.rangeStats(prvFrom, prvTo),
    Supp.rangeStats(curFrom, today),
    Supp.rangeStats(prvFrom, prvTo)
  ]);

  return { cur, prv, curT, prvT, tr, actualRate, targetRate, rateTrusted,
           intake14, intakeTrusted, tdeeReal, targets, plan, rec,
           recent: recent.length, spanDays,
           waterCur, waterPrv, suppCur, suppPrv };
}

/* ---------------- screen ---------------- */
Screens.review = {
  title: 'Weekly review', tab: 'today', back: '#/today',
  sub: () => 'Last 7 days vs the 7 before',
  render: () => `<div id="rev-root"><div class="spinner">Crunching…</div></div>`,
  async mount() { await paintReview(); }
};

function arrow(cur, prev, dp = 0, unit = '') {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return ` <span class="tag">same</span>`;
  return ` <span style="font-size:11.5px;color:var(--dim);font-weight:700">${
    d > 0 ? '▲' : '▼'} ${Calc.r(Math.abs(d), dp)}${unit}</span>`;
}

async function paintReview() {
  const root = $('#rev-root');
  if (!root) return;

  const r = await buildReview();
  const s = Store.s;
  const t = r.targets;

  const toneMap = { wait: 'dim', protein: 'warn', hold: 'good', cut: 'warn', raise: 'good' };

  root.innerHTML = `
    <div class="stack">

      <div class="card">
        <div class="card-head"><p class="card-title">Recommendation</p>
          <span class="tag">${r.rec.kind}</span></div>
        <div class="verdict tone-${toneMap[r.rec.kind]}">
          <b>${esc(r.rec.title)}</b><br><br>${esc(r.rec.body)}</div>
        ${r.rec.kcal ? `
          <button class="btn btn-primary btn-block" id="apply-rec" style="margin-top:14px">
            Set target to ${r.rec.kcal} kcal</button>` : ''}
        ${s.kcalOverride ? `
          <button class="btn btn-block btn-ghost btn-sm" id="clear-rec" style="margin-top:8px">
            Clear manual override (${s.kcalOverride} kcal)</button>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Energy balance</p></div>
        ${kv('Reported intake · 14 d avg',
             r.intake14.avgKcal ? Math.round(r.intake14.avgKcal) + ' kcal' : '—')}
        ${kv('Measured maintenance', r.tdeeReal ? r.tdeeReal + ' kcal' : 'needs more data',
             r.tdeeReal ? 'good' : 'dim')}
        ${kv('Formula estimate', t ? t.tdee + ' kcal' : '—')}
        ${r.tdeeReal && t ? kv('Formula error',
             (r.tdeeReal - t.tdee >= 0 ? '+' : '') + (r.tdeeReal - t.tdee) + ' kcal',
             Math.abs(r.tdeeReal - t.tdee) > 250 ? 'warn' : 'good') : ''}
        ${kv('Current target', t ? t.kcal + ' kcal' + (t.overridden ? ' (manual)' : '') : '—')}
        <div style="height:10px"></div>
        ${kv('Actual rate', r.actualRate != null ? Calc.r(r.actualRate, 2) + ' kg/week' : 'unknown',
             r.actualRate == null ? 'dim' : 'good')}
        ${kv('Target rate', Calc.r(r.targetRate, 2) + ' kg/week')}
        <p class="hint" style="margin-top:12px;font-size:12px">
          Measured maintenance comes from your own data — intake minus the energy your
          weight change accounts for. It beats any formula after two weeks of logging.</p>
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Nutrition · 7 days</p>
          <span class="tag">${r.cur.daysLogged}/7 logged</span></div>
        ${kv('Avg calories', (r.cur.avgKcal ? Math.round(r.cur.avgKcal) : '—')
             + arrow(r.cur.avgKcal, r.prv.avgKcal, 0, ' kcal'))}
        ${kv('Avg protein', (r.cur.avgProtein ? Math.round(r.cur.avgProtein) + ' g' : '—')
             + arrow(r.cur.avgProtein, r.prv.avgProtein, 0, ' g'),
             t && r.cur.avgProtein >= t.protein * 0.95 ? 'good' : 'warn')}
        ${t ? kv('Protein vs target',
             r.cur.avgProtein ? Math.round((r.cur.avgProtein / t.protein) * 100) + '%' : '—') : ''}
        ${kv('Avg carbs', (r.cur.avgCarbs ? Math.round(r.cur.avgCarbs) + ' g' : '—')
             + arrow(r.cur.avgCarbs, r.prv.avgCarbs, 0, ' g'))}
        ${kv('Avg fat', (r.cur.avgFat ? Math.round(r.cur.avgFat) + ' g' : '—')
             + arrow(r.cur.avgFat, r.prv.avgFat, 0, ' g'))}
        ${kv('Days logged', r.cur.daysLogged + arrow(r.cur.daysLogged, r.prv.daysLogged))}
      </div>

      <div class="card">
        <div class="card-head"><p class="card-title">Training · 7 days</p></div>
        ${kv('Sessions', r.curT.sessions + arrow(r.curT.sessions, r.prvT.sessions))}
        ${kv('Working sets', r.curT.sets + arrow(r.curT.sets, r.prvT.sets))}
        ${kv('Total load', r.curT.kg.toLocaleString() + ' kg'
             + arrow(r.curT.kg, r.prvT.kg, 0, ' kg'))}
        ${r.curT.sessions === 0 ? `<div class="verdict tone-bad" style="margin-top:12px">
          No sessions this week. In a deficit, training is what tells your body to keep the
          muscle rather than burn it.</div>` : ''}
      </div>
      
      <div class="card">
        <div class="card-head"><p class="card-title">Water &amp; supplements · 7 days</p></div>
        ${kv('Avg water',
             (r.waterCur.avgMl ? fmtMl(r.waterCur.avgMl) : '—')
             + arrow(r.waterCur.avgMl, r.waterPrv.avgMl, 0, ' ml'))}
        ${kv('Days on target', r.waterCur.daysHitTarget + ' / 7',
             r.waterCur.daysHitTarget >= 5 ? 'good' : 'warn')}
        ${kv('Days logged', r.waterCur.daysLogged + ' / 7'
             + arrow(r.waterCur.daysLogged, r.waterPrv.daysLogged))}
        ${r.suppCur.pct != null ? kv('Supplement adherence',
             Math.round(r.suppCur.pct * 100) + '%'
             + arrow(r.suppCur.pct * 100, r.suppPrv.pct != null ? r.suppPrv.pct * 100 : null, 0, '%'),
             r.suppCur.pct >= 0.85 ? 'good' : 'warn') : ''}
        ${r.suppCur.days ? kv('Perfect days', r.suppCur.perfectDays + ' / ' + r.suppCur.days) : ''}
        ${r.waterCur.avgMl && r.waterCur.avgMl < r.waterCur.target * 0.6 ? `
          <div class="verdict tone-warn" style="margin-top:12px">
            Averaging well under target. Low hydration reduces training performance and makes
            scale weight noisier, which makes the trend line harder to read.</div>` : ''}
      </div>

      ${r.tr ? `
      <div class="card">
        <div class="card-head"><p class="card-title">Weight · 3 weeks</p>
          <span class="tag">${r.recent} weigh-ins</span></div>
        ${lineChart([
          { values: r.tr.rows.map(x => x.weightKg), color: 'var(--dim)', width: 1.5 },
          { values: r.tr.smoothArr, color: 'var(--accent)', width: 3, fill: true }
        ])}
      </div>` : ''}

      <a class="btn btn-block btn-ghost" href="#/progress">Full projection</a>
    </div>`;

  $('#apply-rec')?.addEventListener('click', () => {
    Store.set({ kcalOverride: r.rec.kcal });
    tick();
    toast('Target updated to ' + r.rec.kcal + ' kcal');
    paintReview();
  });

  $('#clear-rec')?.addEventListener('click', () => {
    Store.set({ kcalOverride: null });
    toast('Back to calculated target');
    paintReview();
  });
}

/* ============================================================
   MEAL TEMPLATES
   Stored as a single kv row, so no database migration needed.
   ============================================================ */
const MealTpl = {

  async all() {
    const row = await Store.get('kv', 'mealTemplates');
    const list = row?.value || [];
    return list.sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name));
  },

  async _write(list) {
    await Store.put('kv', { key: 'mealTemplates', value: list });
  },

  async save(tpl) {
    const list = (await Store.get('kv', 'mealTemplates'))?.value || [];
    const i = list.findIndex(t => t.id === tpl.id);
    if (i > -1) list[i] = tpl; else list.push(tpl);
    await this._write(list);
    return tpl;
  },

  async remove(id) {
    const list = ((await Store.get('kv', 'mealTemplates'))?.value || []).filter(t => t.id !== id);
    await this._write(list);
  },

  /** Build a template from a day's logged entries. */
  fromEntries(name, meal, entries) {
    return {
      id: Store.uid(),
      name: name.trim(),
      meal,
      createdAt: Date.now(),
      uses: 0,
      items: entries.map(e => {
        /* recover per-100g values so portions can be rescaled later */
        const per100 = (e.grams > 0) ? {
          kcal:    (e.kcal    || 0) / e.grams * 100,
          protein: (e.protein || 0) / e.grams * 100,
          carbs:   (e.carbs   || 0) / e.grams * 100,
          fat:     (e.fat     || 0) / e.grams * 100,
          fiber:   (e.fiber   || 0) / e.grams * 100
        } : null;
        return {
          name: e.name, brand: e.brand || '',
          grams: e.grams ?? null,
          servingLabel: e.servingLabel || '',
          per100,
          macros: { kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, fiber: e.fiber || 0 },
          foodId: e.foodId || null
        };
      })
    };
  },

  totals(tpl, mult = 1) {
    return Food.sum(tpl.items.map(it => {
      const m = (it.per100 && it.grams)
        ? Food.scale(it.per100, it.grams * mult)
        : { kcal: it.macros.kcal * mult, protein: it.macros.protein * mult,
            carbs: it.macros.carbs * mult, fat: it.macros.fat * mult,
            fiber: (it.macros.fiber || 0) * mult };
      return m;
    }));
  },

  /** Write every item of the template into the food log. */
  async log(tpl, day, meal, mult = 1) {
    for (const it of tpl.items) {
      const macros = (it.per100 && it.grams)
        ? Food.scale(it.per100, it.grams * mult)
        : { kcal: it.macros.kcal * mult, protein: it.macros.protein * mult,
            carbs: it.macros.carbs * mult, fat: it.macros.fat * mult,
            fiber: (it.macros.fiber || 0) * mult };
      await Food.addEntry({
        day, meal,
        name: it.name, brand: it.brand,
        grams: it.grams ? it.grams * mult : null,
        servingLabel: mult === 1 ? it.servingLabel : '',
        macros, foodId: it.foodId
      });
    }
    tpl.uses = (tpl.uses || 0) + 1;
    await this.save(tpl);
    return tpl.items.length;
  }
};

/** Wiring for the "Meals" tab inside the Add screen. */
function wireMealsTab() {
  App.mealMult = App.mealMult || 1;

  $$('[data-mult]').forEach(b => b.addEventListener('click', () => {
    App.mealMult = Number(b.dataset.mult);
    $$('[data-mult]').forEach(x => x.classList.toggle('on', x === b));
  }));

  $$('[data-mt]').forEach(b => b.addEventListener('click', async () => {
    const tpls = await MealTpl.all();
    const tpl = tpls.find(t => t.id === b.dataset.mt);
    if (!tpl) return;
    const n = await MealTpl.log(tpl, App.addCtx.day, App.addCtx.meal, App.mealMult || 1);
    tick();
    toast(`Added ${n} item${n > 1 ? 's' : ''}`);
    location.hash = '#/food';
  }));
}

/* ---------------- manage screen ---------------- */
Screens.meals = {
  title: 'Saved meals', tab: 'settings', back: '#/settings',
  sub: () => 'Reusable meal combinations',
  render: () => `<div id="mt-root"><div class="spinner">Loading…</div></div>`,
  async mount() { await paintMealTemplates(); }
};

async function paintMealTemplates() {
  const tpls = await MealTpl.all();

  $('#mt-root').innerHTML = tpls.length ? `
    <div class="stack">
      ${tpls.map(t => {
        const tot = MealTpl.totals(t);
        return `
        <div class="card">
          <div class="card-head">
            <p class="card-title">${esc(t.name)}</p>
            <span class="tag">${Food.mealLabel(t.meal)} · used ${t.uses || 0}×</span>
          </div>
          ${t.items.map(it => `
            <div class="kv">
              <span>${esc(it.name)}${it.grams ? ' · ' + Math.round(it.grams) + ' g' : ''}</span>
              <b>${Math.round(it.macros.kcal)} kcal</b>
            </div>`).join('')}
          ${macroGrid({
            kcal: Math.round(tot.kcal), protein: Math.round(tot.protein),
            carbs: Math.round(tot.carbs), fat: Math.round(tot.fat)
          })}
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-sm btn-ghost" data-rename="${t.id}" style="flex:1">Rename</button>
            <button class="btn btn-sm btn-danger" data-delmt="${t.id}" style="flex:1">Delete</button>
          </div>
        </div>`;
      }).join('')}
    </div>` : `
    <div class="empty">
      <h3>No saved meals yet</h3>
      <p class="hint">Log a meal on the Food tab, then tap <strong>Save as meal</strong>
        under it. From then on it's one tap to log the whole thing.</p>
    </div>`;

  $$('[data-rename]').forEach(b => b.addEventListener('click', async () => {
    const tpls = await MealTpl.all();
    const t = tpls.find(x => x.id === b.dataset.rename);
    const name = prompt('Rename this meal', t.name);
    if (!name || !name.trim()) return;
    t.name = name.trim();
    await MealTpl.save(t);
    await paintMealTemplates();
  }));

  $$('[data-delmt]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this saved meal? Your logged food is unaffected.')) return;
    await MealTpl.remove(b.dataset.delmt);
    toast('Deleted');
    await paintMealTemplates();
  }));
}

/* ============================================================
   EDIT A FOOD ENTRY
   ============================================================ */
Screens.editentry = {
  title: 'Edit entry', tab: 'food', back: '#/food',
  sub: () => App.editEntry ? esc(App.editEntry.name) : '',
  render: () => `<div id="ee-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    const e = await Food.getEntry(App.editId);
    if (!e) { toast('Entry not found'); location.hash = '#/food'; return; }
    App.editEntry = e;
    $('#screen-sub').textContent = e.name;
    paintEditEntry();
  }
};

function paintEditEntry() {
  const e = App.editEntry;
  /* recover per-100g so grams can be rescaled */
  const per100 = (e.grams > 0) ? {
    kcal:    e.kcal / e.grams * 100,
    protein: e.protein / e.grams * 100,
    carbs:   e.carbs / e.grams * 100,
    fat:     e.fat / e.grams * 100,
    fiber:   (e.fiber || 0) / e.grams * 100
  } : null;

  $('#ee-root').innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="row" style="padding-top:0">
          <div class="row-main">
            <div class="row-title">${esc(e.name)}</div>
            <div class="row-sub">${esc(e.brand || '')}${e.brand ? ' · ' : ''}${dayLabel(e.day)}</div>
          </div>
        </div>

        <div class="chips" style="margin:14px 0">
          ${Food.MEALS.map(m =>
            `<button class="chip ${m.key === e.meal ? 'on' : ''}" data-em="${m.key}">${m.label}</button>`
          ).join('')}
        </div>

        ${per100 ? `
          <label class="field" style="margin-bottom:10px"><span>Amount (grams)</span>
            <input id="ee-g" type="number" inputmode="decimal" step="1" value="${Math.round(e.grams)}"></label>
          <div class="chips">
            ${[50, 100, 150, 200, 250, 300].map(g =>
              `<button class="chip" data-eg="${g}">${g} g</button>`).join('')}
          </div>`
        : `
          <div class="field-row">
            <label class="field"><span>Calories</span>
              <input id="ee-k" type="number" inputmode="numeric" value="${Math.round(e.kcal)}"></label>
            <label class="field"><span>Protein (g)</span>
              <input id="ee-p" type="number" inputmode="decimal" value="${Calc.r(e.protein,1)}"></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Carbs (g)</span>
              <input id="ee-c" type="number" inputmode="decimal" value="${Calc.r(e.carbs,1)}"></label>
            <label class="field" style="margin-bottom:0"><span>Fat (g)</span>
              <input id="ee-f" type="number" inputmode="decimal" value="${Calc.r(e.fat,1)}"></label>
          </div>`}

        <div id="ee-preview" style="margin-top:16px"></div>
      </div>

      <button class="btn btn-primary btn-block" id="ee-save">Save changes</button>
      <button class="btn btn-block btn-danger" id="ee-del">Delete entry</button>
    </div>`;

  let meal = e.meal;

  const current = () => {
    if (per100) {
      const g = Number($('#ee-g').value) || 0;
      return { grams: g, macros: Food.scale(per100, g) };
    }
    return { grams: null, macros: {
      kcal: Number($('#ee-k').value) || 0,
      protein: Number($('#ee-p').value) || 0,
      carbs: Number($('#ee-c').value) || 0,
      fat: Number($('#ee-f').value) || 0,
      fiber: e.fiber || 0
    }};
  };

  const paint = () => {
    const m = current().macros;
    $('#ee-preview').innerHTML = macroGrid({
      kcal: Math.round(m.kcal), protein: Math.round(m.protein),
      carbs: Math.round(m.carbs), fat: Math.round(m.fat)
    });
  };

  $$('#ee-root input').forEach(i => i.addEventListener('input', paint));
  paint();

  $$('[data-eg]').forEach(b => b.addEventListener('click', () => {
    $('#ee-g').value = b.dataset.eg; paint();
  }));

  $$('[data-em]').forEach(b => b.addEventListener('click', () => {
    meal = b.dataset.em;
    $$('[data-em]').forEach(x => x.classList.toggle('on', x === b));
  }));

  $('#ee-save').addEventListener('click', async () => {
    const { grams, macros } = current();
    if (!macros.kcal && !macros.protein) return toast('Nothing to save');
    await Food.updateEntry({
      ...e, meal, grams,
      servingLabel: grams === e.grams ? e.servingLabel : '',
      kcal: Math.round(macros.kcal),
      protein: Math.round(macros.protein * 10) / 10,
      carbs: Math.round(macros.carbs * 10) / 10,
      fat: Math.round(macros.fat * 10) / 10,
      fiber: Math.round((macros.fiber || 0) * 10) / 10
    });
    tick(); toast('Updated');
    location.hash = '#/food';
  });

  $('#ee-del').addEventListener('click', async () => {
    await Food.removeEntry(e.id);
    App.lastDeleted = e;
    toast('Removed');
    location.hash = '#/food';
  });
}

/* ============================================================
   PLATE CALCULATOR
   ============================================================ */
const PLATE_SIZES = [25, 20, 15, 10, 5, 2.5, 1.25];

function platesFor(total, bar) {
  const perSide = (total - bar) / 2;
  if (perSide < -0.001) return { ok: false, reason: 'lighter than the bar' };
  let left = perSide;
  const plates = [];
  PLATE_SIZES.forEach(p => {
    const n = Math.floor((left + 1e-9) / p);
    if (n > 0) { plates.push({ p, n }); left -= n * p; }
  });
  return {
    ok: true, perSide,
    plates,
    remainder: Math.round(left * 100) / 100,
    achieved: Math.round((total - left * 2) * 100) / 100
  };
}

Screens.plates = {
  title: 'Plate calculator', tab: 'train', back: '#/train',
  sub: () => 'Per side loading',
  render: () => `<div id="pl-root"></div>`,
  mount() {
    App.plateBar = App.plateBar || 20;
    paintPlates();
  }
};

function paintPlates() {
  const w = App.plateWeight || 60;

  $('#pl-root').innerHTML = `
    <div class="stack">
      <div class="card">
        <label class="field"><span>Target weight (kg)</span>
          <input id="pl-w" type="number" inputmode="decimal" step="1.25" value="${w}"></label>
        <span style="display:block;font-size:13px;color:var(--dim);margin-bottom:6px;font-weight:600">Bar</span>
        <div class="chips">
          ${[20, 15, 10, 7].map(b =>
            `<button class="chip ${App.plateBar === b ? 'on' : ''}" data-bar="${b}">${b} kg</button>`
          ).join('')}
        </div>
        <div class="chips" style="margin-top:12px">
          ${[-5, -2.5, +2.5, +5].map(d =>
            `<button class="chip" data-adj="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}
        </div>
      </div>
      <div id="pl-out"></div>
    </div>`;

  const paint = () => {
    const total = Number($('#pl-w').value) || 0;
    App.plateWeight = total;
    const r = platesFor(total, App.plateBar);

    $('#pl-out').innerHTML = !r.ok ? `
      <div class="card"><div class="verdict tone-bad">
        ${total} kg is ${r.reason} (${App.plateBar} kg).</div></div>`
      : `
      <div class="card">
        <div class="card-head"><p class="card-title">Each side</p>
          <span class="tag">${Calc.r(r.perSide, 2)} kg per side</span></div>
        ${r.plates.length ? r.plates.map(p => `
          <div class="kv"><span>${p.p} kg</span><b>× ${p.n}</b></div>`).join('')
          : `<div class="kv"><span>Empty bar</span><b>—</b></div>`}
        <div style="margin-top:12px">
          ${kv('Bar', App.plateBar + ' kg')}
          ${kv('Total loaded', r.achieved + ' kg', r.remainder ? 'warn' : 'good')}
          ${r.remainder ? kv('Cannot reach', r.remainder * 2 + ' kg short', 'warn') : ''}
        </div>
        <p class="hint" style="margin-top:12px;font-size:12px">
          Assumes 25/20/15/10/5/2.5/1.25 kg plates. Loads heaviest first.</p>
      </div>`;
  };

  $('#pl-w').addEventListener('input', paint);

  $$('[data-bar]').forEach(b => b.addEventListener('click', () => {
    App.plateBar = Number(b.dataset.bar);
    $$('[data-bar]').forEach(x => x.classList.toggle('on', x === b));
    paint();
  }));

  $$('[data-adj]').forEach(b => b.addEventListener('click', () => {
    $('#pl-w').value = Math.max(0, (Number($('#pl-w').value) || 0) + Number(b.dataset.adj));
    paint();
  }));

  paint();
}

/* ============================================================
   WATER TRACKING
   Rides on the day-keyed `metrics` row — no new object store.
   ============================================================ */
const Water = {

  /** Daily target in ml. Manual override wins, else 35 ml per kg. */
  targetMl() {
    if (Store.s.waterTargetMl) return Store.s.waterTargetMl;
    const kg = Store.s.weightKg || 80;
    return Math.round((kg * 35) / 50) * 50;        // nearest 50 ml
  },

  autoTargetMl() {
    const kg = Store.s.weightKg || 80;
    return Math.round((kg * 35) / 50) * 50;
  },

  async get(day = Store.dayKey()) {
    const r = await Store.get('metrics', day);
    return r?.waterMl || 0;
  },

  /** Add (or subtract, with a negative value) and keep an undo trail. */
  async add(ml, day = Store.dayKey()) {
    const row = (await Store.get('metrics', day)) || { day };
    row.waterMl = Math.max(0, (row.waterMl || 0) + ml);
    row.waterLog = [...(row.waterLog || []), ml].slice(-25);
    await Store.put('metrics', row);
    return row.waterMl;
  },

  /** Remove the most recent addition. */
  async undo(day = Store.dayKey()) {
    const row = await Store.get('metrics', day);
    if (!row?.waterLog?.length) return null;
    const last = row.waterLog.pop();
    row.waterMl = Math.max(0, (row.waterMl || 0) - last);
    await Store.put('metrics', row);
    return last;
  },

  async canUndo(day = Store.dayKey()) {
    const row = await Store.get('metrics', day);
    return !!row?.waterLog?.length;
  },

  /** Overwrite the total outright (used when editing a past day). */
  async set(ml, day = Store.dayKey()) {
    const row = (await Store.get('metrics', day)) || { day };
    row.waterMl = Math.max(0, Math.round(ml));
    row.waterLog = [];
    await Store.put('metrics', row);
    return row.waterMl;
  },

  async pct(day = Store.dayKey()) {
    const t = this.targetMl();
    return t ? (await this.get(day)) / t : 0;
  },

  async remaining(day = Store.dayKey()) {
    return Math.max(0, this.targetMl() - (await this.get(day)));
  },

  /** Averages for the weekly review. */
  async rangeStats(from, to) {
    const rows = (await Store.all('metrics')).filter(r => r.day >= from && r.day <= to);
    const logged = rows.filter(r => (r.waterMl || 0) > 0);
    const target = this.targetMl();
    const total = logged.reduce((a, r) => a + r.waterMl, 0);
    return {
      daysLogged: logged.length,
      avgMl: logged.length ? total / logged.length : null,
      daysHitTarget: logged.filter(r => r.waterMl >= target).length,
      target
    };
  }
};

/** 1750 → "1.75 L";  750 → "750 ml" */
function fmtMl(ml) {
  if (ml == null) return '—';
  return ml >= 1000 ? (Math.round(ml / 10) / 100) + ' L' : Math.round(ml) + ' ml';
}

/* ============================================================
   SUPPLEMENTS
   Definitions in kv['supplements']; daily ticks on the metrics row.
   ============================================================ */
const SUPP_SLOTS = [
  { key: 'morning',     label: 'Morning' },
  { key: 'preworkout',  label: 'Pre-workout' },
  { key: 'postworkout', label: 'Post-workout' },
  { key: 'meal',        label: 'With a meal' },
  { key: 'evening',     label: 'Evening' }
];

const suppSlotLabel = k => SUPP_SLOTS.find(s => s.key === k)?.label ?? 'Anytime';

const SUPP_PRESETS = [
  { name: 'Creatine monohydrate', dose: '5 g',      slot: 'postworkout' },
  { name: 'Whey protein',         dose: '1 scoop',  slot: 'postworkout' },
  { name: 'Vitamin D3',           dose: '2000 IU',  slot: 'morning' },
  { name: 'Omega-3',              dose: '2 caps',   slot: 'meal' },
  { name: 'Magnesium',            dose: '300 mg',   slot: 'evening' },
  { name: 'Multivitamin',         dose: '1 tablet', slot: 'morning' },
  { name: 'Zinc',                 dose: '15 mg',    slot: 'evening' },
  { name: 'Caffeine',             dose: '200 mg',   slot: 'preworkout' }
];

const Supp = {

  /* ---------- definitions ---------- */

  async all() {
    const list = (await Store.get('kv', 'supplements'))?.value || [];
    return list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  },

  async _write(list) {
    await Store.put('kv', { key: 'supplements', value: list });
  },

  async save(s) {
    const list = (await Store.get('kv', 'supplements'))?.value || [];
    const row = {
      id: s.id || Store.uid(),
      name: (s.name || '').trim(),
      dose: (s.dose || '').trim(),
      slot: s.slot || 'morning',
      days: (s.days && s.days.length) ? s.days.slice().sort() : [0, 1, 2, 3, 4, 5, 6],
      order: s.order ?? list.length,
      active: s.active !== false
    };
    const i = list.findIndex(x => x.id === row.id);
    if (i > -1) list[i] = row; else list.push(row);
    await this._write(list);
    return row;
  },

  async remove(id) {
    const list = ((await Store.get('kv', 'supplements'))?.value || []).filter(x => x.id !== id);
    await this._write(list);
  },

  async toggleActive(id) {
    const list = (await Store.get('kv', 'supplements'))?.value || [];
    const s = list.find(x => x.id === id);
    if (!s) return null;
    s.active = s.active === false;
    await this._write(list);
    return s;
  },

  /** dir = -1 up, +1 down */
  async move(id, dir) {
    const list = await this.all();
    const i = list.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((s, k) => { s.order = k; });
    await this._write(list);
  },

  /* ---------- scheduling ---------- */

  /** Active supplements scheduled for that date's weekday. */
  dueOn(list, day = Store.dayKey()) {
    const [y, m, d] = day.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return list.filter(s => s.active !== false && (s.days || []).includes(dow));
  },

  bySlot(list) {
    return SUPP_SLOTS
      .map(sl => ({ ...sl, items: list.filter(s => s.slot === sl.key) }))
      .filter(g => g.items.length);
  },

  /* ---------- daily ticks ---------- */

  async taken(day = Store.dayKey()) {
    const r = await Store.get('metrics', day);
    return r?.supps || {};
  },

  async toggle(id, day = Store.dayKey()) {
    const row = (await Store.get('metrics', day)) || { day };
    row.supps = { ...(row.supps || {}) };
    if (row.supps[id]) delete row.supps[id]; else row.supps[id] = true;
    await Store.put('metrics', row);
    return !!row.supps[id];
  },

  async setAll(day = Store.dayKey(), value = true) {
    const list = await this.all();
    const due = this.dueOn(list, day);
    const row = (await Store.get('metrics', day)) || { day };
    row.supps = { ...(row.supps || {}) };
    due.forEach(s => { if (value) row.supps[s.id] = true; else delete row.supps[s.id]; });
    await Store.put('metrics', row);
    return due.length;
  },

  async progress(day = Store.dayKey()) {
    const list = await this.all();
    const due = this.dueOn(list, day);
    const t = await this.taken(day);
    const done = due.filter(s => t[s.id]).length;
    return { due: due.length, done, pct: due.length ? done / due.length : 0, items: due, taken: t };
  },

  /**
   * Consecutive complete days. Days with nothing scheduled are skipped, not counted.
   * An unfinished today doesn't break the streak.
   */
  async streak() {
    const list = (await this.all()).filter(s => s.active !== false);
    if (!list.length) return 0;

    const rows = await Store.all('metrics');
    const byDay = {};
    rows.forEach(r => { byDay[r.day] = r; });

    const floor = Store.s.createdAt || Store.addDays(Store.dayKey(), -365);

    /** true = all taken, false = missed some, null = nothing scheduled */
    const state = day => {
      const due = this.dueOn(list, day);
      if (!due.length) return null;
      const t = byDay[day]?.supps || {};
      return due.every(s => t[s.id]);
    };

    let d = Store.dayKey();
    if (state(d) === false) d = Store.addDays(d, -1);   // today still in progress

    let n = 0, guard = 0;
    while (d >= floor && guard++ < 500) {
      const st = state(d);
      if (st === null) { d = Store.addDays(d, -1); continue; }
      if (st) { n++; d = Store.addDays(d, -1); } else break;
    }
    return n;
  },

  /** Adherence across a date range, for the weekly review. */
  async rangeStats(from, to) {
    const list = (await this.all()).filter(s => s.active !== false);
    if (!list.length) return { due: 0, done: 0, pct: null, perfectDays: 0, days: 0 };

    const rows = await Store.all('metrics');
    const byDay = {};
    rows.forEach(r => { byDay[r.day] = r; });

    let due = 0, done = 0, perfectDays = 0, days = 0;
    let d = from;
    while (d <= to) {
      const dueToday = this.dueOn(list, d);
      if (dueToday.length) {
        days++;
        const t = byDay[d]?.supps || {};
        const hit = dueToday.filter(s => t[s.id]).length;
        due += dueToday.length;
        done += hit;
        if (hit === dueToday.length) perfectDays++;
      }
      d = Store.addDays(d, 1);
    }
    return { due, done, pct: due ? done / due : null, perfectDays, days };
  }
};

/* ============================================================
   WATER CARD  (renders into #water-card)
   ============================================================ */
const WATER_QUICK = [250, 330, 500, 750];

async function paintWaterCard(day = Store.dayKey()) {
  const el = $('#water-card');
  if (!el) return;

  const target = Water.targetMl();
  const have   = await Water.get(day);
  const pct    = target ? have / target : 0;
  const left   = Math.max(0, target - have);
  const undoOk = await Water.canUndo(day);
  const hour   = new Date().getHours();
  const isToday = day === Store.dayKey();

  const nudge = (isToday && hour >= 18 && pct < 0.5)
    ? `<div class="verdict tone-warn" style="margin-top:12px">
         <b>${fmtMl(left)} to go</b> and the day's nearly done. Dehydration blunts
         training performance more than most people expect.</div>`
    : (pct >= 1
      ? `<div class="verdict tone-good" style="margin-top:12px">Target hit ✓</div>` : '');

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <p class="card-title">Water</p>
        <span class="tag">target ${fmtMl(target)}</span>
      </div>

      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
        <div>
          <div class="wbig">${fmtMl(have)}</div>
          <div class="wsub">of ${fmtMl(target)}</div>
        </div>
        <div style="text-align:right">
          <div class="wbig tone-${pct >= 1 ? 'good' : 'dim'}" style="font-size:22px">
            ${pct >= 1 ? '100%' : Math.round(pct * 100) + '%'}</div>
          <div class="wsub">${left ? fmtMl(left) + ' left' : 'done'}</div>
        </div>
      </div>

      <div class="bar" style="margin-top:12px">
        <i class="water" style="width:${Math.min(100, pct * 100).toFixed(0)}%"></i></div>

      <div class="chips" style="margin-top:14px">
        ${WATER_QUICK.map(ml => `<button class="chip" data-wq="${ml}">+${ml}</button>`).join('')}
        <button class="chip" data-wq="custom">+ custom</button>
        ${undoOk ? `<button class="chip" id="w-undo">↩ undo</button>` : ''}
      </div>

      ${nudge}
    </div>`;

  $$('[data-wq]').forEach(b => b.addEventListener('click', async () => {
    let ml;
    if (b.dataset.wq === 'custom') {
      const v = prompt('How many ml?', '400');
      if (!v) return;
      ml = Math.round(Number(v));
      if (!isFinite(ml) || ml <= 0) return toast('Enter a number');
    } else {
      ml = Number(b.dataset.wq);
    }
    await Water.add(ml, day);
    tick();
    await paintWaterCard(day);
  }));

  $('#w-undo')?.addEventListener('click', async () => {
    const removed = await Water.undo(day);
    if (removed) toast('Removed ' + fmtMl(removed));
    await paintWaterCard(day);
  });
}

/* ============================================================
   SUPPLEMENT CHECKLIST  (renders into #supp-card)
   ============================================================ */
async function paintSuppCard(day = Store.dayKey()) {
  const el = $('#supp-card');
  if (!el) return;

  const all = await Supp.all();

  if (!all.length) {
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><p class="card-title">Supplements</p></div>
        <p class="hint" style="margin-bottom:12px">
          Nothing set up yet. Add what you take and tick it off daily.</p>
        <a class="btn btn-sm btn-block btn-ghost" href="#/supplements">Set up supplements</a>
      </div>`;
    return;
  }

  const prog   = await Supp.progress(day);
  const streak = await Supp.streak();
  const groups = Supp.bySlot(prog.items);
  const complete = prog.due > 0 && prog.done === prog.due;

  if (prog.due === 0) {
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><p class="card-title">Supplements</p>
          <a href="#/supplements" style="color:var(--accent);font-size:13px;font-weight:700">Manage ›</a></div>
        <p class="hint">Nothing scheduled for ${DOW[new Date().getDay()]}.</p>
      </div>`;
    return;
  }

  /* collapse to one line once everything's ticked */
  if (complete && !App.suppExpanded) {
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><p class="card-title">Supplements</p>
          ${streak > 1 ? `<span class="tag">${streak}-day streak</span>` : ''}</div>
        <div class="verdict tone-good" style="display:flex;align-items:center;
             justify-content:space-between;gap:10px">
          <span>All ${prog.due} taken ✓</span>
          <button class="btn btn-sm" id="sup-expand">Edit</button>
        </div>
      </div>`;
    $('#sup-expand').addEventListener('click', () => {
      App.suppExpanded = true;
      paintSuppCard(day);
    });
    return;
  }

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <p class="card-title">Supplements</p>
        <span class="tag">${prog.done}/${prog.due}${streak > 1 ? ' · ' + streak + 'd streak' : ''}</span>
      </div>

      <div class="bar" style="margin-bottom:4px">
        <i style="width:${(prog.pct * 100).toFixed(0)}%;background:var(--protein)"></i></div>

      ${groups.map((g, gi) => `
        <div class="slotlab ${gi === 0 ? 'first' : ''}">${g.label}</div>
        ${g.items.map(s => `
          <div class="suprow ${prog.taken[s.id] ? 'on' : ''}" data-sup="${s.id}">
            <span class="check">✓</span>
            <span class="sup-main">
              <span class="sup-name">${esc(s.name)}</span>
              ${s.dose ? `<div class="sup-dose">${esc(s.dose)}</div>` : ''}
            </span>
          </div>`).join('')}
      `).join('')}

      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-sm btn-ghost" id="sup-all" style="flex:1">
          ${prog.done === prog.due ? 'Clear all' : 'Mark all taken'}</button>
        <a class="btn btn-sm btn-ghost" href="#/supplements" style="flex:1">Manage</a>
      </div>
    </div>`;

  $$('[data-sup]').forEach(r => r.addEventListener('click', async () => {
    await Supp.toggle(r.dataset.sup, day);
    tick();
    App.suppExpanded = true;          // don't collapse mid-tapping
    await paintSuppCard(day);
  }));

  $('#sup-all').addEventListener('click', async () => {
    await Supp.setAll(day, prog.done !== prog.due);
    App.suppExpanded = false;
    tick();
    await paintSuppCard(day);
  });
}

/* ============================================================
   SUPPLEMENTS — management screen
   ============================================================ */
Screens.supplements = {
  title: 'Supplements', tab: 'settings', back: '#/settings',
  sub: () => App.suppState?.view === 'edit' ? 'Edit item' : 'What you take and when',
  render: () => `<div id="sup-root"><div class="spinner">Loading…</div></div>`,
  async mount() {
    App.suppState = { view: 'list', editing: null };
    await paintSupplements();
  }
};

async function paintSupplements() {
  if (App.suppState.view === 'edit') return paintSuppEdit();

  const list = await Supp.all();
  const daysLabel = s => {
    const d = s.days || [];
    if (d.length === 7) return 'Every day';
    if (d.length === 0) return 'Never';
    return d.map(i => DOW[i]).join(' ');
  };

  const existing = new Set(list.map(s => s.name.toLowerCase()));
  const presets = SUPP_PRESETS.filter(p => !existing.has(p.name.toLowerCase()));

  $('#sup-root').innerHTML = `
    <div class="stack">

      ${list.length ? `
      <div class="card" style="padding:0">
        <div class="card-head" style="padding:16px 16px 10px;margin:0">
          <p class="card-title">Your stack (${list.length})</p>
          <span class="tag">${list.filter(s => s.active !== false).length} active</span>
        </div>
        ${list.map((s, i) => `
          <div class="tpl" style="${s.active === false ? 'opacity:.45' : ''}">
            <div class="tpl-main" data-edit="${s.id}" style="cursor:pointer">
              <div class="tpl-name">${esc(s.name)}${s.dose ? ` <span class="tag">${esc(s.dose)}</span>` : ''}</div>
              <div class="tpl-sub">${suppSlotLabel(s.slot)} · ${daysLabel(s)}${s.active === false ? ' · paused' : ''}</div>
            </div>
            <div class="tpl-actions">
              <button class="iconbtn" data-up="${s.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="iconbtn" data-down="${s.id}" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="iconbtn" data-toggle="${s.id}">${s.active === false ? '▶' : '⏸'}</button>
            </div>
          </div>`).join('')}
      </div>` : `
      <div class="empty">
        <h3>No supplements yet</h3>
        <p class="hint">Add what you actually take. Tap one of the common ones below,
          or create your own.</p>
      </div>`}

      <button class="btn btn-primary btn-block" id="sup-new">+ Add supplement</button>

      ${presets.length ? `
      <div class="card">
        <div class="card-head"><p class="card-title">Common ones</p></div>
        <div class="chips">
          ${presets.map((p, i) => `<button class="chip" data-preset="${i}">${esc(p.name)}</button>`).join('')}
        </div>
        <p class="hint" style="margin-top:10px;font-size:12px">
          Tap to add with a sensible default dose and timing — edit afterwards if needed.</p>
      </div>` : ''}

      <div class="card">
        <div class="card-head"><p class="card-title">How it works</p></div>
        <p class="hint">Items appear on the Today screen only on the weekdays you schedule.
          Pausing an item hides it without deleting your history. A day counts toward your
          streak when everything scheduled for it is ticked.</p>
      </div>

    </div>`;

  $$('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const all = await Supp.all();
    App.suppState = { view: 'edit', editing: all.find(x => x.id === b.dataset.edit) };
    $('#screen-sub').textContent = 'Edit item';
    paintSupplements();
  }));

  $$('[data-up]').forEach(b => b.addEventListener('click', async () => {
    await Supp.move(b.dataset.up, -1); paintSupplements();
  }));
  $$('[data-down]').forEach(b => b.addEventListener('click', async () => {
    await Supp.move(b.dataset.down, 1); paintSupplements();
  }));
  $$('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    await Supp.toggleActive(b.dataset.toggle); paintSupplements();
  }));

  $$('[data-preset]').forEach(b => b.addEventListener('click', async () => {
    const p = SUPP_PRESETS.filter(x =>
      !new Set(list.map(s => s.name.toLowerCase())).has(x.name.toLowerCase()))[Number(b.dataset.preset)];
    if (!p) return;
    await Supp.save({ ...p });
    tick(); toast(p.name + ' added');
    paintSupplements();
  }));

  $('#sup-new').addEventListener('click', () => {
    App.suppState = { view: 'edit', editing: null };
    $('#screen-sub').textContent = 'Edit item';
    paintSupplements();
  });
}

function paintSuppEdit() {
  const s = App.suppState.editing;
  const isNew = !s;
  const cur = s || { name: '', dose: '', slot: 'morning', days: [0,1,2,3,4,5,6], active: true };
  let days = (cur.days || []).slice();

  $('#sup-root').innerHTML = `
    <button class="btn btn-sm btn-ghost" id="se-back" style="margin-bottom:14px">‹ Back</button>

    <form id="se-form" class="card" onsubmit="return false">
      <label class="field"><span>Name</span>
        <input name="name" data-type="text" value="${esc(cur.name)}" placeholder="Creatine monohydrate"></label>

      <div class="field-row">
        <label class="field"><span>Dose</span>
          <input name="dose" data-type="text" value="${esc(cur.dose)}" placeholder="5 g"></label>
        <label class="field"><span>When</span>
          <select name="slot">
            ${SUPP_SLOTS.map(sl =>
              `<option value="${sl.key}" ${cur.slot === sl.key ? 'selected' : ''}>${sl.label}</option>`
            ).join('')}
          </select></label>
      </div>

      <span style="display:block;font-size:13px;color:var(--dim);margin-bottom:6px;font-weight:600">Days</span>
      <div class="chips" style="margin-bottom:10px">
        ${DOW.map((d, i) =>
          `<button type="button" class="chip ${days.includes(i) ? 'on' : ''}" data-day="${i}">${d}</button>`
        ).join('')}
      </div>
      <div class="chips" style="margin-bottom:16px">
        <button type="button" class="chip" data-preset-days="all">Every day</button>
        <button type="button" class="chip" data-preset-days="weekdays">Mon–Fri</button>
        <button type="button" class="chip" data-preset-days="training">Training days</button>
      </div>

      <button class="btn btn-primary btn-block" id="se-save">
        ${isNew ? 'Add supplement' : 'Save changes'}</button>
      ${!isNew ? `<button class="btn btn-block btn-danger" id="se-del" style="margin-top:8px">
        Delete</button>` : ''}
    </form>`;

  const repaintDays = () => $$('[data-day]').forEach(b =>
    b.classList.toggle('on', days.includes(Number(b.dataset.day))));

  $('#se-back').addEventListener('click', () => {
    App.suppState = { view: 'list', editing: null };
    $('#screen-sub').textContent = 'What you take and when';
    paintSupplements();
  });

  $$('[data-day]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.day);
    const k = days.indexOf(i);
    if (k > -1) days.splice(k, 1); else days.push(i);
    days.sort();
    repaintDays();
  }));

  $$('[data-preset-days]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.presetDays;
    if (kind === 'all')      days = [0, 1, 2, 3, 4, 5, 6];
    if (kind === 'weekdays') days = [1, 2, 3, 4, 5];
    if (kind === 'training') {
      const tpls = await Train.allTemplates();
      const d = tpls.map(t => t.dayHint).filter(x => x != null);
      days = d.length ? [...new Set(d)].sort() : [1, 2, 4, 5];
    }
    repaintDays();
  }));

  $('#se-save').addEventListener('click', async () => {
    const v = readForm($('#se-form'));
    if (!v.name || !v.name.trim()) return toast('Name it first');
    if (!days.length) return toast('Pick at least one day');
    await Supp.save({
      ...(s || {}),
      name: v.name, dose: v.dose, slot: v.slot,
      days, active: cur.active !== false
    });
    tick(); toast('Saved');
    App.suppState = { view: 'list', editing: null };
    $('#screen-sub').textContent = 'What you take and when';
    paintSupplements();
  });

  $('#se-del')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${cur.name}? Days you already ticked stay in your history.`)) return;
    await Supp.remove(cur.id);
    toast('Deleted');
    App.suppState = { view: 'list', editing: null };
    $('#screen-sub').textContent = 'What you take and when';
    paintSupplements();
  });
}

/* ============================================================
   WATER — Body screen section (renders into #water-body)
   ============================================================ */
async function paintWaterBody(range = 90) {
  const el = $('#water-body');
  if (!el) return;

  const all = (await Store.all('metrics')).sort((a, b) => a.day.localeCompare(b.day));
  const cutoff = range ? Store.addDays(Store.dayKey(), -range) : '0000-00-00';
  const rows = all.filter(m => m.day >= cutoff);

  const target = Water.targetMl();
  const auto = Water.autoTargetMl();
  const today = Store.dayKey();
  const todayMl = (await Store.get('metrics', today))?.waterMl || 0;

  const logged = rows.filter(r => (r.waterMl || 0) > 0);
  const avg = logged.length ? logged.reduce((a, r) => a + r.waterMl, 0) / logged.length : null;
  const hit = logged.filter(r => r.waterMl >= target).length;

  el.innerHTML = `
    <div class="card">
      <div class="card-head"><p class="card-title">Water</p>
        <span class="tag">${logged.length} days logged</span></div>

      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${avg ? (Math.round(avg / 100) / 10) : '—'}</div>
          <div class="stat-label">avg litres</div></div>
        <div class="stat"><div class="stat-value">${hit}</div>
          <div class="stat-label">days on target</div></div>
        <div class="stat"><div class="stat-value">${Math.round(target / 100) / 10}</div>
          <div class="stat-label">target litres</div></div>
      </div>

      ${logged.length > 1 ? `<div style="margin-top:16px">
        ${lineChart([{ values: logged.map(r => r.waterMl), color: 'var(--carb)', width: 2.5, fill: true }])}
      </div>` : ''}

      <div class="field-row" style="margin-top:16px">
        <label class="field" style="margin-bottom:0"><span>Today's total (ml)</span>
          <input id="wb-today" type="number" inputmode="numeric" step="50" value="${todayMl}"></label>
        <label class="field" style="margin-bottom:0"><span>Target override (ml)</span>
          <input id="wb-target" type="number" inputmode="numeric" step="100"
                 value="${Store.s.waterTargetMl ?? ''}" placeholder="auto: ${auto}"></label>
      </div>

      <button class="btn btn-block" id="wb-save" style="margin-top:12px">Save water settings</button>
      ${Store.s.waterTargetMl ? `<button class="btn btn-block btn-ghost btn-sm" id="wb-clear"
        style="margin-top:8px">Use automatic target (${auto} ml)</button>` : ''}
      <p class="hint" style="margin-top:10px;font-size:12px">
        Automatic target is 35 ml per kg of bodyweight, so it moves as your weight does.
        Add water quickly from the Today screen.</p>
    </div>`;

  $('#wb-save').addEventListener('click', async () => {
    const ml = Number($('#wb-today').value);
    if (isFinite(ml) && ml >= 0) await Water.set(ml, today);
    const tgt = $('#wb-target').value;
    Store.set({ waterTargetMl: tgt === '' ? null : Math.max(500, Number(tgt)) });
    toast('Saved');
    await paintWaterBody(range);
  });

  $('#wb-clear')?.addEventListener('click', async () => {
    Store.set({ waterTargetMl: null });
    toast('Automatic target restored');
    await paintWaterBody(range);
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
  if (name !== 'session') stopRest();
  if (name !== 'photos') freePhotoUrls();
  if (name !== 'today') App.suppExpanded = false;

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
