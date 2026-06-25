// calendar.js — Brigade Events Calendar
// Manual entry + TripleSeat sync (quando disponibile)

const CAL_LOCATIONS = ['Zenos', 'La Scuderia', 'Private Home'];
const CAL_SERVICE_STYLES = ['Al Piatto', 'Buffet', 'Family Style', 'Cocktail'];
const CAL_STATUSES = ['confirmed', 'tentative', 'cancelled'];

let _calEvents = [];
let _calFilter = 'upcoming';

// ── SHOW CALENDAR (entry point) ──────────────────────────────
async function showCalendar() {
  if (typeof hideAdminMenu === 'function') hideAdminMenu();
  document.querySelectorAll('section[id^="v"]').forEach(s => s.classList.add('hidden'));
  const sec = document.getElementById('vkal');
  if (!sec) return;
  sec.classList.remove('hidden');
  sec.innerHTML = _calShell();
  await _calLoad();
}

// ── SHELL HTML ───────────────────────────────────────────────
function _calShell() {
  const isAdm = typeof isAdmin === 'function' && isAdmin();
  return `
<!-- Header sticky — si ferma sotto il topbar globale (64px) -->
<div style="position:sticky;top:64px;z-index:20;background:white;
            border-bottom:1px solid #e2e8f0;
            box-shadow:0 2px 8px rgba(30,58,95,0.06);">
  <div style="padding:12px 14px;display:flex;align-items:center;gap:10px;">
    <button onclick="showSection('vh')"
      style="width:34px;height:34px;border-radius:10px;background:#f1f5f9;border:none;
             font-size:20px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">‹</button>
    <div style="flex:1;font-size:17px;font-weight:700;color:#1e3a5f;">📅 Events</div>
    <div style="display:flex;gap:6px;">
      ${isAdm ? `<button onclick="openEventEditor()"
        style="font-size:12px;font-weight:700;color:white;background:#059669;border:none;
               border-radius:10px;padding:7px 14px;cursor:pointer;">+ New Event</button>` : ''}
      ${isAdm ? `<button onclick="_calSync()" id="calSyncBtn"
        style="font-size:12px;font-weight:600;color:#059669;background:#f0fdf4;
               border:1px solid #bbf7d0;border-radius:10px;padding:7px 10px;cursor:pointer;">↻</button>` : ''}
    </div>
  </div>
  <!-- Filtri -->
  <div style="display:flex;gap:6px;padding:0 14px 10px;">
    <button onclick="_calSetFilter('upcoming')" id="calF_upcoming"
      style="font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;
             border:1.5px solid #059669;background:#059669;color:white;">Upcoming</button>
    <button onclick="_calSetFilter('past')" id="calF_past"
      style="font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;
             border:1.5px solid #e2e8f0;background:white;color:#64748b;">Past</button>
    <button onclick="_calSetFilter('all')" id="calF_all"
      style="font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;
             border:1.5px solid #e2e8f0;background:white;color:#64748b;">All</button>
  </div>
</div>
<!-- Lista eventi — scrolla normalmente -->
<div id="calList" style="padding:12px 14px 100px;"></div>`;
}

// ── FILTER ───────────────────────────────────────────────────
function _calSetFilter(f) {
  _calFilter = f;
  ['upcoming','past','all'].forEach(k => {
    const btn = document.getElementById('calF_' + k);
    if (!btn) return;
    if (k === f) {
      btn.style.background = '#059669';
      btn.style.color = 'white';
      btn.style.borderColor = '#059669';
    } else {
      btn.style.background = 'white';
      btn.style.color = '#64748b';
      btn.style.borderColor = '#e2e8f0';
    }
  });
  _calRender();
}

// ── LOAD ─────────────────────────────────────────────────────
async function _calLoad() {
  const list = document.getElementById('calList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">Loading events…</div>';
  try {
    const client = window.supa || window.supabaseClient;
    if (!client) throw new Error('Supabase not ready');
    const { data, error } = await client
      .from('events')
      .select('*')
      .order('event_date', { ascending: true });
    if (error) throw error;
    _calEvents = data || [];
    _calRender();
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">Error loading events</div>';
  }
}

// ── RENDER LIST ───────────────────────────────────────────────
function _calRender() {
  const list = document.getElementById('calList');
  if (!list) return;
  const today = new Date().toISOString().split('T')[0];
  let filtered = _calEvents;
  if (_calFilter === 'upcoming') filtered = _calEvents.filter(e => e.event_date >= today);
  else if (_calFilter === 'past') filtered = _calEvents.filter(e => e.event_date < today);

  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">No events found</div>';
    return;
  }

  const byMonth = {};
  filtered.forEach(e => {
    const d = new Date(e.event_date + 'T12:00:00');
    const key = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(e);
  });

  let html = '';
  for (const [month, events] of Object.entries(byMonth)) {
    html += `<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;padding:14px 0 6px;">${month}</div>`;
    events.forEach(e => { html += _calCard(e); });
  }
  list.innerHTML = html;
}

