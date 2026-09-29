// ══════════════════════════════════════════════════════════════════
// PREZZI MANCANTI (FC04) — Admin > Prezzi mancanti
//
// Cosa impedisce al food cost di essere completo, un ingrediente alla
// volta, partendo da quello che blocca piu' ricette.
//
// NON e' un secondo motore. I dati arrivano gia' calcolati da
// fc_prezzi_mancanti(p_token), che legge food_cost.v_chef_alerts e
// aggiunge le prove (ultima fattura, ultimo prezzo al peso, documenti in
// attesa). La funzione verifica la sessione Brigade e risponde solo a un
// amministratore: senza token valido non arriva nessun prezzo.
//
// L'unico calcolo fatto qui e' cercare, fra le fatture non collegate,
// quelle che il motore di candidati ESISTENTE (vdrFindIngredientCandidates,
// lo stesso della worklist e di Vendor Review) proporrebbe per un
// ingrediente senza prezzo.
//
// Questa schermata non scrive niente. Porta lo chef alla schermata
// giusta: scheda ingrediente, collegamento, Vendor Review.
// ══════════════════════════════════════════════════════════════════
'use strict';

// Gruppi, nell'ordine in cui compaiono i filtri.
window.PM_GRUPPI = [
  { id: 'tutti',     label: 'Tutti' },
  { id: 'formato',   label: 'Comprati, manca il peso' },
  { id: 'collegare', label: 'Fattura da collegare' },
  { id: 'mai',       label: 'Mai fatturati' },
  { id: 'altro',     label: 'Altro' },
];

function pmEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pmSoldi(n, dec) {
  if (n == null || isNaN(Number(n))) return '';
  return '$' + Number(n).toFixed(dec == null ? 2 : dec).replace('.', ',');
}
function pmData(d) {
  if (!d) return '';
  const p = String(d).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : String(d);
}
function pmFornitore(v) {
  // "Hardie's Fresh Foods / Dairyland Produce" -> "Hardie's"
  const s = String(v || '');
  if (/^hardie/i.test(s)) return "Hardie's";
  if (/^global gourmet/i.test(s)) return 'Global Gourmet';
  if (/^ben e\.? keith/i.test(s)) return 'Ben E. Keith';
  return s;
}
function pmFattura(f) {
  if (!f) return '';
  return pmFornitore(f.vendor) + ' ' + pmData(f.date)
    + (f.pack ? ', «' + f.pack + '»' : '')
    + (f.unit_price != null ? ', ' + pmSoldi(f.unit_price) : '');
}

// ── DIAGNOSI: dai dati del server a una frase e a un'azione ──────
// Pura: nessun DOM, nessuna chiamata. Testata a parte.
//   cand = fatture non collegate che il motore di candidati associa a
//          questo ingrediente (vedi pmCandidatiNonCollegati)
// FC05: la conversione arriva dal server in g per pezzo o g/ml; allo chef si mostra
// come la pensa: grammi per pezzo, oppure grammi per US qt (1 US qt = 946,353 ml).
function pmConvVista(c, quale) {
  if (!c || !(Number(c[quale]) > 0)) return null;
  const f = c.tipo === 'densita' ? 946.353 : 1;
  return { tipo: c.tipo, fattore: f, valore: Math.round(Number(c[quale]) * f * 10) / 10,
           unita: c.tipo === 'densita' ? 'g per US qt' : 'g per pezzo' };
}
function pmNum(n) { return String(n).replace('.', ','); }

