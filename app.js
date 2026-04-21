/* ===========================================================================
   מתכונים — app.js
   Single-file, no framework, no build. Hash router. Reader + admin.
   Storage: data/recipes.json in this repo (read via fetch, write via GitHub
   Contents API with a fine-grained PAT the admin enters once per device).
   =========================================================================== */
'use strict';

/* ---------- Seed (used only if data/recipes.json is unreachable, e.g. local file://) ---------- */
const SEED = { recipes: [] };

/* ---------- tiny utilities ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const cloneTpl = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);
const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'r-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

function toast(msg, opts = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!opts.error);
  el.hidden = false;
  // ensure reflow so transition plays
  void el.offsetWidth;
  el.dataset.visible = 'true';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.dataset.visible = 'false';
    setTimeout(() => { el.hidden = true; }, 250);
  }, opts.duration || 2200);
}

function relTimeHe(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'עכשיו';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return m === 1 ? 'לפני דקה' : `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'אתמול';
  if (d < 7) return `לפני ${d} ימים`;
  if (d < 30) { const w = Math.floor(d / 7); return w === 1 ? 'לפני שבוע' : `לפני ${w} שבועות`; }
  if (d < 365) { const mo = Math.floor(d / 30); return mo === 1 ? 'לפני חודש' : `לפני ${mo} חודשים`; }
  const y = Math.floor(d / 365);
  return y === 1 ? 'לפני שנה' : `לפני ${y} שנים`;
}

// Normalize text for search: lowercase + strip Hebrew nikud (points)
function norm(s) {
  return (s || '')
    .toString()
    .normalize('NFC')
    .replace(/[\u0591-\u05C7]/g, '') // cantillation + nikud
    .toLowerCase();
}

/* ---------- local device state ---------- */
const LS = {
  lastOpened:    'matkonim.lastOpened',
  pin:           'matkonim.pin',          // plain 4-digit; this is a speedbump, not crypto
  unlockedUntil: 'matkonim.unlockedUntil',
  ghOwner:       'matkonim.gh.owner',
  ghRepo:        'matkonim.gh.repo',
  ghToken:       'matkonim.gh.token',
};

const Local = {
  getLastOpened() {
    try { return JSON.parse(localStorage.getItem(LS.lastOpened) || '{}'); } catch { return {}; }
  },
  markOpened(id) {
    const map = Local.getLastOpened();
    map[id] = new Date().toISOString();
    localStorage.setItem(LS.lastOpened, JSON.stringify(map));
  },
  getPin()        { return localStorage.getItem(LS.pin); },
  setPin(pin)     { localStorage.setItem(LS.pin, pin); },
  clearPin()      { localStorage.removeItem(LS.pin); },

  isUnlocked() {
    const t = parseInt(localStorage.getItem(LS.unlockedUntil) || '0', 10);
    return t > Date.now();
  },
  extendUnlock(days = 30) {
    localStorage.setItem(LS.unlockedUntil, String(Date.now() + days * 24 * 3600 * 1000));
  },
  lock() { localStorage.removeItem(LS.unlockedUntil); },

  getGhConfig() {
    return {
      owner: localStorage.getItem(LS.ghOwner) || '',
      repo:  localStorage.getItem(LS.ghRepo)  || '',
      token: localStorage.getItem(LS.ghToken) || '',
    };
  },
  setGhConfig({ owner, repo, token }) {
    localStorage.setItem(LS.ghOwner, owner);
    localStorage.setItem(LS.ghRepo, repo);
    localStorage.setItem(LS.ghToken, token);
  },
};

/* ---------- GitHub I/O ---------- */
const DATA_PATH = 'data/recipes.json';

