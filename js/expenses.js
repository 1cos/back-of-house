// ── EXPENSES MODULE v3 ──
// Fast entry + weekly/monthly budget dashboard.
// Reads/writes public.expenses via Supabase anon client (supa).

(function(){
'use strict';

// ── STATE ──
let _expRows = [];
let _expAllVendors = [];
let _expEditId = null;
let _expNoteOpen = false;

// ── HELPERS ──
function _escH(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function _todayCDT(){
  return new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
}

function _fmtUSD(n){
  return '$' + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
}

function _fmtDateLabel(d){
  if(!d) return '';
  try {
    var dt = new Date(d+'T12:00:00');
    var opts = {month:'short', day:'numeric', timeZone:'America/Chicago'};
    return dt.toLocaleDateString('en-US', opts);
  } catch(e){ return d; }
}

function _fmtDateShort(d){
  if(!d) return '';
  var p = d.split('-');
  return p.length===3 ? p[1]+'/'+p[2] : d;
}

// Week boundaries: Monday→Sunday, CDT
function _weekBounds(){
  var now = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}));
  var dow = now.getDay(); // 0=Sun
  var diffToMon = dow === 0 ? 6 : dow - 1;
  var mon = new Date(now);
  mon.setDate(now.getDate() - diffToMon);
  var sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  var fmt = function(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  return { start: fmt(mon), end: fmt(sun) };
}

function _monthStart(){
  var d = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}));
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01';
}

// ── LOAD VENDORS ──
async function _loadAllVendors(){
  try {
    var results = await Promise.all([
      supa.from('ingredient_vendors').select('vendor').eq('active',true),
      supa.from('expenses').select('vendor')
    ]);
    var set = new Set();
    if(results[0].data) results[0].data.forEach(function(r){ set.add(r.vendor); });
    if(results[1].data) results[1].data.forEach(function(r){ set.add(r.vendor); });
    _expAllVendors = Array.from(set).sort();
  } catch(e){ console.warn('[expenses] vendor load failed', e); }
}