// ── CARD ─────────────────────────────────────────────────────
function _calCard(e) {
  const d = new Date(e.event_date + 'T12:00:00');
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum = d.getDate();
  const today = new Date().toISOString().split('T')[0];
  const isPast = e.event_date < today;
  const isToday = e.event_date === today;
  const isAdm = typeof isAdmin === 'function' && isAdmin();

  const statusColor = { confirmed:'#059669', tentative:'#f59e0b', cancelled:'#ef4444' }[e.status] || '#94a3b8';
  const statusBg    = { confirmed:'#f0fdf4', tentative:'#fffbeb', cancelled:'#fff5f5' }[e.status] || '#f8fafc';

  let timeStr = '';
  if (e.event_time) {
    const [h, m] = e.event_time.split(':');
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr % 12 || 12;
    timeStr = `${hr12}:${m} ${ampm}`;
  }

  // Recipes list
  const recipes = Array.isArray(e.event_recipes) ? e.event_recipes : [];
  let recipesHtml = '';
  if (recipes.length) {
    recipesHtml = `<div style="margin-top:8px;padding-top:8px;border-top:0.5px solid rgba(59,130,246,0.08);">
      <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Menu</div>
      ${recipes.map(r => `
        <div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;color:#1e3a5f;">
          <span style="color:#94a3b8;">•</span>
          <span>${r.recipe_title || r.name || ''}</span>
          ${r.portions ? `<span style="color:#94a3b8;font-size:11px;">— ${r.portions} portions</span>` : ''}
          ${r.note ? `<span style="color:#cbd5e1;font-size:10px;"> (${r.note})</span>` : ''}
        </div>`).join('')}
    </div>`;
  }

  // Food cost — solo admin
  let fcHtml = '';
  if (isAdm && e.total_food_cost) {
    fcHtml = `<div style="margin-top:6px;font-size:11px;font-weight:600;color:#059669;">Food Cost: $${parseFloat(e.total_food_cost).toFixed(2)}</div>`;
  }

  // Edit button — solo admin, solo eventi manuali
  const editBtn = (isAdm && e.source !== 'tripleseat')
    ? `<button onclick="event.stopPropagation();openEventEditor(${JSON.stringify(e).replace(/"/g,'&quot;')})"
        style="font-size:10px;font-weight:600;color:#3b82f6;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:3px 8px;cursor:pointer;margin-top:8px;">
        ✏️ Edit
      </button>`
    : '';

  // TripleSeat link
  const tsLink = e.tripleseat_id
    ? `<a href="https://lc.tripleseat.com/events/${e.tripleseat_id}" target="_blank"
        style="font-size:10px;color:#94a3b8;text-decoration:none;display:block;margin-top:6px;">View in TripleSeat ↗</a>`
    : '';

  return `
<div style="background:white;border-radius:16px;border:0.5px solid rgba(59,130,246,0.1);
            box-shadow:0 2px 8px rgba(30,58,95,0.06);margin-bottom:10px;overflow:hidden;
            opacity:${isPast ? '0.65' : '1'};">
  <div style="display:flex;gap:0;">
    <div style="min-width:52px;background:${isToday ? '#1e3a5f' : '#f8fafc'};
                display:flex;flex-direction:column;align-items:center;justify-content:center;
                padding:12px 8px;border-right:0.5px solid rgba(59,130,246,0.08);">
      <div style="font-size:10px;font-weight:600;color:${isToday ? '#93c5fd' : '#94a3b8'};text-transform:uppercase;">${dayName}</div>
      <div style="font-size:22px;font-weight:800;color:${isToday ? 'white' : '#1e3a5f'};line-height:1.1;">${dayNum}</div>
    </div>
    <div style="flex:1;padding:12px 14px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="font-size:14px;font-weight:700;color:#1e3a5f;line-height:1.3;">${e.name || ''}</div>
        <span style="font-size:10px;font-weight:600;color:${statusColor};background:${statusBg};
                     border-radius:6px;padding:2px 7px;white-space:nowrap;flex-shrink:0;">
          ${(e.status || 'tentative').charAt(0).toUpperCase() + (e.status || 'tentative').slice(1)}
        </span>
      </div>
      <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        ${timeStr ? `<span style="font-size:12px;color:#475569;">🕐 ${timeStr}</span>` : ''}
        ${e.guest_count ? `<span style="font-size:12px;color:#475569;">👥 ${e.guest_count}</span>` : ''}
        ${(e.location || e.room_name) ? `<span style="font-size:12px;color:#475569;">📍 ${e.location || e.room_name}</span>` : ''}
        ${e.service_style ? `<span style="font-size:11px;color:#6366f1;background:#eef2ff;border-radius:6px;padding:1px 7px;">${e.service_style}</span>` : ''}
      </div>
      ${e.notes ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">${e.notes}</div>` : ''}
      ${recipesHtml}
      ${fcHtml}
      ${editBtn}
      ${tsLink}
    </div>
  </div>