async function loadRecipesFromCdn() {
  // Read from the deployed site itself (works on GH Pages). Cache-bust.
  const url = `${DATA_PATH}?v=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.recipes)) throw new Error('malformed');
    return json;
  } catch (err) {
    console.warn('[matkonim] falling back to SEED:', err.message);
    return structuredClone(SEED);
  }
}

// Read the file from GitHub API so we get the current SHA (needed for writes)
async function loadRecipesViaApi() {
  const { owner, repo, token } = Local.getGhConfig();
  if (!owner || !repo || !token) throw new Error('missing-gh-config');
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' }
  );
  if (res.status === 404) {
    // File doesn't exist yet — first save will create it
    return { data: { recipes: [] }, sha: null };
  }
  if (!res.ok) throw new Error(`api ${res.status}`);
  const body = await res.json();
  // content is base64-encoded UTF-8
  const txt = new TextDecoder('utf-8').decode(
    Uint8Array.from(atob(body.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
  );
  const data = JSON.parse(txt);
  return { data, sha: body.sha };
}

async function saveRecipesViaApi(data, prevSha, commitMessage) {
  const { owner, repo, token } = Local.getGhConfig();
  const content = JSON.stringify(data, null, 2) + '\n';
  // btoa doesn't handle UTF-8 — encode first
  const b64 = btoa(
    Array.from(new TextEncoder().encode(content))
      .map((b) => String.fromCharCode(b))
      .join('')
  );
  const body = {
    message: commitMessage,
    content: b64,
  };
  if (prevSha) body.sha = prevSha;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = res.status === 409
      ? 'מישהו אחר ערך בינתיים — טען מחדש ונסה שוב.'
      : res.status === 401
      ? 'טוקן לא תקף. בדוק ב־GitHub Settings.'
      : res.status === 404
      ? 'ריפו לא נמצא. בדוק את שם ה־owner/repo.'
      : `שגיאה (${res.status}) ${err.message || ''}`;
    throw new Error(msg);
  }
  const result = await res.json();
  return result.content.sha;
}

/* ---------- In-memory store ---------- */
const Store = {
  recipes: [],
  sha: null,          // git sha of data/recipes.json (set after admin load)

  byId(id) { return this.recipes.find((r) => r.id === id); },

  /** Sort by lastOpened desc; fall back to updatedAt/createdAt */
  sorted() {
    const lo = Local.getLastOpened();
    return [...this.recipes].sort((a, b) => {
      const ka = lo[a.id] || a.updatedAt || a.createdAt || '';
      const kb = lo[b.id] || b.updatedAt || b.createdAt || '';
      return kb.localeCompare(ka);
    });
  },

  /** case/nikud-insensitive substring match across title + ingredients + instructions */
  search(q) {
    const needle = norm(q).trim();
    const base = this.sorted();
    if (!needle) return base;
    return base.filter((r) => {
      const hay = norm(
        r.title + '\n' + r.ingredients.join('\n') + '\n' + r.instructions.join('\n')
      );
      return hay.includes(needle);
    });
  },
};

/* ---------- Router ---------- */
const app = () => $('#app');

function navigate(hash, { replace = false } = {}) {
  // If target hash equals current, no hashchange fires — re-route explicitly
  const current = location.hash || '#/';
  if (current === hash) { route(); return; }
  if (replace) location.replace(hash);
  else location.hash = hash;
}

function parseRoute() {
  const h = (location.hash || '#/').slice(1); // strip #
  const parts = h.split('/').filter(Boolean);
  return parts; // e.g. ['admin','r','abc'] or ['r','abc'] or []
}

// Depth of the route for "forward vs back" animation direction.
//   0 = home / admin-home-root
//   1 = recipe detail / admin root
//   2 = admin new / admin edit
function routeDepth(hash) {
  const parts = (hash || '#/').slice(1).split('/').filter(Boolean);
  if (parts.length === 0) return 0;          // #/
  if (parts[0] === 'r') return 1;            // #/r/:id
  if (parts[0] === 'admin') {
    if (parts.length === 1) return 1;        // #/admin
    return 2;                                // #/admin/new or #/admin/r/:id
  }
  return 0;
}

// Set before each mount; read by CSS via html.nav-*
let lastDepth = -1;
let pendingDirection = 'none';
function setDirectionForRoute() {
  const d = routeDepth(location.hash);
  if (lastDepth === -1)     pendingDirection = 'none';
  else if (d > lastDepth)   pendingDirection = 'forward';
  else if (d < lastDepth)   pendingDirection = 'back';
  else                      pendingDirection = 'same';
  lastDepth = d;
}

async function route() {
  setDirectionForRoute();
  const parts = parseRoute();
  // reader
  if (parts.length === 0) return renderHome();
  if (parts[0] === 'r' && parts[1]) return renderRecipe(parts[1]);
  // admin
  if (parts[0] === 'admin') return routeAdmin(parts.slice(1));
  // fallback
  return navigate('#/', { replace: true });
}

async function routeAdmin(rest) {
  // Lock gate
  const pin = Local.getPin();
  if (!pin) return renderLockScreen({ mode: 'set' });
  if (!Local.isUnlocked()) return renderLockScreen({ mode: 'enter' });

  // Token config gate
  const cfg = Local.getGhConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) return renderTokenScreen();

  // Ensure we have latest data + sha for safe writes
  if (Store.sha === null) {
    try {
      const { data, sha } = await loadRecipesViaApi();
      Store.recipes = data.recipes || [];
      Store.sha = sha;
    } catch (e) {
      console.warn(e);
      toast('טעינה מ־GitHub נכשלה — בודק תצורה', { error: true });
      return renderTokenScreen({ errorMsg: e.message });
    }
  }

  if (rest.length === 0) return renderAdminHome();
  if (rest[0] === 'new') return renderEdit(null);
  if (rest[0] === 'r' && rest[1]) return renderEdit(rest[1]);
  navigate('#/admin', { replace: true });
}

/* ---------- Reader: Home ---------- */
function renderHome() {
  const view = cloneTpl('tpl-home');
  const list = $('[data-list]', view);
  const empty = $('[data-empty]', view);
  const search = $('[data-search]', view);
  const countEl = $('[data-count]', view);

  const renderList = () => {
    const q = search.value;
    const results = Store.search(q);
    list.innerHTML = '';
    countEl.textContent = `${Store.recipes.length} מתכונים`;
    if (!results.length) { empty.hidden = false; return; }
    empty.hidden = true;
    const lo = Local.getLastOpened();
    const frag = document.createDocumentFragment();
    for (const r of results) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="t"></span>
        <span class="meta"></span>
      `;
      $('.t', li).textContent = r.title;
      $('.meta', li).textContent = relTimeHe(lo[r.id] || r.updatedAt || r.createdAt);
      li.addEventListener('click', () => {
        Local.markOpened(r.id);
        navigate(`#/r/${r.id}`);
      });
      frag.appendChild(li);
    }
    list.appendChild(frag);
  };

  search.addEventListener('input', debounce(renderList, 90));
  renderList();
  mount(view);
}