window.pmDiagnosi = function(it, cand) {
  cand = cand || [];
  const uf = it.ultima_fattura, up = it.ultimo_prezzo_al_peso;
  const d = { gruppo: 'altro', titolo: '', testo: '', prove: [], azioni: [] };
  const scheda = { tipo: 'scheda', label: 'Apri la scheda ingrediente' };
  const inArrivo = function(label) { return { tipo: 'presto', label: label }; };

  switch (it.diagnosi) {
    case 'formato_nuovo_senza_peso':
      d.gruppo = 'formato';
      d.titolo = 'Comprato, ma l’ultima fattura non ha un peso';
      d.testo = 'Il prezzo c’è, manca quanto pesa il formato: senza il peso non si sa quanto costa al grammo.';
      if (uf) d.prove.push('Ultima fattura: ' + pmFattura(uf) + '.');
      if (up) d.prove.push('Ultimo prezzo al peso: ' + pmSoldi(up.cost_per_100g, 4) + ' / 100 g ('
        + pmFornitore(up.vendor) + ' ' + pmData(up.date) + ').');
      d.azioni.push({ tipo: 'scheda', label: 'Indica il peso del formato' });
      break;
    case 'formato_senza_peso':
      d.gruppo = 'formato';
      d.titolo = 'Comprato, ma il formato non ha mai avuto un peso';
      d.testo = 'Serve sapere quanto pesa il formato acquistato.';
      if (uf) d.prove.push('Ultima fattura: ' + pmFattura(uf) + (uf.pack ? '' : ', formato non indicato') + '.');
      d.azioni.push({ tipo: 'scheda', label: 'Indica il peso del formato' });
      break;
    case 'peso_al_pezzo':
      d.gruppo = 'formato';
      d.titolo = 'Serve il peso di un pezzo';
      d.testo = 'La ricetta e la fattura contano in modo diverso (a pezzi e a peso).';
      if (uf) d.prove.push('Ultima fattura: ' + pmFattura(uf) + '.');
      d.azioni.push(inArrivo('Peso di un pezzo — in arrivo'));
      break;
    case 'litri_chili':
      d.gruppo = 'formato';
      d.titolo = 'Serve la conversione fra litri e chili';
      d.testo = 'La ricetta lo misura a volume, il prezzo è al peso. Per l’olio vale 1 L = 1 kg; per questo ingrediente la regola non c’è ancora.';
      if (uf) d.prove.push('Ultima fattura: ' + pmFattura(uf) + '.');
      d.azioni.push(inArrivo('Conversione litri/chili — in arrivo'));
      break;
    case 'conflitto':
      d.gruppo = 'altro';
      d.titolo = 'Due prezzi che non tornano';
      d.testo = 'Il prezzo corrente e la fattura dicono cose diverse: va controllato prima di usarlo.';
      if (uf) d.prove.push('Ultima fattura: ' + pmFattura(uf) + '.');
      d.azioni.push(scheda);
      break;
    case 'unita_sospetta':
      // FC05: si compra e si usa a pezzi (fiori, finocchi): il peso non serve, e'
      // la ricetta scritta in grammi che va rivista. Qui non si corregge niente.
      d.gruppo = 'altro';
      d.titolo = 'Unit\u00e0 della ricetta da rivedere';
      d.testo = 'Si compra e si usa a pezzi, ma queste ricette lo scrivono in grammi. Vanno corrette nella ricetta: da qui non si tocca niente.';
      if (uf) d.prove.push('Ultima fattura: ' + pmFattura(uf) + '.');
      break;
    case 'conversione_da_confermare': {
      // FC05: conversione proposta. Lo chef la conferma o la corregge una volta
      // sola; poi vale per tutti gli acquisti. Finche' non conferma, e' una stima.
      const v = pmConvVista(it.conversione, 'proposta');
      d.gruppo = 'formato';
      d.titolo = 'Conversione stimata da confermare';
      d.testo = 'Le ricette scritte in grammi usano ' + (v ? pmNum(v.valore) + ' ' + v.unita : 'una conversione stimata')
        + '. Finch\u00e9 non la confermi il costo \u00e8 una stima.';
      if (v) d.azioni.push({ tipo: 'conferma', campo: true, label: 'Conferma', tipoConv: v.tipo,
                             valore: v.valore, unita: v.unita, fattore: v.fattore });
      break;
    }
    case 'conversione_alternativa': {
      // FC05: c'e' una conversione in uso (panna: 908 g per US qt, dichiarata da Max)
      // e un riferimento standard diverso (952 g). Nessuna sostituzione automatica:
      // resta quella in uso finche' lo chef non sceglie.
      const u = pmConvVista(it.conversione, 'in_uso');
      const p = pmConvVista(it.conversione, 'proposta');
      d.gruppo = 'formato';
      d.titolo = 'Due conversioni: scegli quale tenere';
      d.testo = u && p ? 'In uso: ' + pmNum(u.valore) + ' ' + u.unita + '. Riferimento standard: '
        + pmNum(p.valore) + ' ' + p.unita + '. Finch\u00e9 non scegli resta quella in uso.' : 'Due conversioni diverse.';
      if (it.conversione && it.conversione.fonte_proposta) d.prove.push('Fonte del riferimento: ' + it.conversione.fonte_proposta + '.');
      if (u && p) {
        d.azioni.push({ tipo: 'conferma', label: 'Usa ' + pmNum(p.valore) + ' g', tipoConv: p.tipo, valore: p.valore, fattore: p.fattore });
        d.azioni.push({ tipo: 'conferma', label: 'Tieni ' + pmNum(u.valore) + ' g', tipoConv: u.tipo, valore: u.valore, fattore: u.fattore });
      }
      break;
    }
    case 'unita_ricetta':
      d.gruppo = 'altro';
      d.titolo = 'Unità della ricetta non convertibile';
      d.testo = 'In una ricetta è scritto in un’unità come pizzico o spicchio. Le ricette non si modificano da qui.';
      d.azioni.push(scheda);
      break;
    case 'solo_in_attesa':
      d.gruppo = 'collegare';
      d.titolo = 'Fattura in attesa di approvazione';
      d.testo = 'Il prodotto è in un documento non ancora approvato.';
      break;
    default: // mai_fatturato
      if (cand.length) {
        d.gruppo = 'collegare';
        d.titolo = 'C’è una fattura non collegata che potrebbe essere questo';
        d.testo = 'Controlla il prodotto e, se è lui, collegalo: il prezzo arriva dalla fattura.';
        cand.forEach(function(c) {
          d.prove.push('«' + c.descrizione + '» — ' + pmFornitore(c.vendor)
            + (c.ultima_data ? ' ' + pmData(c.ultima_data) : '')
            + (c.ultimo_prezzo != null ? ', ' + pmSoldi(c.ultimo_prezzo) : '') + '.');
          d.azioni.push({ tipo: 'collega', label: 'Collega «' + c.descrizione + '»', cand: c });
        });
      } else {
        d.gruppo = 'mai';
        d.titolo = 'Nessuna fattura trovata';
        d.testo = 'Non risulta nessun acquisto di questo ingrediente. Nessun prezzo viene inventato.';
        d.azioni.push(inArrivo('Stima dello chef — in arrivo'));
      }
  }
  if ((it.documenti_in_attesa || []).length) {
    const doc = it.documenti_in_attesa[0];
    d.prove.push('In attesa di approvazione: documento ' + pmFornitore(doc.vendor)
      + ' con «' + doc.description + '».');
    d.azioni.push({ tipo: 'vendor_review', label: 'Apri i documenti in attesa' });
  }
  return d;
};

