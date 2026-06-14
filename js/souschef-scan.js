// ══════════════════════════════════════════════════════════════
// SOUS CHEF SCAN — osservazione DB, genera warning con OQR
// Un warning per ingrediente. Niente raggruppamenti.
// L'AI genera domanda + opzioni già pronte per ogni problema.
// Zero AI nella fase di risoluzione.
// ══════════════════════════════════════════════════════════════

const SC_THROTTLE_MS = 30 * 60 * 1000;

window.runSousChefScan = async function() {
  const sb = window.supabaseClient;
  if (!sb) return;

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
    const [{ data: ivRows }, { data: allIngr }, { data: allRecipes }, { data: linkRows }] = await Promise.all([
      sb.from('ingredient_vendors')
        .select('ingredient_id,vendor,unit_price,price_per_100g,price_type,pack_description,conversion_to_base,last_invoice_date')
        .not('unit_price', 'is', null),
      sb.from('ingredients').select('id,name,category').eq('active', true),
      sb.from('recipes').select('title,ingredients'),
      sb.from('ingredient_links').select('ingredient_id').eq('confirmed', true),
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

    if (dataset.length === 0) {
      showScToast('✅ Nessun dato da analizzare');
      return;
    }

    // ── 3. Prompt AI — UN warning per ingrediente con OQR ───
    const dataJson = JSON.stringify(dataset.slice(0, 80));

    const prompt = `Sei l'Executive Sous Chef digitale di Zenos on the Square, ristorante italiano autentico a Weatherford Texas.
Analizza questi ingredienti e trova anomalie reali di prezzi e pesi.

INGREDIENTI (JSON): ${dataJson}

TIPI DI ANOMALIE:
1. SC-PRICE-001 (blocking): price_per_100g esiste ma impossibile per quel prodotto
   Es: carne/maiale/pesce a meno di $0.50/100g — errore di peso non inserito
   Es: olio/aceto/salse a meno di $0.05/100g — impossibile
2. SC-NOLINK-001 (alert): unit_price esiste ma price_per_100g è null — peso mai inserito

REGOLE:
- Usa buon senso da cuoco: farina=$0.05-0.30/100g OK, carne<$0.50/100g IMPOSSIBILE
- Per SC-PRICE-001: calcola il peso probabile dalla pack description e proponi la correzione
- Massimo 8 problemi, solo i più importanti
- UN oggetto JSON per ingrediente — non raggruppare mai

Per ogni problema genera:
- La domanda OQR specifica per quell'ingrediente
- Le opzioni concrete con i valori esatti da salvare nel DB
- Le opzioni devono includere conversion_to_base in grammi (1lb=453.592g)

RISPOSTA: JSON array ESATTO, niente markdown, niente testo extra.
[
  {
    "code": "SC-PRICE-001",
    "severity": "blocking",
    "ingredient_id": "uuid-esatto-dal-dataset",
    "ingredient_name": "nome",
    "vendor": "vendor",
    "unit_price": 29.05,
    "price_per_100g": 0.2287,
    "pack": "1pc / 28#",
    "title": "Tomahawk Loin — prezzo impossibile",
    "message": "Carne a $0.23/100g è impossibile. Pack 28lb → prezzo corretto sarebbe $2.30/100g.",
    "question": "Tomahawk Loin: 1 pezzo da 28 lb a $29.05. Il prezzo è corretto?",
    "options": [
      {
        "label": "Sì — 28 lb (12,701g)",
        "updates": {"conversion_to_base": 12700.96, "price_type": "per_case"}
      },
      {
        "label": "No — inserisci peso manualmente",
        "updates": null
      }
    ],
    "suggested": {"conversion_to_base": 12700.96, "price_type": "per_case"},
    "target_table": "ingredient_vendors",
    "target_field": "conversion_to_base"
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

    // ── 6. Salva in invoice_warnings — uno per ingrediente ──
    // Non cancellare i resolved — solo gli open di questi codici
    const scCodes = [...new Set(problems.map(p => p.code))];
    await sb.from('invoice_warnings').delete()
      .in('code', scCodes).eq('status', 'open');

    const toInsert = problems.map(p => ({
      code: p.code,
      severity: p.severity,
      status: 'open',
      category: 'invoice',
      vendor: p.vendor || null,
      ingredient_id: p.ingredient_id || null,
      item_description: p.title,
      message: p.message,
      question: p.question || null,
      options: p.options ? JSON.stringify(p.options) : null,
      suggested: p.suggested ? JSON.stringify(p.suggested) : null,
      target_table: p.target_table || null,
      target_id: p.ingredient_id || null, // per ingredient_vendors la chiave è ingredient_id
      target_field: p.target_field || null,
    }));

    await sb.from('invoice_warnings').insert(toInsert);

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