/* ---------- Reader: Recipe detail ---------- */
function renderRecipe(id) {
  const r = Store.byId(id);
  if (!r) {
    toast('מתכון לא נמצא', { error: true });
    return navigate('#/', { replace: true });
  }
  Local.markOpened(r.id);

  const view = cloneTpl('tpl-recipe');
  $('[data-title]', view).textContent = r.title;
  $('[data-sub]', view).textContent =
    `${r.ingredients.length} מצרכים · ${r.instructions.length} שלבים`;

  const ing = $('[data-ingredients]', view);
  for (const line of r.ingredients) {
    const d = document.createElement('div');
    d.textContent = line;
    if (/[:：]\s*$/.test(line)) d.dataset.section = 'true';
    ing.appendChild(d);
  }
  const ol = $('[data-instructions]', view);
  for (const step of r.instructions) {
    const li = document.createElement('li');
    li.textContent = step;
    ol.appendChild(li);
  }
  mount(view);
  // scroll to top
  window.scrollTo({ top: 0 });
}

/* ---------- Admin: Lock screen ---------- */
function renderLockScreen({ mode }) {
  const view = cloneTpl('tpl-admin-lock');
  const title = $('[data-lock-title]', view);
  const sub = $('[data-lock-sub]', view);
  const dots = $('[data-dots]', view);
  const pad = $('.pin-pad', view);
  const forgot = $('[data-forgot]', view);

  let buffer = '';
  let firstPin = null;           // used during 'set' confirm flow

  const renderDots = () => {
    $$('span', dots).forEach((s, i) => s.classList.toggle('filled', i < buffer.length));
  };

  const setTitle = (t, s) => { title.textContent = t; sub.textContent = s; };

  if (mode === 'set') {
    setTitle('בחר PIN', 'ארבע ספרות לגישה לעריכה');
  } else {
    setTitle('הזן PIN', 'ארבע ספרות לגישה לעריכה');
    forgot.hidden = false;
  }

  const shake = () => {
    dots.classList.add('shake');
    setTimeout(() => dots.classList.remove('shake'), 340);
    buffer = '';
    renderDots();
  };

  const onComplete = () => {
    if (mode === 'set') {
      if (firstPin === null) {
        firstPin = buffer;
        buffer = '';
        renderDots();
        setTitle('אשר PIN', 'הקלד שוב');
        return;
      }
      if (firstPin !== buffer) {
        toast('PIN לא תואם, נסה שוב', { error: true });
        firstPin = null;
        buffer = '';
        renderDots();
        setTitle('בחר PIN', 'ארבע ספרות לגישה לעריכה');
        return;
      }
      Local.setPin(firstPin);
      Local.extendUnlock();
      toast('PIN נשמר');
      // fall through to admin
      return navigate('#/admin', { replace: true });
    }
    // mode === 'enter'
    if (buffer === Local.getPin()) {
      Local.extendUnlock();
      return navigate('#/admin', { replace: true });
    }
    shake();
  };

  pad.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('pad-back')) {
      buffer = buffer.slice(0, -1);
      renderDots();
      return;
    }
    if (btn.classList.contains('pad-spacer')) return;
    if (buffer.length >= 4) return;
    buffer += btn.textContent.trim();
    renderDots();
    if (buffer.length === 4) setTimeout(onComplete, 120);
  });

  forgot.addEventListener('click', () => {
    if (!confirm('למחוק את כל הנתונים המקומיים (PIN, טוקן, נפתחו לאחרונה)? אי אפשר לשחזר טוקן — תצטרך ליצור חדש ב־GitHub.')) return;
    Object.values(LS).forEach((k) => localStorage.removeItem(k));
    toast('נמחק');
    navigate('#/', { replace: true });
  });

  mount(view);
}

