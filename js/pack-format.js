// ══════════════════════════════════════════════════════════════════
// FORMATO DELLA CONFEZIONE (FC04-UX)
//
// Lo chef non deve fare conti a mente. Dalla descrizione del fornitore
// ("12/1 QT", "6 CT", "3/5LT") si ricavano numero di confezioni, quantita'
// per confezione e unita'; da li' il totale in grammi e il prezzo per
// 100 g, mostrati PRIMA di salvare.
//
// Tre modi di arrivare ai grammi, sempre dichiarati:
//   documentato  il formato e' gia' un peso (10 KG, 2/5LB): conversione esatta
//   chef         il formato e' un volume o dei pezzi: lo chef dice quanto pesa
//                UNA confezione (1 QT = 908 g, 1 mazzo = 100 g)
//   totale       lo chef conosce gia' il peso complessivo
// Nessun volume diventa peso da solo: la convenzione 1 L = 1 kg vale per
// l'olio (FC02) e resta nel motore, non qui.
//
// Funzioni pure, niente DOM: testate in tests/pack-format.test.js.
// ══════════════════════════════════════════════════════════════════
'use strict';

// Unita' offerte allo chef, nell'ordine del selettore.
window.PK_UNITA = [
  { id: 'g',   label: 'g',      dim: 'mass',   f: 1 },
  { id: 'kg',  label: 'kg',     dim: 'mass',   f: 1000 },
  { id: 'lb',  label: 'lb',     dim: 'mass',   f: 453.592 },
  { id: 'oz',  label: 'oz',     dim: 'mass',   f: 28.3495 },
  { id: 'ml',  label: 'ml',     dim: 'volume', f: 1 },
  { id: 'l',   label: 'L',      dim: 'volume', f: 1000 },
  { id: 'qt',  label: 'US qt',  dim: 'volume', f: 946.353 },
  { id: 'gal', label: 'US gal', dim: 'volume', f: 3785.41 },
  { id: 'pz',  label: 'pezzi',  dim: 'count',  f: 1 },
];

const PK_ALIAS = {
  G: 'g', GR: 'g', GRAM: 'g', GRAMS: 'g',
  KG: 'kg', KGS: 'kg', KILO: 'kg',
  LB: 'lb', LBS: 'lb', '#': 'lb',
  OZ: 'oz',
  ML: 'ml',
  L: 'l', LT: 'l', LTR: 'l', LITER: 'l', LITRE: 'l', LITERS: 'l',
  QT: 'qt', QUART: 'qt',
  GAL: 'gal', GALLON: 'gal', GA: 'gal',
  CT: 'pz', EA: 'pz', EACH: 'pz', PC: 'pz', PCS: 'pz', PZ: 'pz', BUNCH: 'pz', BU: 'pz',
  DZ: 'pz12',
};

window.pkUnita = function(id) {
  return window.PK_UNITA.find(function(u) { return u.id === id; }) || null;
};

