// ── ADMIN TEAM ──
// Gestione utenti: aggiungi cuoco, modifica stazione/PIN/lingua, disattiva.
// Chiamato da: menu Admin → 👤 Utenti → openUserManager()

const TEAM_STATIONS = ['Oven Station','Pasta Station','Plating Station','Salad Station','Freezer'];
const TEAM_LANGS    = [{v:'en',l:'English'},{v:'it',l:'Italiano'},{v:'es',l:'Español'}];
const TEAM_ROLES    = [{v:'staff',l:'Staff'},{v:'admin',l:'Admin'}];

window.openUserManager = async function() {
  if (!isAdmin()) return;

  const modal = document.createElement('div');
  modal.id = 'teamModal';
  modal.className = 'fixed inset-0 z-[65] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;">
      <button onclick="this.closest('#teamModal').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:600;color:#1e293b;">👥 Team</div>
        <div style="font-size:11px;color:#94a3b8;">Gestione cuochi e stazioni</div>
      </div>
      <button onclick="openUserEditor(null)" style="height:32px;padding:0 14px;border-radius:10px;background:#1e293b;color:white;font-size:12px;font-weight:600;border:none;cursor:pointer;">+ Aggiungi</button>
    </div>
    <div style="padding:16px;max-width:520px;width:100%;margin:0 auto;">
      <div id="teamList"><div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Caricamento...</div></div>
    </div>`;
  document.body.appendChild(modal);
  await teamLoad();
};

async function teamLoad() {
  const list = document.getElementById('teamList');
  if (!list) return;
  try {
    const sb = window.supabaseClient;
    const { data, error } = await sb.from('users').select('id,name,role,default_station,lang,active,is_admin').order('name');
    if (error) throw error;
    teamRender(data || []);
  } catch(e) {
    if (list) list.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#991b1b;font-size:13px;">✗ ${e.message}</div>`;
  }
}

function teamRender(users) {
  const list = document.getElementById('teamList');
  if (!list) return;

  const active   = users.filter(u => u.active !== false);
  const inactive = users.filter(u => u.active === false);

  function userCard(u) {
    const stationColor = u.default_station ? '#1e3a5f' : '#94a3b8';
    const stationText  = u.default_station || tr('adminNoStation');
    const roleTag = u.is_admin
      ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:20px;font-weight:600;">Admin</span>`
      : `<span style="font-size:10px;background:#f1f5f9;color:#64748b;padding:2px 7px;border-radius:20px;">Staff</span>`;
    const langFlag = {en:'🇺🇸',it:'🇮🇹',es:'🇪🇸'}[u.lang] || '🌐';
    return `
      <div style="border:1px solid #f1f5f9;border-radius:14px;padding:13px 14px;margin-bottom:8px;background:${u.active===false?'#fafafa':'white'};">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:40px;height:40px;border-radius:50%;background:#3B82F6;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:white;flex-shrink:0;">
            ${(u.name||'?')[0].toUpperCase()}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:14px;font-weight:600;color:#1e293b;">${escHtml(u.name||'')}</span>
              ${roleTag}
              <span style="font-size:13px;">${langFlag}</span>
              ${u.active===false?'<span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:20px;">Inattivo</span>':''}
            </div>
            <div style="font-size:12px;color:${stationColor};margin-top:2px;">📍 ${stationText}</div>
          </div>
          <button onclick="openUserEditor(${u.id})"
            style="height:32px;padding:0 12px;border-radius:9px;background:rgba(59,130,246,0.08);color:#1d4ed8;border:none;font-size:12px;font-weight:500;cursor:pointer;flex-shrink:0;">
            Modifica
          </button>
        </div>
      </div>`;
  }

  let html = active.map(userCard).join('');
  if (inactive.length) {
    html += `<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin:16px 0 8px;">Inattivi</div>`;
    html += inactive.map(userCard).join('');
  }
  list.innerHTML = html || '<div style="text-align:center;padding:32px 0;color:#94a3b8;font-size:13px;">'+tr('adminNoUser')+'</div>';
}