/* ---------- Admin: Token setup ---------- */
function renderTokenScreen({ errorMsg } = {}) {
  const view = cloneTpl('tpl-admin-token');
  const cfg = Local.getGhConfig();
  $('[data-owner]', view).value = cfg.owner || 'danielhadar';
  $('[data-repo]', view).value  = cfg.repo  || 'matkonim';
  $('[data-token]', view).value = cfg.token || '';
  if (errorMsg) toast(errorMsg, { error: true });

  $('[data-save]', view).addEventListener('click', async () => {
    const owner = $('[data-owner]', view).value.trim();
    const repo = $('[data-repo]', view).value.trim();
    const token = $('[data-token]', view).value.trim();
    if (!owner || !repo || !token) return toast('חסרים שדות', { error: true });
    Local.setGhConfig({ owner, repo, token });
    // try a read to validate
    try {
      const { data, sha } = await loadRecipesViaApi();
      Store.recipes = data.recipes || [];
      Store.sha = sha;
      toast('מחובר ✓');
      navigate('#/admin');
    } catch (e) {
      toast('חיבור נכשל: ' + e.message, { error: true });
    }
  });

  mount(view);
}

/* ---------- Admin: Home (recipe list with edit/delete) ---------- */
function renderAdminHome() {
  const view = cloneTpl('tpl-admin-home');
  const list = $('[data-list]', view);
  const empty = $('[data-empty]', view);
  const search = $('[data-search]', view);

  const renderList = () => {
    list.innerHTML = '';
    const q = search.value;
    const results = Store.search(q);
    if (!results.length) { empty.hidden = false; return; }
    empty.hidden = true;
    for (const r of results) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="t"></span>
        <span class="row-actions">
          <a href="#/admin/r/${r.id}" tabindex="-1" aria-hidden="true">ערוך</a>
        </span>
      `;
      $('.t', li).textContent = r.title;
      li.addEventListener('click', () => navigate(`#/admin/r/${r.id}`));
      list.appendChild(li);
    }
  };

  search.addEventListener('input', debounce(renderList, 90));
  renderList();
  mount(view);
}

