// ── vendor-parsers/ocr-layout.js ─────────────────────────────
// XCF-GG — da parole OCR con coordinate a righe di testo.
//
// Perche' serve: un motore OCR restituisce il testo di una tabella per
// BLOCCHI, spesso colonna per colonna (prima tutte le quantita', poi
// tutte le descrizioni...). Un parser di fattura ha bisogno della RIGA:
// "3 cs Italian Peeled Tomatoes 6#10 "La Carmela" 35.00 3cs 105.00".
// Il percorso pdfjs del worker fa gia' questo con le coordinate Y dei
// pezzi di testo; qui si fa la stessa cosa con le coordinate delle
// parole OCR, in modo deterministico e indipendente dal motore.
//
// Ingresso: pagine = [{ width, height, tokens: [{ text, box }] }], dove
// box = 4 vertici [{x,y}] in coordinate della pagina (pixel o
// normalizzate, purche' coerenti con width/height), in ordine
// alto-sinistra, alto-destra, basso-destra, basso-sinistra.
// Uscita: testo, righe separate da \n, pagine separate da \f.
//
// Scansioni e foto sono spesso un po' storte: un grado e mezzo su una
// pagina larga sposta l'ultima colonna di piu' di un'altezza di riga.
// L'inclinazione si stima dai bordi superiori delle parole (mediana,
// pesata sulle parole lunghe) e si raddrizzano i centri prima di
// raggrupparli. Pure functions, nessuna dipendenza.

'use strict';

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function tokenGeometry(tok, sx, sy) {
  const v = (tok.box || []).map(p => ({ x: (p.x || 0) * sx, y: (p.y || 0) * sy }));
  if (v.length < 4) return null;
  const cx = (v[0].x + v[1].x + v[2].x + v[3].x) / 4;
  const cy = (v[0].y + v[1].y + v[2].y + v[3].y) / 4;
  const w  = Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y);
  const h  = Math.hypot(v[3].x - v[0].x, v[3].y - v[0].y);
  const angle = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
  return { text: String(tok.text || ''), cx, cy, w, h, angle, left: Math.min(v[0].x, v[3].x) };
}

// Una pagina → righe di testo.
//
// Le righe si costruiscono da SINISTRA a destra, "inseguendo" la riga:
// ogni parola si attacca alla riga la cui retta (centro dell'ultima parola
// + pendenza della riga) passa piu' vicino al suo centro. Serve per le
// FOTO di fatture: la prospettiva fa si' che le righe non siano parallele
// fra loro, e una sola inclinazione globale lascia la colonna Amount una
// riga piu' su (misurato sulla foto della #20734). Su una scansione dritta
// il risultato e' lo stesso del raggruppamento per Y.
function pageToLines(page) {
  const W = page.width || 1, H = page.height || 1;
  // Coordinate normalizzate (<=1) → si riportano alle proporzioni vere
  // della pagina, altrimenti l'angolo sarebbe distorto.
  const norm = (page.tokens || []).every(t => (t.box || []).every(p => (p.x || 0) <= 1.0001 && (p.y || 0) <= 1.0001));
  const sx = norm ? W : 1, sy = norm ? H : 1;
  const toks = (page.tokens || []).map(t => tokenGeometry(t, sx, sy))
    .filter(t => t && t.text.trim() && t.h > 0);
  if (!toks.length) return [];

  const hMed = median(toks.map(t => t.h)) || 1;
  const longOnes = toks.filter(t => t.w > 3 * hMed);
  const globalSlope = Math.tan(median((longOnes.length >= 5 ? longOnes : toks).map(t => t.angle)));

  toks.sort((a, b) => a.left - b.left);
  const rows = [];
  const slopeOf = (r) => {
    // Retta ai minimi quadrati sui centri della riga, se la riga e' gia'
    // abbastanza lunga da dire qualcosa; altrimenti la pendenza globale.
    const n = r.toks.length;
    if (n < 2) return globalSlope;
    const xs = r.toks.map(t => t.cx), ys = r.toks.map(t => t.cy);
    const span = Math.max(...xs) - Math.min(...xs);
    if (span < 6 * hMed) return globalSlope;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const fit = den ? num / den : globalSlope;
    // Mai troppo lontano dalla pendenza globale: una riga di due parole
    // storte non deve poter girare di 10 gradi.
    return Math.abs(fit - globalSlope) > 0.05 ? globalSlope : fit;
  };
  for (const t of toks) {
    let best = null, bestD = Infinity;
    for (const r of rows) {
      const last = r.toks[r.toks.length - 1];
      if (t.left < last.left + last.w * 0.5) continue;      // sovrapposta: non e' la stessa riga
      const pred = last.cy + r.slope * (t.cx - last.cx);
      const d = Math.abs(t.cy - pred);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (best && bestD <= 0.5 * Math.max(hMed, Math.min(t.h, 2 * hMed))) {
      best.toks.push(t); best.slope = slopeOf(best);
    } else {
      rows.push({ toks: [t], slope: globalSlope });
    }
  }
  // Ordine verticale: la y di ogni riga riportata al centro pagina.
  const xRef = W / 2 * (norm ? 1 : 1);
  rows.forEach(r => { const f = r.toks[0]; r.yRef = f.cy + r.slope * (xRef - f.cx); });
  rows.sort((a, b) => a.yRef - b.yRef);
  return rows.map(r => r.toks.map(t => t.text).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function pagesToText(pages) {
  return (pages || []).map(p => pageToLines(p).join('\n')).join('\n\f\n');
}

// ── Adattatore Google Vision (files:annotate / images:annotate) ──
// fullTextAnnotation.pages[].blocks[].paragraphs[].words[] con
// boundingBox.vertices (immagini, pixel) o normalizedVertices (PDF, 0..1).
function visionPagesToLayout(fullTextAnnotation) {
  const out = [];
  for (const pg of (fullTextAnnotation && fullTextAnnotation.pages) || []) {
    const tokens = [];
    for (const b of pg.blocks || []) for (const para of b.paragraphs || []) for (const w of para.words || []) {
      const text = (w.symbols || []).map(s => s.text || '').join('');
      const bb = w.boundingBox || {};
      const verts = (bb.normalizedVertices && bb.normalizedVertices.length === 4) ? bb.normalizedVertices : bb.vertices;
      if (!text || !verts || verts.length !== 4) continue;
      tokens.push({ text, box: verts.map(v => ({ x: v.x || 0, y: v.y || 0 })) });
    }
    out.push({ width: pg.width || 1, height: pg.height || 1, tokens });
  }
  return out;
}

const API = { pageToLines, pagesToText, visionPagesToLayout };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
