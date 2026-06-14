// ══════════════════════════════════════════════════════════════
// SOUS CHEF SCAN — osservazione DB, genera warning con OQR
// L'AI osserva in silenzio. Scrive in invoice_warnings.
// Zero hardcoded buttons — il questionario è generato dall'AI.
// ══════════════════════════════════════════════════════════════

const SC_THROTTLE_MS = 30 * 60 * 1000; // 30 minuti

window.runSousChefScan = async function() {
  const sb = window.supabaseClient;
  if (!sb) return;

  // Throttle lato client (il server fa il controllo vero)
  const lastScan = parseInt(localStorage.getItem('sc_last_scan') || '0');
  const now = Date.now();
  if (now - lastScan < SC_THROTTLE_MS) {
    const minsLeft = Math.ceil((SC_THROTTLE_MS - (now - lastScan)) / 60000);
    showScToast(`⏳ Prossima scan tra ${minsLeft} min`);
    return;
  }

  const btn = document.getElementById('scBtn');
  if (btn) { btn.style.background = 'rgba(16,185,129,0.15)'; btn.style.borderColor = '#10b981'; }
  showScToast('🔍 Sous Chef sta analizzando...');

  try {
    // ── 1. Raccogli dati dal DB ──────────────────────────────
    const [{ data: ivRows }, { data: allIngr }, { data: allRecipes }, { data: linkRows },
           { data: salesRows }, { data: prepRows }] = await Promise.all([
      sb.from('ingredient_vendors')
        .select('ingredient_id,vendor,unit_price,price_per_100g,price_type,pack_description,conversion_to_base,last_invoice_date')
        .not('unit_price', 'is', null),
      sb.from('ingredients').select('id,name,category').eq('active', true),
      sb.from('recipes').select('title,ingredients'),
      sb.from('ingredient_links').select('ingredient_id').eq('confirmed', true),
      sb.from('pos_sales_by_item').select('menu_item,quantity,net_sales,sale_date')
        .order('sale_date', { ascending: false }).limit(100),
      sb.from('prep_log').select('item,qty,unit,user_name,created_at')
        .gte('created_at', new Date(Date.now() - 7*24*60*60*1000).toISOString())
        .order('created_at', { ascending: false }).limit(50),
    ]);

    const ingrMap = {};
    for (const i of (allIngr || [])) ingrMap[i.id] = i;
    const recipeNames = new Set((allRecipes || []).map(r => (r.title || '').toLowerCase().trim()));
    const usedInRecipes = new Set();
    for (const r of (allRecipes || [])) {
      for (const ing of (r.ingredients || [])) {
        if (ing.name) usedInRecipes.add(ing.name.toLowerCase().trim());
      }
    }
    const linkedIds = new Set((linkRows || []).map(l => l.ingredient_id));

    // ── 2. Costruisci dataset per l'AI ──────────────────────
    const dataset = [];
    for (const iv of (ivRows || [])) {
      const ingr = ingrMap[iv.ingredient_id];
      if (!ingr) continue;
      if (ingr.category === 'Supply') continue;
      const nameLower = ingr.name.toLowerCase().trim();
      if (recipeNames.has(nameLower) && !linkedIds.has(iv.ingredient_id)) continue;
      dataset.push({
        id: iv.ingredient_id,
        name: ingr.name,
        vendor: iv.vendor,
        unit_price: parseFloat(iv.unit_price) || null,
        price_per_100g: iv.price_per_100g ? parseFloat(iv.price_per_100g) : null,
        price_type: iv.price_type || 'per_case',
        pack: iv.pack_description,
        conversion_to_base: iv.conversion_to_base ? parseFloat(iv.conversion_to_base) : null,
        last_invoice: iv.last_invoice_date,
        in_recipes: usedInRecipes.has(nameLower),
        has_link: linkedIds.has(iv.ingredient_id),
      });
    }
    // Aggiungi ingredienti senza vendor (fantasmi)
    for (const ingr of (allIngr || [])) {
      if (ingr.category === 'Supply') continue;
      const nameLower = ingr.name.toLowerCase().trim();
      if (recipeNames.has(nameLower)) continue;
      if (dataset.find(d => d.id === ingr.id)) continue;
      if (!linkedIds.has(ingr.id) && !usedInRecipes.has(nameLower)) {
        dataset.push({ id: ingr.id, name: ingr.name, vendor: null, unit_price: null,
          price_per_100g: null, price_type: null, pack: null, conversion_to_base: null,
          last_invoice: null, in_recipes: false, has_link: false });
      }
    }

    if (dataset.length === 0) {
      showScToast('✅ Nessun dato da analizzare');
      return;
    }

    // ── 3. Prompt AI — genera warning con OQR già pronto ────
    const dataJson = JSON.stringify(dataset.slice(0, 80));
    const salesJson = JSON.stringify((salesRows || []).slice(0, 30));
    const prepJson = JSON.stringify((prepRows || []).slice(0, 20));

    const prompt = `Sei l'Executive Sous Chef digitale di Zenos on the Square, ristorante italiano autentico a Weatherford Texas.
Analizza questi dati reali e trova anomalie — come farebbe un sous chef esperto.

INGREDIENTI (JSON): ${dataJson}
VENDITE RECENTI (JSON): ${salesJson}
PREP ULTIMA SETTIMANA (JSON): ${prepJson}

TIPI DI ANOMALIE DA CERCARE:
1. PREZZO IMPOSSIBILE (SC-PRICE-001): price_per_100g esiste ma è troppo basso per quel prodotto
   Es: carne a $0.06/100g — impossibile, errore di peso
2. PESO MANCANTE (SC-NOLINK-001): unit_price esiste ma price_per_100g è null (pack in CT/DZ/EA)
3. FANTASMA (SC-GHOST-001): nessun vendor, nessun link, non usato in ricette
4. VENDITA ANOMALA (SC-SALES-001): piatto venduto molto meno del solito (< 20% della media)
5. PREP DOPPIA (SC-PREP-001): stessa prep fatta 2+ volte nella stessa mattina

REGOLE:
- Usa buon senso: farina costa poco, carne molto, pesce ancora di più
- Massimo 6 problemi totali — solo i più importanti
- Per ogni problema genera già la domanda OQR e le opzioni di risposta con i valori che salverebbero nel DB
- Le opzioni devono essere concrete e risolvere il problema

RISPOSTA: JSON array ESATTO, niente altro, niente markdown.
[
  {
    "code": "SC-PRICE-001|SC-NOLINK-001|SC-GHOST-001|SC-SALES-001|SC-PREP-001",
    "severity": "blocking|alert|insight",
    "category": "invoice|sales|prep",
    "ingredient_id": "uuid o null",
    "ingredient_name": "nome o null",
    "vendor": "vendor o null",
    "unit_price": numero_o_null,
    "price_per_100g": numero_o_null,
    "pack": "pack o null",
    "title": "frase breve max 6 parole",
    "message": "una frase: perché è un problema",
    "question": "domanda OQR concisa per Max",
    "suggested": {"conversion_to_base": numero, "price_type": "per_lb|per_case"},
    "options": [
      {"label": "testo bottone", "value": "valore", "updates": {"campo": valore}},
      {"label": "testo bottone 2", "value": "valore2", "updates": {"campo": valore2}}
    ],
    "target_table": "ingredient_vendors|ingredients|prep_log",
    "target_id": "uuid_del_record_da_aggiornare"
  }
]`;

    // ── 4. Chiama souschef-classify ──────────────────────────
    const res = await fetch(`${SUPABASE_URL}/functions/v1/souschef-classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ mode: 'scan', scanPrompt: prompt }),
    });
    if (!res.ok) throw new Error('Scan error: ' + res.status);
    const resData = await res.json();
    const rawText = resData.rawText || '';

    // ── 5. Parse risposta ────────────────────────────────────
    let problems = [];
    try {
      const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const arr = JSON.parse(cleaned);
      problems = Array.isArray(arr) ? arr : [];
    } catch(_) {
      const m = rawText.match(/\[[\s\S]*\]/);
      if (m) { try { problems = JSON.parse(m[0]); } catch(_) {} }
    }

    if (problems.length === 0) {
      showScToast('✅ Sous Chef — tutto ok');
      localStorage.setItem('sc_last_scan', String(now));
      return;
    }

    // ── 6. Salva in invoice_warnings ─────────────────────────
    // NON cancellare i resolved — solo gli open di questi codici
    const scCodes = [...new Set(problems.map(p => p.code))];
    await sb.from('invoice_warnings').delete()
      .in('code', scCodes).eq('status', 'open');

    await sb.from('invoice_warnings').insert(problems.map(p => ({
      code: p.code,
      severity: p.severity,
      status: 'open',
      category: p.category || 'invoice',
      vendor: p.vendor || null,
      ingredient_id: p.ingredient_id || null,
      item_description: p.title,
      message: p.message,
      question: p.question || null,
      options: p.options ? JSON.stringify(p.options) : null,
      suggested: p.suggested ? JSON.stringify(p.suggested) : null,
      target_table: p.target_table || null,
      target_id: p.target_id || null,
    })));

    localStorage.setItem('sc_last_scan', String(now));
    if (typeof loadWarningsBanner === 'function') loadWarningsBanner();
    showScToast(`⚠️ ${problems.length} warning trovati`);

  } catch(e) {
    console.error('[SousChefScan]', e.message);
    showScToast('⚠️ Scan error: ' + e.message);
  } finally {
    if (btn) { btn.style.background = ''; btn.style.borderColor = ''; }
  }
};
