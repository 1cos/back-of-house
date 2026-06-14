// ── ADMIN INGREDIENTS ──
// Bootstrap, Cleanup, Similarity Cleanup, Vendor Match, Soft Merge.
// Admin-only tools. Requires: escHtml, escAttr (in admin.js), isAdmin(), showScToast().

// ── Bootstrap Ingredients from recipes ───────────────────────
// Admin-only utility. Reads recipes.ingredients jsonb,
// extracts every ingredient name, deduplicates, inserts missing.
// Does NOT rewrite recipes or touch any other table.
window.bootstrapIngredients = async function() {
  if (!isAdmin()) return;

  const modal = document.createElement('div');
  modal.id = 'bootstrapModal';
  modal.className = 'fixed inset-0 z-[65] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;">
      <button onclick="this.closest('#bootstrapModal').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
      <div>
        <div style="font-size:15px;font-weight:600;color:#1e293b;">🌱 Bootstrap Ingredients</div>
        <div style="font-size:11px;color:#94a3b8;">Populate from recipe data — admin only</div>
      </div>
    </div>
    <div style="padding:16px;max-width:520px;width:100%;margin:0 auto;">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#166534;line-height:1.6;">
        Reads every ingredient name from <strong>recipes.ingredients</strong>.<br>
        Trims, deduplicates, and inserts only names that don't exist yet.<br>
        Inserts with: <code>base_unit = 'g'</code>, <code>active = true</code>, <code>count_unit = 'weight'</code>.<br>
        Nothing else is touched.
      </div>
      <button id="bsRunBtn" onclick="bootstrapIngredientsRun()"
        style="width:100%;height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;margin-bottom:14px;">
        🌱 Run Bootstrap
      </button>
      <div id="bsStatus" style="display:none;"></div>
    </div>`;
  document.body.appendChild(modal);
};

window.bootstrapIngredientsRun = async function() {
  const btn      = document.getElementById('bsRunBtn');
  const statusEl = document.getElementById('bsStatus');

  btn.disabled = true;
  btn.textContent = '⏳ Running…';
  btn.style.background = '#94a3b8';
  statusEl.style.display = 'none';

  function showStatus(html, type) {
    const colors = {
      info:    { bg: 'rgba(59,130,246,0.06)',  border: 'rgba(59,130,246,0.2)',   text: '#1e40af' },
      success: { bg: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.25)',  text: '#065f46' },
      error:   { bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.25)',   text: '#991b1b' },
    }[type] || { bg: '#f8fafc', border: '#e2e8f0', text: '#1e293b' };
    statusEl.style.display = 'block';
    statusEl.style.cssText = `display:block;padding:14px;border-radius:10px;font-size:13px;line-height:1.8;background:${colors.bg};border:1px solid ${colors.border};color:${colors.text};`;
    statusEl.innerHTML = html;
  }

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    // ── Step 1: Read all recipes ──────────────────────────────
    showStatus('⏳ Reading recipes…', 'info');
    const { data: recipes, error: recErr } = await sb
      .from('recipes')
      .select('id, title, ingredients');
    if (recErr) throw new Error('Reading recipes: ' + recErr.message);

    // ── Step 2: Extract and deduplicate ingredient names ──────
    const seen   = new Map(); // lowercase → original case (first occurrence)
    let rawCount = 0;

    for (const recipe of (recipes || [])) {
      const ingr = recipe.ingredients;
      // ingredients may be an array or a jsonb object with an array inside
      const list = Array.isArray(ingr) ? ingr
                 : (ingr && Array.isArray(ingr.ingredients)) ? ingr.ingredients
                 : [];
      for (const item of list) {
        const raw = (item.name || item.ingredient || '').trim();
        if (!raw) continue;
        rawCount++;
        const key = raw.toLowerCase();
        if (!seen.has(key)) seen.set(key, raw);
      }
    }

    const uniqueNames = [...seen.values()]; // original-case names, deduplicated
    const uniqueCount = uniqueNames.length;

    if (uniqueCount === 0) {
      showStatus('⚠️ No ingredient names found in recipes.ingredients.<br>Check that recipes have an <code>ingredients</code> jsonb array with a <code>name</code> field.', 'error');
      btn.disabled = false; btn.textContent = '🌱 Run Bootstrap'; btn.style.background = '#1e293b';
      return;
    }

    showStatus(`⏳ Found <strong>${uniqueCount}</strong> unique names from ${rawCount} raw entries.<br>Checking existing ingredients…`, 'info');

    // ── Step 3: Fetch existing ingredient names ───────────────
    const { data: existing, error: exErr } = await sb
      .from('ingredients')
      .select('name');
    if (exErr) throw new Error('Reading ingredients: ' + exErr.message);

    const existingKeys = new Set((existing || []).map(r => r.name.toLowerCase().trim()));
    const toInsert = uniqueNames.filter(n => !existingKeys.has(n.toLowerCase()));
    const alreadyExisted = uniqueCount - toInsert.length;

    if (toInsert.length === 0) {
      showStatus(
        `✓ All <strong>${uniqueCount}</strong> ingredient names already exist.<br>` +
        `Nothing to insert.`,
        'success'
      );
      btn.disabled = false; btn.textContent = '🌱 Run Bootstrap'; btn.style.background = '#1e293b';
      return;
    }

    showStatus(
      `⏳ Inserting <strong>${toInsert.length}</strong> new ingredients…<br>` +
      `(${alreadyExisted} already existed)`,
      'info'
    );

    // ── Step 4: Insert in batches of 100 ─────────────────────
    const rows = toInsert.map(name => ({
      name,
      base_unit:  'g',
      active:     true,
      count_unit: 'weight',
    }));

    const BATCH = 100;
    let insertedCount = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { data: inserted, error: insErr } = await sb
        .from('ingredients')
        .insert(batch)
        .select('id');
      if (insErr) {
        errors.push(`Batch ${Math.floor(i/BATCH)+1}: ${insErr.message}`);
      } else {
        insertedCount += (inserted || []).length;
      }
    }

    // ── Step 5: Report ────────────────────────────────────────
    if (errors.length === 0) {
      showStatus(
        `✅ Bootstrap complete.<br><br>` +
        `<strong>Unique names found:</strong> ${uniqueCount}<br>` +
        `<strong>Already existed:</strong> ${alreadyExisted}<br>` +
        `<strong>Inserted:</strong> ${insertedCount}`,
        'success'
      );
      btn.textContent = '✓ Done';
      btn.style.background = '#10b981';
    } else {
      showStatus(
        `⚠️ Partial success.<br><br>` +
        `<strong>Unique names found:</strong> ${uniqueCount}<br>` +
        `<strong>Already existed:</strong> ${alreadyExisted}<br>` +
        `<strong>Inserted:</strong> ${insertedCount}<br>` +
        `<strong>Errors:</strong><br>${errors.map(e => `• ${e}`).join('<br>')}`,
        'error'
      );
      btn.disabled = false; btn.textContent = '🌱 Retry'; btn.style.background = '#1e293b';
    }

  } catch(e) {
    showStatus(`✗ Error: ${e.message}`, 'error');
    btn.disabled = false; btn.textContent = '🌱 Run Bootstrap'; btn.style.background = '#1e293b';
  }
};

// ── Ingredient Cleanup Tool ───────────────────────────────────
// Admin-only. Loads ingredients, shows suspicious ones first.
// Actions: Edit Name, Mark OK (notes='cleanup_ok'), Deactivate.
// No deletes. No vendor/recipe/bom changes.

const IC_SUSPICIOUS_RE = [
  /^\d/,                                                      // starts with number
  /\b\d+\/\d+\b/,                                            // fractions: 1/2, 1/4
  /\b(bunch|pack|tsp|tbsp|tablespoon|teaspoon|gallon|gal|oz|lb|lbs|kg|gr|gram|grams|cup|cups|quart|pint)\b/i,
  /\b(divided|optional|facultative|zeste|zest|peel|peeled|chopped|sliced|diced|minced|whole|fresh|dried|frozen|canned|toasted|cooked|raw)\b/i,
];

function icIsSuspicious(ingr) {
  if (ingr.notes === 'cleanup_ok') return false;
  const name = (ingr.name || '').trim();
  return IC_SUSPICIOUS_RE.some(re => re.test(name));
}

window.openIngredientCleanup = function() {
  if (!isAdmin()) return;

  const modal = document.createElement('div');
  modal.id = 'icModal';
  modal.className = 'fixed inset-0 z-[65] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;">
      <button onclick="this.closest('#icModal').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:600;color:#1e293b;">🧹 Ingredient Cleanup</div>
        <div style="font-size:11px;color:#94a3b8;">Suspicious names shown first — admin only</div>
      </div>
      <button onclick="icLoad()" style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">↻ Refresh</button>
    </div>
    <div style="padding:16px;max-width:640px;width:100%;margin:0 auto;">
      <!-- Filter tabs -->
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
        <button id="icTabSuspicious" onclick="icSetTab('suspicious')"
          style="padding:5px 12px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:600;background:#1e293b;color:white;">
          ⚠️ Suspicious
        </button>
        <button id="icTabAll" onclick="icSetTab('all')"
          style="padding:5px 12px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:500;background:#f1f5f9;color:#64748b;">
          All
        </button>
        <button id="icTabMerge" onclick="icSetTab('merge')"
          style="padding:5px 12px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:500;background:#f1f5f9;color:#64748b;">
          🔀 Merge / Duplicates
        </button>
      </div>
      <div id="icList">
        <div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  window._icTab = 'suspicious';
  icLoad();
};

window._icTab = 'suspicious';
window._icData = [];

window.icSetTab = function(tab) {
  window._icTab = tab;
  const btnS = document.getElementById('icTabSuspicious');
  const btnA = document.getElementById('icTabAll');
  const btnM = document.getElementById('icTabMerge');
  const active = '#1e293b', inactive = '#f1f5f9', activeT = 'white', inactiveT = '#64748b';
  if (btnS) { btnS.style.background = tab==='suspicious'?active:inactive; btnS.style.color = tab==='suspicious'?activeT:inactiveT; }
  if (btnA) { btnA.style.background = tab==='all'       ?active:inactive; btnA.style.color = tab==='all'       ?activeT:inactiveT; }
  if (btnM) { btnM.style.background = tab==='merge'     ?active:inactive; btnM.style.color = tab==='merge'     ?activeT:inactiveT; }
  if (tab === 'merge') { icRenderMerge(); } else { icRender(window._icData); }
};

window.icLoad = async function() {
  const list = document.getElementById('icList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const { data, error } = await sb
      .from('ingredients')
      .select('id,name,category,base_unit,active,notes')
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);

    window._icData = data || [];
    icRender(window._icData);

  } catch(e) {
    if (list) list.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#991b1b;font-size:13px;">✗ ${e.message}</div>`;
  }
};