</div>`;
}

// ── EVENT EDITOR ─────────────────────────────────────────────
function openEventEditor(ev = null) {
  // ev può essere un oggetto evento (modifica) o null (nuovo)
  const isEdit = ev && ev.id;

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';

  const locationOpts = CAL_LOCATIONS.map(l =>
    `<option value="${l}" ${(ev?.location || ev?.room_name) === l ? 'selected' : ''}>${l}</option>`
  ).join('');
  const isCustomLoc = ev && (ev.location || ev.room_name) && !CAL_LOCATIONS.includes(ev.location || ev.room_name);
  const customLocVal = isCustomLoc ? (ev.location || ev.room_name) : '';

  const serviceOpts = CAL_SERVICE_STYLES.map(s =>
    `<option value="${s}" ${ev?.service_style === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  const statusOpts = CAL_STATUSES.map(s =>
    `<option value="${s}" ${(ev?.status || 'confirmed') === s ? 'selected' : ''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
  ).join('');

  modal.innerHTML = `
<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[90vh] flex flex-col" style="animation:slideUp .2s ease;">
  <div class="p-4 border-b" style="flex-shrink:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <h3 class="font-bold text-base" style="color:#1e3a5f;">${isEdit ? '✏️ Edit Event' : '📅 New Event'}</h3>
      <button onclick="this.closest('.fixed').remove()" style="width:30px;height:30px;border-radius:50%;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
  </div>

  <div class="overflow-auto p-4 space-y-3 text-sm" style="flex:1;">

    <!-- Nome evento -->
    <div>
      <div class="text-xs text-slate-500 mb-1 font-medium">Event Name</div>
      <input id="evName" placeholder="e.g. Smith Wedding Rehearsal" value="${ev?.name || ''}"
        class="w-full px-3 py-2.5 border rounded-xl text-sm" style="border-color:#e2e8f0;">
    </div>

    <!-- Data + Ora -->
    <div class="grid grid-cols-2 gap-2">
      <div>
        <div class="text-xs text-slate-500 mb-1 font-medium">Date</div>
        <input id="evDate" type="date" value="${ev?.event_date || ''}"
          class="w-full px-3 py-2.5 border rounded-xl text-sm" style="border-color:#e2e8f0;">
      </div>
      <div>
        <div class="text-xs text-slate-500 mb-1 font-medium">Time</div>
        <input id="evTime" type="time" value="${ev?.event_time ? ev.event_time.slice(0,5) : ''}"
          class="w-full px-3 py-2.5 border rounded-xl text-sm" style="border-color:#e2e8f0;">
      </div>
    </div>

    <!-- Location -->
    <div>
      <div class="text-xs text-slate-500 mb-1 font-medium">Location</div>
      <select id="evLocation" onchange="_calLocationChange(this)"
        class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white" style="border-color:#e2e8f0;">
        <option value="">— Select —</option>
        ${locationOpts}
        <option value="__custom__" ${isCustomLoc ? 'selected' : ''}>+ Add New…</option>
      </select>
      <input id="evLocationCustom" placeholder="Enter location name…"
        class="w-full px-3 py-2.5 border rounded-xl text-sm mt-1"
        style="border-color:#6366f1;display:${isCustomLoc ? 'block' : 'none'};"
        value="${customLocVal}">
    </div>

    <!-- Ospiti + Servizio -->
    <div class="grid grid-cols-2 gap-2">
      <div>
        <div class="text-xs text-slate-500 mb-1 font-medium">Guests</div>
        <input id="evGuests" type="number" min="1" placeholder="e.g. 80" value="${ev?.guest_count || ''}"
          class="w-full px-3 py-2.5 border rounded-xl text-sm" style="border-color:#e2e8f0;">
      </div>
      <div>
        <div class="text-xs text-slate-500 mb-1 font-medium">Service Style</div>
        <select id="evService" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white" style="border-color:#e2e8f0;">
          <option value="">— Select —</option>
          ${serviceOpts}
        </select>
      </div>
    </div>

    <!-- Status -->
    <div>
      <div class="text-xs text-slate-500 mb-1 font-medium">Status</div>
      <select id="evStatus" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white" style="border-color:#e2e8f0;">
        ${statusOpts}
      </select>
    </div>

    <!-- Note -->
    <div>
      <div class="text-xs text-slate-500 mb-1 font-medium">Notes</div>
      <textarea id="evNotes" placeholder="Any details for the brigade…" rows="2"
        class="w-full px-3 py-2.5 border rounded-xl text-sm resize-none" style="border-color:#e2e8f0;">${ev?.notes || ''}</textarea>
    </div>

    <!-- Ricette -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div class="font-semibold" style="color:#1e3a5f;">
          Recipes
          <span class="text-xs text-slate-400 font-normal ml-1">title · qty · unit · note</span>
        </div>
        <button id="evAddRecipe"
          class="text-xs border border-emerald-200 rounded-lg px-2 py-1"
          style="color:#059669;cursor:pointer;background:white;">
          + Add Recipe
        </button>
      </div>
      <div id="evRecipeList" class="space-y-1"></div>
      <div id="evFoodCost" style="display:none;margin-top:8px;padding:8px 12px;background:#f0fdf4;border-radius:10px;font-size:12px;font-weight:600;color:#059669;"></div>
    </div>

  </div>

  <!-- Footer -->
  <div class="p-3 border-t" style="flex-shrink:0;">
    <div style="display:flex;gap:8px;margin-bottom:${isEdit ? '8px' : '0'};">
      <button onclick="this.closest('.fixed').remove()"
        class="flex-1 py-2.5 border rounded-xl text-sm font-medium" style="border-color:#e2e8f0;color:#64748b;">
        Cancel
      </button>
      <button id="evSaveBtn"
        class="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
        style="background:linear-gradient(135deg,#1e3a5f,#2563eb);">
        ${isEdit ? 'Save Changes' : 'Create Event'}
      </button>
    </div>
    ${isEdit ? `<button id="evDeleteBtn"
      class="w-full py-2.5 rounded-xl text-sm font-medium"
      style="color:#ef4444;background:#fff5f5;border:1px solid #fecdd3;">
      🗑 Delete Event
    </button>` : ''}
  </div>
</div>`;

  document.body.appendChild(modal);

  // Tap backdrop chiude
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Blocca swipe orizzontale su iOS
  modal.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
      const dx = Math.abs(e.touches[0].clientX - (modal._tx || e.touches[0].clientX));
      const dy = Math.abs(e.touches[0].clientY - (modal._ty || e.touches[0].clientY));
      if (dx > dy) e.preventDefault();
    }
  }, { passive: false });
  modal.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { modal._tx = e.touches[0].clientX; modal._ty = e.touches[0].clientY; }
  }, { passive: true });

  // ── Recipe rows ──
  const recipeList = modal.querySelector('#evRecipeList');
  const fcDiv = modal.querySelector('#evFoodCost');

  function addRecipeRow(d = {}) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 70px 90px 32px;gap:4px;align-items:center;margin-bottom:4px;';
    row.innerHTML = `
      <div style="position:relative;">
        <input placeholder="Recipe name…" class="ev-rec-name w-full px-2 py-2 border rounded-lg text-sm"
          value="${(d.recipe_title || d.name || '').replace(/"/g,'&quot;')}"
          style="border-color:#e2e8f0;" autocomplete="off">
        <div class="ev-ac-dropdown" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:9999;
          background:white;border:1.5px solid #e2e8f0;border-radius:10px;
          box-shadow:0 8px 24px rgba(30,58,95,0.13);max-height:200px;overflow-y:auto;margin-top:2px;"></div>
      </div>
      <input placeholder="Portions" type="number" min="0" step="1" class="ev-rec-portions px-2 py-2 border rounded-lg text-sm text-center" value="${d.portions || d.qty || ''}" style="border-color:#e2e8f0;">
      <input placeholder="Note" class="ev-rec-note px-2 py-2 border rounded-lg text-sm" value="${(d.note || '').replace(/"/g,'&quot;')}" style="border-color:#e2e8f0;">
      <button class="ev-rec-del text-red-400" style="min-width:32px;min-height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;background:none;border:none;">✕</button>`;

    row.querySelector('.ev-rec-del').onclick = () => { row.remove(); _calcFoodCost(); };

    const nameInput = row.querySelector('.ev-rec-name');
    const dropdown  = row.querySelector('.ev-ac-dropdown');

    let _ac       = null;
    let _recipeId = d.recipe_id || null;
    let _recipeFc = d.food_cost  || null;

    row._getRecipeId = () => _recipeId;
    row._getFoodCost = () => _recipeFc;

    function _selectRecipe(title, id, fc) {
      nameInput.value = title;
      _recipeId = id;
      _recipeFc = fc;
      nameInput.style.borderColor = '#10b981';
      nameInput.style.background  = '#f0fdf4';
      dropdown.style.display = 'none';
      _calcFoodCost();
    }

    function _hideDropdown() { dropdown.style.display = 'none'; }

    function _showResults(results) {
      if (!results || !results.length) { _hideDropdown(); return; }
      dropdown.innerHTML = results.map((r, i) => `
        <div class="ev-ac-item" data-idx="${i}"
          style="padding:9px 12px;font-size:13px;color:#1e3a5f;cursor:pointer;
                 border-bottom:0.5px solid #f1f5f9;
                 -webkit-user-select:none;user-select:none;">
          <span style="font-weight:600;">${r.title}</span>
          ${r.menu_group ? `<span style="font-size:11px;color:#94a3b8;margin-left:6px;">${r.menu_group}</span>` : ''}
        </div>`).join('');
      dropdown.style.display = 'block';
      dropdown.querySelectorAll('.ev-ac-item').forEach((item, i) => {
        const r = results[i];
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          _selectRecipe(r.title, r.id, r.food_cost_pct || null);
        });
        item.addEventListener('touchend', e => {
          e.preventDefault();
          _selectRecipe(r.title, r.id, r.food_cost_pct || null);
        });
        item.addEventListener('touchstart', () => {
          item.style.background = '#f0f9ff';
        }, { passive: true });
      });
    }

    nameInput.addEventListener('input', () => {
      _recipeId = null; _recipeFc = null;
      nameInput.style.borderColor = '#e2e8f0';
      nameInput.style.background  = '';
      clearTimeout(_ac);
      const q = nameInput.value.trim();
      if (q.length < 2) { _hideDropdown(); return; }
      _ac = setTimeout(async () => {
        const client = window.supa || window.supabaseClient;
        const { data } = await client
          .from('recipes')
          .select('id,title,menu_group,food_cost_pct')
          .ilike('title', `%${q}%`)
          .order('title')
          .limit(10);
        _showResults(data || []);
      }, 220);
    });

    // blur con delay 200ms: permette a touchend/mousedown sul dropdown di scattare prima
    nameInput.addEventListener('blur', () => { setTimeout(_hideDropdown, 200); });

    recipeList.appendChild(row);
  }

  function _calcFoodCost() {
    const rows = [...recipeList.querySelectorAll('div[style*="grid"]')];
    let hasAny = false;
    let totalCost = 0;
    rows.forEach(row => {
      const fc = row._getFoodCost ? row._getFoodCost() : null;
      const portions = parseFloat(row.querySelector('.ev-rec-portions')?.value) || 0;
      if (fc && portions) {
        totalCost += (fc / 100) * portions;
        hasAny = true;
      }
    });
    if (hasAny) {
      fcDiv.style.display = 'block';
      fcDiv.textContent = `Estimated Food Cost: $${totalCost.toFixed(2)}`;
    } else {
      fcDiv.style.display = 'none';
    }
  }

  // Popola ricette esistenti
  const existing = Array.isArray(ev?.event_recipes) ? ev.event_recipes : [];
  existing.forEach(r => addRecipeRow(r));
  if (!existing.length) addRecipeRow(); // una riga vuota di default

  modal.querySelector('#evAddRecipe').onclick = () => addRecipeRow();

  // ── Save ──
  modal.querySelector('#evSaveBtn').onclick = async () => {
    const name = modal.querySelector('#evName').value.trim();
    if (!name) { alert('Event name required'); return; }
    const date = modal.querySelector('#evDate').value;
    if (!date) { alert('Date required'); return; }

    // Location
    const locSel = modal.querySelector('#evLocation').value;
    const locCustom = modal.querySelector('#evLocationCustom').value.trim();
    const location = locSel === '__custom__' ? locCustom : locSel;

    // Raccoglie le ricette
    const recipeRows = [...recipeList.querySelectorAll('div[style*="grid"]')];
    const event_recipes = recipeRows
      .map(row => ({
        recipe_id: row._getRecipeId ? row._getRecipeId() : null,
        recipe_title: row.querySelector('.ev-rec-name')?.value.trim() || '',
        portions: parseInt(row.querySelector('.ev-rec-portions')?.value) || null,
        note: row.querySelector('.ev-rec-note')?.value.trim() || '',
        food_cost: row._getFoodCost ? row._getFoodCost() : null
      }))
      .filter(r => r.recipe_title);

    const payload = {
      name,
      event_date: date,
      event_time: modal.querySelector('#evTime').value || null,
      location,
      room_name: location,
      guest_count: parseInt(modal.querySelector('#evGuests').value) || null,
      service_style: modal.querySelector('#evService').value || null,
      status: modal.querySelector('#evStatus').value || 'confirmed',
      notes: modal.querySelector('#evNotes').value.trim() || null,
      event_recipes,
      source: 'manual',
      updated_at: new Date().toISOString()
    };

    const btn = modal.querySelector('#evSaveBtn');
    btn.textContent = 'Saving…';
    btn.disabled = true;

    try {
      const client = window.supa || window.supabaseClient;
      let err;
      if (isEdit) {
        ({ error: err } = await client.from('events').update(payload).eq('id', ev.id));
      } else {
        payload.created_at = new Date().toISOString();
        ({ error: err } = await client.from('events').insert(payload));
      }
      if (err) throw err;
      modal.remove();
      // Aggiorna calendario e home
      await _calLoad();
      if (typeof loadUpcomingDemand === 'function') loadUpcomingDemand();
      if (typeof showToast === 'function') showToast(isEdit ? 'Event updated ✓' : 'Event created ✓');
    } catch(e) {
      btn.textContent = isEdit ? 'Save Changes' : 'Create Event';
      btn.disabled = false;
      alert('Error: ' + e.message);
    }
  };

  // ── Delete ──
  const deleteBtn = modal.querySelector('#evDeleteBtn');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${ev.name}"?`)) return;
      try {
        const client = window.supa || window.supabaseClient;
        const { error } = await client.from('events').delete().eq('id', ev.id);
        if (error) throw error;
        modal.remove();
        await _calLoad();
        if (typeof loadUpcomingDemand === 'function') loadUpcomingDemand();
        if (typeof showToast === 'function') showToast('Event deleted');
      } catch(e) {
        alert('Error: ' + e.message);
      }
    };
  }
}

