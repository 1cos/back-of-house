// ══════════════════════════════════════════════════════════════════
// GG03 — IL DOCUMENTO PROTETTO
//
// Verifica che un documento in status 'error' sia invisibile ai due
// cicli del cron, visibile nella UI, approvabile a mano, e che
// l'approvazione sia essa stessa il rilascio — senza nessuna finestra
// in cui il cron possa infilarsi.
//
// Le asserzioni girano contro la SORGENTE vera dei due file, non
// contro una descrizione di come dovrebbero funzionare.
// ══════════════════════════════════════════════════════════════════
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const WORKER = R('edge-functions/vendor-doc-auto-import/index.ts');
const VDR    = R('js/vendor-documents-review.js');
const DOC    = JSON.parse(fs.readFileSync(
  '/private/tmp/claude-501/-Users-massimilianozubboli-Desktop-App-principale-Brigade/f462f632-f3a7-4333-ba63-2219929d10e2/scratchpad/gg/doc20734.json','utf8'));
const { vdaiPackToGrams } = require('../pure_logic.cjs');

// ── 1. IL CRON NON PUO' VEDERLO ───────────────────────────────────

test('1. Phase B pesca solo status pending: un documento error e\' fuori dalla query', () => {
  const qb = WORKER.match(/let qB = sb\.from\('vendor_documents'\)[\s\S]{0,400}?;/);
  assert.ok(qb, 'query di Phase B non trovata');
  assert.ok(qb[0].includes(".eq('status', 'pending')"),
    'Phase B deve filtrare su pending: ' + qb[0].slice(0, 200));
  // e non deve esserci nessun ramo che accetta anche error
  assert.ok(!/in\('status',\s*\[[^\]]*error/.test(WORKER),
    'nessuna query del worker deve accettare status error');
});

test('2. Phase A pesca solo pdf_received: nemmeno lei lo tocca', () => {
  assert.ok(WORKER.includes("qA.eq('status', 'pdf_received')"),
    'Phase A deve filtrare su pdf_received');
});

test('3. anche il conteggio della finestra di Phase B filtra su pending', () => {
  const conteggi = WORKER.match(/\.eq\('status', 'pending'\)/g) || [];
  assert.ok(conteggi.length >= 2,
    'sia il conteggio sia la query devono filtrare su pending, trovati ' + conteggi.length);
});

// ── 2. LA UI LO VEDE E LO SA APPROVARE ────────────────────────────

test('4. Vendor Review elenca pending E error: il documento e\' visibile', () => {
  assert.ok(VDR.includes(".in('status', ['pending','error'])"),
    'la lista di Vendor Review deve includere error');
});

test('5. il bottone Approve compare per qualunque status tranne imported', () => {
  const bottoni = VDR.match(/doc\.status !== 'imported' \?[^:]*vdrApprove/g) || [];
  assert.ok(bottoni.length >= 2,
    'il bottone deve comparire anche su error, trovati ' + bottoni.length + ' punti');
});

test('6. vdrApprove non richiede pending, e va dritto a imported', () => {
  // esce presto SOLO se e' gia' importato
  assert.ok(/if \(doc\.status === 'imported'\)/.test(VDR),
    'unica uscita anticipata prevista');
  assert.ok(!/vdrApprove[\s\S]{0,8000}?\.eq\('status',\s*'pending'\)/.test(VDR),
    'vdrApprove non deve avere una guardia su pending');
  // e l'aggiornamento finale non ha guardia di stato
  assert.ok(VDR.includes(".update({ status: 'imported', updated_at: new Date().toISOString() }).eq('id', docId)"),
    'l\'approvazione scrive imported filtrando solo per id');
});

test('7. NESSUNA FINESTRA: non si passa mai da pending', () => {
  // il documento nasce error e diventa imported con un solo UPDATE.
  // Se esistesse un passaggio intermedio a pending, il cron potrebbe
  // infilarsi fra i due. Verifico che vdrApprove non scriva mai pending.
  const approve = VDR.slice(VDR.indexOf('window.vdrApprove'), VDR.indexOf('window.vdrApprove') + 9000);
  assert.ok(!/status:\s*'pending'/.test(approve),
    'vdrApprove non deve mai riportare il documento a pending');
});

test('8. il worker legge ingredient_links confermati: i collegamenti valgono anche qui', () => {
  assert.ok(/from\('ingredient_links'\)[\s\S]{0,200}?confirmed/.test(VDR),
    'vdrApprove deve leggere solo i link confermati');
  assert.ok(/ingredient_links/.test(WORKER), 'e il worker pure');
});

// ── 3. L'OLIO: UNITA' COERENTI ────────────────────────────────────

test('9. olio: prezzo per cassa e peso per cassa, mai mescolati', () => {
  const olio = DOC.items.find(i => i.description.includes('Oleoestepa'));
  assert.ok(olio, 'riga olio mancante');
  assert.strictEqual(olio.qty, 3, 'tre casse');
  assert.strictEqual(olio.unit_price, 164.00, 'prezzo PER CASSA');
  assert.strictEqual(olio.amount, 492.00, '3 x 164');
  assert.strictEqual(olio._densita_assunta, 0.916);
  // 1 cassa = 3 confezioni da 5 lt = 15 litri
  assert.strictEqual(olio._peso_per_cassa_g, 15 * 1000 * 0.916);
  assert.strictEqual(olio._peso_per_cassa_g, 13740);
  assert.strictEqual(olio._peso_totale_g, 41220, 'le tre casse');
  // il costo si ottiene SOLO accoppiando prezzo-cassa con peso-cassa
  assert.strictEqual(olio._cost_per_100g, 1.1936);
  const giusto = 164.00 / 13740 * 100;
  assert.ok(Math.abs(olio._cost_per_100g - giusto) < 0.0001);
  // e la trappola che Max ha segnalato, esplicitata:
  const sbagliato = 164.00 / 41220 * 100;   // prezzo di 1 cassa / peso di 3
  assert.ok(Math.abs(sbagliato - 0.3979) < 0.001, 'la divisione sbagliata darebbe $0,3979');
  assert.ok(Math.abs(olio._cost_per_100g - sbagliato) > 0.5, 'e non e\' quella che usiamo');
  // controprova: anche 492 / 41.220 da' lo stesso risultato giusto
  assert.ok(Math.abs(492.00 / 41220 * 100 - giusto) < 0.0001,
    'totale riga diviso peso totale: stessa cifra, le unita\' sono coerenti');
});

test('10. il writer non puo\' ricavare il peso da "3/5LT": per questo serve _cost_per_100g', () => {
  assert.strictEqual(vdaiPackToGrams('3/5LT'), null,
    'il formato in litri non da\' grammi: senza _cost_per_100g la riga resterebbe senza prezzo');
  // la catena del writer: _cost_per_100g ha la precedenza su tutto
  assert.ok(/const per100g = item\._cost_per_100g \? parseFloat\(item\._cost_per_100g\)/.test(WORKER),
    '_cost_per_100g e\' il primo ramo del writer');
});

test('11. le altre righe restano coerenti con i pesi ricavati dal formato', () => {
  const g = d => vdaiPackToGrams(d);
  const sale = DOC.items.find(i => i.description.includes('SEA SALT'));
  assert.strictEqual(Math.round(g(sale.pack_description)), 25000);
  assert.ok(Math.abs(sale.unit_price / 25000 * 100 - 0.1380) < 0.0001, '$0,1380/100 g');
  const guanciale = DOC.items.find(i => i.description.includes('Guanciale'));
  assert.strictEqual(guanciale.cost_per_lb, 16.82, 'la colonna U/M dice lb');
  assert.ok(Math.abs(guanciale.cost_per_lb / 453.592 * 100 - 3.7082) < 0.0001);
});

test('12. i totali quadrano ancora dopo la correzione', () => {
  const somma = DOC.items.reduce((s, i) => s + i.amount, 0);
  assert.ok(Math.abs(somma - 936.10) < 0.005, 'somma righe ' + somma.toFixed(2));
  assert.strictEqual(DOC.total, 936.10);
});