// ── OPEN ──
window.openExpenses = async function(){
  if(typeof hideAdminMenu === 'function') hideAdminMenu();
  _expEditId = null;
  _expNoteOpen = false;

  var vendorP = _loadAllVendors();

  var sheet = document.createElement('div');
  sheet.id = 'expensesSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(15,23,42,0.45);overflow-y:auto;-webkit-overflow-scrolling:touch;';

  sheet.innerHTML =
  '<div style="min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:8px 6px 40px;">' +
    '<div style="background:linear-gradient(160deg,#eff6ff 0%,#dbeafe 60%,#e0f2fe 100%);border-radius:20px;width:100%;max-width:500px;padding:18px 14px 24px;">' +

      // HEADER
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
        '<div style="font-size:17px;font-weight:700;color:#1e3a5f;">💰 Expenses</div>' +
        '<button onclick="document.getElementById(\'expensesSheet\').remove()" style="font-size:22px;background:none;border:none;color:#94a3b8;padding:4px 8px;">✕</button>' +
      '</div>' +

      // FAST ENTRY
      '<div id="expFormCard" style="background:rgba(255,255,255,0.65);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(59,130,246,0.18);border-radius:16px;padding:14px;margin-bottom:12px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
          '<span id="expFormTitle" style="font-size:13px;font-weight:600;color:#1e3a5f;">New Expense</span>' +
          '<button onclick="_expToggleDate()" id="expDateBtn" style="font-size:12px;color:#3b82f6;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:8px;padding:4px 10px;cursor:pointer;font-family:inherit;">Today · <span id="expDateLabel"></span></button>' +
        '</div>' +
        '<input type="date" id="expDate" style="display:none;width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;background:white;color:#1e3a5f;margin-bottom:8px;">' +

        // Vendor dropdown
        '<select id="expVendor" style="width:100%;padding:11px 10px;border:1px solid #e2e8f0;border-radius:12px;font-size:15px;font-family:inherit;background:white;color:#1e3a5f;margin-bottom:8px;-webkit-appearance:none;appearance:none;background-image:url(\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%228%22><path d=%22M1 1l5 5 5-5%22 stroke=%22%2394a3b8%22 stroke-width=%221.5%22 fill=%22none%22/></svg>\');background-repeat:no-repeat;background-position:right 12px center;">' +
          '<option value="">Select vendor…</option>' +
        '</select>' +
        '<input type="text" id="expVendorOther" placeholder="Enter vendor name…" style="display:none;width:100%;padding:11px 10px;border:1px solid #e2e8f0;border-radius:12px;font-size:15px;font-family:inherit;background:white;color:#1e3a5f;margin-bottom:8px;">' +

        // Amount
        '<input type="number" id="expAmount" inputmode="decimal" step="0.01" min="0" placeholder="$0.00" style="width:100%;padding:11px 10px;border:1px solid #e2e8f0;border-radius:12px;font-size:18px;font-weight:600;font-family:inherit;background:white;color:#1e3a5f;margin-bottom:8px;text-align:center;">' +

        // Note toggle
        '<div id="expNoteToggle" style="margin-bottom:8px;">' +
          '<button onclick="_expShowNote()" style="font-size:12px;color:#64748b;background:none;border:none;cursor:pointer;padding:2px 0;font-family:inherit;">+ Add note</button>' +
        '</div>' +
        '<input type="text" id="expNotes" placeholder="Invoice #, description…" style="display:none;width:100%;padding:9px 10px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;background:white;color:#1e3a5f;margin-bottom:8px;">' +

        // Buttons
        '<div id="expBtnRow" style="display:flex;gap:8px;">' +
          '<button id="expSaveBtn" onclick="_expSave()" style="flex:1;padding:13px;background:#1e3a5f;color:white;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">Add Expense</button>' +
          '<button id="expCancelBtn" onclick="_expCancelEdit()" style="display:none;padding:13px 18px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '</div>' +
        '<div id="expSaveMsg" style="display:none;text-align:center;font-size:12px;margin-top:6px;padding:6px;border-radius:8px;"></div>' +
      '</div>' +

      // KPI DASHBOARD
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">' +
        '<div style="background:rgba(255,255,255,0.65);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(59,130,246,0.18);border-radius:14px;padding:14px 12px;text-align:center;">' +
          '<div style="font-size:10px;font-weight:700;color:#3b82f6;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:4px;">This Week</div>' +
          '<div id="expWeekTotal" style="font-size:20px;font-weight:800;color:#1e3a5f;">$0.00</div>' +
          '<div id="expWeekCount" style="font-size:10px;color:#94a3b8;margin-top:2px;">0 expenses</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.65);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(59,130,246,0.18);border-radius:14px;padding:14px 12px;text-align:center;">' +
          '<div style="font-size:10px;font-weight:700;color:#3b82f6;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:4px;">This Month</div>' +
          '<div id="expMonthTotal" style="font-size:20px;font-weight:800;color:#1e3a5f;">$0.00</div>' +
          '<div id="expMonthCount" style="font-size:10px;color:#94a3b8;margin-top:2px;">0 expenses</div>' +
        '</div>' +
      '</div>' +

      // HISTORY HEADER
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="font-size:13px;font-weight:600;color:#1e3a5f;">Recent Expenses</span>' +
        '<button onclick="_expToggleFilters()" id="expFilterToggle" style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;font-family:inherit;">Filter & Export ▾</button>' +
      '</div>' +

      // FILTERS (collapsed)
      '<div id="expFilterPanel" style="display:none;background:rgba(255,255,255,0.5);border:0.5px solid rgba(59,130,246,0.12);border-radius:12px;padding:10px 12px;margin-bottom:10px;">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
          '<input type="date" id="expFFrom" style="padding:5px 6px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:inherit;background:white;color:#1e3a5f;" onchange="_expApplyFilters()">' +
          '<span style="font-size:11px;color:#94a3b8;">→</span>' +
          '<input type="date" id="expFTo" style="padding:5px 6px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:inherit;background:white;color:#1e3a5f;" onchange="_expApplyFilters()">' +
          '<select id="expFVendor" style="padding:5px 6px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:inherit;background:white;color:#1e3a5f;max-width:130px;" onchange="_expApplyFilters()">' +
            '<option value="">All Vendors</option>' +
          '</select>' +
          '<button onclick="_expExportCSV()" style="padding:5px 10px;background:rgba(59,130,246,0.08);color:#2563eb;border:1px solid rgba(59,130,246,0.2);border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">CSV ↓</button>' +
        '</div>' +
        '<div id="expFilterSummary" style="font-size:11px;color:#64748b;margin-top:6px;"></div>' +
      '</div>' +

      // LIST
      '<div id="expList" style="display:flex;flex-direction:column;gap:5px;">' +
        '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px;">Loading…</div>' +
      '</div>' +

    '</div>' +
  '</div>';

  sheet.addEventListener('click', function(e){ if(e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);

  // Set date
  var today = _todayCDT();
  document.getElementById('expDate').value = today;
  document.getElementById('expDateLabel').textContent = _fmtDateLabel(today);

  // Vendor change handler
  document.getElementById('expVendor').addEventListener('change', function(){
    var otherField = document.getElementById('expVendorOther');
    if(this.value === '__other__'){
      otherField.style.display = 'block';
      otherField.focus();
    } else {
      otherField.style.display = 'none';
      otherField.value = '';
      // Auto-focus amount after vendor selection
      document.getElementById('expAmount').focus();
    }
  });

  // Date change handler
  document.getElementById('expDate').addEventListener('change', function(){
    var lbl = document.getElementById('expDateLabel');
    var btn = document.getElementById('expDateBtn');
    if(this.value === today){
      btn.innerHTML = 'Today · <span id="expDateLabel">' + _escH(_fmtDateLabel(today)) + '</span>';
    } else {
      btn.innerHTML = '<span id="expDateLabel">' + _escH(_fmtDateLabel(this.value)) + '</span>';
    }
  });

  await vendorP;
  _expPopulateVendorDropdown();

  await _expFetchAll();
};

// ── DATE TOGGLE ──
window._expToggleDate = function(){
  var el = document.getElementById('expDate');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

// ── NOTE TOGGLE ──
window._expShowNote = function(){
  _expNoteOpen = true;
  document.getElementById('expNotes').style.display = 'block';
  document.getElementById('expNoteToggle').style.display = 'none';
  document.getElementById('expNotes').focus();
};

// ── FILTER TOGGLE ──
window._expToggleFilters = function(){
  var p = document.getElementById('expFilterPanel');
  var b = document.getElementById('expFilterToggle');
  if(p.style.display === 'none'){
    p.style.display = 'block';
    b.textContent = 'Filter & Export ▴';
    // Set default filter range if empty
    if(!document.getElementById('expFFrom').value){
      document.getElementById('expFFrom').value = _monthStart();
      document.getElementById('expFTo').value = _todayCDT();
    }
  } else {
    p.style.display = 'none';
    b.textContent = 'Filter & Export ▾';
  }
};

// ── VENDOR DROPDOWN ──
function _expPopulateVendorDropdown(){
  var sel = document.getElementById('expVendor');
  if(!sel) return;
  var current = sel.value;
  var html = '<option value="">Select vendor…</option>';
  _expAllVendors.forEach(function(v){
    html += '<option value="' + _escH(v) + '"' + (v===current?' selected':'') + '>' + _escH(v) + '</option>';
  });
  html += '<option value="__other__">Other vendor…</option>';
  sel.innerHTML = html;
}

// ── EDIT MODE ──
window._expEdit = function(id){
  var row = _expRows.find(function(r){ return r.id === id; });
  if(!row) return;
  _expEditId = id;

  document.getElementById('expDate').value = row.expense_date || '';
  document.getElementById('expDate').style.display = 'block';
  var lbl = document.getElementById('expDateBtn');
  lbl.innerHTML = '<span id="expDateLabel">' + _escH(_fmtDateLabel(row.expense_date)) + '</span>';

  // Set vendor
  var sel = document.getElementById('expVendor');
  var inList = _expAllVendors.indexOf(row.vendor) >= 0;
  if(inList){
    sel.value = row.vendor;
    document.getElementById('expVendorOther').style.display = 'none';
  } else {
    sel.value = '__other__';
    document.getElementById('expVendorOther').style.display = 'block';
    document.getElementById('expVendorOther').value = row.vendor;
  }

  document.getElementById('expAmount').value = Number(row.amount || 0);

  if(row.notes){
    _expShowNote();
    document.getElementById('expNotes').value = row.notes;
  }

  var title = document.getElementById('expFormTitle');
  var btn = document.getElementById('expSaveBtn');
  var cancelBtn = document.getElementById('expCancelBtn');
  var card = document.getElementById('expFormCard');
  if(title) title.textContent = '✏️ Editing';
  if(btn) btn.textContent = 'Save Changes';
  if(cancelBtn) cancelBtn.style.display = 'block';
  if(card) card.style.borderColor = 'rgba(245,158,11,0.4)';
  card.scrollIntoView({behavior:'smooth', block:'start'});
};

window._expCancelEdit = function(){
  _expEditId = null;
  _expNoteOpen = false;
  var today = _todayCDT();
  document.getElementById('expDate').value = today;
  document.getElementById('expDate').style.display = 'none';
  document.getElementById('expDateBtn').innerHTML = 'Today · <span id="expDateLabel">' + _escH(_fmtDateLabel(today)) + '</span>';
  document.getElementById('expVendor').value = '';
  document.getElementById('expVendorOther').style.display = 'none';
  document.getElementById('expVendorOther').value = '';
  document.getElementById('expAmount').value = '';
  document.getElementById('expNotes').value = '';
  document.getElementById('expNotes').style.display = 'none';
  document.getElementById('expNoteToggle').style.display = 'block';

  var title = document.getElementById('expFormTitle');
  var btn = document.getElementById('expSaveBtn');
  var cancelBtn = document.getElementById('expCancelBtn');
  var card = document.getElementById('expFormCard');
  if(title) title.textContent = 'New Expense';
  if(btn){ btn.textContent = 'Add Expense'; btn.disabled = false; }
  if(cancelBtn) cancelBtn.style.display = 'none';
  if(card) card.style.borderColor = 'rgba(59,130,246,0.18)';

  var msgEl = document.getElementById('expSaveMsg');
  if(msgEl) msgEl.style.display = 'none';
};

// ── SAVE ──
window._expSave = async function(){
  var selV = document.getElementById('expVendor');
  var otherV = document.getElementById('expVendorOther');
  var vendor = selV.value === '__other__' ? (otherV.value||'').trim() : selV.value;
  var expDate = document.getElementById('expDate').value;
  var amount = parseFloat(document.getElementById('expAmount').value);
  var notes = (document.getElementById('expNotes').value||'').trim() || null;
  var msgEl = document.getElementById('expSaveMsg');
  var btn = document.getElementById('expSaveBtn');

  if(!expDate){ _expMsg(msgEl,'⚠️ Date is required','#fef3c7','#92400e'); return; }
  if(!vendor){ _expMsg(msgEl,'⚠️ Select a vendor','#fef3c7','#92400e'); return; }
  if(isNaN(amount) || amount < 0){ _expMsg(msgEl,'⚠️ Enter a valid amount','#fef3c7','#92400e'); return; }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if(_expEditId){
      var res = await supa.from('expenses')
        .update({ expense_date: expDate, vendor: vendor, amount: amount, notes: notes })
        .eq('id', _expEditId);
      if(res.error) throw res.error;
      _expMsg(msgEl,'✓ Updated','#dcfce7','#166534');
      _expCancelEdit();
    } else {
      var res2 = await supa.from('expenses').insert({
        expense_date: expDate, vendor: vendor, amount: amount, notes: notes,
        created_by: (window.user && window.user.name) || 'Admin'
      });
      if(res2.error) throw res2.error;
      _expMsg(msgEl,'✓ Added','#dcfce7','#166534');
      // Reset for next fast entry
      document.getElementById('expVendor').value = '';
      document.getElementById('expVendorOther').style.display = 'none';
      document.getElementById('expVendorOther').value = '';
      document.getElementById('expAmount').value = '';
      document.getElementById('expNotes').value = '';
      document.getElementById('expNotes').style.display = 'none';
      document.getElementById('expNoteToggle').style.display = 'block';
      _expNoteOpen = false;
    }
    await _expFetchAll();
  } catch(e){
    console.error('[expenses] save error', e);
    _expMsg(msgEl,'✕ Failed: '+(e.message||'unknown'),'#fee2e2','#991b1b');
  } finally {
    btn.disabled = false;
    btn.textContent = _expEditId ? 'Save Changes' : 'Add Expense';
  }
};

// ── DELETE ──
window._expDelete = async function(id){
  if(!id) return;
  if(!confirm('Delete this expense? This cannot be undone.')) return;
  try {
    var res = await supa.from('expenses').delete().eq('id', id);
    if(res.error) throw res.error;
    if(_expEditId === id) _expCancelEdit();
    _expMsg(document.getElementById('expSaveMsg'),'✓ Deleted','#dcfce7','#166534');
    await _expFetchAll();
  } catch(e){
    console.error('[expenses] delete error', e);
    _expMsg(document.getElementById('expSaveMsg'),'✕ Delete failed','#fee2e2','#991b1b');
  }
};

function _expMsg(el, text, bg, color){
  if(!el) return;
  el.textContent = text;
  el.style.background = bg;
  el.style.color = color;
  el.style.display = 'block';
  setTimeout(function(){ el.style.display = 'none'; }, 2500);
}

// ── DATA FETCH ──
async function _expFetchAll(){
  // Fetch recent expenses for the list (last 60 days or filter)
  var from = document.getElementById('expFFrom');
  var to = document.getElementById('expFTo');
  var vendorF = document.getElementById('expFVendor');
  var filterPanel = document.getElementById('expFilterPanel');
  var filtersActive = filterPanel && filterPanel.style.display !== 'none';

  var q = supa.from('expenses').select('*').order('expense_date',{ascending:false}).order('created_at',{ascending:false});

  if(filtersActive && from && from.value) q = q.gte('expense_date', from.value);
  if(filtersActive && to && to.value) q = q.lte('expense_date', to.value);
  if(filtersActive && vendorF && vendorF.value) q = q.eq('vendor', vendorF.value);
  if(!filtersActive) q = q.limit(50);

  var res = await q;
  _expRows = res.data || [];

  _expRenderList();
  _expPopulateFilterVendor();
  if(filtersActive) _expRenderFilterSummary();

  // KPIs — always independent queries
  await _expUpdateKPIs();
}

async function _expUpdateKPIs(){
  var week = _weekBounds();
  var monthStart = _monthStart();
  var today = _todayCDT();

  var wkRes = await supa.from('expenses').select('amount').gte('expense_date', week.start).lte('expense_date', week.end);
  var wkRows = wkRes.data || [];
  var wkTotal = wkRows.reduce(function(s,r){ return s + Number(r.amount||0); }, 0);
  var el1 = document.getElementById('expWeekTotal');
  var el2 = document.getElementById('expWeekCount');
  if(el1) el1.textContent = _fmtUSD(wkTotal);
  if(el2) el2.textContent = wkRows.length + ' expense' + (wkRows.length!==1?'s':'');

  var moRes = await supa.from('expenses').select('amount').gte('expense_date', monthStart).lte('expense_date', today);
  var moRows = moRes.data || [];
  var moTotal = moRows.reduce(function(s,r){ return s + Number(r.amount||0); }, 0);
  var el3 = document.getElementById('expMonthTotal');
  var el4 = document.getElementById('expMonthCount');
  if(el3) el3.textContent = _fmtUSD(moTotal);
  if(el4) el4.textContent = moRows.length + ' expense' + (moRows.length!==1?'s':'');
}

// ── RENDER LIST ──
function _expRenderList(){
  var el = document.getElementById('expList');
  if(!el) return;
  if(_expRows.length === 0){
    el.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px;">No expenses found.</div>';
    return;
  }
  el.innerHTML = _expRows.map(function(r){
    var noteHtml = r.notes ? '<div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.2;">' + _escH(r.notes) + '</div>' : '';
    var editHL = _expEditId === r.id ? 'border-color:rgba(245,158,11,0.5);' : '';
    return '<div style="background:rgba(255,255,255,0.55);border:0.5px solid rgba(59,130,246,0.1);border-radius:10px;padding:8px 10px;' + editHL + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:5px;">' +
            '<span style="font-size:11px;color:#94a3b8;min-width:36px;">' + _escH(_fmtDateShort(r.expense_date)) + '</span>' +
            '<span style="font-size:13px;font-weight:600;color:#1e3a5f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escH(r.vendor) + '</span>' +
          '</div>' +
          noteHtml +
        '</div>' +
        '<div style="font-size:14px;font-weight:700;color:#1e3a5f;white-space:nowrap;">' + _fmtUSD(r.amount) + '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:4px;">' +
        '<button onclick="_expEdit(\'' + r.id + '\')" style="padding:3px 8px;font-size:10px;color:#64748b;background:rgba(241,245,249,0.8);border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-family:inherit;">Edit</button>' +
        '<button onclick="_expDelete(\'' + r.id + '\')" style="padding:3px 8px;font-size:10px;color:#dc2626;background:rgba(254,226,226,0.4);border:1px solid rgba(220,38,38,0.12);border-radius:6px;cursor:pointer;font-family:inherit;">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _expPopulateFilterVendor(){
  var sel = document.getElementById('expFVendor');
  if(!sel) return;
  var current = sel.value;
  var vendors = [];
  var seen = {};
  _expRows.forEach(function(r){ if(!seen[r.vendor]){ seen[r.vendor]=1; vendors.push(r.vendor); } });
  vendors.sort();
  sel.innerHTML = '<option value="">All Vendors</option>' +
    vendors.map(function(v){ return '<option value="' + _escH(v) + '"' + (v===current?' selected':'') + '>' + _escH(v) + '</option>'; }).join('');
}

function _expRenderFilterSummary(){
  var el = document.getElementById('expFilterSummary');
  if(!el) return;
  var total = _expRows.reduce(function(s,r){ return s + Number(r.amount||0); }, 0);
  el.textContent = _expRows.length + ' expenses · ' + _fmtUSD(total);
}

// ── FILTERS ──
window._expApplyFilters = function(){ _expFetchAll(); };

// ── CSV EXPORT ──
window._expExportCSV = function(){
  if(_expRows.length === 0){
    if(typeof showScToast === 'function') showScToast('No expenses to export');
    return;
  }
  var header = 'Date,Vendor,Amount,Notes,Created By,Created At';
  var rows = _expRows.map(function(r){
    return [
      r.expense_date||'', _csvEsc(r.vendor||''), Number(r.amount||0).toFixed(2),
      _csvEsc(r.notes||''), _csvEsc(r.created_by||''), r.created_at||''
    ].join(',');
  });
  var csv = header + '\n' + rows.join('\n');
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'expenses_' + _todayCDT() + '.csv'; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ a.remove(); URL.revokeObjectURL(url); }, 200);
};

function _csvEsc(s){
  if(!s) return '';
  if(s.indexOf(',')>=0 || s.indexOf('"')>=0 || s.indexOf('\n')>=0)
    return '"' + s.replace(/"/g,'""') + '"';
  return s;
}

// ── HOME QUICK ENTRY ──────────────────────────────────────────────
// Compact expense entry widget on Home, visible 08:00–14:00 CDT.
// Authorized users: admin + Tela (id=3, Kitchen Operation Coordinator).

var _EXP_QUICK_ALLOWED_IDS = [1, 3]; // Max, Tela

function _expQuickAllowed(){
  if(!window.user) return false;
  if(window.user.is_admin || window.user.role === 'admin') return true;
  return _EXP_QUICK_ALLOWED_IDS.indexOf(window.user.id) >= 0;
}

function _expQuickInWindow(){
  var h = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/Chicago',hour:'numeric',hour12:false}));
  var m = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/Chicago',minute:'numeric'}));
  var total = h * 60 + m; // minutes since midnight
  return total >= 480 && total < 840; // 08:00 (480) to 14:00 (840)
}

window.initExpenseQuickEntry = function(){
  var el = document.getElementById('expQuickWidget');
  if(!el) return;

  if(!_expQuickAllowed()){ el.style.display = 'none'; return; }

  // Initial visibility
  _expQuickUpdateVisibility();
  // Re-check every 60s for boundary crossing
  if(!window._expQuickInterval){
    window._expQuickInterval = setInterval(_expQuickUpdateVisibility, 60000);
  }
};

function _expQuickUpdateVisibility(){
  var el = document.getElementById('expQuickWidget');
  if(!el) return;
  if(!_expQuickAllowed()){ el.style.display = 'none'; return; }
  el.style.display = _expQuickInWindow() ? 'block' : 'none';
  // Populate dropdown if becoming visible and not yet populated
  if(el.style.display === 'block'){
    var sel = document.getElementById('expQVendor');
    if(sel && sel.options.length <= 1) _expQuickLoadVendors();
    // Update date label
    var lbl = document.getElementById('expQDateLabel');
    if(lbl) lbl.textContent = _fmtDateLabel(_todayCDT());
  }
}

async function _expQuickLoadVendors(){
  if(_expAllVendors.length === 0) await _loadAllVendors();
  var sel = document.getElementById('expQVendor');
  if(!sel) return;
  var html = '<option value="">Select vendor…</option>';
  _expAllVendors.forEach(function(v){
    html += '<option value="' + _escH(v) + '">' + _escH(v) + '</option>';
  });
  html += '<option value="__other__">Other vendor…</option>';
  sel.innerHTML = html;
}

window._expQuickVendorChange = function(){
  var sel = document.getElementById('expQVendor');
  var other = document.getElementById('expQOther');
  if(sel.value === '__other__'){
    other.style.display = 'block';
    other.focus();
  } else {
    other.style.display = 'none';
    other.value = '';
    document.getElementById('expQAmount').focus();
  }
};

window._expQuickAdd = async function(){
  var selV = document.getElementById('expQVendor');
  var otherV = document.getElementById('expQOther');
  var amtEl = document.getElementById('expQAmount');
  var btn = document.getElementById('expQBtn');
  var msg = document.getElementById('expQMsg');

  var vendor = selV.value === '__other__' ? (otherV.value||'').trim() : selV.value;
  var amount = parseFloat(amtEl.value);

  if(!vendor){ _expQMsg(msg,'Select vendor','#fef3c7','#92400e'); return; }
  if(isNaN(amount) || amount < 0){ _expQMsg(msg,'Enter amount','#fef3c7','#92400e'); return; }

  btn.disabled = true;
  btn.textContent = '…';

  try {
    var res = await supa.from('expenses').insert({
      expense_date: _todayCDT(),
      vendor: vendor,
      amount: amount,
      notes: null,
      created_by: (window.user && window.user.name) || 'Admin'
    });
    if(res.error) throw res.error;
    _expQMsg(msg,'Added ✓','#dcfce7','#166534');
    selV.value = '';
    otherV.style.display = 'none';
    otherV.value = '';
    amtEl.value = '';
  } catch(e){
    console.error('[expenses-quick] error', e);
    _expQMsg(msg,'Failed','#fee2e2','#991b1b');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add';
  }
};

function _expQMsg(el,text,bg,color){
  if(!el) return;
  el.textContent = text;
  el.style.background = bg;
  el.style.color = color;
  el.style.display = 'inline-block';
  setTimeout(function(){ el.style.display = 'none'; }, 2000);
}

})();
