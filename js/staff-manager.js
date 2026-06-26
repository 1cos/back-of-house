// staff-manager.js — Brigade Staff & Stazioni Manager
// Admin only — gestione profili brigata e assegnazioni stazioni

const STAFF_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const STAFF_DAYS_IT = ['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
const STAFF_STATIONS_LIST = [
  'Oven Station','Sauté Station','Pasta Station','Salad Station',
  'Fresh Pasta Station','Saucier Station','Coordinator Station',
  'Pastry Station','Plating Station','Table Side','Grill & Features','Dish Crew'
];

function openStaffManager() {
  hideAdminMenu();
  let overlay = document.getElementById('staffManagerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'staffManagerOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:80;background:#f0f4f8;overflow-y:auto;-webkit-overflow-scrolling:touch;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = _staffManagerShell();
  overlay.classList.remove('hidden');
  _loadStaffList();
}

function _staffManagerShell() {
  return `
    <div style="max-width:480px;margin:0 auto;padding:0 0 80px;">
      <!-- Header -->
      <div style="position:sticky;top:0;z-index:10;background:#f0f4f8;padding:16px 16px 10px;display:flex;align-items:center;gap:10px;border-bottom:0.5px solid #e2e8f0;">
        <button onclick="closeStaffManager()" style="width:36px;height:36px;border-radius:50%;border:none;background:white;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.1);cursor:pointer;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e3a5f" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <div>
          <div style="font-size:17px;font-weight:700;color:#1e3a5f;">Staff & Stazioni</div>
          <div style="font-size:11px;color:#94a3b8;">Gestione brigata — solo admin</div>
        </div>
        <button onclick="_showAddStaffModal()" style="margin-left:auto;padding:7px 14px;border-radius:20px;border:none;background:#1e3a5f;color:white;font-size:12px;font-weight:600;cursor:pointer;">+ Aggiungi</button>
      </div>

      <!-- Lista -->
      <div id="staffList" style="padding:12px 12px 0;">
        <div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">${tr('loading')}...</div>
      </div>
    </div>

    <!-- Modal editor -->
    <div id="staffEditorModal" style="display:none;position:fixed;inset:0;z-index:90;background:rgba(15,23,42,0.5);" onclick="if(event.target===this)_closeStaffEditor()">
      <div id="staffEditorContent" style="position:absolute;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;background:white;border-radius:24px 24px 0 0;padding:20px 16px 40px;max-height:90vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">
      </div>
    </div>
  `;
}

async function _loadStaffList() {
  const { supabase } = window;
  const container = document.getElementById('staffList');
  if (!container) return;

  try {
    const { data: profiles, error } = await supabase
      .from('staff_profiles')
      .select('*')
      .eq('active', true)
      .order('name');
    if (error) throw error;

    const { data: stations } = await supabase
      .from('staff_stations')
      .select('*')
      .order('priority');

    const stByName = {};
    (stations || []).forEach(s => {
      if (!stByName[s.staff_name]) stByName[s.staff_name] = [];
      stByName[s.staff_name].push(s);
    });

    if (!profiles || profiles.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">'+tr('adminNoProfile')+'</div>';
      return;
    }

    container.innerHTML = profiles.map(p => {
      const sts = stByName[p.name] || [];
      const shiftLabel = p.shift_preference === 'morning' ? '🌅 Mattina' : p.shift_preference === 'evening' ? '🌆 Sera' : '🌅🌆 Entrambi';
      const offStr = (p.off_days || []).map(d => STAFF_DAYS_IT[STAFF_DAYS.indexOf(d)]).filter(Boolean).join(', ');
      const stationPills = sts.slice(0,4).map(s =>
        `<span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600;background:${s.priority===1?'#dbeafe':s.priority===2?'#f1f5f9':'#fef9c3'};color:${s.priority===1?'#1e40af':s.priority===2?'#475569':'#854d0e'};margin:2px 2px 0 0;">${s.station.replace(' Station','')}</span>`
      ).join('') + (sts.length > 4 ? `<span style="font-size:10px;color:#94a3b8;"> +${sts.length-4}</span>` : '');

      return `
        <div onclick="_openStaffEditor('${p.name}')" style="background:white;border-radius:14px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 4px rgba(30,58,95,0.07);cursor:pointer;border:0.5px solid #e2e8f0;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-size:14px;font-weight:700;color:#1e3a5f;">${p.name}</div>
              <div style="font-size:11px;color:#64748b;margin-top:1px;">${shiftLabel} · ${p.max_days_per_week}gg/sett${p.is_double_shift?' · 🔄 Doppio':''}${offStr?' · Off: '+offStr:''}</div>
              ${p.notes ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px;">${p.notes}</div>` : ''}
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div style="margin-top:8px;">${stationPills || '<span style="font-size:10px;color:#94a3b8;">'+tr('adminNoStation')+'</span>'}</div>
        </div>
      `;
    }).join('');

  } catch(e) {
    container.innerHTML = `<div style="padding:20px;color:#ef4444;font-size:13px;">${tr('errorPrefix')}${e.message}</div>`;
  }
}

async function _openStaffEditor(name) {
  const modal = document.getElementById('staffEditorModal');
  const content = document.getElementById('staffEditorContent');
  if (!modal || !content) return;

  content.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">'+tr('loading')+'...</div>';
  modal.style.display = 'block';

  const { supabase } = window;
  const { data: profile } = await supabase.from('staff_profiles').select('*').eq('name', name).single();
  const { data: stations } = await supabase.from('staff_stations').select('*').eq('staff_name', name).order('priority');

  if (!profile) { content.innerHTML = '<div style="padding:20px;color:#ef4444;">Profilo non trovato</div>'; return; }

  const sts = stations || [];
  const dayCheckboxes = STAFF_DAYS.map((d, i) => {
    const isOff = (profile.off_days||[]).includes(d);
    const noEve = (profile.no_evening_days||[]).includes(d);
    const onlyD = (profile.only_days||[]).length > 0 && !(profile.only_days||[]).includes(d);
    return `
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;background:#f8fafc;margin-bottom:4px;">
        <span style="font-size:12px;font-weight:600;color:#1e3a5f;width:70px;">${STAFF_DAYS_IT[i]}</span>
        <label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#ef4444;">
          <input type="checkbox" id="off_${d}" ${isOff?'checked':''} onchange="_updateDayConstraint('${name}','${d}')"> Off
        </label>
        <label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#f59e0b;">
          <input type="checkbox" id="noeve_${d}" ${noEve?'checked':''} onchange="_updateDayConstraint('${name}','${d}')"> No sera
        </label>
      </div>
    `;
  }).join('');

  const stationRows = sts.map(s => `
    <div id="strow_${s.id}" style="display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:8px;background:#f8fafc;margin-bottom:4px;">
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:600;color:#1e3a5f;">${s.station.replace(' Station','')}</div>
        <div style="font-size:10px;color:#94a3b8;">${s.shift==='morning'?'🌅 Mattina':s.shift==='evening'?'🌆 Sera':'🌅🌆 Entrambi'}</div>
      </div>
      <select onchange="_updateStationPriority(${s.id}, this.value)" style="font-size:11px;border:0.5px solid #e2e8f0;border-radius:6px;padding:3px 6px;background:white;color:#1e3a5f;">
        <option value="1" ${s.priority===1?'selected':''}>⭐ Preferita</option>
        <option value="2" ${s.priority===2?'selected':''}>✓ Sa fare</option>
        <option value="3" ${s.priority===3?'selected':''}>🆘 Emergenza</option>
      </select>
      <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:#059669;">
        <input type="checkbox" ${s.is_default?'checked':''} onchange="_updateStationDefault(${s.id}, this.checked, '${name}', '${s.shift}')"> Default
      </label>
      <button onclick="_removeStation(${s.id},'${name}')" style="width:24px;height:24px;border-radius:50%;border:none;background:#fee2e2;color:#ef4444;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>
    </div>
  `).join('');

  const availableStations = STAFF_STATIONS_LIST.filter(st => !sts.some(s => s.station === st && s.shift === 'both'));

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <button onclick="_closeStaffEditor()" style="width:32px;height:32px;border-radius:50%;border:none;background:#f1f5f9;cursor:pointer;display:flex;align-items:center;justify-content:center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e3a5f" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="font-size:16px;font-weight:700;color:#1e3a5f;">${profile.name}</div>
    </div>

    <!-- Preferenza turno + giorni -->
    <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">Profilo</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <select id="shiftPref_${name}" onchange="_updateShiftPref('${name}', this.value)" style="flex:1;font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:8px;background:white;color:#1e3a5f;">
        <option value="morning" ${profile.shift_preference==='morning'?'selected':''}>🌅 Mattina</option>
        <option value="evening" ${profile.shift_preference==='evening'?'selected':''}>🌆 Sera</option>
        <option value="both" ${profile.shift_preference==='both'?'selected':''}>🌅🌆 Entrambi</option>
      </select>
      <select id="maxDays_${name}" onchange="_updateMaxDays('${name}', this.value)" style="width:90px;font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:8px;background:white;color:#1e3a5f;">
        ${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${profile.max_days_per_week===n?'selected':''}>${n} giorni</option>`).join('')}
      </select>
    </div>

    <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">Disponibilità giorni</div>
    ${dayCheckboxes}

    <div style="display:flex;align-items:center;gap:8px;margin:8px 0 14px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#1e3a5f;">
        <input type="checkbox" id="dblShift_${name}" ${profile.is_double_shift?'checked':''} onchange="_updateDoubleShift('${name}', this.checked)">
        Doppio turno (mattina + sera stesso giorno)
      </label>
    </div>

    <!-- Note -->
    <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">Note</div>
    <textarea id="notes_${name}" placeholder="Note operative..." style="width:100%;font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:8px;resize:none;height:52px;color:#1e3a5f;font-family:inherit;" onblur="_updateNotes('${name}', this.value)">${profile.notes||''}</textarea>

    <!-- Stazioni -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 8px;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;">Stazioni</div>
      <button onclick="_showAddStationForm('${name}')" style="padding:5px 12px;border-radius:14px;border:none;background:#1e3a5f;color:white;font-size:11px;font-weight:600;cursor:pointer;">+ Aggiungi</button>
    </div>
    <div id="stationList_${name}">${stationRows || '<div style="font-size:12px;color:#94a3b8;padding:8px;">'+tr('adminNoStationAssigned')+'</div>'}</div>

    <!-- Aggiungi stazione form (nascosto) -->
    <div id="addStationForm_${name}" style="display:none;background:#f8fafc;border-radius:10px;padding:12px;margin-top:8px;border:0.5px dashed #cbd5e1;">
      <div style="font-size:11px;font-weight:600;color:#1e3a5f;margin-bottom:8px;">Nuova stazione</div>
      <select id="newStation_${name}" style="width:100%;font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:8px;background:white;color:#1e3a5f;margin-bottom:6px;">
        ${STAFF_STATIONS_LIST.map(st=>`<option value="${st}">${st}</option>`).join('')}
      </select>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <select id="newShift_${name}" style="flex:1;font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:6px;background:white;color:#1e3a5f;">
          <option value="morning">🌅 Mattina</option>
          <option value="evening">🌆 Sera</option>
          <option value="both">🌅🌆 Entrambi</option>
        </select>
        <select id="newPriority_${name}" style="flex:1;font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:6px;background:white;color:#1e3a5f;">
          <option value="1">⭐ Preferita</option>
          <option value="2">✓ Sa fare</option>
          <option value="3">🆘 Emergenza</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;">
        <button onclick="_saveNewStation('${name}')" style="flex:1;padding:8px;border-radius:8px;border:none;background:#1e3a5f;color:white;font-size:12px;font-weight:600;cursor:pointer;">Salva</button>
        <button onclick="document.getElementById('addStationForm_${name}').style.display='none'" style="padding:8px 14px;border-radius:8px;border:0.5px solid #e2e8f0;background:white;color:#64748b;font-size:12px;cursor:pointer;">Annulla</button>
      </div>
    </div>

    <!-- Disattiva profilo -->
    <div style="margin-top:24px;padding-top:16px;border-top:0.5px solid #f1f5f9;">
      <button onclick="_deactivateStaff('${name}')" style="width:100%;padding:10px;border-radius:10px;border:0.5px solid #fecaca;background:#fff5f5;color:#ef4444;font-size:12px;font-weight:600;cursor:pointer;">Disattiva ${name}</button>
    </div>
  `;
}

function _closeStaffEditor() {
  const modal = document.getElementById('staffEditorModal');
  if (modal) modal.style.display = 'none';
  _loadStaffList();
}

function closeStaffManager() {
  const overlay = document.getElementById('staffManagerOverlay');
  if (overlay) overlay.remove();
}

function _showAddStationForm(name) {
  const form = document.getElementById(`addStationForm_${name}`);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function _saveNewStation(name) {
  const { supabase } = window;
  const station = document.getElementById(`newStation_${name}`)?.value;
  const shift = document.getElementById(`newShift_${name}`)?.value;
  const priority = parseInt(document.getElementById(`newPriority_${name}`)?.value);
  if (!station || !shift) return;

  const { error } = await supabase.from('staff_stations').insert({
    staff_name: name, station, shift, priority, is_default: false
  });
  if (error && !error.message.includes('unique')) {
    alert(tr('errorPrefix') + error.message); return;
  }
  _openStaffEditor(name);
}

async function _removeStation(id, name) {
  if (!confirm(tr('adminRemoveStation'))) return;
  const { supabase } = window;
  await supabase.from('staff_stations').delete().eq('id', id);
  _openStaffEditor(name);
}

async function _updateStationPriority(id, priority) {
  const { supabase } = window;
  await supabase.from('staff_stations').update({ priority: parseInt(priority) }).eq('id', id);
}

async function _updateStationDefault(id, isDefault, name, shift) {
  const { supabase } = window;
  if (isDefault) {
    await supabase.from('staff_stations').update({ is_default: false }).eq('staff_name', name).eq('shift', shift);
  }
  await supabase.from('staff_stations').update({ is_default: isDefault }).eq('id', id);
}

async function _updateDayConstraint(name, day) {
  const { supabase } = window;
  const profile = (await supabase.from('staff_profiles').select('off_days,no_evening_days,only_days').eq('name', name).single()).data;
  if (!profile) return;

  const isOff = document.getElementById(`off_${day}`)?.checked;
  const noEve = document.getElementById(`noeve_${day}`)?.checked;

  let offDays = [...(profile.off_days || [])];
  let noEveDays = [...(profile.no_evening_days || [])];

  if (isOff) { if (!offDays.includes(day)) offDays.push(day); }
  else { offDays = offDays.filter(d => d !== day); }

  if (noEve) { if (!noEveDays.includes(day)) noEveDays.push(day); }
  else { noEveDays = noEveDays.filter(d => d !== day); }

  await supabase.from('staff_profiles').update({ off_days: offDays, no_evening_days: noEveDays }).eq('name', name);
}

async function _updateShiftPref(name, val) {
  const { supabase } = window;
  await supabase.from('staff_profiles').update({ shift_preference: val }).eq('name', name);
}

async function _updateMaxDays(name, val) {
  const { supabase } = window;
  await supabase.from('staff_profiles').update({ max_days_per_week: parseInt(val) }).eq('name', name);
}

async function _updateDoubleShift(name, val) {
  const { supabase } = window;
  await supabase.from('staff_profiles').update({ is_double_shift: val }).eq('name', name);
}

async function _updateNotes(name, val) {
  const { supabase } = window;
  await supabase.from('staff_profiles').update({ notes: val }).eq('name', name);
}

async function _deactivateStaff(name) {
  if (!confirm(`Disattivare ${name}? Il profilo verrà nascosto ma non eliminato.`)) return;
  const { supabase } = window;
  await supabase.from('staff_profiles').update({ active: false }).eq('name', name);
  _closeStaffEditor();
}

function _showAddStaffModal() {
  const content = document.getElementById('staffEditorContent');
  const modal = document.getElementById('staffEditorModal');
  if (!content || !modal) return;
  modal.style.display = 'block';
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <button onclick="_closeStaffEditor()" style="width:32px;height:32px;border-radius:50%;border:none;background:#f1f5f9;cursor:pointer;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e3a5f" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="font-size:16px;font-weight:700;color:#1e3a5f;">Nuovo membro</div>
    </div>
    <input id="newStaffName" placeholder="Nome" style="width:100%;font-size:14px;border:0.5px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;color:#1e3a5f;font-family:inherit;">
    <select id="newStaffShift" style="width:100%;font-size:13px;border:0.5px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;background:white;color:#1e3a5f;">
      <option value="morning">🌅 Mattina</option>
      <option value="evening">🌆 Sera</option>
      <option value="both">🌅🌆 Entrambi</option>
    </select>
    <select id="newStaffDays" style="width:100%;font-size:13px;border:0.5px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:16px;background:white;color:#1e3a5f;">
      ${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${n===5?'selected':''}>${n} giorni/settimana</option>`).join('')}
    </select>
    <button onclick="_saveNewStaff()" style="width:100%;padding:12px;border-radius:10px;border:none;background:#1e3a5f;color:white;font-size:14px;font-weight:600;cursor:pointer;">Crea profilo</button>
  `;
}

async function _saveNewStaff() {
  const { supabase } = window;
  const name = document.getElementById('newStaffName')?.value?.trim();
  const shift = document.getElementById('newStaffShift')?.value;
  const days = parseInt(document.getElementById('newStaffDays')?.value);
  if (!name) { alert('Inserisci il nome'); return; }

  const { error } = await supabase.from('staff_profiles').insert({
    name, shift_preference: shift, max_days_per_week: days,
    off_days: [], no_evening_days: [], only_days: [], is_double_shift: false, active: true
  });
  if (error) { alert(tr('errorPrefix') + error.message); return; }
  _openStaffEditor(name);
}
