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
  const isEdit = ev && ev.id;
  const isAdm  = typeof isAdmin === 'function' && isAdmin();

  // ── Opzioni select ──
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

  // ── CSS inline condiviso (tutti 16px per evitare zoom Safari) ──
  const I = `width:100%;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1e3a5f;background:white;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;outline:none;-webkit-appearance:none;box-sizing:border-box;`;
  const LBL = `font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px;`;

  // ── Overlay backdrop ──
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(15,23,42,0.45);';
  overlay.addEventListener('click', e => { if (e.target === overlay) _closeEditor(); });

  // ── Sheet ──
  const sheet = document.createElement('div');
  sheet.style.cssText = `
    position:fixed;left:0;right:0;bottom:0;z-index:201;
    background:white;border-radius:22px 22px 0 0;
    box-shadow:0 -8px 32px rgba(30,58,95,0.2);
    display:flex;flex-direction:column;
    height:88vh;
    overflow:hidden;
  `;

  sheet.innerHTML = `
    <!-- Grip -->
    <div style="display:flex;justify-content:center;padding:10px 0 4px;flex-shrink:0;">
      <div style="width:38px;height:4px;border-radius:2px;background:#e2e8f0;"></div>
    </div>
    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 16px 13px;border-bottom:1px solid #f1f5f9;flex-shrink:0;">
      <div style="font-size:18px;font-weight:700;color:#1e3a5f;">${isEdit ? '✏️ Edit Event' : '📅 New Event'}</div>
      <button id="evCloseBtn" style="width:30px;height:30px;border-radius:50%;background:#f1f5f9;border:none;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#64748b;">✕</button>
    </div>
    <!-- Scroll body -->
    <div id="evBody" style="flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;padding:16px 16px 20px;">
      <!-- Event Name -->
      <div style="margin-bottom:14px;">
        <div style="${LBL}">Event Name</div>
        <input id="evName" type="text" placeholder="e.g. Smith Wedding Rehearsal" value="${(ev?.name||'').replace(/"/g,'&quot;')}" style="${I}">
      </div>
      <!-- Date + Time -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
          <div style="${LBL}">Date</div>
          <input id="evDate" type="date" value="${ev?.event_date||''}" style="${I}">
        </div>
        <div>
          <div style="${LBL}">Time</div>
          <input id="evTime" type="time" value="${ev?.event_time ? ev.event_time.slice(0,5) : ''}" style="${I}">
        </div>
      </div>
      <!-- Location -->
      <div style="margin-bottom:14px;">
        <div style="${LBL}">Location</div>
        <select id="evLocation" onchange="_calLocationChange(this)" style="${I}">
          <option value="">— Select —</option>
          ${locationOpts}
          <option value="__custom__" ${isCustomLoc ? 'selected' : ''}>+ Add New…</option>
        </select>
        <input id="evLocationCustom" type="text" placeholder="Enter location name…"
          style="${I}margin-top:6px;border-color:#6366f1;display:${isCustomLoc ? 'block' : 'none'};"
          value="${customLocVal.replace(/"/g,'&quot;')}">
      </div>
      <!-- Guests + Service -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
          <div style="${LBL}">Guests</div>
          <input id="evGuests" type="number" min="1" placeholder="80" value="${ev?.guest_count||''}" style="${I}">
        </div>
        <div>
          <div style="${LBL}">Service Style</div>
          <select id="evService" style="${I}">
            <option value="">— Select —</option>
            ${serviceOpts}
          </select>
        </div>
      </div>
      <!-- Status -->
      <div style="margin-bottom:14px;">
        <div style="${LBL}">Status</div>
        <select id="evStatus" style="${I}">${statusOpts}</select>
      </div>
      <!-- Notes -->
      <div style="margin-bottom:18px;">
        <div style="${LBL}">Notes</div>
        <textarea id="evNotes" rows="2" placeholder="Any details for the brigade…"
          style="${I}resize:none;">${ev?.notes||''}</textarea>
      </div>

      <!-- ── RECIPES ── -->
      <div style="border-top:1.5px solid #f1f5f9;padding-top:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:15px;font-weight:700;color:#1e3a5f;">🍽 Menu / Recipes</div>
          <div style="display:flex;gap:6px;">
            <button id="evAddSection"
              style="font-size:13px;font-weight:600;color:#6366f1;background:#eef2ff;border:1px solid #c7d2fe;border-radius:9px;padding:6px 12px;cursor:pointer;">
              + Section
            </button>
            <button id="evAddRecipe"
              style="font-size:13px;font-weight:600;color:#059669;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;padding:6px 12px;cursor:pointer;">
              + Recipe
            </button>
          </div>
        </div>
        <!-- Header colonne -->
        <div style="display:grid;grid-template-columns:1fr 64px 34px;gap:6px;padding:0 0 4px;margin-bottom:2px;">
          <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Recipe</div>
          <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;text-align:center;">Pax</div>
          <div></div>
        </div>
        <div id="evRecipeList"></div>
        <div id="evFoodCost" style="display:none;margin-top:8px;padding:9px 12px;background:#f0fdf4;border-radius:10px;font-size:13px;font-weight:600;color:#059669;"></div>
      </div>

      <!-- ── CHEF NOTES (testo libero) ── -->
      <div style="margin-top:18px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:13px;">
        <div style="${LBL}color:#92400e;">📝 Chef Notes</div>
        <textarea id="evChefNotes" rows="3" placeholder="Note libere: setup, timing, allergeni, speech, istruzioni speciali…"
          style="${I}background:white;border-color:#fde68a;border-radius:10px;resize:none;">${ev?.chef_notes||''}</textarea>
      </div>

      <!-- Delete (solo edit) -->
      ${isEdit ? `<button id="evDeleteBtn" style="width:100%;margin-top:16px;padding:13px;border:1px solid #fecdd3;border-radius:13px;background:#fff5f5;color:#ef4444;font-size:16px;font-weight:600;cursor:pointer;">🗑 Delete Event</button>` : ''}
    </div>
    <!-- Footer fisso -->
    <div style="flex-shrink:0;background:white;border-top:1px solid #f1f5f9;padding:12px 16px 28px;display:flex;gap:10px;">
      <button id="evCancelBtn" style="flex:1;padding:14px;border:1.5px solid #e2e8f0;border-radius:13px;background:white;color:#64748b;font-size:16px;font-weight:600;cursor:pointer;">Cancel</button>
      <button id="evSaveBtn" style="flex:2;padding:14px;border:none;border-radius:13px;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;font-size:16px;font-weight:700;cursor:pointer;">${isEdit ? 'Save Changes' : 'Create Event'}</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  function _closeEditor() {
    overlay.remove();
    sheet.remove();
  }

  sheet.querySelector('#evCloseBtn').onclick  = _closeEditor;
  sheet.querySelector('#evCancelBtn').onclick = _closeEditor;

  // ── Recipe / Section list ──
  const recipeList = sheet.querySelector('#evRecipeList');
  const fcDiv      = sheet.querySelector('#evFoodCost');

  function _addSection(title = '') {
    const sec = document.createElement('div');
    sec.dataset.type = 'section';
    sec.style.cssText = 'display:flex;align-items:center;gap:8px;margin:10px 0 6px;';
    sec.innerHTML = `
      <input type="text" placeholder="Section title… (e.g. Antipasti, Speech, Dessert)"
        value="${title.replace(/"/g,'&quot;')}"
        style="flex:1;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#6366f1;font-weight:700;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:10px;padding:9px 12px;outline:none;-webkit-appearance:none;box-sizing:border-box;">
      <button style="width:30px;height:30px;flex-shrink:0;border:none;background:#fff0f0;border-radius:8px;color:#f87171;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>`;
    sec.querySelector('button').onclick = () => sec.remove();
    recipeList.appendChild(sec);
  }

  function _addRecipeRow(d = {}) {
    const row = document.createElement('div');
    row.dataset.type = 'recipe';
    row.style.cssText = 'margin-bottom:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 11px;';

    const RI = `width:100%;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1e3a5f;background:white;border:1.5px solid #e2e8f0;border-radius:9px;padding:10px 11px;outline:none;-webkit-appearance:none;box-sizing:border-box;`;

    row.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 64px 30px;gap:7px;align-items:center;margin-bottom:7px;">
        <input type="text" placeholder="Recipe name…" class="ev-rec-name"
          value="${(d.recipe_title||d.name||'').replace(/"/g,'&quot;')}"
          style="${RI}" autocomplete="off">
        <input type="number" placeholder="Pax" class="ev-rec-portions" min="0"
          value="${d.portions||d.qty||''}"
          style="${RI}text-align:center;">
        <button class="ev-rec-del" style="width:30px;height:30px;border:none;background:#fff0f0;border-radius:8px;color:#f87171;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
      </div>
      <div>
        <input type="text" placeholder="Note (e.g. plated, salsare in busta, servire freddo…)" class="ev-rec-note"
          value="${(d.note||'').replace(/"/g,'&quot;')}"
          style="${RI}color:#64748b;">
      </div>`;

    row.querySelector('.ev-rec-del').onclick = () => { row.remove(); _calcFoodCost(); };

    // Autocomplete ricette — custom dropdown iOS-safe
    const nameInput = row.querySelector('.ev-rec-name');
    const dropdown  = document.createElement('div');
    dropdown.style.cssText = 'position:absolute;left:0;right:0;top:calc(100% + 2px);z-index:9999;background:white;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(30,58,95,0.13);max-height:180px;overflow-y:auto;display:none;';
    nameInput.parentNode.style.position = 'relative';
    nameInput.parentNode.appendChild(dropdown);

    let _ac = null;
    let _recipeId = d.recipe_id || null;
    let _recipeFc = d.food_cost  || null;
    row._getRecipeId = () => _recipeId;
    row._getFoodCost = () => _recipeFc;

    function _selectRecipe(title, id, fc) {
      nameInput.value = title;
      _recipeId = id; _recipeFc = fc;
      nameInput.style.borderColor = '#10b981';
      nameInput.style.background  = '#f0fdf4';
      dropdown.style.display = 'none';
      _calcFoodCost();
    }

    nameInput.addEventListener('input', () => {
      _recipeId = null; _recipeFc = null;
      nameInput.style.borderColor = '#e2e8f0';
      nameInput.style.background  = '';
      clearTimeout(_ac);
      const q = nameInput.value.trim();
      if (q.length < 2) { dropdown.style.display = 'none'; return; }
      _ac = setTimeout(async () => {
        const client = window.supa || window.supabaseClient;
        const { data } = await client.from('recipes').select('id,title,menu_group,food_cost_pct').ilike('title',`%${q}%`).order('title').limit(10);
        if (!data || !data.length) { dropdown.style.display = 'none'; return; }
        dropdown.innerHTML = data.map((r,i) => `
          <div class="ev-ac-item" data-i="${i}"
            style="padding:10px 13px;font-size:15px;color:#1e3a5f;cursor:pointer;border-bottom:0.5px solid #f1f5f9;-webkit-user-select:none;user-select:none;">
            <span style="font-weight:600;">${r.title}</span>
            ${r.menu_group ? `<span style="font-size:12px;color:#94a3b8;margin-left:6px;">${r.menu_group}</span>` : ''}
          </div>`).join('');
        dropdown.style.display = 'block';
        dropdown.querySelectorAll('.ev-ac-item').forEach((item, i) => {
          const r = data[i];
          item.addEventListener('mousedown', e => { e.preventDefault(); _selectRecipe(r.title, r.id, r.food_cost_pct||null); });
          item.addEventListener('touchend',  e => { e.preventDefault(); _selectRecipe(r.title, r.id, r.food_cost_pct||null); });
          item.addEventListener('touchstart', () => { item.style.background = '#f0f9ff'; }, { passive: true });
        });
      }, 220);
    });
    nameInput.addEventListener('blur', () => { setTimeout(() => { dropdown.style.display = 'none'; }, 200); });

    recipeList.appendChild(row);
  }

  function _calcFoodCost() {
    let total = 0; let hasAny = false;
    recipeList.querySelectorAll('[data-type="recipe"]').forEach(row => {
      const fc  = row._getFoodCost ? row._getFoodCost() : null;
      const pax = parseFloat(row.querySelector('.ev-rec-portions')?.value) || 0;
      if (fc && pax) { total += (fc / 100) * pax; hasAny = true; }
    });
    fcDiv.style.display = hasAny ? 'block' : 'none';
    if (hasAny) fcDiv.textContent = `Estimated Food Cost: $${total.toFixed(2)}`;
  }

  // Popola ricette esistenti (supporta sezioni e ricette miste)
  const existing = Array.isArray(ev?.event_recipes) ? ev.event_recipes : [];
  existing.forEach(item => {
    if (item.type === 'section') _addSection(item.title || '');
    else _addRecipeRow(item);
  });
  if (!existing.length) _addRecipeRow();

  sheet.querySelector('#evAddRecipe').onclick  = () => _addRecipeRow();
  sheet.querySelector('#evAddSection').onclick = () => _addSection();

  // ── Save ──
  sheet.querySelector('#evSaveBtn').onclick = async () => {
    const name = sheet.querySelector('#evName').value.trim();
    if (!name) { alert('Event name required'); return; }
    const date = sheet.querySelector('#evDate').value;
    if (!date) { alert('Date required'); return; }

    const locSel    = sheet.querySelector('#evLocation').value;
    const locCustom = sheet.querySelector('#evLocationCustom').value.trim();
    const location  = locSel === '__custom__' ? locCustom : locSel;

    // Raccoglie ricette E sezioni in ordine
    const event_recipes = [];
    recipeList.childNodes.forEach(node => {
      if (!node.dataset) return;
      if (node.dataset.type === 'section') {
        const t = node.querySelector('input')?.value.trim() || '';
        if (t) event_recipes.push({ type: 'section', title: t });
      } else if (node.dataset.type === 'recipe') {
        const title = node.querySelector('.ev-rec-name')?.value.trim() || '';
        if (title) event_recipes.push({
          type: 'recipe',
          recipe_id:    node._getRecipeId ? node._getRecipeId() : null,
          recipe_title: title,
          portions:     parseInt(node.querySelector('.ev-rec-portions')?.value) || null,
          note:         node.querySelector('.ev-rec-note')?.value.trim() || '',
          food_cost:    node._getFoodCost ? node._getFoodCost() : null
        });
      }
    });

    const payload = {
      name,
      event_date:    date,
      event_time:    sheet.querySelector('#evTime').value || null,
      location,
      room_name:     location,
      guest_count:   parseInt(sheet.querySelector('#evGuests').value) || null,
      service_style: sheet.querySelector('#evService').value || null,
      status:        sheet.querySelector('#evStatus').value || 'confirmed',
      notes:         sheet.querySelector('#evNotes').value.trim() || null,
      chef_notes:    sheet.querySelector('#evChefNotes').value.trim() || null,
      event_recipes,
      source:        'manual',
      updated_at:    new Date().toISOString()
    };

    const btn = sheet.querySelector('#evSaveBtn');
    btn.textContent = 'Saving…'; btn.disabled = true;
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
      _closeEditor();
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
  const deleteBtn = sheet.querySelector('#evDeleteBtn');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${ev.name}"?`)) return;
      try {
        const client = window.supa || window.supabaseClient;
        const { error } = await client.from('events').delete().eq('id', ev.id);
        if (error) throw error;
        _closeEditor();
        await _calLoad();
        if (typeof loadUpcomingDemand === 'function') loadUpcomingDemand();
        if (typeof showToast === 'function') showToast('Event deleted');
      } catch(e) { alert('Error: ' + e.message); }
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