// ── LOCATION SELECT HANDLER ───────────────────────────────────
function _calLocationChange(sel) {
  const customInput = sel.closest('div').querySelector('#evLocationCustom');
  if (!customInput) return;
  if (sel.value === '__custom__') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
    customInput.value = '';
  }
}

// ── TRIPLESEAT SYNC (invariato — pronto per quando Monica autorizza) ──
async function _calSync() {
  const btn = document.getElementById('calSyncBtn');
  if (btn) { btn.textContent = '↻ Syncing…'; btn.style.opacity = '0.6'; btn.disabled = true; }
  try {
    const res = await fetch('https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/tripleseat-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();
    if (result.success) {
      if (btn) { btn.textContent = `✓ ${result.inserted} new, ${result.updated} updated`; btn.style.opacity = '1'; }
      await _calLoad();
      setTimeout(() => { if (btn) { btn.textContent = '↻ TripleSeat'; btn.disabled = false; } }, 3000);
    } else {
      throw new Error(result.error || 'Sync failed');
    }
  } catch(e) {
    if (btn) { btn.textContent = '✗ Error'; btn.style.opacity = '1'; btn.disabled = false; }
    console.error('TripleSeat sync error:', e);
    alert('TripleSeat non ancora connesso. Monica deve autorizzare l\'app prima.');
  }
}