window.openUserEditor = async function(userId) {
  const sb = window.supabaseClient;
  let user = null;

  if (userId) {
    const { data } = await sb.from('users').select('*').eq('id', userId).single();
    user = data;
  }

  const isNew = !user;
  const sheet = document.createElement('div');
  sheet.id = 'teamEditorSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;justify-content:center;';

  sheet.innerHTML = `
    <div style="background:white;border-radius:24px 24px 0 0;padding:20px;width:100%;max-width:480px;margin:0 auto;max-height:88vh;overflow-y:auto;">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:16px;">
        ${isNew ? '➕ Nuovo cuoco' : '✏️ '+tr('adminEdit')+' ' + escHtml(user.name||'')}
      </div>

      <!-- Nome -->
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Nome</div>
        <input id="tuName" value="${escAttr(user?.name||'')}" placeholder="es. Rachel"
          style="width:100%;height:44px;padding:0 12px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:14px;outline:none;box-sizing:border-box;">
      </div>

      <!-- PIN -->
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">
          PIN (4 cifre)${!isNew?' — lascia vuoto per non cambiare':''}
        </div>
        <input id="tuPin" type="password" inputmode="numeric" maxlength="4"
          placeholder="${isNew?'0000':'••••'}"
          style="width:100%;height:44px;padding:0 12px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:18px;letter-spacing:6px;outline:none;box-sizing:border-box;">
      </div>

      <!-- Stazione -->
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Stazione default</div>
        <select id="tuStation" style="width:100%;height:44px;padding:0 12px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:14px;background:white;outline:none;box-sizing:border-box;">
          <option value="">— Nessuna stazione —</option>
          ${TEAM_STATIONS.map(s=>`<option value="${s}" ${user?.default_station===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>

      <!-- Lingua -->
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Lingua</div>
        <div style="display:flex;gap:8px;">
          ${TEAM_LANGS.map(l=>`
            <button id="tuLang-${l.v}" onclick="teamSelectLang('${l.v}')"
              style="flex:1;height:44px;border-radius:12px;border:1.5px solid ${(user?.lang||'en')===l.v?'#1e3a5f':'#e2e8f0'};
                background:${(user?.lang||'en')===l.v?'#1e3a5f':'white'};
                color:${(user?.lang||'en')===l.v?'white':'#64748b'};
                font-size:13px;font-weight:500;cursor:pointer;">
              ${l.l}
            </button>`).join('')}
        </div>
      </div>

      <!-- Ruolo -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Ruolo</div>
        <div style="display:flex;gap:8px;">
          ${TEAM_ROLES.map(r=>`
            <button id="tuRole-${r.v}" onclick="teamSelectRole('${r.v}')"
              style="flex:1;height:44px;border-radius:12px;border:1.5px solid ${(user?.role||'staff')===r.v?'#1e3a5f':'#e2e8f0'};
                background:${(user?.role||'staff')===r.v?'#1e3a5f':'white'};
                color:${(user?.role||'staff')===r.v?'white':'#64748b'};
                font-size:13px;font-weight:500;cursor:pointer;">
              ${r.l}
            </button>`).join('')}
        </div>
      </div>

      <!-- Bottoni -->
      <div style="display:flex;gap:8px;">
        <button onclick="document.getElementById('teamEditorSheet').remove()"
          style="flex:1;height:48px;border-radius:16px;background:#f1f5f9;color:#64748b;border:none;font-size:14px;font-weight:500;cursor:pointer;">
          Annulla
        </button>
        <button id="tuSaveBtn" onclick="teamSaveUser(${userId||'null'})"
          style="flex:2;height:48px;border-radius:16px;background:#1e293b;color:white;border:none;font-size:14px;font-weight:600;cursor:pointer;">
          ${isNew ? 'Crea cuoco' : tr('adminSaveChanges')}
        </button>
      </div>

      ${!isNew ? `
      <div style="margin-top:12px;text-align:center;">
        <button onclick="teamToggleActive(${userId}, ${user?.active !== false})"
          style="height:40px;padding:0 20px;border-radius:12px;background:rgba(239,68,68,0.06);color:#991b1b;border:1px solid rgba(239,68,68,0.15);font-size:13px;cursor:pointer;">
          ${user?.active === false ? '✓ Riattiva cuoco' : '✗ Disattiva cuoco'}
        </button>
      </div>` : ''}
    </div>`;

  // Store selected lang/role in closure
  window._tuLang = user?.lang || 'en';
  window._tuRole = user?.role || 'staff';

  sheet.addEventListener('click', e => { if(e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
};

window.teamSelectLang = function(lang) {
  window._tuLang = lang;
  TEAM_LANGS.forEach(l => {
    const btn = document.getElementById('tuLang-' + l.v);
    if (!btn) return;
    const active = l.v === lang;
    btn.style.background = active ? '#1e3a5f' : 'white';
    btn.style.color = active ? 'white' : '#64748b';
    btn.style.borderColor = active ? '#1e3a5f' : '#e2e8f0';
  });
};

window.teamSelectRole = function(role) {
  window._tuRole = role;
  TEAM_ROLES.forEach(r => {
    const btn = document.getElementById('tuRole-' + r.v);
    if (!btn) return;
    const active = r.v === role;
    btn.style.background = active ? '#1e3a5f' : 'white';
    btn.style.color = active ? 'white' : '#64748b';
    btn.style.borderColor = active ? '#1e3a5f' : '#e2e8f0';
  });
};

window.teamSaveUser = async function(userId) {
  const sb = window.supabaseClient;
  const btn = document.getElementById('tuSaveBtn');
  const name = document.getElementById('tuName')?.value.trim();
  const pin  = document.getElementById('tuPin')?.value.trim();
  const station = document.getElementById('tuStation')?.value || null;
  const lang = window._tuLang || 'en';
  const role = window._tuRole || 'staff';
  const isAdmin_ = role === 'admin';

  if (!name) { showScToast('Nome obbligatorio'); return; }
  if (!userId && (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin))) {
    showScToast('PIN deve essere 4 cifre'); return;
  }
  if (pin && (pin.length !== 4 || !/^\d{4}$/.test(pin))) {
    showScToast('PIN deve essere 4 cifre'); return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...'; }

  try {
    if (!userId) {
      // Nuovo utente
      const payload = { name, role, lang, default_station: station, is_admin: isAdmin_, active: true, pin };
      const { error } = await sb.from('users').insert(payload);
      if (error) throw error;
    } else {
      // Modifica esistente
      const payload = { name, role, lang, default_station: station, is_admin: isAdmin_ };
      if (pin) payload.pin = pin;
      const { error } = await sb.from('users').update(payload).eq('id', userId);
      if (error) throw error;
    }
    document.getElementById('teamEditorSheet')?.remove();
    showScToast('✓ ' + (userId ? 'Modifiche salvate' : 'Cuoco creato'));
    await teamLoad();
  } catch(e) {
    showScToast(tr('errorPrefix') + e.message);
    if (btn) { btn.disabled = false; btn.textContent = userId ? tr('adminSaveChanges') : 'Crea cuoco'; }
  }
};

window.teamToggleActive = async function(userId, currentlyActive) {
  const sb = window.supabaseClient;
  const newState = !currentlyActive;
  try {
    const { error } = await sb.from('users').update({ active: newState }).eq('id', userId);
    if (error) throw error;
    document.getElementById('teamEditorSheet')?.remove();
    showScToast(newState ? '✓ Cuoco riattivato' : '✓ Cuoco disattivato');
    await teamLoad();
  } catch(e) {
    showScToast(tr('errorPrefix') + e.message);
  }
};