// Fatture non collegate che il motore di candidati esistente associa a un
// ingrediente degli avvisi. Stessa raggruppatura della worklist (per
// fornitore + SKU, righe tecniche escluse). Solo candidati sicuri: quelli
// che il motore marca needsConfirmation restano fuori.
window.pmCandidatiNonCollegati = function(righe, ingredienti, idAvvisi) {
  const out = {};
  if (typeof window.vdrFindIngredientCandidates !== 'function') return out;
  const gruppi = typeof window.iwlRaggruppa === 'function' ? window.iwlRaggruppa(righe) : [];
  const avvisi = new Set(idAvvisi || []);
  gruppi.forEach(function(g) {
    const c = window.vdrFindIngredientCandidates(g.descrizione, ingredienti || []);
    c.forEach(function(x) {
      if (x.needsConfirmation || !avvisi.has(x.id)) return;
      (out[x.id] = out[x.id] || []).push(g);
    });
  });
  return out;
};

// ── SCHERMATA ─────────────────────────────────────────────────────
window.openPrezziMancanti = async function() {
  if (typeof isAdmin === 'function' && !isAdmin()) return;
  const sb = window.supabaseClient || window.supa;
  if (!sb) return;

  pmChiudi();
  const overlay = document.createElement('div');
  overlay.id = 'pmOverlay';
  // Sotto la modale di collegamento (9400), come la worklist.
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9200;background:rgba(8,18,40,0.65);';
  overlay.onclick = function(e) { if (e.target === overlay) pmChiudi(); };
  document.body.appendChild(overlay);

  const modal = document.createElement('div');
  modal.id = 'pmModal';
  modal.style.cssText = 'position:fixed;z-index:9201;background:#0f172a;color:#e2e8f0;'
    + 'display:flex;flex-direction:column;overflow:hidden;'
    + 'box-shadow:0 32px 80px rgba(0,0,0,0.7);'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  const dimensiona = function() {
    if (window.innerWidth <= 768) { modal.style.inset = '0'; modal.style.borderRadius = '0'; }
    else { modal.style.inset = '24px'; modal.style.borderRadius = '18px'; modal.style.maxWidth = '760px'; modal.style.margin = '0 auto'; }
  };
  dimensiona();
  document.body.appendChild(modal);
  modal.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">Carico…</div>';

  const r = await pmCaricaDati(sb);
  if (!r.ok) {
    modal.innerHTML = '<div style="padding:40px;color:#fca5a5;font-size:15px;">' + pmEsc(r.perche) + '</div>'
      + '<div style="padding:0 40px 40px;display:flex;gap:8px;"><button onclick="pmChiudi()" style="' + PM_BTN_GHOST + '">Chiudi</button>'
      + (typeof brigadeBottoneHome === 'function' ? brigadeBottoneHome(PM_BTN_GHOST) : '') + '</div>';
    return;
  }
  const prima = window.PM_STATO || {};
  window.PM_STATO = { items: r.items, cand: r.cand, filtro: prima.filtro || 'tutti',
                      aperti: {}, generato: r.generato, avviso: null };
  pmRender();
};