/* ---------- Admin: Add / Edit ---------- */
function renderEdit(idOrNull) {
  const existing = idOrNull ? Store.byId(idOrNull) : null;
  const view = cloneTpl('tpl-admin-edit');
  $('[data-heading]', view).textContent = existing ? 'עריכת מתכון' : 'מתכון חדש';
  const titleEl = $('[data-title]', view);
  const ingEl = $('[data-ingredients]', view);
  const insEl = $('[data-instructions]', view);
  const previewEl = $('[data-preview]', view);
  const delBtn = $('[data-delete]', view);
  const saveBtn = $('[data-save]', view);

  if (existing) {
    titleEl.value = existing.title;
    ingEl.value = existing.ingredients.join('\n');
    insEl.value = existing.instructions.join('\n');
    delBtn.hidden = false;
  }

  const splitLines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const newId = uid(); // stable for this form's lifetime
  const buildRecipe = () => ({
    id: existing ? existing.id : newId,
    title: titleEl.value.trim(),
    ingredients: splitLines(ingEl.value),
    instructions: splitLines(insEl.value),
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const renderPreview = () => {
    const r = buildRecipe();
    if (!r.title && !r.ingredients.length && !r.instructions.length) {
      previewEl.innerHTML = '<p style="color:var(--ink-40);font-size:14px;">מלא שדות למעלה כדי לראות תצוגה מקדימה.</p>';
      return;
    }
    previewEl.innerHTML = `
      <h3></h3>
      <div class="p-section">מצרכים</div>
      ${r.ingredients.map(() => `<div class="p-ing"></div>`).join('')}
      <div class="p-section">הוראות הכנה</div>
      <ol class="p-steps">${r.instructions.map(() => `<li></li>`).join('')}</ol>
    `;
    $('h3', previewEl).textContent = r.title || '(ללא כותרת)';
    const ingNodes = $$('.p-ing', previewEl);
    r.ingredients.forEach((line, i) => {
      if (!ingNodes[i]) return;
      ingNodes[i].textContent = line;
      if (/[:：]\s*$/.test(line)) ingNodes[i].dataset.section = 'true';
    });
    const stepNodes = $$('.p-steps li', previewEl);
    r.instructions.forEach((step, i) => { if (stepNodes[i]) stepNodes[i].textContent = step; });
  };

  [titleEl, ingEl, insEl].forEach((el) => el.addEventListener('input', debounce(renderPreview, 90)));
  renderPreview();

  // Auto-grow textareas
  const autogrow = (el) => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };
  [ingEl, insEl].forEach((el) => {
    el.addEventListener('input', () => autogrow(el));
    requestAnimationFrame(() => autogrow(el));
  });

  // Save
  view.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const r = buildRecipe();
    if (!r.title) return toast('חסרה כותרת', { error: true });
    if (!r.ingredients.length) return toast('חסרים מצרכים', { error: true });
    if (!r.instructions.length) return toast('חסרות הוראות', { error: true });

    saveBtn.disabled = true;
    saveBtn.textContent = existing ? 'שומר…' : 'יוצר…';
    try {
      const idx = Store.recipes.findIndex((x) => x.id === r.id);
      if (idx >= 0) Store.recipes[idx] = r; else Store.recipes.push(r);
      const newSha = await saveRecipesViaApi(
        { recipes: Store.recipes },
        Store.sha,
        existing ? `recipe: edit — ${r.title}` : `recipe: add — ${r.title}`
      );
      Store.sha = newSha;
      toast('נשמר ✓');
      navigate('#/admin');
    } catch (e) {
      toast(e.message, { error: true });
      saveBtn.disabled = false;
      saveBtn.textContent = 'שמירה';
    }
  });

  // Delete
  delBtn.addEventListener('click', async () => {
    if (!existing) return;
    if (!confirm(`למחוק את "${existing.title}"? אי אפשר לשחזר.`)) return;
    delBtn.disabled = true;
    delBtn.textContent = 'מוחק…';
    try {
      const next = Store.recipes.filter((x) => x.id !== existing.id);
      const newSha = await saveRecipesViaApi(
        { recipes: next },
        Store.sha,
        `recipe: delete — ${existing.title}`
      );
      Store.recipes = next;
      Store.sha = newSha;
      toast('נמחק');
      navigate('#/admin');
    } catch (e) {
      toast(e.message, { error: true });
      delBtn.disabled = false;
      delBtn.textContent = 'מחיקה';
    }
  });

  mount(view);
}

/* ---------- mount helper ---------- */
function mount(view) {
  const root = app();
  const doSwap = () => {
    root.innerHTML = '';
    root.appendChild(view);
    // scroll to top on every view swap — recipes especially
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // Tag <html> so CSS can pick the right slide direction
  const h = document.documentElement;
  h.classList.remove('nav-forward', 'nav-back', 'nav-same', 'nav-none');
  h.classList.add('nav-' + pendingDirection);

  // Prefers-reduced-motion short-circuit
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canTransition =
    !reduced &&
    typeof document.startViewTransition === 'function' &&
    (pendingDirection === 'forward' || pendingDirection === 'back');

  if (!canTransition) { doSwap(); return; }
  document.startViewTransition(doSwap);
}

/* ---------- debounce ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- boot ---------- */
(async function boot() {
  try {
    // Reader can always see the public JSON. Admin will reload via API on entry.
    const data = await loadRecipesFromCdn();
    Store.recipes = data.recipes || [];
  } catch (e) {
    console.error(e);
    Store.recipes = SEED.recipes;
  }
  window.addEventListener('hashchange', route);
  route();
})();