function icRender(data) {
  const list = document.getElementById('icList');
  if (!list) return;

  const tab = window._icTab;

  // Partition: suspicious first, then clean
  const suspicious = data.filter(i => icIsSuspicious(i));
  const clean      = data.filter(i => !icIsSuspicious(i));
  const inactive   = data.filter(i => !i.active);

  const display = tab === 'suspicious' ? suspicious : data;

  if (display.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:48px 0;">
        <div style="font-size:32px;margin-bottom:10px;">${tab === 'suspicious' ? '✅' : '📭'}</div>
        <div style="font-size:14px;font-weight:500;color:#1e293b;margin-bottom:4px;">
          ${tab === 'suspicious' ? 'No suspicious ingredients' : 'No ingredients found'}
        </div>
        <div style="font-size:12px;color:#94a3b8;">
          ${tab === 'suspicious' ? 'All names look clean' : 'Run Bootstrap Ingr. first'}
        </div>
      </div>`;
    return;
  }

  // Summary bar
  const summaryHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;color:#64748b;">
      <span>Total: <strong style="color:#1e293b;">${data.length}</strong></span>
      <span style="color:#f59e0b;">⚠️ Suspicious: <strong>${suspicious.length}</strong></span>
      <span style="color:#94a3b8;">Inactive: <strong>${inactive.length}</strong></span>
    </div>`;

  const rowsHTML = display.map(ingr => icRowHTML(ingr)).join('');
  list.innerHTML = summaryHTML + rowsHTML;
}

function icRowHTML(ingr) {
  const isSusp   = icIsSuspicious(ingr);
  const isOk     = ingr.notes === 'cleanup_ok';
  const rowBorder = isSusp ? '1px solid rgba(245,158,11,0.3)' : '1px solid #f1f5f9';
  const rowBg     = isSusp ? 'rgba(255,251,235,0.6)' : 'white';
  const activeDot = ingr.active ? '' : '<span style="font-size:10px;color:#94a3b8;background:#f1f5f9;padding:1px 6px;border-radius:4px;margin-left:6px;">inactive</span>';

  return `
    <div id="icRow-${ingr.id}" style="border:${rowBorder};border-radius:12px;padding:11px 13px;margin-bottom:8px;background:${rowBg};">
      <!-- Name + meta -->
      <div style="display:flex;align-items:start;gap:8px;margin-bottom:8px;">
        <div style="flex:1;min-width:0;">
          <div id="icNameDisplay-${ingr.id}" style="font-size:13px;font-weight:600;color:#1e293b;word-break:break-word;">
            ${isSusp ? '<span style="font-size:10px;color:#f59e0b;font-weight:700;margin-right:5px;">⚠️</span>' : ''}${escHtml(ingr.name)}${activeDot}
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;">
            ${ingr.category ? escHtml(ingr.category) + ' · ' : ''}${ingr.base_unit || 'g'}
          </div>
        </div>
      </div>
      <!-- Edit form (hidden by default) -->
      <div id="icEditForm-${ingr.id}" style="display:none;margin-bottom:8px;">
        <div style="display:flex;gap:6px;">
          <input id="icEditInput-${ingr.id}" type="text" value="${escAttr(ingr.name)}"
            style="flex:1;height:36px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;" />
          <button onclick="icSaveName('${ingr.id}')"
            style="height:36px;padding:0 12px;border-radius:8px;background:#1e293b;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;">
            Save
          </button>
          <button onclick="icCancelEdit('${ingr.id}')"
            style="height:36px;padding:0 10px;border-radius:8px;background:#f1f5f9;color:#64748b;font-size:12px;border:none;cursor:pointer;">
            ✕
          </button>
        </div>
      </div>
      <!-- Action buttons -->
      <div id="icActions-${ingr.id}" style="display:flex;gap:6px;flex-wrap:wrap;">
        <button onclick="icStartEdit('${ingr.id}','${escAttr(ingr.name)}')"
          style="height:30px;padding:0 10px;border-radius:8px;background:rgba(59,130,246,0.08);color:#1d4ed8;border:none;font-size:11px;font-weight:500;cursor:pointer;">
          ✏️ Edit Name
        </button>
        ${!isOk ? `<button onclick="icMarkOk('${ingr.id}')"
          style="height:30px;padding:0 10px;border-radius:8px;background:rgba(16,185,129,0.08);color:#065f46;border:none;font-size:11px;font-weight:500;cursor:pointer;">
          ✓ Mark OK
        </button>` : `<span style="height:30px;display:inline-flex;align-items:center;padding:0 10px;font-size:11px;color:#10b981;">✓ OK</span>`}
        ${ingr.active ? `<button onclick="icDeactivate('${ingr.id}')"
          style="height:30px;padding:0 10px;border-radius:8px;background:rgba(239,68,68,0.06);color:#991b1b;border:none;font-size:11px;font-weight:500;cursor:pointer;">
          Deactivate
        </button>` : `<span style="height:30px;display:inline-flex;align-items:center;padding:0 10px;font-size:11px;color:#94a3b8;">Inactive</span>`}
      </div>
      <!-- Inline status -->
      <div id="icRowStatus-${ingr.id}" style="display:none;margin-top:6px;font-size:12px;"></div>
    </div>`;
}

// ── Start inline edit ─────────────────────────────────────────
window.icStartEdit = function(id, currentName) {
  document.getElementById('icEditForm-' + id).style.display = 'block';
  document.getElementById('icActions-' + id).style.display = 'none';
  const input = document.getElementById('icEditInput-' + id);
  if (input) { input.value = currentName; input.focus(); input.select(); }
};

window.icCancelEdit = function(id) {
  document.getElementById('icEditForm-' + id).style.display = 'none';
  document.getElementById('icActions-' + id).style.display = 'flex';
};

// ── Title Case helper ────────────────────────────────────────
function icTitleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ── Save edited name — checks for merge before simple rename ──
window.icSaveName = async function(id) {
  const input   = document.getElementById('icEditInput-' + id);
  const newName = (input ? input.value : '').trim();
  if (!newName) { if (input) input.focus(); return; }

  icSetRowBusy(id, true);
  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const srcRec = window._icData.find(r => r.id === id);
    if (!srcRec) throw new Error('Source ingredient not found in local cache');

    const targetDisplay = icTitleCase(newName);
    const targetKey     = newName.toLowerCase().trim();
    const sourceKey     = (srcRec.name || '').toLowerCase().trim();

    // No-op: same name
    if (targetKey === sourceKey) {
      icSetRowBusy(id, false);
      icCancelEdit(id);
      return;
    }

    // Check whether the target name already exists in ingredients
    const { data: existing, error: chkErr } = await sb
      .from('ingredients')
      .select('id, name')
      .ilike('name', newName)
      .maybeSingle();
    if (chkErr) throw new Error(chkErr.message);

    if (existing) {
      // ── Target exists → merge flow ──────────────────────────
      icSetRowBusy(id, false);
      await icShowMergeConfirm(srcRec, existing, targetDisplay);
    } else {
      // ── Target does not exist → simple rename ───────────────
      const { error } = await sb
        .from('ingredients')
        .update({ name: targetDisplay, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);

      srcRec.name = targetDisplay;
      const row = document.getElementById('icRow-' + id);
      if (row) row.outerHTML = icRowHTML(srcRec);
    }
  } catch(e) {
    icSetRowBusy(id, false);
    icShowRowStatus(id, '✗ ' + e.message, '#991b1b');
  }
};

// ── Merge confirmation modal ───────────────────────────────────
async function icShowMergeConfirm(srcRec, targetRec, targetDisplay, onSuccessCallback) {
  const sb = window.supabaseClient;

  // Find recipes that use the source ingredient name
  const srcName = srcRec.name || '';

  const { data: allRecipes, error: rErr } = await sb
    .from('recipes')
    .select('id, title, ingredients');
  if (rErr) throw new Error('Reading recipes: ' + rErr.message);

  const affected = (allRecipes || []).filter(r => {
    const list = icExtractIngrList(r.ingredients);
    return list.some(i => (i.name || '').toLowerCase().trim() === srcName.toLowerCase().trim());
  });

  const modal = document.createElement('div');
  modal.id = 'icMergeModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:20px;width:100%;max-width:480px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.18);">
      <!-- Header -->
      <div style="padding:16px 18px 12px;border-bottom:1px solid #f1f5f9;">
        <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:2px;">🔀 Merge Ingredient</div>
        <div style="font-size:11px;color:#94a3b8;">This name already exists — merge instead of rename?</div>
      </div>
      <!-- Body -->
      <div style="padding:16px 18px;overflow-y:auto;flex:1;">
        <!-- Source → Target -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:8px 12px;flex:1;min-width:120px;">
            <div style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Source (will be deactivated)</div>
            <div style="font-size:13px;font-weight:600;color:#991b1b;">${escHtml(srcName)}</div>
          </div>
          <span style="font-size:20px;color:#94a3b8;flex-shrink:0;">→</span>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 12px;flex:1;min-width:120px;">
            <div style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Target (kept, Title Case)</div>
            <div style="font-size:13px;font-weight:600;color:#166534;">${escHtml(targetDisplay)}</div>
          </div>
        </div>
        <!-- Affected recipes — full before/after per row -->
        ${affected.length > 0 ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">
            Affected Recipes (${affected.length})
          </div>
          ${affected.map(r => {
            const list = icExtractIngrList(r.ingredients);
            const match = list.find(i => (i.name || '').toLowerCase().trim() === srcName.toLowerCase().trim());
            const qty  = match ? (match.qty  || '') : '';
            const unit = match ? (match.unit || '') : '';
            const qtyUnit = [qty, unit].filter(Boolean).join(' ');
            return `<div style="border:1px solid #f1f5f9;border-radius:10px;padding:10px 12px;margin-bottom:6px;">
              <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:6px;">
                📄 ${escHtml(r.title || 'Untitled')}
              </div>
              <div style="display:flex;flex-direction:column;gap:3px;">
                <div style="font-size:11px;color:#94a3b8;">
                  <span style="font-weight:500;color:#64748b;">Current:</span>
                  ${qtyUnit ? `<span style="color:#475569;">qty: ${escHtml(qty)} unit: ${escHtml(unit)}</span> ` : ''}
                  <span style="color:#991b1b;">name: ${escHtml(match ? match.name : srcName)}</span>
                </div>
                <div style="font-size:11px;color:#94a3b8;">
                  <span style="font-weight:500;color:#64748b;">After merge:</span>
                  ${qtyUnit ? `<span style="color:#475569;">qty: ${escHtml(qty)} unit: ${escHtml(unit)}</span> ` : ''}
                  <span style="color:#166534;font-weight:600;">name: ${escHtml(targetDisplay)}</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>` : `
        <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#64748b;">
          ℹ️ Source ingredient is not used in any recipe. It will be deactivated only.
        </div>`}
        <!-- Status -->
        <div id="icMergeStatus" style="display:none;margin-top:10px;padding:10px 12px;border-radius:10px;font-size:12px;"></div>
      </div>
      <!-- Footer -->
      <div style="padding:12px 18px 16px;border-top:1px solid #f1f5f9;display:flex;gap:8px;">
        <button onclick="document.getElementById('icMergeModal').remove()"
          style="flex:1;height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;border:none;font-size:13px;font-weight:500;cursor:pointer;">
          Cancel
        </button>
        <button id="icMergeBtn" onclick="icDoMergeStored()"
          style="flex:2;height:42px;border-radius:12px;background:#1e293b;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;">
          🔀 Merge & Update Recipes
        </button>
      </div>
    </div>`;
  // Store all merge args on window — no user data in HTML onclick attributes
  window._icPendingMerge = { srcId: srcRec.id, targetId: targetRec.id,
                              srcName, targetDisplay };
  // Store optional success callback keyed by srcId for icDoMerge to call
  if (onSuccessCallback) window._icMergeCallbacks = window._icMergeCallbacks || {};
  if (onSuccessCallback) window._icMergeCallbacks[srcRec.id] = onSuccessCallback;
  document.body.appendChild(modal);
}

// ── No-arg wrapper — reads args from window._icPendingMerge ─
// Avoids putting user data (apostrophes, parens, etc.) in onclick attributes.
window.icDoMergeStored = function() {
  const p = window._icPendingMerge;
  if (!p) return;
  window._icPendingMerge = null;
  icDoMerge(p.srcId, p.targetId, p.srcName, p.targetDisplay);
};

// ── Execute the merge ─────────────────────────────────────────
window.icDoMerge = async function(srcId, targetId, srcName, targetDisplay) {
  const btn      = document.getElementById('icMergeBtn');
  const statusEl = document.getElementById('icMergeStatus');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Merging…'; btn.style.background = '#94a3b8'; }

  function setStatus(html, type) {
    if (!statusEl) return;
    const c = { info: ['rgba(59,130,246,0.06)','rgba(59,130,246,0.2)','#1e40af'],
                success: ['rgba(16,185,129,0.06)','rgba(16,185,129,0.25)','#065f46'],
                error:   ['rgba(239,68,68,0.06)','rgba(239,68,68,0.25)','#991b1b'] }[type];
    statusEl.style.display = 'block';
    statusEl.style.cssText = `display:block;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.7;background:${c[0]};border:1px solid ${c[1]};color:${c[2]};`;
    statusEl.innerHTML = html;
  }

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    // ── Step 1: Update target ingredient name to Title Case ───
    setStatus('⏳ Updating target ingredient name…', 'info');
    const { error: tErr } = await sb
      .from('ingredients')
      .update({ name: targetDisplay, updated_at: new Date().toISOString() })
      .eq('id', targetId);
    if (tErr) throw new Error('Updating target name: ' + tErr.message);

    // ── Step 2: Fetch all recipes, find affected ones ─────────
    setStatus('⏳ Scanning recipes…', 'info');
    const { data: allRecipes, error: rErr } = await sb
      .from('recipes')
      .select('id, title, ingredients');
    if (rErr) throw new Error('Reading recipes: ' + rErr.message);

    const affected = (allRecipes || []).filter(r => {
      const list = icExtractIngrList(r.ingredients);
      return list.some(i => (i.name || '').toLowerCase().trim() === srcName.toLowerCase().trim());
    });

    // ── Step 3: Update each affected recipe's ingredients JSONB
    setStatus(`⏳ Updating ${affected.length} recipe${affected.length !== 1 ? 's' : ''}…`, 'info');
    const errors = [];
    for (const recipe of affected) {
      const updated = icReplaceIngrName(recipe.ingredients, srcName, targetDisplay);
      const { error: uErr } = await sb
        .from('recipes')
        .update({ ingredients: updated })
        .eq('id', recipe.id);
      if (uErr) errors.push(`Recipe "${recipe.title}": ${uErr.message}`);
    }
    if (errors.length) throw new Error(errors.join('; '));

    // ── Step 4: Deactivate source, set merge note ─────────────
    setStatus('⏳ Deactivating source ingredient…', 'info');
    const { error: dErr } = await sb
      .from('ingredients')
      .update({
        active:     false,
        notes:      'merged_into:' + targetId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', srcId);
    if (dErr) throw new Error('Deactivating source: ' + dErr.message);

    // ── Step 5: Update local cache ────────────────────────────
    const srcLocal = (window._icData || []).find(r => r.id === srcId);
    if (srcLocal) { srcLocal.active = false; srcLocal.notes = 'merged_into:' + targetId; }
    const tgtLocal = (window._icData || []).find(r => r.id === targetId);
    if (tgtLocal) { tgtLocal.name = targetDisplay; }

    setStatus(
      `✅ Merge complete.<br>` +
      `• ${affected.length} recipe${affected.length !== 1 ? 's' : ''} updated<br>` +
      `• Target renamed to "<strong>${escHtml(targetDisplay)}</strong>"<br>` +
      `• Source deactivated`,
      'success'
    );
    if (btn) { btn.textContent = '✓ Done'; btn.style.background = '#10b981'; }

    // Re-render source row in cleanup list, close modal after short delay
    const row = document.getElementById('icRow-' + srcId);
    if (row && srcLocal) {
      row.style.transition = 'opacity .3s';
      row.style.opacity = '0';
      setTimeout(() => {
        if (srcLocal) row.outerHTML = icRowHTML(srcLocal);
        icUpdateSummary();
      }, 300);
    }
    // Fire success callback (e.g. dismiss similarity card)
    const cb = window._icMergeCallbacks && window._icMergeCallbacks[srcId];
    if (cb) { delete window._icMergeCallbacks[srcId]; setTimeout(cb, 400); }
    setTimeout(() => {
      const m = document.getElementById('icMergeModal');
      if (m) m.remove();
    }, 1800);

  } catch(e) {
    setStatus('✗ ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔀 Merge & Update Recipes'; btn.style.background = '#1e293b'; }
  }
};

// ── Extract ingredient list from recipes.ingredients jsonb ────
function icExtractIngrList(ingr) {
  if (Array.isArray(ingr)) return ingr;
  if (ingr && Array.isArray(ingr.ingredients)) return ingr.ingredients;
  return [];
}

// ── Replace ingredient name in jsonb, keep qty/unit intact ────
function icReplaceIngrName(ingr, srcName, targetDisplay) {
  const srcKey = srcName.toLowerCase().trim();
  if (Array.isArray(ingr)) {
    return ingr.map(i => {
      if ((i.name || '').toLowerCase().trim() === srcKey) {
        return { ...i, name: targetDisplay };
      }
      return i;
    });
  }
  if (ingr && Array.isArray(ingr.ingredients)) {
    return {
      ...ingr,
      ingredients: ingr.ingredients.map(i => {
        if ((i.name || '').toLowerCase().trim() === srcKey) {
          return { ...i, name: targetDisplay };
        }
        return i;
      }),
    };
  }
  return ingr;
}

// ── Mark OK ───────────────────────────────────────────────────
window.icMarkOk = async function(id) {
  icSetRowBusy(id, true);
  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const { error } = await sb
      .from('ingredients')
      .update({ notes: 'cleanup_ok', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);

    const rec = window._icData.find(r => r.id === id);
    if (rec) rec.notes = 'cleanup_ok';

    // In suspicious tab: fade out and remove. In all tab: re-render row.
    if (window._icTab === 'suspicious') {
      const row = document.getElementById('icRow-' + id);
      if (row) {
        row.style.transition = 'opacity .25s';
        row.style.opacity = '0';
        setTimeout(() => { row.remove(); icUpdateSummary(); }, 250);
      }
    } else {
      const row = document.getElementById('icRow-' + id);
      if (row) row.outerHTML = icRowHTML(rec);
    }
  } catch(e) {
    icSetRowBusy(id, false);
    icShowRowStatus(id, '✗ ' + e.message, '#991b1b');
  }
};

// ── Deactivate ────────────────────────────────────────────────
window.icDeactivate = async function(id) {
  icSetRowBusy(id, true);
  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const { error } = await sb
      .from('ingredients')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);

    const rec = window._icData.find(r => r.id === id);
    if (rec) rec.active = false;

    const row = document.getElementById('icRow-' + id);
    if (row) row.outerHTML = icRowHTML(rec);
  } catch(e) {
    icSetRowBusy(id, false);
    icShowRowStatus(id, '✗ ' + e.message, '#991b1b');
  }
};

// ── Helpers ───────────────────────────────────────────────────
function icSetRowBusy(id, busy) {
  const actions = document.getElementById('icActions-' + id);
  const form    = document.getElementById('icEditForm-' + id);
  if (actions) actions.style.opacity = busy ? '0.4' : '1';
  if (actions) actions.style.pointerEvents = busy ? 'none' : '';
  if (form)    form.style.opacity = busy ? '0.4' : '1';
  if (form)    form.style.pointerEvents = busy ? 'none' : '';
}

function icShowRowStatus(id, msg, color) {
  const el = document.getElementById('icRowStatus-' + id);
  if (!el) return;
  el.style.display = 'block';
  el.style.color = color || '#1e293b';
  el.textContent = msg;
}

function icUpdateSummary() {
  // Recount suspicious after a removal
  const suspicious = (window._icData || []).filter(i => icIsSuspicious(i));
  const total      = (window._icData || []).length;
  const inactive   = (window._icData || []).filter(i => !i.active).length;
  const summaryEl  = document.querySelector('#icList > div:first-child');
  if (summaryEl && summaryEl.innerHTML.includes('Total:')) {
    summaryEl.innerHTML =
      `<span>Total: <strong style="color:#1e293b;">${total}</strong></span>` +
      `<span style="color:#f59e0b;">⚠️ Suspicious: <strong>${suspicious.length}</strong></span>` +
      `<span style="color:#94a3b8;">Inactive: <strong>${inactive}</strong></span>`;
  }
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  return (str || '').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

// ── INGREDIENT SIMILARITY CLEANUP ────────────────────────────
// Finds likely duplicate ingredients using normalization + stemming.
// Groups candidates and lets admin merge via the existing merge engine.
// Never auto-merges. Active ingredients only.

// ── Normalize a name for similarity comparison ────────────────
function simNormalize(name) {
  let s = (name || '').toLowerCase().trim();
  // remove punctuation
  s = s.replace(/[^a-z0-9\s]/g, '');
  // collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ── Simple English stemmer (suffix stripping) ─────────────────
// Handles the most common kitchen-ingredient plurals and variants
function simStem(s) {
  // ies → y  (berries → berry, cherries → cherry)
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y';
  // ves → f   (leaves → leaf, knives → knife)
  if (s.endsWith('ves') && s.length > 4) return s.slice(0, -3) + 'f';
  // es after sibilant (tomatoes → tomato, potatoes → potato)
  if (s.endsWith('oes')) return s.slice(0, -2);
  // shrimps/clams/beans → drop trailing s  (but not "bass", "ress")
  if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) return s.slice(0, -1);
  // -ed suffix  (canned → can, dried → drie → already handled by ies)
  if (s.endsWith('ned') && s.length > 4) return s.slice(0, -3);
  if (s.endsWith('ed') && s.length > 4) return s.slice(0, -2);
  return s;
}

// ── Build a single comparison key ─────────────────────────────
function simKey(name) {
  const norm = simNormalize(name);
  // stem each word individually
  return norm.split(' ').map(simStem).join(' ');
}

// ── Find duplicate groups among active ingredients ─────────────
// Returns [ [ingr, ingr, ...], ... ] — only groups with ≥2 members
function simFindGroups(ingredients) {
  const map = new Map(); // key → [ingr, ...]
  for (const ingr of ingredients) {
    const k = simKey(ingr.name);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(ingr);
  }
  return [...map.values()].filter(g => g.length >= 2);
}

// ── Count how many recipes use an ingredient name ─────────────
function simRecipeCount(ingrName, recipes) {
  const key = (ingrName || '').toLowerCase().trim();
  return (recipes || []).filter(r => {
    const list = icExtractIngrList(r.ingredients);
    return list.some(i => (i.name || '').toLowerCase().trim() === key);
  }).length;
}

// ── Open the Similarity Cleanup modal ─────────────────────────
window.openSimilarityCleanup = function() {
  if (!isAdmin()) return;

  const modal = document.createElement('div');
  modal.id = 'simModal';
  modal.className = 'fixed inset-0 z-[65] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;">
      <button onclick="this.closest('#simModal').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:600;color:#1e293b;">🔍 Similarity Cleanup</div>
        <div style="font-size:11px;color:#94a3b8;">Likely duplicates — admin only</div>
      </div>
      <button onclick="simLoad()" style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">↻ Refresh</button>
    </div>
    <div style="padding:16px;max-width:640px;width:100%;margin:0 auto;">
      <div id="simList">
        <div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  simLoad();
};

// ── Load and render groups ─────────────────────────────────────
window.simLoad = async function() {
  const list = document.getElementById('simList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    // Fetch active ingredients
    const { data: ingredients, error: iErr } = await sb
      .from('ingredients')
      .select('id,name,category,active,notes')
      .eq('active', true);
    if (iErr) throw new Error(iErr.message);

    // Fetch all recipes (for recipe counts)
    const { data: recipes, error: rErr } = await sb
      .from('recipes')
      .select('id,title,ingredients');
    if (rErr) throw new Error(rErr.message);

    const groups = simFindGroups(ingredients || []);

    // Attach recipe counts to each ingredient in each group
    const groupsWithCounts = groups.map(group =>
      group.map(ingr => ({
        ...ingr,
        _recipeCount: simRecipeCount(ingr.name, recipes || []),
      }))
    );

    // Sort each group: higher recipe count first (becomes default merge target)
    groupsWithCounts.forEach(g =>
      g.sort((a, b) => b._recipeCount - a._recipeCount)
    );

    // Sort groups: most recipe usage first
    groupsWithCounts.sort((a, b) => {
      const aMax = Math.max(...a.map(i => i._recipeCount));
      const bMax = Math.max(...b.map(i => i._recipeCount));
      return bMax - aMax;
    });

    // Store for use by action handlers
    window._simGroups    = groupsWithCounts;
    window._simRecipes   = recipes || [];
    window._simDismissed = window._simDismissed || new Set();

    simRender();

  } catch(e) {
    if (list) list.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#991b1b;font-size:13px;">✗ ${e.message}</div>`;
  }
};

// ── Render all groups ──────────────────────────────────────────
function simRender() {
  const list = document.getElementById('simList');
  if (!list) return;

  const groups  = (window._simGroups || []);
  const dismissed = window._simDismissed || new Set();

  // Filter out dismissed groups and groups where all members are gone
  const active = groups.filter((g, gIdx) => !dismissed.has(gIdx));

  if (active.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:48px 0;">
        <div style="font-size:32px;margin-bottom:10px;">✅</div>
        <div style="font-size:14px;font-weight:500;color:#1e293b;margin-bottom:4px;">No duplicates found</div>
        <div style="font-size:12px;color:#94a3b8;">Active ingredient names look unique</div>
      </div>`;
    return;
  }

  const total = groups.length;
  const html = `
    <div style="font-size:12px;color:#64748b;margin-bottom:12px;">
      <strong style="color:#1e293b;">${active.length}</strong> possible duplicate group${active.length !== 1 ? 's' : ''} found
      ${dismissed.size > 0 ? `<span style="color:#94a3b8;"> · ${dismissed.size} dismissed</span>` : ''}
    </div>
    ${active.map((group, localIdx) => {
      // Find original index for dismiss tracking
      const gIdx = groups.indexOf(group);
      return simGroupHTML(group, gIdx);
    }).join('')}`;

  list.innerHTML = html;
}

// ── Render one group card ──────────────────────────────────────
// Buttons pass only numeric indices — no names in HTML attributes.
// Names are retrieved from window._simGroups at click time.
function simGroupHTML(group, gIdx) {
  return `
    <div id="simGroup-${gIdx}" style="border:1px solid rgba(99,102,241,0.2);border-radius:14px;padding:13px 14px;margin-bottom:10px;background:rgba(99,102,241,0.02);">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">
        Possible Duplicate
      </div>
      <!-- Ingredient chips -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
        ${group.map((ingr, iIdx) => `
          <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:7px 11px;flex-shrink:0;">
            <div style="font-size:13px;font-weight:600;color:#1e293b;">${escHtml(ingr.name)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:1px;">
              ${ingr._recipeCount > 0
                ? `<span style="color:#3B82F6;">${ingr._recipeCount} recipe${ingr._recipeCount !== 1 ? 's' : ''}</span>`
                : '<span>0 recipes</span>'}
            </div>
          </div>
          ${iIdx < group.length - 1 ? '<span style="color:#94a3b8;font-size:16px;">↔</span>' : ''}`
        ).join('')}
      </div>
      <!-- Actions: indices only in onclick — no names/ids in HTML attributes -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        ${group.length === 2 ? `
          <button onclick="simMerge(${gIdx}, 1, 0)"
            style="height:32px;padding:0 12px;border-radius:8px;background:#1e293b;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;">
            🔀 Merge → ${escHtml(group[0].name)}
          </button>` :
          group.slice(1).map((ingr, i) => `
            <button onclick="simMerge(${gIdx}, ${i + 1}, 0)"
              style="height:32px;padding:0 12px;border-radius:8px;background:#1e293b;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;margin-bottom:2px;">
              🔀 Merge "${escHtml(ingr.name)}" → "${escHtml(group[0].name)}"
            </button>`).join('')
        }
        <button onclick="simDismiss(${gIdx})"
          style="height:32px;padding:0 12px;border-radius:8px;background:#f1f5f9;color:#64748b;font-size:12px;font-weight:500;border:none;cursor:pointer;">
          Not Duplicate
        </button>
      </div>
    </div>`;
}

// ── Dismiss a group (Not Duplicate) ───────────────────────────
window.simDismiss = function(gIdx) {
  if (!window._simDismissed) window._simDismissed = new Set();
  window._simDismissed.add(gIdx);
  const card = document.getElementById('simGroup-' + gIdx);
  if (card) {
    card.style.transition = 'opacity .2s';
    card.style.opacity = '0';
    setTimeout(() => { card.remove(); simRenderSummary(); }, 200);
  }
};

// ── Trigger merge via existing engine ─────────────────────────
// srcIdx/targetIdx are positions within group — no strings in HTML attributes.
window.simMerge = async function(gIdx, srcIdx, targetIdx) {
  const groups = window._simGroups || [];
  const group  = groups[gIdx];
  if (!group) return;

  const srcRec    = group[srcIdx];
  const targetRec = group[targetIdx];
  if (!srcRec || !targetRec) return;

  const targetDisplay = icTitleCase(targetRec.name);

  try {
    // Pass a callback so the similarity card is removed after successful merge
    await icShowMergeConfirm(srcRec, targetRec, targetDisplay, function() {
      simDismiss(gIdx);
      showScToast('✓ Merged: ' + srcRec.name + ' → ' + targetDisplay);
    });
  } catch(e) {
    showScToast('Error: ' + e.message);
  }
};

// ── Update summary count after dismissal ─────────────────────
function simRenderSummary() {
  const groups    = window._simGroups || [];
  const dismissed = window._simDismissed || new Set();
  const remaining = groups.filter((_, i) => !dismissed.has(i)).length;
  const summaryEl = document.querySelector('#simList > div:first-child');
  if (summaryEl && summaryEl.textContent.includes('possible duplicate')) {
    summaryEl.innerHTML =
      `<strong style="color:#1e293b;">${remaining}</strong> possible duplicate group${remaining !== 1 ? 's' : ''} found` +
      (dismissed.size > 0 ? ` <span style="color:#94a3b8;"> · ${dismissed.size} dismissed</span>` : '');
  }
  if (remaining === 0) simRender();
}

// ══════════════════════════════════════════════════════════════
// VENDOR MATCH V1
// Connect approved vendor document items to canonical ingredients.
// Match key: vendor + vendor_sku (stable across invoices).
// Creates: vendor_item_aliases + ingredient_vendors records.
// Does NOT touch: inventory, recipe_bom, costing, purchase history.
// ══════════════════════════════════════════════════════════════

// ── Token-overlap confidence scorer ──────────────────────────
// Returns 0–100. Used for auto-suggest only — human confirms.
function vmScore(vendorName, ingrName) {
  function tokens(s) {
    return (s || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 1 &&
        !['the','and','or','of','in','a','an','with','no','not',
          'fresh','dried','whole','sliced','diced','chopped',
          'frozen','canned','raw','cooked','large','small','medium',
          'hass','choice','grade','select','extra','premium'].includes(t));
  }
  const vt = new Set(tokens(vendorName));
  const it = new Set(tokens(ingrName));
  if (!vt.size || !it.size) return 0;
  let overlap = 0;
  for (const t of vt) if (it.has(t)) overlap++;
  // Jaccard-style: overlap / union
  const union = new Set([...vt, ...it]).size;
  return Math.round((overlap / union) * 100);
}

// ── Suggest best ingredient match for a vendor item name ──────
// Returns { ingredient, score } or null
function vmSuggest(vendorItemName, ingredients) {
  let best = null, bestScore = 0;
  for (const ingr of ingredients) {
    const score = vmScore(vendorItemName, ingr.name);
    if (score > bestScore) { bestScore = score; best = ingr; }
  }
  return bestScore >= 40 ? { ingredient: best, score: bestScore } : null;
}

// ── Extract all unique vendor items from approved documents ───
// Returns [ { vendor, vendor_sku, vendor_item_name, pack_description,
//             unit_price, pack_size, pack_unit, last_invoice_date,
//             purchase_unit } ]
// Keyed by vendor+sku — last-seen price wins.
function vmExtractItems(docs) {
  const map = new Map(); // key: vendor|sku
  for (const doc of docs) {
    const pj    = doc.parsed_json || {};
    const items = Array.isArray(pj.items) ? pj.items
                : Array.isArray(pj.ingredients) ? pj.ingredients : [];
    const docDate = doc.document_date || null;
    for (const item of items) {
      const sku  = (item.vendor_sku || '').trim();
      const name = (item.description || item.raw_description || '').trim();
      if (!name) continue;
      const key  = (doc.vendor || '') + '|' + sku;
      const existing = map.get(key);
      // Keep most recent entry (docs are ordered newest-first)
      if (!existing) {
        map.set(key, {
          vendor:            doc.vendor || '',
          vendor_sku:        sku || null,
          vendor_item_name:  name,
          pack_description:  item.pack_description || null,
          unit_price:        item.unit_price        != null ? item.unit_price : null,
          pack_size:         item.pack_qty           != null ? item.pack_qty  : null,
          pack_unit:         item.pack_unit          || null,
          purchase_unit:     item.purchase_unit      || 'lb',
          last_invoice_date: docDate,
        });
      }
    }
  }
  return [...map.values()];
}

// ── Main entry point ──────────────────────────────────────────
window.openVendorMatch = function() {
  if (!isAdmin()) return;

  const modal = document.createElement('div');
  modal.id    = 'vmModal';
  modal.className = 'fixed inset-0 z-[65] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;">
      <button onclick="this.closest('#vmModal').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:600;color:#1e293b;">🔗 Vendor Match</div>
        <div style="font-size:11px;color:#94a3b8;">Map vendor items to canonical ingredients</div>
      </div>
      <button onclick="vmLoad()" style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">↻ Refresh</button>
    </div>
    <!-- Progress bar -->
    <div id="vmProgress" style="display:none;padding:10px 16px;background:#f8fafc;border-bottom:1px solid #f1f5f9;">
      <div style="display:flex;gap:16px;font-size:12px;">
        <span>Unmatched: <strong id="vmCountUnmatched" style="color:#f59e0b;">—</strong></span>
        <span>Matched: <strong id="vmCountMatched" style="color:#10b981;">—</strong></span>
        <span style="color:#94a3b8;">Total items: <strong id="vmCountTotal">—</strong></span>
      </div>
    </div>
    <!-- Debug output (temporary) -->
    <div id="vmDebug" style="display:none;padding:8px 16px;background:#fefce8;border-bottom:1px solid rgba(234,179,8,0.2);font-size:11px;color:#78350f;line-height:1.6;"></div>

    <!-- Filter tabs -->
    <div style="padding:10px 16px 0;display:flex;gap:6px;">
      <button id="vmTabUnmatched" onclick="vmSetTab('unmatched')"
        style="padding:5px 12px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:600;background:#1e293b;color:white;">
        Unmatched
      </button>
      <button id="vmTabMatched" onclick="vmSetTab('matched')"
        style="padding:5px 12px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:500;background:#f1f5f9;color:#64748b;">
        Matched
      </button>
    </div>
    <div style="padding:12px 16px;max-width:680px;width:100%;margin:0 auto;">
      <div id="vmList">
        <div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  window._vmTab = 'unmatched';
  vmLoad();
};

// ── Load data ─────────────────────────────────────────────────
window.vmLoad = async function() {
  const list = document.getElementById('vmList');
  const prog = document.getElementById('vmProgress');
  if (list) list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    // Load vendor docs — accept any status that has parsed content
    const { data: docs, error: dErr } = await sb
      .from('vendor_documents')
      .select('id,vendor,document_date,document_number,status,parsed_json')
      .in('status', ['approved', 'imported', 'pending'])
      .order('document_date', { ascending: false });
    if (dErr) throw new Error(dErr.message);

    // ── DEBUG: show what we loaded ─────────────────────────────
    const debugInfo = {
      docsLoaded: (docs || []).length,
      byStatus: {},
      sampleKeys: [],
    };
    for (const d of (docs || [])) {
      debugInfo.byStatus[d.status] = (debugInfo.byStatus[d.status] || 0) + 1;
      if (debugInfo.sampleKeys.length < 2) {
        const pj = d.parsed_json || {};
        debugInfo.sampleKeys.push({
          id: d.id,
          status: d.status,
          topKeys: Object.keys(pj).slice(0, 8),
          itemsKey: Array.isArray(pj.items) ? 'items[' + pj.items.length + ']'
                  : Array.isArray(pj.ingredients) ? 'ingredients[' + pj.ingredients.length + ']'
                  : 'no array found',
        });
      }
    }
    console.log('[VendorMatch] docs loaded:', debugInfo);

    // Active ingredients
    const { data: ingredients, error: iErr } = await sb
      .from('ingredients')
      .select('id,name,category')
      .eq('active', true)
      .order('name');
    if (iErr) throw new Error(iErr.message);

    // Existing aliases (vendor+sku already matched)
    const { data: aliases, error: aErr } = await sb
      .from('vendor_item_aliases')
      .select('vendor,vendor_sku,vendor_description,ingredient_id,ingredients(name)');
    if (aErr) throw new Error(aErr.message);

    // Build matched set keyed by vendor|sku
    const matchedSet = new Map();
    for (const a of (aliases || [])) {
      const key = (a.vendor || '') + '|' + (a.vendor_sku || '');
      matchedSet.set(key, a);
    }

    // Extract all unique items from docs
    const allItems = vmExtractItems(docs || []);
    console.log('[VendorMatch] unique items extracted:', allItems.length,
      '| sample:', allItems.slice(0, 2).map(i => i.vendor_item_name));

    // Attach match status and suggestion to each item
    const enriched = allItems.map(item => {
      const key     = item.vendor + '|' + (item.vendor_sku || '');
      const matched = matchedSet.get(key) || null;
      const suggest = matched ? null : vmSuggest(item.vendor_item_name, ingredients || []);
      return { ...item, _key: key, _matched: matched, _suggest: suggest };
    });

    // Store globally
    window._vmItems       = enriched;
    window._vmIngredients = ingredients || [];
    window._vmDismissed   = window._vmDismissed || new Set();

    // Update progress
    const matchedCount   = enriched.filter(i => i._matched).length;
    const unmatchedCount = enriched.filter(i => !i._matched).length;
    if (prog) prog.style.display = 'block';
    vmUpdateProgress(unmatchedCount, matchedCount, enriched.length);

    // ── Debug panel (visible in UI) ──────────────────────────
    const dbgEl = document.getElementById('vmDebug');
    if (dbgEl) {
      const rawLineCount = (docs || []).reduce((n, d) => {
        const pj = d.parsed_json || {};
        return n + (Array.isArray(pj.items) ? pj.items.length
                  : Array.isArray(pj.ingredients) ? pj.ingredients.length : 0);
      }, 0);
      dbgEl.style.display = 'block';
      dbgEl.innerHTML =
        `<strong>Debug:</strong> ` +
        `Documents loaded: <strong>${(docs||[]).length}</strong> ` +
        `(${JSON.stringify(debugInfo.byStatus)}) · ` +
        `Raw lines: <strong>${rawLineCount}</strong> · ` +
        `Unique vendor items: <strong>${allItems.length}</strong> · ` +
        `Ingredients in DB: <strong>${(ingredients||[]).length}</strong>`;
    }

    vmRender();

  } catch(e) {
    if (list) list.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#991b1b;font-size:13px;">✗ ${e.message}</div>`;
  }
};

window._vmTab = 'unmatched';

window.vmSetTab = function(tab) {
  window._vmTab = tab;
  const u = document.getElementById('vmTabUnmatched');
  const m = document.getElementById('vmTabMatched');
  if (u) { u.style.background = tab === 'unmatched' ? '#1e293b' : '#f1f5f9'; u.style.color = tab === 'unmatched' ? 'white' : '#64748b'; }
  if (m) { m.style.background = tab === 'matched'   ? '#1e293b' : '#f1f5f9'; m.style.color = tab === 'matched'   ? 'white' : '#64748b'; }
  vmRender();
};

function vmUpdateProgress(unmatched, matched, total) {
  const u = document.getElementById('vmCountUnmatched');
  const m = document.getElementById('vmCountMatched');
  const t = document.getElementById('vmCountTotal');
  if (u) u.textContent = unmatched;
  if (m) m.textContent = matched;
  if (t) t.textContent = total;
}

// ── Render item list ──────────────────────────────────────────
function vmRender() {
  const list = document.getElementById('vmList');
  if (!list) return;
  const tab   = window._vmTab || 'unmatched';
  const items = (window._vmItems || []).filter(i =>
    tab === 'unmatched' ? !i._matched : !!i._matched
  );

  if (items.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:48px 0;">
        <div style="font-size:32px;margin-bottom:10px;">${tab === 'unmatched' ? '✅' : '📭'}</div>
        <div style="font-size:14px;font-weight:500;color:#1e293b;">
          ${tab === 'unmatched' ? 'All items matched' : 'No matched items yet'}
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px;">
          ${tab === 'unmatched' ? 'Nothing left to review' : 'Approve some matches first'}
        </div>
      </div>`;
    return;
  }

  list.innerHTML = items.map((item, idx) => vmItemHTML(item, idx)).join('');
}

// ── Single item card ──────────────────────────────────────────
function vmItemHTML(item, idx) {
  const cardId = 'vmCard-' + encodeURIComponent(item._key).replace(/%/g, '_');

  if (item._matched) {
    // Matched card — compact, shows what it's linked to
    const ingrName = item._matched.ingredients?.name || '—';
    return `
      <div id="${cardId}" style="border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:11px 13px;margin-bottom:8px;background:rgba(16,185,129,0.02);">
        <div style="display:flex;align-items:start;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:#1e293b;">${escHtml(item.vendor_item_name)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:1px;">
              ${escHtml(item.vendor)} ${item.vendor_sku ? '· SKU ' + escHtml(item.vendor_sku) : ''}
              ${item.pack_description ? '· ' + escHtml(item.pack_description) : ''}
              ${item.unit_price != null ? '· $' + item.unit_price.toFixed(2) : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:11px;color:#10b981;font-weight:600;">✓ ${escHtml(ingrName)}</div>
          </div>
        </div>
      </div>`;
  }

  // Unmatched card — full OQR interaction
  const suggest = item._suggest;
  const confColor = !suggest ? '#94a3b8'
    : suggest.score >= 80 ? '#10b981'
    : suggest.score >= 60 ? '#3B82F6'
    : '#f59e0b';

  // Store item index for onclick handlers (no data in attributes)
  const safeIdx = (window._vmItems || []).indexOf(item);

  return `
    <div id="${cardId}" style="border:1px solid #f1f5f9;border-radius:12px;padding:12px 13px;margin-bottom:8px;">
      <!-- Vendor item info -->
      <div style="margin-bottom:10px;">
        <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:2px;">${escHtml(item.vendor_item_name)}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#94a3b8;">
          <span>${escHtml(item.vendor)}</span>
          ${item.vendor_sku  ? `<span>SKU: ${escHtml(item.vendor_sku)}</span>` : ''}
          ${item.pack_description ? `<span>${escHtml(item.pack_description)}</span>` : ''}
          ${item.unit_price != null ? `<span style="color:#1e293b;font-weight:500;">$${item.unit_price.toFixed(2)}</span>` : ''}
        </div>
      </div>

      <!-- Suggestion -->
      ${suggest ? `
      <div style="background:#f8fafc;border-radius:10px;padding:9px 11px;margin-bottom:9px;">
        <div style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Suggested Match</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:13px;font-weight:600;color:#1e293b;">${escHtml(suggest.ingredient.name)}</span>
          <span style="font-size:11px;font-weight:600;color:${confColor};background:${confColor}12;padding:2px 7px;border-radius:20px;">${suggest.score}% match</span>
          ${suggest.ingredient.category ? `<span style="font-size:11px;color:#94a3b8;">${escHtml(suggest.ingredient.category)}</span>` : ''}
        </div>
      </div>` : `
      <div style="background:#fefce8;border:1px solid rgba(234,179,8,0.2);border-radius:10px;padding:8px 11px;margin-bottom:9px;font-size:12px;color:#78350f;">
        No automatic match found — choose manually.
      </div>`}

      <!-- Action buttons -->
      <div id="vmActions-${safeIdx}" style="display:flex;gap:7px;flex-wrap:wrap;">
        ${suggest ? `
        <button onclick="vmApprove(${safeIdx})"
          style="height:34px;padding:0 14px;border-radius:9px;background:#1e293b;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;">
          ✓ Approve Match
        </button>` : ''}
        <button onclick="vmChooseDifferent(${safeIdx})"
          style="height:34px;padding:0 14px;border-radius:9px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:12px;font-weight:500;border:none;cursor:pointer;">
          ${suggest ? 'Choose Different' : '🔍 Choose Ingredient'}
        </button>
      </div>

      <!-- Inline search (hidden until Choose Different) -->
      <div id="vmSearch-${safeIdx}" style="display:none;margin-top:10px;">
        <input id="vmSearchInput-${safeIdx}" type="text" placeholder="Type ingredient name…"
          oninput="vmFilterIngredients(${safeIdx})"
          style="width:100%;height:36px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;box-sizing:border-box;" />
        <div id="vmSearchResults-${safeIdx}" style="margin-top:6px;max-height:200px;overflow-y:auto;border:1px solid #f1f5f9;border-radius:8px;"></div>
      </div>

      <!-- Status -->
      <div id="vmStatus-${safeIdx}" style="display:none;margin-top:7px;font-size:12px;"></div>
    </div>`;
}

// ── Approve suggested match ───────────────────────────────────
window.vmApprove = async function(idx) {
  const item = (window._vmItems || [])[idx];
  if (!item || !item._suggest) return;
  await vmSaveMatch(idx, item._suggest.ingredient);
};

// ── Show inline ingredient search ────────────────────────────
window.vmChooseDifferent = function(idx) {
  const searchEl  = document.getElementById('vmSearch-'  + idx);
  const actionsEl = document.getElementById('vmActions-' + idx);
  const inputEl   = document.getElementById('vmSearchInput-' + idx);
  if (searchEl)  searchEl.style.display  = 'block';
  if (actionsEl) actionsEl.style.display = 'none';
  if (inputEl)   { inputEl.focus(); vmFilterIngredients(idx); }
};

// ── Live filter ingredient list ───────────────────────────────
window.vmFilterIngredients = function(idx) {
  const input   = document.getElementById('vmSearchInput-' + idx);
  const results = document.getElementById('vmSearchResults-' + idx);
  if (!input || !results) return;

  const q     = input.value.toLowerCase().trim();
  const ingrs = (window._vmIngredients || []);
  const shown = q.length === 0
    ? ingrs.slice(0, 30)
    : ingrs.filter(i => i.name.toLowerCase().includes(q)).slice(0, 30);

  if (shown.length === 0) {
    results.innerHTML = '<div style="padding:10px;font-size:12px;color:#94a3b8;">No ingredients found</div>';
    return;
  }

  results.innerHTML = shown.map(ingr => `
    <div onclick="vmSelectIngredient(${idx}, '${escAttr(ingr.id)}')"
      style="padding:8px 11px;font-size:12px;color:#1e293b;cursor:pointer;border-bottom:0.5px solid #f8fafc;"
      onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <span style="font-weight:500;">${escHtml(ingr.name)}</span>
      ${ingr.category ? `<span style="color:#94a3b8;font-size:11px;margin-left:6px;">${escHtml(ingr.category)}</span>` : ''}
    </div>`).join('');
};

// ── Select ingredient from search results ─────────────────────
window.vmSelectIngredient = async function(idx, ingrId) {
  const ingr = (window._vmIngredients || []).find(i => i.id === ingrId);
  if (!ingr) return;
  await vmSaveMatch(idx, ingr);
};

// ── Save the match to both tables ────────────────────────────
async function vmSaveMatch(idx, ingr) {
  const item = (window._vmItems || [])[idx];
  if (!item) return;

  // Disable actions
  const actionsEl = document.getElementById('vmActions-' + idx);
  const searchEl  = document.getElementById('vmSearch-'  + idx);
  const statusEl  = document.getElementById('vmStatus-'  + idx);
  if (actionsEl) actionsEl.style.opacity = '0.4';
  if (actionsEl) actionsEl.style.pointerEvents = 'none';
  if (searchEl)  searchEl.style.display = 'none';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const now = new Date().toISOString();
    const user = window.user;
    const confirmedBy = user?.name || user?.email || 'admin';

    // ── 1. Upsert vendor_item_aliases ─────────────────────────
    // Unique key: vendor + vendor_sku (or vendor + vendor_description if no sku)
    const aliasPayload = {
      vendor:             item.vendor,
      vendor_sku:         item.vendor_sku   || null,
      vendor_description: item.vendor_item_name,
      ingredient_id:      ingr.id,
      confirmed_by:       confirmedBy,
      confirmed_at:       now,
      active:             true,
    };

    const { error: aErr } = await sb
      .from('vendor_item_aliases')
      .upsert(aliasPayload, {
        onConflict: item.vendor_sku
          ? 'vendor,vendor_sku'
          : 'vendor,vendor_description',
        ignoreDuplicates: false,
      });
    if (aErr) throw new Error('Saving alias: ' + aErr.message);

    // ── 2. Upsert ingredient_vendors ──────────────────────────
    const ivPayload = {
      ingredient_id:     ingr.id,
      vendor:            item.vendor,
      vendor_sku:        item.vendor_sku   || null,
      purchase_unit:     item.purchase_unit || 'lb',
      pack_description:  item.pack_description || null,
      pack_size:         item.pack_size     != null ? item.pack_size  : null,
      pack_unit:         item.pack_unit     || null,
      unit_price:        item.unit_price    != null ? item.unit_price : null,
      last_invoice_date: item.last_invoice_date || null,
      active:            true,
      updated_at:        now,
    };

    const { error: ivErr } = await sb
      .from('ingredient_vendors')
      .upsert(ivPayload, {
        onConflict: 'ingredient_id,vendor',
        ignoreDuplicates: false,
      });
    if (ivErr) throw new Error('Saving ingredient_vendors: ' + ivErr.message);

    // ── 3. Update local state ─────────────────────────────────
    item._matched = { vendor: item.vendor, vendor_sku: item.vendor_sku,
                      ingredient_id: ingr.id, ingredients: { name: ingr.name } };
    item._suggest = null;

    // Update progress counters
    const allItems      = window._vmItems || [];
    const matchedCount  = allItems.filter(i => i._matched).length;
    const unmatchedCount = allItems.filter(i => !i._matched).length;
    vmUpdateProgress(unmatchedCount, matchedCount, allItems.length);

    // Fade card out — it moves to Matched tab
    const cardId = 'vmCard-' + encodeURIComponent(item._key).replace(/%/g, '_');
    const card   = document.getElementById(cardId);
    if (card) {
      card.style.transition = 'opacity .25s';
      card.style.opacity    = '0';
      setTimeout(() => { card.remove(); }, 260);
    }

    showScToast('✓ Matched: ' + item.vendor_item_name + ' → ' + ingr.name);

  } catch(e) {
    if (actionsEl) { actionsEl.style.opacity = ''; actionsEl.style.pointerEvents = ''; }
    if (statusEl)  { statusEl.style.display = 'block'; statusEl.style.color = '#991b1b'; statusEl.textContent = '✗ ' + e.message; }
  }
}

// ══════════════════════════════════════════════════════════════
// INGREDIENT CLEANUP V2 — SOFT MERGE
// Finds duplicates via fuzzy matching.
// Soft merge: deactivates source, reassigns FK references.
// Does NOT delete records. Hard merge is a future task.
// ══════════════════════════════════════════════════════════════

// ── Levenshtein distance ──────────────────────────────────────
function icLev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) => Array(n+1).fill(0).map((_, j) => j ? j : i));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1]
               : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// ── Normalise name for fuzzy comparison ──────────────────────
// Returns { spaced, compact }:
//   spaced  = lowercase, no punctuation, single spaces  ("extra vergine")
//   compact = spaced with all spaces removed            ("extravergine")
// Two names are capitalization/spacing/punctuation-only variants when
// either their spaced OR compact forms are identical.
function icFuzzyNorm(name) {
  const spaced = (name||'').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ').trim();
  const compact = spaced.replace(/\s/g, '');
  return { spaced, compact };
}

// ── Strict equality check: same ingredient, different style ───
// Returns true if the two names are only capitalisation / spacing /
// punctuation variants of each other (should go to Standardization,
// never to Duplicates).
function icSameNorm(a, b) {
  const na = icFuzzyNorm(a), nb = icFuzzyNorm(b);
  return na.spaced === nb.spaced || na.compact === nb.compact;
}

// ── Similarity 0–100 between two names ───────────────────────
function icSimilarity(a, b) {
  const na = icFuzzyNorm(a).spaced;
  const nb = icFuzzyNorm(b).spaced;
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const maxLen = Math.max(na.length, nb.length);
  const lev = icLev(na, nb);
  return Math.round((1 - lev / maxLen) * 100);
}

// ── Find duplicate candidate pairs from ingredient list ───────
// Conservative: threshold 96, excludes all same-norm pairs.
// Better to miss a duplicate than to suggest a wrong merge.
function icFindDuplicatePairs(ingredients) {
  const THRESHOLD = 96;
  const active = ingredients.filter(i => i.active && !(i.notes||'').startsWith('merged_into'));
  const pairs = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      // Exclude capitalisation / spacing / punctuation variants entirely
      if (icSameNorm(active[i].name, active[j].name)) continue;
      // Hard guard: identical after simple lowercase+trim (catches invisible char differences)
      if (active[i].name.trim().toLowerCase() === active[j].name.trim().toLowerCase()) continue;
      const score = icSimilarity(active[i].name, active[j].name);
      if (score >= THRESHOLD) {
        const a = active[i], b = active[j];
        const src = a.name.length <= b.name.length ? a : b;
        const tgt = a.name.length <= b.name.length ? b : a;
        pairs.push({ src, tgt, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return pairs.filter(p => {
    if (seen.has(p.src.id)) return false;
    seen.add(p.src.id);
    return true;
  });
}

// ── Find name standardization candidates ─────────────────────
// Returns ingredients where name !== Title Case version of itself.
// These differ only in capitalisation/punctuation — rename only,
// no merge, no FK reassignment, no recipe update.
function icFindStandardizationCases(ingredients) {
  const active = ingredients.filter(i => i.active && !(i.notes||'').startsWith('merged_into'));
  return active.filter(i => {
    const std = icTitleCase(i.name);
    return std !== i.name;
  });
}

// ── Render Merge tab ──────────────────────────────────────────
window.icRenderMerge = function() {
  const list = document.getElementById('icList');
  if (!list) return;

  const ingredients = window._icData || [];
  if (!ingredients.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px 0;color:#94a3b8;font-size:13px;">No ingredient data — refresh first</div>';
    return;
  }

  const pairs   = icFindDuplicatePairs(ingredients);
  const stdCases = icFindStandardizationCases(ingredients);
  window._icMergePairs = pairs;

  // Manual source/target picker (always shown)
  const activeNames = ingredients.filter(i => i.active && !(i.notes||'').startsWith('merged_into'));
  const optionsHTML = activeNames.map(i =>
    `<option value="${escAttr(i.id)}">${escHtml(i.name)}</option>`
  ).join('');

  // ── Duplicates section ────────────────────────────────────
  const dupSection = pairs.length ? `
    <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">
      Suggested Duplicates (${pairs.length})
    </div>
    ${pairs.map((p, idx) => icMergePairHTML(p, idx)).join('')}` : `
    <div style="background:#f0fdf4;border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#166534;">
      ✓ No duplicate ingredients detected
    </div>`;

  // ── Name Standardization section ─────────────────────────
  // Store stdCases globally so bulk action can read them
  window._icStdCases = stdCases;

  const stdSection = stdCases.length ? `
    <div style="margin-top:18px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;flex:1;">
          📝 Name Standardization (${stdCases.length})
        </div>
        <button onclick="icBulkStandardizePreview()"
          style="height:28px;padding:0 12px;border-radius:7px;background:#1e293b;color:white;font-size:11px;font-weight:600;border:none;cursor:pointer;white-space:nowrap;">
          ⚡ Preview All ${stdCases.length}
        </button>
      </div>
      <div style="font-size:11px;color:#64748b;margin-bottom:10px;">
        These differ only in capitalisation. No merge — rename only.
      </div>
      ${stdCases.map((ingr, idx) => {
        const std = icTitleCase(ingr.name);
        return `<div id="icStdRow-${escAttr(ingr.id)}" style="border:1px solid #f1f5f9;border-radius:10px;padding:9px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:12px;color:#94a3b8;">${escHtml(ingr.name)}</span>
            <span style="color:#cbd5e1;font-size:12px;">→</span>
            <span style="font-size:12px;font-weight:600;color:#1e293b;">${escHtml(std)}</span>
          </div>
          <button onclick="icStandardizeName('${escAttr(ingr.id)}','${escAttr(std)}',this)"
            style="height:28px;padding:0 10px;border-radius:7px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:11px;font-weight:500;border:none;cursor:pointer;flex-shrink:0;">
            Rename
          </button>
        </div>`;
      }).join('')}
    </div>` : '';

  list.innerHTML = `
    <div style="font-size:12px;color:#64748b;margin-bottom:14px;">
      <strong style="color:#1e293b;">${pairs.length}</strong> possible duplicate${pairs.length!==1?'s':''}
      ${stdCases.length ? ` · <strong style="color:#3B82F6;">${stdCases.length}</strong> name${stdCases.length!==1?'s':''} to standardize` : ''}
    </div>

    <!-- Manual merge picker -->
    <div style="border:1px solid #f1f5f9;border-radius:12px;padding:12px 14px;margin-bottom:14px;background:#f8fafc;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Manual Merge</div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:8px;">
        <div>
          <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">SOURCE (will be deactivated)</div>
          <select id="icManualSrc" style="width:100%;height:34px;padding:0 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
            <option value="">Select source…</option>${optionsHTML}
          </select>
        </div>
        <div style="font-size:16px;color:#94a3b8;margin-top:14px;">→</div>
        <div>
          <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">TARGET (kept)</div>
          <select id="icManualTgt" style="width:100%;height:34px;padding:0 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
            <option value="">Select target…</option>${optionsHTML}
          </select>
        </div>
      </div>
      <button onclick="icManualMergePreview()"
        style="height:34px;padding:0 14px;border-radius:9px;background:#1e293b;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;">
        Preview Merge
      </button>
    </div>

    ${dupSection}
    ${stdSection}`;
};

// ── Render one suggested pair card ───────────────────────────
function icMergePairHTML(p, idx) {
  const confColor = p.score >= 98 ? '#7c3aed' : p.score >= 97 ? '#10b981' : '#3B82F6';
  const srcNorm = icFuzzyNorm(p.src.name).spaced;
  const tgtNorm = icFuzzyNorm(p.tgt.name).spaced;
  return `
    <div id="icMergePair-${idx}" style="border:1px solid #f1f5f9;border-radius:12px;padding:11px 13px;margin-bottom:8px;">
      <div style="margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:600;color:#991b1b;">${escHtml(p.src.name)}</span>
          <span style="color:#94a3b8;">→</span>
          <span style="font-size:13px;font-weight:600;color:#166534;">${escHtml(p.tgt.name)}</span>
          <span style="font-size:11px;font-weight:700;color:${confColor};background:${confColor}12;padding:2px 7px;border-radius:20px;">${p.score}%</span>
        </div>
        <div style="font-size:10px;color:#cbd5e1;font-family:monospace;">
          norm: "${escHtml(srcNorm)}" → "${escHtml(tgtNorm)}"
          &nbsp;·&nbsp;len: ${p.src.name.length} / ${p.tgt.name.length}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button onclick="icMergePreview('${escAttr(p.src.id)}','${escAttr(p.tgt.id)}')"
          style="height:30px;padding:0 12px;border-radius:8px;background:#1e293b;color:white;font-size:11px;font-weight:500;border:none;cursor:pointer;">
          Preview Merge
        </button>
        <button onclick="icDismissPair(${idx})"
          style="height:30px;padding:0 10px;border-radius:8px;background:#f1f5f9;color:#64748b;font-size:11px;border:none;cursor:pointer;">
          Not Duplicate
        </button>
      </div>
    </div>`;
}

window.icDismissPair = function(idx) {
  const card = document.getElementById('icMergePair-' + idx);
  if (card) { card.style.transition='opacity .2s'; card.style.opacity='0'; setTimeout(()=>card.remove(),200); }
};

// ── Rename ingredient to standardised Title Case ──────────────
// Name only. No merge, no FK update, no recipe change.
window.icStandardizeName = async function(id, stdName, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase not available');
    const { error } = await sb
      .from('ingredients')
      .update({ name: stdName, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    // Update local cache
    const rec = (window._icData || []).find(i => i.id === id);
    if (rec) rec.name = stdName;
    // Fade out row
    const row = document.getElementById('icStdRow-' + id);
    if (row) { row.style.transition='opacity .2s'; row.style.opacity='0'; setTimeout(()=>row.remove(),200); }
    showScToast('✓ Renamed to ' + stdName);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Rename';
    showScToast('Error: ' + e.message);
  }
};

// ── Bulk standardization preview modal ───────────────────────
window.icBulkStandardizePreview = function() {
  const cases = window._icStdCases || [];
  if (!cases.length) { showScToast('Nothing to standardize'); return; }

  // Build preview rows — show first 8, then ellipsis
  const PREVIEW_MAX = 8;
  const shown = cases.slice(0, PREVIEW_MAX);
  const remaining = cases.length - shown.length;

  const rowsHTML = shown.map(ingr => {
    const std = icTitleCase(ingr.name);
    return `<div style="padding:6px 11px;border-bottom:0.5px solid #f8fafc;display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="color:#94a3b8;flex:1;">${escHtml(ingr.name)}</span>
      <span style="color:#cbd5e1;">→</span>
      <span style="font-weight:600;color:#1e293b;flex:1;">${escHtml(std)}</span>
    </div>`;
  }).join('');

  const moreHTML = remaining > 0
    ? `<div style="padding:7px 11px;font-size:11px;color:#94a3b8;text-align:center;">…and ${remaining} more</div>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'icBulkStdModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:20px;width:100%;max-width:440px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.18);">
      <div style="padding:16px 18px 12px;border-bottom:1px solid #f1f5f9;">
        <div style="font-size:15px;font-weight:700;color:#1e293b;">⚡ Bulk Name Standardization</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${cases.length} ingredient names will be capitalised to Title Case</div>
      </div>
      <div style="padding:14px 18px;overflow-y:auto;flex:1;">
        <!-- Safety summary -->
        <div style="background:#f0fdf4;border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:10px 12px;font-size:12px;color:#166534;line-height:1.7;margin-bottom:12px;">
          <strong>Only ingredient.name is updated.</strong><br>
          No merges · No FK updates · No recipe changes<br>
          No deactivation · No notes changes · No id changes
        </div>
        <!-- Preview rows -->
        <div style="border:1px solid #f1f5f9;border-radius:10px;overflow:hidden;margin-bottom:12px;">
          <div style="padding:7px 11px;font-size:11px;font-weight:600;color:#94a3b8;background:#f8fafc;text-transform:uppercase;letter-spacing:.05em;display:flex;gap:8px;">
            <span style="flex:1;">Current name</span>
            <span style="flex:1;">Standardized</span>
          </div>
          ${rowsHTML}${moreHTML}
        </div>
        <div id="icBulkStdStatus" style="display:none;padding:10px 12px;border-radius:10px;font-size:12px;"></div>
      </div>
      <div style="padding:12px 18px 16px;border-top:1px solid #f1f5f9;display:flex;gap:8px;">
        <button onclick="document.getElementById('icBulkStdModal').remove()"
          style="flex:1;height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;border:none;font-size:13px;font-weight:500;cursor:pointer;">
          Cancel
        </button>
        <button id="icBulkStdConfirmBtn" onclick="icDoBulkStandardize()"
          style="flex:2;height:42px;border-radius:12px;background:#1e293b;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;">
          ✓ Apply All ${cases.length} Standardizations
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
};

// ── Execute bulk standardization ──────────────────────────────
window.icDoBulkStandardize = async function() {
  const cases = window._icStdCases || [];
  if (!cases.length) return;

  const btn      = document.getElementById('icBulkStdConfirmBtn');
  const statusEl = document.getElementById('icBulkStdStatus');

  function setStatus(html, type) {
    if (!statusEl) return;
    const c = {
      info:    ['rgba(59,130,246,0.06)','rgba(59,130,246,0.2)','#1e40af'],
      success: ['rgba(16,185,129,0.06)','rgba(16,185,129,0.25)','#065f46'],
      error:   ['rgba(239,68,68,0.06)','rgba(239,68,68,0.25)','#991b1b'],
    }[type];
    statusEl.style.display = 'block';
    statusEl.style.cssText = `display:block;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.7;background:${c[0]};border:1px solid ${c[1]};color:${c[2]};`;
    statusEl.innerHTML = html;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Applying…'; btn.style.background = '#94a3b8'; }

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const BATCH = 50;
    let done = 0;
    const errors = [];
    const now = new Date().toISOString();

    for (let i = 0; i < cases.length; i += BATCH) {
      const batch = cases.slice(i, i + BATCH);
      setStatus(`⏳ Updating names ${i + 1}–${Math.min(i + BATCH, cases.length)} of ${cases.length}…`, 'info');

      // Run batch in parallel — each is a single-row update by id
      const results = await Promise.all(batch.map(ingr => {
        const std = icTitleCase(ingr.name);
        return sb.from('ingredients')
          .update({ name: std, updated_at: now })
          .eq('id', ingr.id)
          .then(({ error }) => {
            if (error) return `"${ingr.name}": ${error.message}`;
            // Update local cache immediately
            const rec = (window._icData || []).find(r => r.id === ingr.id);
            if (rec) rec.name = std;
            done++;
            return null;
          });
      }));

      results.forEach(e => { if (e) errors.push(e); });
    }

    if (errors.length) {
      setStatus(
        `⚠️ ${done} standardized, ${errors.length} failed:<br>${errors.slice(0, 5).map(escHtml).join('<br>')}`,
        'error'
      );
      if (btn) { btn.disabled = false; btn.textContent = 'Retry'; btn.style.background = '#1e293b'; }
    } else {
      setStatus(`✅ ${done} ingredient name${done !== 1 ? 's' : ''} standardized successfully.`, 'success');
      if (btn) { btn.textContent = '✓ Done'; btn.style.background = '#10b981'; }
      // Refresh the list after short delay
      setTimeout(() => {
        document.getElementById('icBulkStdModal')?.remove();
        icLoad().then(() => icSetTab('merge'));
      }, 1200);
    }
  } catch(e) {
    setStatus('✗ ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Apply All'; btn.style.background = '#1e293b'; }
  }
};

// ── Manual merge: read dropdowns, open preview ────────────────
window.icManualMergePreview = function() {
  const srcId = document.getElementById('icManualSrc')?.value;
  const tgtId = document.getElementById('icManualTgt')?.value;
  if (!srcId || !tgtId) { showScToast('Select both source and target'); return; }
  if (srcId === tgtId)  { showScToast('Source and target must be different'); return; }
  icMergePreview(srcId, tgtId);
};

// ── Auto-merge high confidence ────────────────────────────────
window.icAutoMergeHighConf = async function() {
  const pairs = (window._icMergePairs || []).filter(p => p.score >= 98);
  if (!pairs.length) { showScToast('No high-confidence pairs'); return; }
  // Show first one as preview — after confirm, chain to next
  window._icAutoMergeQueue = [...pairs];
  icAutoMergeNext();
};

window.icAutoMergeNext = function() {
  const queue = window._icAutoMergeQueue || [];
  if (!queue.length) { showScToast('✓ Auto-merge complete'); icLoad(); return; }
  const p = queue[0];
  icMergePreview(p.src.id, p.tgt.id, true /* isAuto */);
};

// ── Load affected counts and show confirmation modal ──────────
window.icMergePreview = async function(srcId, tgtId) {
  const sb = window.supabaseClient;
  if (!sb) { showScToast('Supabase not available'); return; }

  const all = window._icData || [];
  const src = all.find(i => i.id === srcId);
  const tgt = all.find(i => i.id === tgtId);
  if (!src || !tgt) { showScToast('Ingredient not found in local data'); return; }

  // Show loading state immediately
  const loadingModal = document.createElement('div');
  loadingModal.id = 'icSoftMergeModal';
  loadingModal.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;padding:16px;';
  loadingModal.innerHTML = `<div style="background:white;border-radius:20px;padding:32px;font-size:13px;color:#94a3b8;">⏳ Loading preview…</div>`;
  document.body.appendChild(loadingModal);

  try {
    // Load FK counts + affected recipes in parallel
    const [ivRes, ilRes, linkRes, recipesRes] = await Promise.all([
      sb.from('ingredient_vendors').select('id', {count:'exact',head:true}).eq('ingredient_id', srcId),
      sb.from('invoice_lines').select('id',      {count:'exact',head:true}).eq('ingredient_id', srcId),
      sb.from('ingredient_links').select('id',   {count:'exact',head:true}).eq('ingredient_id', srcId),
      sb.from('recipes').select('id,title,ingredients'),
    ]);

    const ivCount   = ivRes.count   || 0;
    const ilCount   = ilRes.count   || 0;
    const linkCount = linkRes.count || 0;

    // Find affected recipes — exact name match only
    const srcKey = src.name.toLowerCase().trim();
    const affectedRecipes = (recipesRes.data || []).filter(r => {
      const list = icExtractIngrList(r.ingredients);
      return list.some(i => (i.name||'').toLowerCase().trim() === srcKey);
    });

    // Store everything for icDoSoftMerge
    window._icPendingSoftMerge = {
      srcId, tgtId, srcName: src.name, tgtName: tgt.name,
      affectedRecipes,  // full recipe objects — used by doSoftMerge
    };

    // Build per-recipe before/after rows
    const recipeRowsHTML = affectedRecipes.length ? `
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">
          Recipes (${affectedRecipes.length}) — will be updated
        </div>
        ${affectedRecipes.map(r => {
          const list = icExtractIngrList(r.ingredients);
          const match = list.find(i => (i.name||'').toLowerCase().trim() === srcKey);
          const qty  = match ? (match.qty  || '') : '';
          const unit = match ? (match.unit || '') : '';
          const qtyUnit = [qty, unit].filter(Boolean).join(' ');
          return `<div style="border:1px solid #f1f5f9;border-radius:10px;padding:9px 11px;margin-bottom:5px;">
            <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:5px;">📄 ${escHtml(r.title||'Untitled')}</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:2px;">
              <span style="color:#64748b;font-weight:500;">Current:</span>
              ${qtyUnit?`<span style="color:#475569;">${escHtml(qtyUnit)}</span> `:''}
              <span style="color:#991b1b;">${escHtml(match?match.name:src.name)}</span>
            </div>
            <div style="font-size:11px;color:#94a3b8;">
              <span style="color:#64748b;font-weight:500;">After merge:</span>
              ${qtyUnit?`<span style="color:#475569;">${escHtml(qtyUnit)}</span> `:''}
              <span style="color:#166534;font-weight:600;">${escHtml(tgt.name)}</span>
            </div>
          </div>`;
        }).join('')}
      </div>` : `
      <div style="background:#f8fafc;border-radius:10px;padding:9px 11px;margin-bottom:12px;font-size:12px;color:#64748b;">
        ℹ️ No recipes use "<strong>${escHtml(src.name)}</strong>" — only FK references will be reassigned.
      </div>`;

    loadingModal.innerHTML = `
      <div style="background:white;border-radius:20px;width:100%;max-width:460px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.18);">
        <div style="padding:16px 18px 12px;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:15px;font-weight:700;color:#1e293b;">🔀 Soft Merge Preview</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Review all changes — you decide which name to keep</div>
        </div>
        <div style="padding:14px 18px;overflow-y:auto;flex:1;">

          <!-- Source → Target with Swap button -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:8px 12px;flex:1;min-width:100px;">
              <div style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Deactivated</div>
              <div style="font-size:13px;font-weight:600;color:#991b1b;">${escHtml(src.name)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;">
              <span style="font-size:16px;color:#94a3b8;">→</span>
              <button onclick="document.getElementById('icSoftMergeModal').remove();icMergePreview('${escAttr(tgt.id)}','${escAttr(src.id)}')"
                style="height:24px;padding:0 8px;border-radius:6px;background:#f1f5f9;color:#64748b;border:none;font-size:10px;font-weight:500;cursor:pointer;white-space:nowrap;">
                ⇅ Swap
              </button>
            </div>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 12px;flex:1;min-width:100px;">
              <div style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Kept</div>
              <div style="font-size:13px;font-weight:600;color:#166534;">${escHtml(tgt.name)}</div>
            </div>
          </div>

          <!-- FK counts summary -->
          <div style="border:1px solid #f1f5f9;border-radius:10px;overflow:hidden;margin-bottom:12px;">
            <div style="padding:7px 12px;font-size:11px;font-weight:600;color:#94a3b8;background:#f8fafc;text-transform:uppercase;letter-spacing:.05em;">FK References Reassigned</div>
            ${[
              ['Vendor rows',      ivCount,   'ingredient_vendors.ingredient_id'],
              ['Invoice lines',    ilCount,   'invoice_lines.ingredient_id'],
              ['Ingredient links', linkCount, 'ingredient_links.ingredient_id'],
            ].map(([label, count, col]) => `
              <div style="padding:7px 12px;border-bottom:0.5px solid #f8fafc;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-size:12px;color:#1e293b;">${label}</div>
                  <div style="font-size:10px;color:#94a3b8;">${col}</div>
                </div>
                <span style="font-size:13px;font-weight:600;color:${count>0?'#1e293b':'#cbd5e1'};">${count}</span>
              </div>`).join('')}
          </div>

          <!-- Recipes before/after -->
          ${recipeRowsHTML}

          <!-- Summary of source/target changes -->
          <div style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:10px;padding:10px 12px;font-size:12px;color:#78350f;line-height:1.7;">
            <strong>What will happen:</strong><br>
            • <span style="color:#991b1b;font-weight:600;">${escHtml(src.name)}</span> → <strong>deactivated</strong>, notes = merged_into: ${escHtml(tgt.name)}<br>
            • <span style="color:#166534;font-weight:600;">${escHtml(tgt.name)}</span> → ${tgt.active === false
              ? '<strong style="color:#7c3aed;">reactivated</strong> (currently inactive) + kept as canonical name'
              : 'kept <strong>active</strong>, name unchanged'}
          </div>

          <div id="icSoftMergeStatus" style="display:none;margin-top:10px;padding:10px 12px;border-radius:10px;font-size:12px;"></div>
        </div>
        <div style="padding:12px 18px 16px;border-top:1px solid #f1f5f9;display:flex;gap:8px;">
          <button onclick="document.getElementById('icSoftMergeModal').remove()"
            style="flex:1;height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;border:none;font-size:13px;font-weight:500;cursor:pointer;">
            Cancel
          </button>
          <button id="icSoftMergeConfirmBtn" onclick="icDoSoftMerge()"
            style="flex:2;height:42px;border-radius:12px;background:#1e293b;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;">
            ✓ Confirm Soft Merge
          </button>
        </div>
      </div>`;
  } catch(e) {
    loadingModal.innerHTML = `<div style="background:white;border-radius:20px;padding:24px;max-width:400px;">
      <div style="font-size:13px;color:#991b1b;margin-bottom:12px;">✗ Failed to load preview: ${escHtml(e.message)}</div>
      <button onclick="document.getElementById('icSoftMergeModal').remove()"
        style="height:36px;padding:0 16px;border-radius:9px;background:#f1f5f9;color:#64748b;border:none;cursor:pointer;">Close</button>
    </div>`;
  }
};

// ── Execute soft merge ────────────────────────────────────────
window.icDoSoftMerge = async function() {
  const p = window._icPendingSoftMerge;
  if (!p) return;

  const btn      = document.getElementById('icSoftMergeConfirmBtn');
  const statusEl = document.getElementById('icSoftMergeStatus');

  if (btn) { btn.disabled=true; btn.textContent='⏳ Merging…'; btn.style.background='#94a3b8'; }

  function setStatus(html, type) {
    if (!statusEl) return;
    const c = {
      info:    ['rgba(59,130,246,0.06)','rgba(59,130,246,0.2)','#1e40af'],
      success: ['rgba(16,185,129,0.06)','rgba(16,185,129,0.25)','#065f46'],
      error:   ['rgba(239,68,68,0.06)', 'rgba(239,68,68,0.25)', '#991b1b'],
    }[type];
    statusEl.style.display='block';
    statusEl.style.cssText=`display:block;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.7;background:${c[0]};border:1px solid ${c[1]};color:${c[2]};`;
    statusEl.innerHTML=html;
  }

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');
    const { srcId, tgtId, srcName, tgtName, affectedRecipes } = p;
    const now = new Date().toISOString();
    const errors = [];

    // ── 1. Reassign ingredient_vendors ───────────────────────
    setStatus('⏳ Reassigning vendor rows…', 'info');
    const { error: ivErr } = await sb.from('ingredient_vendors')
      .update({ ingredient_id: tgtId, updated_at: now })
      .eq('ingredient_id', srcId);
    if (ivErr) errors.push('ingredient_vendors: ' + ivErr.message);

    // ── 2. Reassign invoice_lines ─────────────────────────────
    const { error: ilErr } = await sb.from('invoice_lines')
      .update({ ingredient_id: tgtId })
      .eq('ingredient_id', srcId);
    if (ilErr) errors.push('invoice_lines: ' + ilErr.message);

    // ── 3. Reassign ingredient_links ──────────────────────────
    const { error: lnErr } = await sb.from('ingredient_links')
      .update({ ingredient_id: tgtId })
      .eq('ingredient_id', srcId);
    if (lnErr) errors.push('ingredient_links: ' + lnErr.message);

    // ── 4. Update recipes.ingredients JSONB ───────────────────
    // Exact name replacement only. qty/unit/all other fields unchanged.
    if (affectedRecipes && affectedRecipes.length) {
      setStatus(`⏳ Updating ${affectedRecipes.length} recipe${affectedRecipes.length!==1?'s':''}…`, 'info');
      for (const recipe of affectedRecipes) {
        const updatedIngr = icReplaceIngrName(recipe.ingredients, srcName, tgtName);
        const { error: rErr } = await sb.from('recipes')
          .update({ ingredients: updatedIngr })
          .eq('id', recipe.id);
        if (rErr) errors.push(`Recipe "${recipe.title||recipe.id}": ${rErr.message}`);
      }
    }

    // ── 5. Ensure target ingredient is active ────────────────
    // Clear notes only if they start with merged_into: (leftover from a
    // previous merge). Any other notes are preserved.
    setStatus('⏳ Activating target…', 'info');
    const tgtLocal = (window._icData || []).find(i => i.id === tgtId);
    const tgtNotes = (tgtLocal?.notes || '');
    const tgtNotesCleared = tgtNotes.startsWith('merged_into:') ? null : (tgtNotes || null);
    const { error: activateErr } = await sb.from('ingredients')
      .update({ active: true, notes: tgtNotesCleared, updated_at: now })
      .eq('id', tgtId);
    if (activateErr) errors.push('activate target: ' + activateErr.message);
    // Update local cache immediately so UI reflects it
    if (tgtLocal) { tgtLocal.active = true; tgtLocal.notes = tgtNotesCleared; }

    // ── 6. Deactivate source ingredient ───────────────────────
    setStatus('⏳ Deactivating source…', 'info');
    const { error: deactErr } = await sb.from('ingredients')
      .update({ active: false, notes: 'merged_into: ' + tgtName, updated_at: now })
      .eq('id', srcId);
    if (deactErr) errors.push('deactivate source: ' + deactErr.message);

    if (errors.length) throw new Error(errors.join('; '));

    // ── 7. Update local cache ─────────────────────────────────
    const local = window._icData || [];
    const srcLocal = local.find(i => i.id === srcId);
    if (srcLocal) { srcLocal.active = false; srcLocal.notes = 'merged_into: ' + tgtName; }

    const recipeCount = (affectedRecipes||[]).length;
    setStatus(
      `✅ Soft merge complete.<br>` +
      `"${escHtml(srcName)}" → "${escHtml(tgtName)}"<br>` +
      `Source deactivated · ${recipeCount} recipe${recipeCount!==1?'s':''} updated`,
      'success'
    );
    if (btn) { btn.textContent='✓ Done'; btn.style.background='#10b981'; }

    setTimeout(() => {
      document.getElementById('icSoftMergeModal')?.remove();
      icLoad().then(() => icSetTab('merge'));
    }, 1400);

  } catch(e) {
    setStatus('✗ ' + e.message, 'error');
    if (btn) { btn.disabled=false; btn.textContent='✓ Confirm Soft Merge'; btn.style.background='#1e293b'; }
  }
};