// Gli avvisi dal server (solo con una sessione da amministratore) e le
// fatture non collegate per il motore di candidati: solo nomi e categorie,
// nessuna ricetta, nessun prezzo di listino.
async function pmCaricaDati(sb) {
  let token = null;
  try { token = window.localStorage.getItem('brigade_token'); } catch (e) { token = null; }
  const { data: res, error } = await sb.rpc('fc_prezzi_mancanti', { p_token: token });
  if (error || !res || !res.ok) {
    return { ok: false, perche: res && res.error === 'unauthorized'
      ? 'Questa schermata è riservata all’amministratore.'
      : (res && /session|token/.test(res.error || '')
        ? 'La sessione è scaduta: esci e rientra con il PIN.'
        : 'Non riesco a leggere gli avvisi' + (error ? ': ' + error.message : '.')) };
  }
  const items = res.items || [];
  let cand = {};
  try {
    const [{ data: righe }, { data: ingrs }] = await Promise.all([
      sb.from('invoice_lines')
        .select('vendor,vendor_sku,raw_description,pack_description,invoice_date,unit_price,line_total,cost_per_100g,import_id')
        .is('ingredient_id', null),
      sb.from('ingredients').select('id,name,category').eq('active', true),
    ]);
    const cibo = (ingrs || []).filter(function(i) { return i.category !== 'Supply'; });
    cand = window.pmCandidatiNonCollegati(righe || [], cibo, items.map(function(i) { return i.ingredient_id; }));
  } catch (e) { cand = {}; }
  return { ok: true, items: items, cand: cand, generato: res.generated_at };
}