// "12/1 QT" -> {confezioni:12, quantita:1, unita:'qt'}
// "6 CT"    -> {confezioni:6,  quantita:1, unita:'pz'}   (6 pezzi)
// "3/5LT"   -> {confezioni:3,  quantita:5, unita:'l'}
// "9-1/2 GAL" -> {confezioni:9, quantita:0.5, unita:'gal'} (9 mezzi galloni)
// Restituisce null se non e' sicuro (es. "16-22 CT": un intervallo).
window.pkLeggi = function(testo) {
  if (!testo) return null;
  let s = String(testo).toUpperCase().trim()
    .replace(/(\d)\s*#/g, '$1 LB')
    .replace(/\s*\/\s*/g, '/')
    .replace(/(\d)\s*X\s*(\d)/g, '$1x$2')
    .replace(/\s+/g, ' ');
  const unita = function(u) {
    const k = PK_ALIAS[u.replace(/\.$/, '')];
    return k || null;
  };
  const fine = function(n, q, u) {
    const k = unita(u);
    if (!k || !(n > 0) || !(q > 0)) return null;
    if (k === 'pz12') return { confezioni: n, quantita: q * 12, unita: 'pz' };
    return { confezioni: n, quantita: q, unita: k };
  };
  let m;
  // "9-1/2 GAL": N confezioni da 1/2
  m = s.match(/^(\d+)-(\d+)\/(\d+)\s*([A-Z#.]+)$/);
  if (m) return fine(Number(m[1]), Number(m[2]) / Number(m[3]), m[4]);
  // intervalli ("16-22 CT", "6-8 LB"): nessuna ipotesi
  if (/^\d+(\.\d+)?\s*-\s*\d/.test(s)) return null;
  // "12/1 QT", "2/5LB", "8/12 OZ", "3/5LT"
  m = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*([A-Z#.]+)$/);
  if (m) return fine(Number(m[1]), Number(m[2]), m[3]);
  // "4x5LB"
  m = s.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\s*([A-Z#.]+)$/);
  if (m) return fine(Number(m[1]), Number(m[2]), m[3]);
  // "6 CT", "10 KG", "1 GAL", "5 LB"
  m = s.match(/^(\d+(?:\.\d+)?)\s*([A-Z#.]+)$/);
  if (m) {
    const k = unita(m[2]);
    if (k === 'pz' || k === 'pz12') return fine(Number(m[1]), 1, m[2]);
    return fine(1, Number(m[1]), m[2]);
  }
  return null;
};

// Totale di una confezione intera nella sua dimensione (g, ml o pezzi).
window.pkTotale = function(f) {
  const u = f && window.pkUnita(f.unita);
  if (!u || !(f.confezioni > 0) || !(f.quantita > 0)) return null;
  return { dim: u.dim, quantita: f.confezioni * f.quantita * u.f };
};

// Quanto pesa una confezione singola, dato quello che lo chef ha dichiarato.
// dich = {g_per_ml} per i volumi, {g_per_pz} per i pezzi (vedi pkDichiara).
window.pkPesoConfezione = function(f, dich) {
  const u = f && window.pkUnita(f.unita);
  if (!u || !dich) return null;
  if (u.dim === 'volume' && dich.g_per_ml > 0) return f.quantita * u.f * dich.g_per_ml;
  if (u.dim === 'count' && dich.g_per_pz > 0) return f.quantita * dich.g_per_pz;
  return null;
};

// Dal peso di UNA confezione (lo chef lo scrive) alla dichiarazione riusabile:
// 1 US qt = 908 g  ->  {g_per_ml: 0.9595}; 1 mazzo = 100 g -> {g_per_pz: 100}
window.pkDichiara = function(f, grammiConfezione) {
  const u = f && window.pkUnita(f.unita);
  if (!u || !(grammiConfezione > 0) || !(f.quantita > 0)) return null;
  if (u.dim === 'volume') return { g_per_ml: grammiConfezione / (f.quantita * u.f) };
  if (u.dim === 'count') return { g_per_pz: grammiConfezione / f.quantita };
  return null;
};

// I grammi del formato, con la fonte. Input:
//   f       {confezioni, quantita, unita}
//   dich    dichiarazione dello chef {g_per_ml} o {g_per_pz} (volumi e pezzi)
//   totale  grammi complessivi gia' noti (vince su tutto)
// Output: {grammi, fonte: 'documentato'|'chef'|'totale', spiegazione} oppure
//         {grammi:null, manca, spiegazione}
window.pkGrammi = function(f, dich, totale) {
  if (totale > 0) {
    return { grammi: totale, fonte: 'totale', spiegazione: 'peso complessivo indicato dallo chef' };
  }
  const t = window.pkTotale(f);
  if (!t) return { grammi: null, manca: 'formato', spiegazione: 'indica confezioni, quantit\u00e0 e unit\u00e0' };
  const u = window.pkUnita(f.unita);
  if (t.dim === 'mass') {
    return { grammi: t.quantita, fonte: 'documentato',
      spiegazione: f.confezioni + ' \u00d7 ' + pkNum(f.quantita) + ' ' + u.label + ' = ' + pkNum(t.quantita, 0) + ' g' };
  }
  const una = window.pkPesoConfezione(f, dich);
  if (!(una > 0)) {
    return { grammi: null, manca: 'peso_confezione',
      spiegazione: t.dim === 'volume'
        ? 'serve il peso di una confezione da ' + pkNum(f.quantita) + ' ' + u.label
        : 'serve il peso di un pezzo' };
  }
  const g = f.confezioni * una;
  return { grammi: g, fonte: 'chef',
    spiegazione: f.confezioni + ' \u00d7 ' + pkNum(una, una % 1 ? 1 : 0) + ' g = ' + pkNum(g, 0) + ' g' };
};

// Prezzo per 100 g dal prezzo della confezione intera.
window.pkPrezzo100 = function(prezzo, grammi) {
  if (!(prezzo > 0) || !(grammi > 0)) return null;
  return prezzo / grammi * 100;
};

// Numeri all'italiana: 10896 -> "10.896", 0.5 -> "0,5"
function pkNum(n, dec) {
  if (n == null || isNaN(n)) return '';
  const d = dec == null ? (Math.round(n) === n ? 0 : 2) : dec;
  const s = Number(n).toFixed(d).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return s[1] && Number(s[1]) !== 0 ? s[0] + ',' + s[1].replace(/0+$/, '') : s[0];
}
window.pkNum = pkNum;

// ══════════════════════════════════════════════════════════════════
// EDITOR DEL FORMATO — nella finestra "Edit Vendor" della scheda ingrediente
//
// pkMontaEditor(contenitore, {pack, conv, prezzo, ingredientId, onChange})
//   pack    descrizione del fornitore ("12/1 QT"): letta, mai riscritta
//   conv    grammi gia' salvati (conversion_to_base), se ci sono
//   prezzo  prezzo della confezione intera, per l'anteprima
//   onChange(stato) a ogni modifica: stato.grammi e' il totale, o null
// Lo stato completo resta in contenitore._pk (lo legge il salvataggio).
// ══════════════════════════════════════════════════════════════════
const PK_INPUT = 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;'
  + 'font-size:16px;background:#fff;color:#1e293b;'; // 16px: l'iPhone non ingrandisce la pagina

function pkEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pkData(d) {
  const p = String(d || '').slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : '';
}

// Ultima dichiarazione dello chef per questo ingrediente (tabella audit
// esistente, nessuna colonna nuova): {g_per_ml} o {g_per_pz}, con chi e quando.
window.pkUltimaDichiarazione = async function(sb, ingredientId, dim) {
  if (!sb || !ingredientId) return null;
  try {
    const { data } = await sb.from('ingredient_vendor_price_audit')
      .select('assunzioni,created_at,eseguito_da')
      .eq('ingredient_id', ingredientId)
      .eq('assunzioni->>tipo', 'conversione_formato')
      .order('created_at', { ascending: false }).limit(10);
    const k = dim === 'volume' ? 'g_per_ml' : 'g_per_pz';
    const r = (data || []).find(function(x) {
      const d = x.assunzioni && x.assunzioni.dichiarazione;
      return x.assunzioni && x.assunzioni.fonte === 'chef' && d && d[k] > 0;
    });
    if (!r) return null;
    const d = {}; d[k] = Number(r.assunzioni.dichiarazione[k]);
    return { dich: d, chi: r.eseguito_da, quando: r.created_at };
  } catch (e) { return null; }
};

window.pkMontaEditor = async function(el, o) {
  if (!el) return;
  o = o || {};
  const letto = window.pkLeggi(o.pack);
  const st = el._pk = {
    formato: letto ? { confezioni: letto.confezioni, quantita: letto.quantita, unita: letto.unita }
                   : { confezioni: 1, quantita: '', unita: 'g' },
    letto: !!letto, dich: null, dichNota: '', totale: null, modoTotale: false,
    prezzo: Number(o.prezzo) || null, convIniziale: Number(o.conv) || null, risultato: null,
  };
  const sb = window.supabaseClient || window.supa;
  const dim = function() { const u = window.pkUnita(st.formato.unita); return u ? u.dim : null; };

  // Da dove parte l'editor, senza chiedere conti allo chef:
  //  - una dichiarazione gia' approvata per questo ingrediente;
  //  - altrimenti i grammi gia' salvati, divisi per le confezioni;
  //  - un formato illeggibile con grammi salvati: modalita' "peso totale".
  if (dim() === 'volume' || dim() === 'count') {
    const ult = await window.pkUltimaDichiarazione(sb, o.ingredientId, dim());
    if (ult) {
      st.dich = ult.dich;
      st.dichNota = 'dichiarato da ' + (ult.chi || 'chef') + ' il ' + pkData(ult.quando);
    } else if (st.convIniziale && st.formato.confezioni > 0) {
      st.dich = window.pkDichiara(st.formato, st.convIniziale / st.formato.confezioni);
      st.dichNota = 'dal peso già salvato';
    }
  } else if (!letto && st.convIniziale) {
    st.modoTotale = true; st.totale = st.convIniziale;
  }

  function domanda() {
    const f = st.formato, u = window.pkUnita(f.unita) || window.PK_UNITA[0];
    return u.dim === 'volume'
      ? 'Quanto pesa una confezione da ' + pkNum(Number(f.quantita) || 1) + ' ' + u.label + '?'
      : 'Quanto pesa un pezzo?';
  }
  function scatola() {
    const r = st.risultato = window.pkGrammi(st.formato, st.dich, st.modoTotale ? st.totale : null);
    if (r.grammi > 0) {
      const fonte = { documentato: 'peso scritto sulla confezione', chef: 'peso dichiarato dallo chef', totale: 'peso totale indicato dallo chef' }[r.fonte];
      const p100 = window.pkPrezzo100(st.prezzo, r.grammi);
      return '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;margin-top:10px;">'
        + '<div style="font-size:15px;font-weight:700;color:#14532d;">Totale ' + pkNum(r.grammi, 0) + ' g</div>'
        + '<div style="font-size:12px;color:#166534;margin-top:2px;">' + pkEsc(r.spiegazione) + ' \u00b7 ' + fonte + '</div>'
        + (p100 != null ? '<div style="font-size:14px;color:#14532d;margin-top:6px;">$' + pkNum(st.prezzo, 2) + ' \u00f7 ' + pkNum(r.grammi, 0)
          + ' g = <b>$' + pkNum(p100, 4) + ' / 100 g</b></div>' : '<div style="font-size:12px;color:#92400e;margin-top:6px;">Inserisci il prezzo per vedere il costo per 100 g.</div>')
        + '</div>';
    }
    return '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-top:10px;font-size:13px;color:#92400e;">'
      + 'Manca: ' + pkEsc(r.spiegazione) + '.</div>';
  }
  // Mentre si scrive si aggiornano solo domanda e anteprima: ricostruire i
  // campi farebbe chiudere la tastiera dell'iPhone.
  function aggiornaVista() {
    const b = el.querySelector('#pkBox'); if (b) b.innerHTML = scatola();
    const d = el.querySelector('#pkDomanda'); if (d) d.textContent = domanda();
    if (typeof o.onChange === 'function') o.onChange(st);
  }

  function disegna() {
    const f = st.formato, u = window.pkUnita(f.unita) || window.PK_UNITA[0];
    const una = window.pkPesoConfezione(f, st.dich);
    let h = '<label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:6px;">FORMATO DELLA CONFEZIONE</label>';
    if (o.pack) {
      h += '<div style="font-size:12px;color:#64748b;margin-bottom:8px;">Dal fornitore: <b style="color:#1e293b;">«' + pkEsc(o.pack) + '»</b>'
        + (letto ? ' — letto qui sotto, correggi se serve' : ' — non riesco a leggerlo, compila qui sotto') + '</div>';
    }
    if (!st.modoTotale) {
      h += '<div style="display:grid;grid-template-columns:1fr auto 1fr 1.2fr;gap:6px;align-items:center;">'
        + '<input id="pkConf" inputmode="decimal" aria-label="Numero di confezioni" value="' + pkEsc(f.confezioni) + '" style="' + PK_INPUT + '">'
        + '<span style="color:#94a3b8;font-size:15px;">×</span>'
        + '<input id="pkQta" inputmode="decimal" aria-label="Quantità per confezione" value="' + pkEsc(f.quantita) + '" style="' + PK_INPUT + '">'
        + '<select id="pkUnita" aria-label="Unità" style="' + PK_INPUT + 'padding:10px 6px;">'
        + window.PK_UNITA.map(function(x) { return '<option value="' + x.id + '"' + (x.id === f.unita ? ' selected' : '') + '>' + x.label + '</option>'; }).join('')
        + '</select></div>'
        + '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">confezioni × quantità per confezione</div>';
      if (u.dim === 'volume' || u.dim === 'count') {
        h += '<label id="pkDomanda" for="pkUna" style="font-size:13px;color:#1e293b;font-weight:600;display:block;margin:12px 0 4px;">' + pkEsc(domanda()) + '</label>'
          + '<div style="display:flex;gap:6px;align-items:center;"><input id="pkUna" inputmode="decimal" value="'
          + (una > 0 ? pkEsc(Math.round(una * 100) / 100) : '') + '" placeholder="grammi" style="' + PK_INPUT + '"><span style="color:#64748b;">g</span></div>'
          + '<div style="font-size:11px;color:#b45309;margin-top:4px;">Peso dichiarato dallo chef, non scritto sulla confezione'
          + (st.dichNota ? ' · ' + pkEsc(st.dichNota) : '') + '.'
          + (u.dim === 'volume' ? ' Nessuna regola 1 L = 1 kg: pesa una confezione.' : '') + '</div>';
      }
    } else {
      h += '<label for="pkTot" style="font-size:13px;color:#1e293b;font-weight:600;display:block;margin:4px 0;">Peso totale della confezione</label>'
        + '<div style="display:flex;gap:6px;align-items:center;"><input id="pkTot" inputmode="decimal" value="' + (st.totale > 0 ? pkEsc(st.totale) : '')
        + '" placeholder="grammi" style="' + PK_INPUT + '"><span style="color:#64748b;">g</span></div>';
    }
    h += '<button type="button" id="pkModo" style="margin-top:8px;background:none;border:none;color:#2563eb;font-size:13px;padding:4px 0;cursor:pointer;">'
      + (st.modoTotale ? 'Calcola dal formato' : 'Conosco già il peso totale') + '</button>';
    el.innerHTML = h + '<div id="pkBox"></div>';
    lega();
    aggiornaVista();
  }

  function num(id) { const x = el.querySelector('#' + id); if (!x) return null; const v = parseFloat(String(x.value).replace(',', '.')); return isNaN(v) ? null : v; }
  function lega() {
    const agg = function() {
      if (!st.modoTotale) {
        st.formato = { confezioni: num('pkConf'), quantita: num('pkQta'), unita: el.querySelector('#pkUnita').value };
        const una = num('pkUna');
        if (el.querySelector('#pkUna')) {
          const d = window.pkDichiara(st.formato, una);
          if (d) { st.dich = d; st.dichNota = ''; } else if (una == null) st.dich = null;
        }
      } else {
        st.totale = num('pkTot');
      }
      aggiornaVista();
    };
    ['pkConf', 'pkQta', 'pkUna', 'pkTot'].forEach(function(id) {
      const x = el.querySelector('#' + id);
      if (x) x.addEventListener('input', agg);
    });
    // cambiare unita' puo' cambiare la domanda (peso o pezzi): si ridisegna
    const s = el.querySelector('#pkUnita');
    if (s) s.addEventListener('change', function() {
      st.dich = null; st.dichNota = '';
      st.formato = { confezioni: num('pkConf'), quantita: num('pkQta'), unita: s.value };
      disegna();
    });
    el.querySelector('#pkModo').addEventListener('click', function() {
      st.modoTotale = !st.modoTotale;
      if (st.modoTotale && !(st.totale > 0) && st.risultato && st.risultato.grammi > 0) st.totale = Math.round(st.risultato.grammi);
      disegna();
    });
  }

  el.pkPrezzo = function(p) { st.prezzo = Number(p) || null; aggiornaVista(); };
  disegna();
};

// Per il salvataggio: la riga di audit che distingue la fonte dei grammi.
window.pkRigaAudit = function(st, v, conv, p100, chi) {
  if (!st || !st.risultato || !(st.risultato.grammi > 0)) return null;
  return {
    ingredient_vendor_id: v.id, ingredient_id: v.ingredient_id, vendor: v.vendor,
    motivo: 'FC04-UX — formato della confezione: ' + st.risultato.spiegazione
      + ' (' + { documentato: 'peso scritto sulla confezione', chef: 'peso dichiarato dallo chef', totale: 'peso totale indicato dallo chef' }[st.risultato.fonte] + ')',
    prima: { conversion_to_base: v.conversion_to_base, price_per_100g: v.price_per_100g },
    dopo: { conversion_to_base: conv, price_per_100g: p100 },
    assunzioni: { tipo: 'conversione_formato', fonte: st.risultato.fonte, formato: st.formato,
                  dichiarazione: st.risultato.fonte === 'chef' ? st.dich : null,
                  grammi: st.risultato.grammi, pack_description: v.pack_description || null },
    eseguito_da: chi || 'Brigade',
  };
};
