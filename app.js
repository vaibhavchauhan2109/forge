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
    render: () => `
      <div class="stack">

        <div class="card">
          <div class="card-head">
            <p class="card-title">Nutrition</p>
            <span class="tag">Phase 3</span>
          </div>
          <div class="stat-grid">
            <div class="stat"><div class="stat-value">—</div><div class="stat-label">kcal</div></div>
            <div class="stat"><div class="stat-value">—</div><div class="stat-label">protein</div></div>
            <div class="stat"><div class="stat-value">—</div><div class="stat-label">left</div></div>
          </div>
          <div style="margin-top:14px" class="bar"><i style="width:0%"></i></div>
        </div>

        <div class="card">
          <div class="card-head">
            <p class="card-title">Today's training</p>
            <span class="tag">Phase 4</span>
          </div>
          <p class="hint">No plan yet — we'll build the planner soon.</p>
        </div>

        <div class="card">
          <div class="card-head">
            <p class="card-title">Goal</p>
            <span class="tag">Phase 5</span>
          </div>
          <p class="hint">Abs in 5 months, lean mass retained.</p>
        </div>

      </div>`
  },

  /* ---------------- FOOD ---------------- */
  food: {
    title: 'Food',
    sub: () => 'Meal log & protein',
    action: () => `<button class="btn btn-primary btn-sm" id="add-food">+ Add</button>`,
    render: () => `
      <div class="empty">
        <h3>Meal logger</h3>
        <p class="hint">Coming in Phase 3: quick-add, your own food library, barcode scanning.</p>
      </div>`,
    mount() {
      $('#add-food')?.addEventListener('click', () => toast('Meal logging arrives in Phase 3'));
    }
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
    sub: () => 'Profile, targets, backup',
    render: () => `
      <div class="stack">

        <div class="card">
          <div class="card-head"><p class="card-title">Profile</p><span class="tag">Phase 2</span></div>
          <p class="hint">Height, weight, age, activity → BMI, TDEE and macro targets.</p>
        </div>

        <div class="card">
          <div class="card-head"><p class="card-title">Diagnostics</p></div>
          <div class="row">
            <div class="row-main"><div class="row-title">App version</div></div>
            <div class="row-value">${App.version}</div>
          </div>
          <div class="row">
            <div class="row-main"><div class="row-title">Installed</div>
              <div class="row-sub">Running from home screen?</div></div>
            <div class="row-value">${isStandalone() ? 'Yes ✓' : 'No — open via Safari'}</div>
          </div>
          <div class="row">
            <div class="row-main"><div class="row-title">Offline cache</div>
              <div class="row-sub">Service worker</div></div>
            <div class="row-value" id="sw-state">checking…</div>
          </div>
          <div class="row">
            <div class="row-main"><div class="row-title">Storage used</div></div>
            <div class="row-value" id="storage-state">—</div>
          </div>
        </div>

        <button class="btn btn-block" id="force-update">Check for update</button>
        <button class="btn btn-block btn-danger" id="hard-reset">Clear cache &amp; reload</button>
        <p class="hint" style="text-align:center">Clearing the cache does <strong>not</strong> delete your logged data.</p>

      </div>`,
    async mount() {
      /* service worker state */
      const swEl = $('#sw-state');
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        swEl.textContent = reg && navigator.serviceWorker.controller ? 'Active ✓'
                        : reg ? 'Installing…' : 'Not registered';
      } else {
        swEl.textContent = 'Unsupported';
      }

      /* storage estimate */
      if (navigator.storage?.estimate) {
        const { usage } = await navigator.storage.estimate();
        $('#storage-state').textContent = ((usage || 0) / 1024).toFixed(0) + ' KB';
      }

      /* force the service worker to look for a new version */
      $('#force-update').addEventListener('click', async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) return toast('No service worker');
        await reg.update();
        toast('Checked. Close & reopen the app to apply.');
      });

      /* nuclear option — fixes any stuck cache */
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

  /* header */
  $('#screen-title').textContent = screen.title;
  const sub = screen.sub ? screen.sub() : '';
  $('#screen-sub').textContent = sub;
  $('#screen-sub').style.display = sub ? '' : 'none';
  $('#bar-action').innerHTML = screen.action ? screen.action() : '';

  /* body */
  $('#view').innerHTML = screen.render();

  /* tab highlight */
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));

  /* let the browser paint before we scroll + wire up */
  window.scrollTo(0, 0);
  document.title = 'Forge — ' + screen.title;
  screen.mount?.();
}

window.addEventListener('hashchange', () => { tick(); render(); });

window.addEventListener('DOMContentLoaded', () => {
  if (!location.hash) location.replace('#/today');
  render();
});