// Rilegge i dati SENZA ricostruire la schermata: filtro, elenchi aperti e
// posizione nella lista restano dove li aveva lasciati lo chef. Se c'e' un
// esito (appena salvato), in cima compare cosa e' cambiato.
window.pmRicarica = async function(esito) {
  const modal = document.getElementById('pmModal');
  const st = window.PM_STATO;
  if (!modal || !st) return window.openPrezziMancanti();
  const sb = window.supabaseClient || window.supa;
  const lista = document.getElementById('pmLista');
  const scroll = lista ? lista.scrollTop : 0;
  const r = await pmCaricaDati(sb);
  if (!r.ok) return;
  let avviso = null;
  if (esito && esito.ingredientId) {
    const prima = st.items.filter(function(i) { return i.ingredient_id === esito.ingredientId; });
    const dopo = r.items.filter(function(i) { return i.ingredient_id === esito.ingredientId; });
    const nome = (prima[0] || dopo[0] || {}).ingrediente || 'Ingrediente';
    if (prima.length && !dopo.length) {
      const n = Math.max.apply(null, prima.map(function(i) { return Number(i.ricette_bloccate) || 0; }));
      avviso = { ok: true, testo: '\u2713 ' + nome + ' ha un prezzo: non blocca pi\u00f9 ' + n + (n === 1 ? ' ricetta.' : ' ricette.') };
    } else if (dopo.length) {
      avviso = { ok: false, testo: nome + ': salvato, ma manca ancora qualcosa \u2014 '
        + window.pmDiagnosi(dopo[0], r.cand[dopo[0].ingredient_id]).titolo.toLowerCase() + '.' };
    }
  }
  st.items = r.items; st.cand = r.cand; st.generato = r.generato; st.avviso = avviso;
  pmRender();
  const nuova = document.getElementById('pmLista');
  if (nuova) nuova.scrollTop = scroll;
};

