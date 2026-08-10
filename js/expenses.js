// ── EXPENSES MODULE ──
// Manual expense/invoice total tracker for admin.
// Reads/writes public.expenses via Supabase anon client (supa).
// No Edge Functions, no vendor_documents integration.

(function(){
'use strict';

// ── STATE ──
let _expRows = [];
let _expVendors = []; // from ingredient_vendors
let _expFilterFrom = '';
let _expFilterTo = '';
let _expFilterVendor = '';
let _expEditId = null; // UUID of expense being edited, null = add mode

// ── HELPERS ──
function _escH(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function _todayCDT(){
  return new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
}

function _monthStartCDT(){
  const d = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}));
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
}

function _fmtUSD(n){
  return '$' + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
}

function _fmtDateShort(d){
  if(!d) return '';
  const p = d.split('-');
  if(p.length!==3) return d;
  return p[1]+'/'+p[2];
}

// ── VENDOR AUTOCOMPLETE ──
async function _loadVendorNames(){
  try {
    const{data}=await supa.from('ingredient_vendors').select('vendor').eq('active',true);
    if(data){
      const set = new Set(data.map(r=>r.vendor));
      _expVendors = [...set].sort();
    }
  } catch(e){ console.warn('[expenses] vendor load failed', e); }
}

// ── OPEN ──
window.openExpenses = async function(){
  if(typeof hideAdminMenu === 'function') hideAdminMenu();

  // defaults
  _expFilterFrom = _monthStartCDT();
  _expFilterTo = _todayCDT();
  _expFilterVendor = '';
  _expEditId = null;

  // load vendors in parallel with building UI
  const vendorP = _loadVendorNames();

  const sheet = document.createElement('div');
  sheet.id = 'expensesSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(15,23,42,0.45);overflow-y:auto;-webkit-overflow-scrolling:touch;';

  sheet.innerHTML = `
  <div style="min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:8px 6px 40px;">
    <div style="background:linear-gradient(160deg,#eff6ff 0%,#dbeafe 60%,#e0f2fe 100%);border-radius:20px;width:100%;max-width:500px;padding:18px 14px 24px;">

      <!-- HEADER -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div>
          <div style="font-size:17px;font-weight:700;color:#1e3a5f;">💰 Expenses</div>
          <div style="font-size:11px;color:#60a5fa;margin-top:2px;">Manual invoice & expense totals</div>
        </div>
        <button onclick="document.getElementById('expensesSheet').remove()" style="font-size:22px;background:none;border:none;color:#94a3b8;padding:4px 8px;">✕</button>
      </div>

      <!-- ADD/EDIT FORM -->
      <div id="expFormCard" style="background:rgba(255,255,255,0.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(59,130,246,0.18);border-radius:16px;padding:14px;margin-bottom:14px;">
        <div style="font-size:13px;font-weight:600;color:#1e3a5f;margin-bottom:10px;" id="expFormTitle">Add Expense</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div>
            <label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px;">Date</label>
            <input type="date" id="expDate" style="width:100%;padding:9px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;background:white;color:#1e3a5f;">
          </div>
          <div>
            <label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px;">Amount ($)</label>
            <input type="number" id="expAmount" inputmode="decimal" step="0.01" min="0" placeholder="0.00" style="width:100%;padding:9px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;background:white;color:#1e3a5f;">
          </div>
        </div>
        <div style="margin-bottom:8px;position:relative;">
          <label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px;">Vendor</label>
          <input type="text" id="expVendor" autocomplete="off" placeholder="Type vendor name…" style="width:100%;padding:9px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;background:white;color:#1e3a5f;">
          <div id="expVendorAC" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:10;background:white;border:1px solid #e2e8f0;border-radius:10px;max-height:160px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.1);"></div>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px;">Notes <span style="color:#94a3b8;">(optional)</span></label>
          <input type="text" id="expNotes" placeholder="Invoice #, description…" style="width:100%;padding:9px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;background:white;color:#1e3a5f;">
        </div>
        <div id="expBtnRow" style="display:flex;gap:8px;">
          <button id="expSaveBtn" onclick="_expSave()" style="flex:1;padding:11px;background:#1e3a5f;color:white;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">Add Expense</button>
          <button id="expCancelBtn" onclick="_expCancelEdit()" style="display:none;padding:11px 16px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
        </div>
        <div id="expSaveMsg" style="display:none;text-align:center;font-size:12px;margin-top:6px;padding:6px;border-radius:8px;"></div>
      </div>

      <!-- FILTERS -->
      <div style="background:rgba(255,255,255,0.5);border:0.5px solid rgba(59,130,246,0.12);border-radius:12px;padding:10px 12px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:11px;color:#64748b;font-weight:600;">Filter:</span>
          <input type="date" id="expFFrom" style="padding:5px 6px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:inherit;background:white;color:#1e3a5f;" onchange="_expApplyFilters()">
          <span style="font-size:11px;color:#94a3b8;">→</span>
          <input type="date" id="expFTo" style="padding:5px 6px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:inherit;background:white;color:#1e3a5f;" onchange="_expApplyFilters()">
          <select id="expFVendor" style="padding:5px 6px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:inherit;background:white;color:#1e3a5f;max-width:140px;" onchange="_expApplyFilters()">
            <option value="">All Vendors</option>
          </select>
        </div>
      </div>

      <!-- SUMMARY -->
      <div id="expSummary" style="background:rgba(255,255,255,0.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(59,130,246,0.18);border-radius:14px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:22px;font-weight:700;color:#1e3a5f;" id="expTotal">$0.00</div>
          <div style="font-size:11px;color:#64748b;" id="expCount">0 expenses</div>
        </div>
        <button onclick="_expExportCSV()" style="padding:7px 12px;background:rgba(59,130,246,0.08);color:#2563eb;border:1px solid rgba(59,130,246,0.2);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;">Export CSV</button>
      </div>

      <!-- LIST -->
      <div id="expList" style="display:flex;flex-direction:column;gap:6px;">
        <div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px;">Loading…</div>
      </div>

    </div>
  </div>`;

  sheet.addEventListener('click', e => { if(e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);

  // Set default date
  document.getElementById('expDate').value = _todayCDT();
  document.getElementById('expFFrom').value = _expFilterFrom;
  document.getElementById('expFTo').value = _expFilterTo;

  // Vendor autocomplete wiring
  await vendorP;
  _expWireAutocomplete();

  // Load data
  await _expFetchAndRender();
};

// ── VENDOR AUTOCOMPLETE ──
function _expWireAutocomplete(){
  const inp = document.getElementById('expVendor');
  const ac = document.getElementById('expVendorAC');
  if(!inp || !ac) return;

  inp.addEventListener('input', function(){
    const q = this.value.trim().toLowerCase();
    if(!q || q.length < 1){ ac.style.display='none'; return; }
    // Combine known vendors from ingredient_vendors + unique vendors already in expenses
    const allVendors = [...new Set([..._expVendors, ..._expRows.map(r=>r.vendor)])].sort();
    const matches = allVendors.filter(v => v.toLowerCase().includes(q));
    if(matches.length === 0){ ac.style.display='none'; return; }
    ac.innerHTML = matches.slice(0,8).map(v =>
      `<div style="padding:8px 10px;font-size:13px;color:#1e3a5f;cursor:pointer;border-bottom:1px solid #f1f5f9;" onmousedown="_expPickVendor('${_escH(v.replace(/'/g,"\\'"))}')">${_escH(v)}</div>`
    ).join('');
    ac.style.display='block';
  });

  inp.addEventListener('blur', function(){ setTimeout(()=>{ ac.style.display='none'; }, 150); });
  inp.addEventListener('focus', function(){ if(this.value.trim()) this.dispatchEvent(new Event('input')); });
}

window._expPickVendor = function(v){
  const inp = document.getElementById('expVendor');
  if(inp) inp.value = v;
  const ac = document.getElementById('expVendorAC');
  if(ac) ac.style.display = 'none';
};

// ── EDIT MODE ──
window._expEdit = function(id){
  const row = _expRows.find(r => r.id === id);
  if(!row) return;
  _expEditId = id;

  document.getElementById('expDate').value = row.expense_date || '';
  document.getElementById('expAmount').value = Number(row.amount || 0);
  document.getElementById('expVendor').value = row.vendor || '';
  document.getElementById('expNotes').value = row.notes || '';

  // Switch UI to edit mode
  const title = document.getElementById('expFormTitle');
  const btn = document.getElementById('expSaveBtn');
  const cancelBtn = document.getElementById('expCancelBtn');
  const card = document.getElementById('expFormCard');
  if(title) title.textContent = '✏️ Editing Expense';
  if(btn) btn.textContent = 'Save Changes';
  if(cancelBtn) cancelBtn.style.display = 'block';
  if(card) card.style.borderColor = 'rgba(245,158,11,0.4)';

  // Scroll form into view
  card.scrollIntoView({behavior:'smooth', block:'start'});
};

window._expCancelEdit = function(){
  _expEditId = null;

  // Reset form
  document.getElementById('expDate').value = _todayCDT();
  document.getElementById('expAmount').value = '';
  document.getElementById('expVendor').value = '';
  document.getElementById('expNotes').value = '';

  // Restore add mode UI
  const title = document.getElementById('expFormTitle');
  const btn = document.getElementById('expSaveBtn');
  const cancelBtn = document.getElementById('expCancelBtn');
  const card = document.getElementById('expFormCard');
  if(title) title.textContent = 'Add Expense';
  if(btn){ btn.textContent = 'Add Expense'; btn.disabled = false; }
  if(cancelBtn) cancelBtn.style.display = 'none';
  if(card) card.style.borderColor = 'rgba(59,130,246,0.18)';

  const msgEl = document.getElementById('expSaveMsg');
  if(msgEl) msgEl.style.display = 'none';
};

// ── SAVE (insert or update) ──
window._expSave = async function(){
  const dateEl = document.getElementById('expDate');
  const vendorEl = document.getElementById('expVendor');
  const amountEl = document.getElementById('expAmount');
  const notesEl = document.getElementById('expNotes');
  const msgEl = document.getElementById('expSaveMsg');
  const btn = document.getElementById('expSaveBtn');

  const expDate = dateEl?.value;
  const vendor = vendorEl?.value?.trim();
  const amount = parseFloat(amountEl?.value);
  const notes = notesEl?.value?.trim() || null;

  // Validate
  if(!expDate){ _expMsg(msgEl, '⚠️ Date is required', '#fef3c7', '#92400e'); return; }
  if(!vendor){ _expMsg(msgEl, '⚠️ Vendor is required', '#fef3c7', '#92400e'); return; }
  if(isNaN(amount) || amount < 0){ _expMsg(msgEl, '⚠️ Amount must be ≥ 0', '#fef3c7', '#92400e'); return; }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if(_expEditId){
      // ── UPDATE ──
      const{error} = await supa.from('expenses')
        .update({ expense_date: expDate, vendor: vendor, amount: amount, notes: notes })
        .eq('id', _expEditId);
      if(error) throw error;
      _expMsg(msgEl, '✓ Expense updated', '#dcfce7', '#166534');
      _expCancelEdit();
    } else {
      // ── INSERT ──
      const{error} = await supa.from('expenses').insert({
        expense_date: expDate,
        vendor: vendor,
        amount: amount,
        notes: notes,
        created_by: (window.user && window.user.name) || 'Admin'
      });
      if(error) throw error;
      _expMsg(msgEl, '✓ Expense added', '#dcfce7', '#166534');
      amountEl.value = '';
      notesEl.value = '';
    }
    await _expFetchAndRender();
  } catch(e){
    console.error('[expenses] save error', e);
    _expMsg(msgEl, '✕ Save failed: ' + (e.message||'unknown'), '#fee2e2', '#991b1b');
  } finally {
    btn.disabled = false;
    if(_expEditId) btn.textContent = 'Save Changes';
    else btn.textContent = 'Add Expense';
  }
};

// ── DELETE ──
window._expDelete = async function(id){
  if(!id) return;
  if(!confirm('Delete this expense? This cannot be undone.')) return;

  try {
    const{error} = await supa.from('expenses').delete().eq('id', id);
    if(error) throw error;

    // If we were editing this row, exit edit mode
    if(_expEditId === id) _expCancelEdit();

    const msgEl = document.getElementById('expSaveMsg');
    _expMsg(msgEl, '✓ Expense deleted', '#dcfce7', '#166534');
    await _expFetchAndRender();
  } catch(e){
    console.error('[expenses] delete error', e);
    const msgEl = document.getElementById('expSaveMsg');
    _expMsg(msgEl, '✕ Delete failed: ' + (e.message||'unknown'), '#fee2e2', '#991b1b');
  }
};

function _expMsg(el, text, bg, color){
  if(!el) return;
  el.textContent = text;
  el.style.background = bg;
  el.style.color = color;
  el.style.display = 'block';
  setTimeout(()=>{ el.style.display = 'none'; }, 3000);
}

// ── FETCH & RENDER ──
async function _expFetchAndRender(){
  const from = document.getElementById('expFFrom')?.value || '';
  const to = document.getElementById('expFTo')?.value || '';
  const vendor = document.getElementById('expFVendor')?.value || '';

  let q = supa.from('expenses').select('*').order('expense_date',{ascending:false}).order('created_at',{ascending:false});
  if(from) q = q.gte('expense_date', from);
  if(to) q = q.lte('expense_date', to);
  if(vendor) q = q.eq('vendor', vendor);

  const{data, error} = await q;
  if(error){ console.error('[expenses] fetch error', error); return; }
  _expRows = data || [];

  _expRenderList();
  _expRenderSummary();
  _expPopulateVendorFilter();
}

function _expRenderList(){
  const el = document.getElementById('expList');
  if(!el) return;
  if(_expRows.length === 0){
    el.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:24px;">No expenses in this period.</div>';
    return;
  }
  el.innerHTML = _expRows.map(r => {
    const dateStr = _fmtDateShort(r.expense_date);
    const notesHtml = r.notes ? `<div style="font-size:12px;color:#64748b;margin-top:3px;line-height:1.3;">${_escH(r.notes)}</div>` : '';
    const isEditing = _expEditId === r.id;
    const editHighlight = isEditing ? 'border-color:rgba(245,158,11,0.5);' : '';
    return `<div style="background:rgba(255,255,255,0.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:0.5px solid rgba(59,130,246,0.12);border-radius:12px;padding:10px 12px;${editHighlight}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:12px;color:#94a3b8;font-weight:500;min-width:40px;">${_escH(dateStr)}</span>
            <span style="font-size:14px;font-weight:600;color:#1e3a5f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escH(r.vendor)}</span>
          </div>
          ${notesHtml}
          <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${_escH(r.created_by||'')}</div>
        </div>
        <div style="font-size:15px;font-weight:700;color:#1e3a5f;white-space:nowrap;">${_fmtUSD(r.amount)}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;padding-top:5px;border-top:1px solid rgba(59,130,246,0.06);">
        <button onclick="_expEdit('${r.id}')" style="padding:4px 10px;font-size:11px;color:#64748b;background:rgba(241,245,249,0.8);border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-family:inherit;">Edit</button>
        <button onclick="_expDelete('${r.id}')" style="padding:4px 10px;font-size:11px;color:#dc2626;background:rgba(254,226,226,0.5);border:1px solid rgba(220,38,38,0.15);border-radius:8px;cursor:pointer;font-family:inherit;">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function _expRenderSummary(){
  const totalEl = document.getElementById('expTotal');
  const countEl = document.getElementById('expCount');
  if(!totalEl || !countEl) return;
  const total = _expRows.reduce((s,r) => s + Number(r.amount||0), 0);
  totalEl.textContent = _fmtUSD(total);
  const n = _expRows.length;
  countEl.textContent = n + ' expense' + (n !== 1 ? 's' : '');
}

function _expPopulateVendorFilter(){
  const sel = document.getElementById('expFVendor');
  if(!sel) return;
  const current = sel.value;
  const vendors = [...new Set(_expRows.map(r=>r.vendor))].sort();
  sel.innerHTML = '<option value="">All Vendors</option>' +
    vendors.map(v => `<option value="${_escH(v)}"${v===current?' selected':''}>${_escH(v)}</option>`).join('');
}

// ── FILTERS ──
window._expApplyFilters = function(){
  _expFetchAndRender();
};

// ── CSV EXPORT ──
window._expExportCSV = function(){
  if(_expRows.length === 0){
    if(typeof showScToast === 'function') showScToast('No expenses to export');
    return;
  }
  const header = 'Date,Vendor,Amount,Notes,Created By,Created At';
  const rows = _expRows.map(r => {
    return [
      r.expense_date || '',
      _csvEsc(r.vendor || ''),
      Number(r.amount||0).toFixed(2),
      _csvEsc(r.notes || ''),
      _csvEsc(r.created_by || ''),
      r.created_at || ''
    ].join(',');
  });
  const csv = header + '\n' + rows.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'expenses_' + _todayCDT() + '.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); }, 200);
};

function _csvEsc(s){
  if(!s) return '';
  if(s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0){
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

})();
