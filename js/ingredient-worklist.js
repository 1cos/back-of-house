// ══════════════════════════════════════════════════════════════════
// WORKLIST INGREDIENTI — js/ingredient-worklist.js
//
// NON e' una nuova schermata di matching. La schermata di matching
// esiste gia' ed e' window.vdrOpenMatchSelector(): candidati, ricerca,
// approvazione con un tap, scrittura su ingredient_vendors, backfill
// delle righe storiche e recupero del prezzo. Questo file aggiunge
// SOLTANTO il punto d'ingresso che mancava: l'elenco di tutti gli SKU
// scollegati, di tutti i documenti, in un posto solo.
//
// Prima si arrivava al matching aprendo un documento alla volta: uno
// SKU rimasto indietro su una fattura di luglio non lo trovava piu'
// nessuno. Da INV15 le fatture entrano anche con prodotti senza nome,
// quindi questa lista e' il posto dove quei nomi si danno.
//
// SOLA LETTURA finche' non tocchi "Collega". Nessun collegamento
// automatico, nessun ingrediente creato da solo, nessuna ricetta
// sfiorata.
// ══════════════════════════════════════════════════════════════════
'use strict';

// Righe tecniche Walmart: quadrature di pagamento e varianze di
// evasione. Non sono prodotti e non diventeranno mai ingredienti.
// L'elenco e' ESATTO, non euristico: nessun "contiene", nessun regex.
window.IWL_SKU_TECNICI = ['ALT_PAYMENT_METHODS', 'SubDown'];

// Raggruppa le righe scollegate per fornitore + SKU. Una riga per
// prodotto, non per fattura: il collegamento e' per SKU e una sola
// approvazione sistema tutte le righe storiche.
window.iwlRaggruppa = function(righe) {
  const m = new Map();
  (righe || []).forEach(function(r) {
    if (!r.vendor_sku) return;
    if (window.IWL_SKU_TECNICI.indexOf(r.vendor_sku) > -1) return;
    const k = r.vendor + '\u0000' + r.vendor_sku;
    let g = m.get(k);
    if (!g) {
      g = { vendor: r.vendor, vendor_sku: r.vendor_sku, descrizione: r.raw_description || '',
            pack: r.pack_description || null, righe: 0, valore: 0,
            ultima_data: null, ultimo_prezzo: null, doc_id: null, ha_peso: false };
      m.set(k, g);
    }
    g.righe += 1;
    g.valore += Number(r.line_total || 0);
    if (r.cost_per_100g != null && Number(r.cost_per_100g) > 0) g.ha_peso = true;
    if (!g.ultima_data || (r.invoice_date && r.invoice_date > g.ultima_data)) {
      g.ultima_data   = r.invoice_date || g.ultima_data;
      g.ultimo_prezzo = r.unit_price != null ? Number(r.unit_price) : g.ultimo_prezzo;
      g.descrizione   = r.raw_description || g.descrizione;
      g.pack          = r.pack_description || g.pack;
      g.doc_id        = r.import_id || g.doc_id;
    }
  });
  // Per importanza: quanto vale, poi quante volte e' stato comprato.
  return Array.from(m.values()).sort(function(a, b) {
    return b.valore - a.valore || b.righe - a.righe;
  });
};