// Nasconde la schermata tenendola intatta (filtro, posizione) e la riprende.
function pmNascondi() {
  ['pmOverlay', 'pmModal'].forEach(function(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}
window.pmTorna = function(esito) {
  const o = document.getElementById('pmOverlay'), m = document.getElementById('pmModal');
  if (!m) return window.openPrezziMancanti();
  if (o) o.style.display = '';
  m.style.display = 'flex';
  if (esito && esito.salvato) window.pmRicarica(esito);
};

const PM_BTN = 'font:600 14px -apple-system,sans-serif;padding:11px 14px;border-radius:10px;border:0;'
  + 'background:#34d399;color:#062b1f;cursor:pointer;';
const PM_BTN_GHOST = 'font:600 14px -apple-system,sans-serif;padding:11px 14px;border-radius:10px;'
  + 'border:1px solid #334155;background:transparent;color:#e2e8f0;cursor:pointer;';
const PM_BTN_OFF = 'font:600 13px -apple-system,sans-serif;padding:10px 12px;border-radius:10px;'
  + 'border:1px dashed #475569;background:transparent;color:#94a3b8;cursor:default;';

function pmRender() {
  const modal = document.getElementById('pmModal');
  const st = window.PM_STATO;
  if (!modal || !st) return;
  const righe = st.items.map(function(it, k) {
    return { it: it, k: k, d: window.pmDiagnosi(it, st.cand[it.ingredient_id]) };
  });
  const conta = {};
  righe.forEach(function(r) { conta[r.d.gruppo] = (conta[r.d.gruppo] || 0) + 1; });
  conta.tutti = righe.length;
  const visibili = righe.filter(function(r) { return st.filtro === 'tutti' || r.d.gruppo === st.filtro; });

  let h = '<div style="padding:18px 18px 12px;border-bottom:1px solid #1e293b;display:flex;gap:12px;align-items:flex-start;">'
    + '<div style="flex:1;min-width:0;">'
    + '<div style="font-size:20px;font-weight:700;color:#f8fafc;">Prezzi mancanti</div>'
    + '<div style="font-size:13px;color:#94a3b8;margin-top:4px;line-height:1.45;">'
    + righe.length + ' ingredienti impediscono un food cost completo. In cima quelli che bloccano più ricette. '
    + 'Qui nessun prezzo viene inventato: vedi cosa manca e dove si sistema.</div></div>'
    + '<div style="display:flex;gap:8px;flex-shrink:0;">'
    + (typeof brigadeBottoneHome === 'function' ? brigadeBottoneHome(PM_BTN_GHOST + 'padding:8px 12px;') : '')
    + '<button onclick="pmChiudi()" aria-label="Chiudi" style="' + PM_BTN_GHOST + 'padding:8px 12px;">Chiudi</button></div></div>';
  if (st.avviso) {
    h += '<div role="status" style="margin:12px 14px 0;padding:11px 13px;border-radius:10px;font-size:14px;line-height:1.4;'
      + (st.avviso.ok ? 'background:#064e3b;color:#d1fae5;border:1px solid #047857;' : 'background:#451a03;color:#fde68a;border:1px solid #92400e;')
      + '">' + pmEsc(st.avviso.testo) + '</div>';
  }
  h += '';

  h += '<div style="display:flex;gap:8px;overflow-x:auto;padding:12px 18px;border-bottom:1px solid #1e293b;-webkit-overflow-scrolling:touch;">';
  window.PM_GRUPPI.forEach(function(g) {
    if (!conta[g.id] && g.id !== 'tutti') return;
    const on = st.filtro === g.id;
    h += '<button onclick="pmFiltro(\'' + g.id + '\')" style="flex:0 0 auto;font:600 13px -apple-system,sans-serif;'
      + 'padding:8px 12px;border-radius:999px;cursor:pointer;white-space:nowrap;'
      + (on ? 'background:#e2e8f0;color:#0f172a;border:1px solid #e2e8f0;'
            : 'background:transparent;color:#cbd5e1;border:1px solid #334155;') + '">'
      + pmEsc(g.label) + ' <span style="opacity:.7;">' + (conta[g.id] || 0) + '</span></button>';
  });
  h += '</div><div id="pmLista" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 0 30px;">';

  visibili.forEach(function(r) {
    // la chiave e' la posizione: lo stesso ingrediente puo' avere due avvisi
    // diversi (il sale: litri/chili e unita' della ricetta)
    const it = r.it, d = r.d, id = String(r.k);
    const colore = { formato: '#fbbf24', collegare: '#34d399', mai: '#64748b', altro: '#f87171' }[d.gruppo] || '#64748b';
    h += '<div style="margin:10px 14px;padding:14px 14px 12px;background:#111c33;border:1px solid #1e293b;'
      + 'border-left:3px solid ' + colore + ';border-radius:12px;">'
      + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">'
      + '<div style="font-size:17px;font-weight:700;color:#f8fafc;min-width:0;overflow-wrap:anywhere;">' + pmEsc(it.ingrediente) + '</div>'
      + '<button onclick="pmRicette(\'' + id + '\')" style="flex:0 0 auto;background:none;border:0;color:#cbd5e1;'
      + 'font:600 13px -apple-system,sans-serif;cursor:pointer;padding:0;">blocca ' + it.ricette_bloccate
      + (Number(it.ricette_bloccate) === 1 ? ' ricetta' : ' ricette') + ' ›</button></div>'
      + '<div style="font-size:14px;font-weight:600;color:' + colore + ';margin-top:6px;">' + pmEsc(d.titolo) + '</div>'
      + '<div style="font-size:13.5px;color:#cbd5e1;margin-top:4px;line-height:1.45;">' + pmEsc(d.testo) + '</div>';
    d.prove.forEach(function(p) {
      h += '<div style="font-size:13px;color:#94a3b8;margin-top:5px;line-height:1.4;">' + pmEsc(p) + '</div>';
    });
    if (st.aperti[id]) {
      h += '<div style="font-size:12.5px;color:#94a3b8;margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;line-height:1.5;">'
        + pmEsc(it.ricette) + '</div>';
    }
    if (d.azioni.length) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">';
      d.azioni.forEach(function(a, i) {
        if (a.tipo === 'presto') {
          h += '<span style="' + PM_BTN_OFF + '">' + pmEsc(a.label) + '</span>';
        } else if (a.tipo === 'conferma' && a.campo) {
          h += '<span style="display:inline-flex;align-items:center;gap:6px;">'
            + '<input id="pmConv' + id + '" inputmode="decimal" aria-label="Conversione" value="' + pmEsc(a.valore) + '" '
            + 'style="width:84px;padding:10px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#f8fafc;font-size:16px;">'
            + '<span style="color:#94a3b8;font-size:13px;">' + pmEsc(a.unita) + '</span></span>'
            + '<button data-id="' + id + '" data-i="' + i + '" onclick="pmAzione(this)" style="' + PM_BTN + '">' + pmEsc(a.label) + '</button>';
        } else {
          h += '<button data-id="' + id + '" data-i="' + i + '" onclick="pmAzione(this)" style="'
            + (i === 0 ? PM_BTN : PM_BTN_GHOST) + '">' + pmEsc(a.label) + '</button>';
        }
      });
      h += '</div>';
    }
    h += '</div>';
  });
  if (!visibili.length) h += '<div style="padding:40px;text-align:center;color:#94a3b8;">Niente in questo gruppo.</div>';
  h += '</div>';
  modal.innerHTML = h;
}

window.pmFiltro = function(f) { window.PM_STATO.filtro = f; pmRender(); };
window.pmRicette = function(id) {
  const a = window.PM_STATO.aperti; a[id] = !a[id]; pmRender();
};

window.pmChiudi = function() {
  document.getElementById('pmOverlay')?.remove();
  document.getElementById('pmModal')?.remove();
};

window.pmAzione = function(btn) {
  const st = window.PM_STATO;
  const it = st.items[Number(btn.getAttribute('data-id'))];
  if (!it) return;
  const d = window.pmDiagnosi(it, st.cand[it.ingredient_id]);
  const a = d.azioni[Number(btn.getAttribute('data-i'))];
  if (!a) return;
  if (a.tipo === 'conferma') {
    const campo = document.getElementById('pmConv' + btn.getAttribute('data-id'));
    const scritto = parseFloat(String(a.campo && campo ? campo.value : a.valore).replace(',', '.'));
    const valore = scritto / (a.fattore || 1);
    if (!(valore > 0)) return;
    let token = null;
    try { token = window.localStorage.getItem('brigade_token'); } catch (e) { token = null; }
    const sb = window.supabaseClient || window.supa;
    btn.disabled = true; btn.textContent = 'Salvo\u2026';
    return Promise.resolve(sb.rpc('fc_conferma_conversione',
      { p_token: token, p_ingredient_id: it.ingredient_id, p_tipo: a.tipoConv, p_valore: valore }))
      .then(function(r) {
        if (r && r.data && r.data.ok) return window.pmRicarica({ ingredientId: it.ingredient_id });
        btn.disabled = false; btn.textContent = 'Non salvato: riprova';
      });
  }
  if (a.tipo === 'scheda' && typeof window.openIngredientCard === 'function') {
    // La scheda sta a z-index 60: questa schermata si nasconde (intatta) e la
    // scheda sa da dove arriva. "‹ Prezzi mancanti" e Salva riportano qui.
    pmNascondi();
    window.openIngredientCard(it.ingredient_id, { origine: {
      etichetta: 'Prezzi mancanti', dopoSalva: 'torna', torna: window.pmTorna } });
  } else if (a.tipo === 'collega' && typeof window.vdrOpenMatchSelector === 'function') {
    // La modale di collegamento sta SOPRA (9400): la lista resta sotto, com'e'.
    const c = a.cand;
    Promise.resolve(window.vdrOpenMatchSelector(c.doc_id || null, c.vendor, c.vendor_sku, c.descrizione, btn))
      .then(function() {
        if (!document.getElementById('_vdrMatchSelector') || !window.MutationObserver) return;
        const obs = new window.MutationObserver(function() {
          if (document.getElementById('_vdrMatchSelector')) return;
          obs.disconnect();
          window.pmRicarica({ ingredientId: it.ingredient_id });
        });
        obs.observe(document.body, { childList: true });
      });
  } else if (a.tipo === 'vendor_review' && typeof window.openVendorDocumentsReview === 'function') {
    window.pmChiudi();
    window.openVendorDocumentsReview();
  }
};