window.openIngredientWorklist = async function() {
  const sb = window.supabaseClient || window.supa;
  if (!sb) return;

  document.getElementById('iwlOverlay')?.remove();
  document.getElementById('iwlModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'iwlOverlay';
  // z-index: la worklist deve stare SOTTO la modale di match, che sta a
  // 9400 (vendor-documents-review.js). Con 9401 la modale si apriva
  // DIETRO questa schermata, che e' opaca e a tutto schermo: il bottone
  // Collega sembrava morto perche' cio' che apriva era invisibile.
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9200;background:rgba(8,18,40,0.65);';
  overlay.onclick = function(e) { if (e.target === overlay) chiudi(); };
  document.body.appendChild(overlay);

  const modal = document.createElement('div');
  modal.id = 'iwlModal';
  const mob = function() { return window.innerWidth <= 768; };
  function dimensiona() {
    if (mob()) { modal.style.inset = '0'; modal.style.borderRadius = '0'; }
    else { modal.style.inset = '24px'; modal.style.borderRadius = '18px'; }
  }
  modal.style.cssText = 'position:fixed;z-index:9201;background:#0f172a;color:#e2e8f0;'
    + 'display:flex;flex-direction:column;overflow:hidden;'
    + 'box-shadow:0 32px 80px rgba(0,0,0,0.7);'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  dimensiona();
  window.addEventListener('resize', dimensiona);
  document.body.appendChild(modal);

  function chiudi() {
    document.getElementById('iwlOverlay')?.remove();
    document.getElementById('iwlModal')?.remove();
  }
  window.iwlChiudi = chiudi;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  const soldi = function(n) { return '$' + Number(n || 0).toFixed(2); };

  modal.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">Carico…</div>';

  // ── DATI ──────────────────────────────────────────────────────────
  const { data: righe, error } = await sb.from('invoice_lines')
    .select('vendor,vendor_sku,raw_description,pack_description,invoice_date,unit_price,line_total,cost_per_100g,import_id')
    .is('ingredient_id', null);

  if (error) {
    modal.innerHTML = '<div style="padding:40px;color:#f87171;">Errore: ' + esc(error.message)
      + '</div><div style="padding:0 40px 40px;"><button onclick="iwlChiudi()">Chiudi</button></div>';
    return;
  }

  const gruppi = window.iwlRaggruppa(righe);
  const tecniche = (righe || []).filter(function(r) {
    return window.IWL_SKU_TECNICI.indexOf(r.vendor_sku) > -1;
  }).length;

  // Quanti ingredienti usati dalle ricette hanno un prezzo valido.
  // E' la domanda che conta davvero, e va mostrata in cima.
  let copertura = null;
  try {
    const { data: bom } = await sb.from('recipe_bom').select('item_id').eq('component_type','ITEM');
    const usati = Array.from(new Set((bom || []).map(function(b) { return b.item_id; }).filter(Boolean)));
    const { data: prezzati } = await sb.from('invoice_lines')
      .select('ingredient_id').not('ingredient_id','is',null).gt('cost_per_100g', 0);
    const set = new Set((prezzati || []).map(function(p) { return p.ingredient_id; }));
    copertura = { con: usati.filter(function(id) { return set.has(id); }).length, tot: usati.length };
  } catch (e) { copertura = null; }

  // ── RENDER ────────────────────────────────────────────────────────
  const perFornitore = new Map();
  gruppi.forEach(function(g) {
    if (!perFornitore.has(g.vendor)) perFornitore.set(g.vendor, []);
    perFornitore.get(g.vendor).push(g);
  });
  // I fornitori con piu' denaro scollegato per primi.
  const fornitori = Array.from(perFornitore.entries()).sort(function(a, b) {
    const sa = a[1].reduce(function(s, g) { return s + g.valore; }, 0);
    const sb2 = b[1].reduce(function(s, g) { return s + g.valore; }, 0);
    return sb2 - sa;
  });

  const totale = gruppi.reduce(function(s, g) { return s + g.valore; }, 0);

  const sezioni = fornitori.map(function(par) {
    const vendor = par[0], lista = par[1];
    const somma = lista.reduce(function(s, g) { return s + g.valore; }, 0);
    const card = lista.map(function(g) {
      const peso = g.ha_peso
        ? '<span style="color:#34d399;">prezzo al peso disponibile</span>'
        : '<span style="color:#fbbf24;">formato a pezzo: nessun prezzo al chilo</span>';
      return '<div style="padding:12px 0;border-bottom:1px solid #1e293b;">'
        + '<div style="display:flex;gap:10px;align-items:flex-start;">'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-size:14px;font-weight:600;color:#f1f5f9;">' + esc(g.descrizione) + '</div>'
        +     '<div style="font-size:11px;color:#94a3b8;margin-top:3px;">'
        +       'SKU ' + esc(g.vendor_sku)
        +       (g.pack ? ' &middot; ' + esc(g.pack) : '')
        +       (g.ultima_data ? ' &middot; ' + esc(g.ultima_data) : '')
        +       (g.ultimo_prezzo != null ? ' &middot; ' + soldi(g.ultimo_prezzo) : '')
        +       ' &middot; ' + g.righe + ' rig' + (g.righe === 1 ? 'a' : 'he')
        +     '</div>'
        +     '<div style="font-size:11px;margin-top:3px;">' + peso + '</div>'
        +   '</div>'
        +   '<div style="text-align:right;flex-shrink:0;">'
        +     '<div style="font-size:15px;font-weight:700;color:#f1f5f9;">' + soldi(g.valore) + '</div>'
        +     '<button onclick="iwlCollega(this)"'
        +       ' data-vendor="' + esc(g.vendor) + '"'
        +       ' data-sku="' + esc(g.vendor_sku) + '"'
        +       ' data-descr="' + esc(g.descrizione) + '"'
        +       ' data-doc="' + esc(g.doc_id || '') + '"'
        +       ' style="margin-top:6px;font-size:12px;font-weight:600;padding:7px 14px;'
        +       'border-radius:9px;border:1px solid #2f6f4e;background:rgba(47,111,78,0.18);'
        +       'color:#6ee7b7;cursor:pointer;">Collega</button>'
        +   '</div>'
        + '</div></div>';
    }).join('');
    return '<div style="margin-bottom:22px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;'
      +      'padding-bottom:8px;border-bottom:1px solid #334155;margin-bottom:6px;">'
      +   '<div style="font-size:13px;font-weight:700;letter-spacing:0.04em;color:#cbd5e1;">'
      +     esc(vendor) + '</div>'
      +   '<div style="font-size:12px;color:#94a3b8;">' + lista.length + ' prodott'
      +     (lista.length === 1 ? 'o' : 'i') + ' &middot; ' + soldi(somma) + '</div>'
      + '</div>' + card + '</div>';
  }).join('');

  const testaCopertura = copertura
    ? '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">'
      + '<b style="color:#e2e8f0;">' + copertura.con + '</b> ingredienti su <b style="color:#e2e8f0;">'
      + copertura.tot + '</b> usati dalle ricette hanno un prezzo valido</div>'
    : '';

  modal.innerHTML =
    '<div style="padding:16px 18px 12px;border-bottom:1px solid #1e293b;flex-shrink:0;'
    +     'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">'
    +   '<div><div style="font-size:17px;font-weight:700;color:#f8fafc;">Prodotti da collegare</div>'
    +     '<div style="font-size:12px;color:#94a3b8;margin-top:3px;">'
    +       gruppi.length + ' prodotti &middot; ' + soldi(totale) + ' non ancora attribuiti'
    +       (tecniche ? ' &middot; ' + tecniche + ' righe tecniche escluse' : '')
    +     '</div>' + testaCopertura + '</div>'
    +   '<button onclick="iwlChiudi()" style="font-size:20px;line-height:1;background:none;'
    +     'border:none;color:#94a3b8;cursor:pointer;padding:2px 6px;">&times;</button>'
    + '</div>'
    + '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 18px 40px;">'
    +   (gruppi.length ? sezioni
        : '<div style="padding:40px;text-align:center;color:#34d399;font-size:15px;">'
          + 'Nessun prodotto in attesa. Tutto collegato.</div>')
    + '</div>';
};

// Un tap apre la modale ESISTENTE. Questo file non salva niente: il
// salvataggio vive dentro vdrOpenMatchSelector -> vdrSaveVendorSkuMapping.
//
// Due cose che questa funzione DEVE fare, e che prima non faceva:
//
//   RESTITUIRE LA PROMISE. vdrOpenMatchSelector e' async: senza il
//   return, chi chiama non puo' aspettare che la modale esista. Era
//   invisibile a mano ma rendeva il flusso non verificabile.
//
//   RICARICARE LA WORKLIST quando la modale si chiude. La modale si
//   rimuove da sola dopo il salvataggio, ma non sa niente di questa
//   schermata: senza questo, il prodotto appena collegato restava in
//   lista. Osservo la sua rimozione invece di aggiungere una callback
//   a vendor-documents-review.js, che non e' mio.
window.iwlCollega = function(btn) {
  if (typeof window.vdrOpenMatchSelector !== 'function') return Promise.resolve();
  const p = window.vdrOpenMatchSelector(
    btn.getAttribute('data-doc') || null,
    btn.getAttribute('data-vendor'),
    btn.getAttribute('data-sku'),
    btn.getAttribute('data-descr'),
    btn
  );
  Promise.resolve(p).then(function() { iwlRicaricaAllaChiusura(); });
  return Promise.resolve(p);
};

// Aspetta che #_vdrMatchSelector sparisca, poi rilegge la worklist.
// Vale sia dopo un salvataggio sia dopo un annullamento: nel secondo
// caso e' solo una rilettura, innocua.
function iwlRicaricaAllaChiusura() {
  const sel = document.getElementById('_vdrMatchSelector');
  if (!sel || !window.MutationObserver) return;
  const obs = new window.MutationObserver(function() {
    if (document.getElementById('_vdrMatchSelector')) return;
    obs.disconnect();
    if (document.getElementById('iwlModal')) window.openIngredientWorklist();
  });
  obs.observe(document.body, { childList: true });
}

// ══════════════════════════════════════════════════════════════════
// COLLEGARE DALLA FATTURA PENDING — quando il prodotto non ha SKU
//
// PERCHE' SERVE UNA SECONDA PORTA.
// La worklist qui sopra legge invoice_lines, che esistono solo DOPO
// l'importazione. E vdrOpenMatchSelector mostra il bottone Match solo
// se item.vendor_sku esiste (canMatchThisRow). Una fattura come quelle
// di Global Gourmet non ha nemmeno una colonna codice: senza SKU e
// senza righe importate, quei prodotti non sono raggiungibili da
// nessuna delle due strade.
//
// E l'ordine non e' negoziabile: il collegamento deve esistere PRIMA
// dell'approvazione. writeInvoiceLines legge linkMap[desc] al momento
// della scrittura, e il loop della price intelligence aggiorna il
// prezzo nello stesso passaggio. Collegare dopo lascerebbe le righe
// con ingredient_id null e servirebbe un backfill per descrizione che
// non esiste: vdrBackfillInvoiceLines lavora per vendor_sku.
//
// Quindi questa schermata legge le righe da parsed_json del documento
// PENDING, non da invoice_lines, e scrive ingredient_links — la
// tabella che Brigade usa gia' per i prodotti senza codice, chiavata
// su (invoice_description, vendor).
//
// NON scrive invoice_lines. NON approva niente. NON crea ingredienti.
// Ogni riga passa da un tap.
// ══════════════════════════════════════════════════════════════════

// Litri -> grammi per l'olio. Convenzione dello chef per il food cost
// (FC02): 1 litro = 1 kg. Sostituisce la densita' fisica 0,916 usata fino
// a GG09. Vive qui, dichiarata, e finisce in ingredient_links.conversion_g,
// cosi' resta leggibile a chi guardera' quel collegamento domani.
window.IWL_DENSITA = { 'olio d\'oliva': 1.0 };

window.iwlRigheCollegabili = function(doc) {
  const pj = (doc && doc.parsed_json) || {};
  const items = pj.items || [];
  const vendor = pj.vendor || doc.vendor || '';
  return items
    .filter(function (it) { return !(it.line_type && it.line_type !== 'product'); })
    .map(function (it) {
      const desc = it.description || it.raw_description || '';
      return {
        vendor: vendor,
        descrizione: desc,
        vendor_sku: it.vendor_sku || null,
        pack: it.pack_description || null,
        qty: it.qty != null ? it.qty : null,
        unita: it.purchase_unit || null,
        unit_price: it.unit_price != null ? Number(it.unit_price) : null,
        importo: it.amount != null ? Number(it.amount) : null,
      };
    })
    .filter(function (r) { return r.descrizione; });
};

// Scrive UN collegamento. Solo ingredient_links, niente altro.
// conversion_g e' facoltativa e si passa solo quando qualcuno l'ha
// decisa: non viene mai dedotta qui dentro.
window.iwlSalvaLink = async function (sb, vendor, descrizione, ingrediente, opzioni) {
  if (!sb || !vendor || !descrizione || !ingrediente || !ingrediente.id) {
    return { status: 'error', message: 'campo mancante' };
  }
  const o = opzioni || {};
  const riga = {
    invoice_description: descrizione,
    ingredient_name:     ingrediente.name,
    ingredient_id:       ingrediente.id,
    vendor:              vendor,
    confirmed:           true,
    confidence:          1.0,
    invoice_unit:        o.invoice_unit || null,
    base_unit:           'g',
    conversion_g:        o.conversion_g != null ? Number(o.conversion_g) : null,
  };
  const { error } = await sb.from('ingredient_links')
    .upsert(riga, { onConflict: 'invoice_description,vendor' });
  if (error) return { status: 'error', message: error.message };
  return { status: 'saved', row: riga };
};
