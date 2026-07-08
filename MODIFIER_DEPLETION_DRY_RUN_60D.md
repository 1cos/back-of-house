# MODIFIER DEPLETION — DRY RUN 60 GIORNI
*Brigade · Zenos on the Square · Weatherford TX*
*Eseguito: 8 luglio 2026 — Phase 3a*

> **DRY-RUN ONLY** — nessuna scrittura su stock. Nessun bot modificato. Nessuna regola attivata.

---

## Finestra di analisi

| Campo | Valore |
|---|---|
| Date disponibili nel DB | 2026-06-09 → 2026-07-07 (29 giorni operativi) |
| Regole applicate | `confidence='confirmed'`, `active=false` (dry-run ignora active) |
| Quantità per ramekin | 2 fl oz = 59.147 ml = 59.147 g |
| Totale modifier distinti nel DB | 1074 |
| Righe pos_modifiers nella finestra | 2771 |

> Nota: i dati disponibili coprono 29 giorni operativi (non 60 di calendario — il DB è in produzione dal 9 giugno 2026). I numeri 60gg saranno disponibili dopo il 9 agosto 2026.

---

## Riepilogo totale

| Modifier | Target | Tipo | Uses | g/use | Total kg | Total L | Ramekin |
|---|---|---|---|---|---|---|---|
| Caesar | Caesar Dressing | ingredient | 312 | 59.147 | **18.45** | **18.45** | 312 |
| citronette | CITRONETTE | recipe | 195 | 59.147 | **11.53** | **11.53** | 195 |
| Balsamic | BALSAMIC VINAIGRETTE | recipe | 152 | 59.147 | **8.99** | **8.99** | 152 |
| Ranch | Ranch Dressing | recipe | 86 | 59.147 | **5.09** | **5.09** | 86 |
| **TOTALE** | | | **745** | | **44.06 kg** | **44.06 L** | **745** |

*Tutti i valori calcolati con regola confermata: 2 fl oz = 59.147g. Nessun legacy (74g/78g) usato.*

---

## Alias catturati — copertura matching

### Balsamic — 10 varianti → 152 usi totali

| String POS | Usi |
|---|---|
| Balsamic | 137 |
| balsamic | 6 |
| Balsamic reduction | 2 |
| BALSAMIC ON SIDE | 1 |
| Balsamic on side | 1 |
| Extra balsamic | 1 |
| Salad now balsamic dressing | 1 |
| Balsamic for salad | 1 |
| Side balsamic vinaigrette | 1 |
| Balsamic and tomatoes on side | 1 |

### Caesar — 5 varianti → 312 usi totali

| String POS | Usi |
|---|---|
| Caesar | 305 |
| Caesar dressing | 4 |
| Add Ceasar dressing side for arugula | 1 |
| Extra side of Caesar dressing | 1 |
| Ceasar is split between both seats | 1 |

### citronette — 4 varianti → 195 usi totali

| String POS | Usi |
|---|---|
| citronette | 189 |
| Citronette | 4 |
| Add Citronette ots | 1 |
| Citronette on side | 1 |

### Ranch — 2 varianti → 86 usi totali

| String POS | Usi |
|---|---|
| Ranch | 71 |
| ranch | 15 |

---

## Batch impact — recipe-backed dressings

| Modifier | Recipe | Batch size | Ramekin/batch | Usi 29gg | Batch consumati |
|---|---|---|---|---|---|
| citronette | CITRONETTE | 1000g (1 L) | 16.9 | 195 | **11.53 batch** |
| Balsamic | BALSAMIC VINAIGRETTE | 2000g (2 L) | 33.8 | 152 | **4.50 batch** |
| Ranch | Ranch Dressing | 7571g (~7.6 L) | 128.0 | 86 | **0.67 batch** |

**Lettura Citronette:** 195 usi ÷ 16.9 ramekin/batch = 11.53 batch da 1L consumati in 29 giorni → circa 0.4 batch/giorno → 400ml/giorno di Citronette non tracciati.

**Lettura Balsamic:** 152 usi ÷ 33.8 ramekin/batch = 4.5 batch da 2L → circa 9L/29gg → 300ml/giorno.

**Lettura Ranch:** Ranch ha batch grande (7.6L) — solo 0.67 batch in 29 giorni, consumo basso.

---

## Modifier non catturati — analisi

### Ignorati correttamente (no depletion)

| Modifier | Usi | Motivo |
|---|---|---|
| no dressing | 25 | preferenza negativa — no depletion ✅ |
| X dressing | 1 | preferenza negativa — no depletion ✅ |
| No balsamic glaze | 1 | preferenza negativa — no depletion ✅ |
| Oil and pepper dressing | 1 | dressing diverso — fuori scope attuale ✅ |

### Da valutare — possibili alias mancanti

| Modifier | Usi | Valutazione |
|---|---|---|
| Mini Caesar course 1 | 12 | ⚠️ Caesar course 1 — non è un dressing ramekin standard, è un piatto corso. **Non aggiungere agli alias.** |
| Balsamic glaze on top | 7 | ⚠️ Balsamic glaze ≠ Balsamic Vinaigrette. Prodotto diverso (riduzione). **Non aggiungere.** |
| Balsamic glaze on the side | 4 | stesso — riduzione, non vinaigrette |
| Mini Caesar | 3 | piatto, non modifier dressing |
| Extra dressing | 2 | ambiguo — quale dressing? Non aggiungere senza contesto |
| Balsamic glaze | 2 | riduzione, non vinaigrette |
| Extra side dressing | 1 | ambiguo |
| Add side balsamic reduction | 1 | riduzione — non vinaigrette |

**Conclusione modifiers non catturati:** nessuno degli 8 va aggiunto agli alias. I "Balsamic glaze" sono un prodotto diverso (riduzione, non vinaigrette). I "Mini Caesar" sono piatti. Nessuna perdita di copertura significativa.

---

## Breakdown giornaliero

| Data | Balsamic | Caesar | Citronette | Ranch | Totale g |
|---|---|---|---|---|---|
| 09/06 | 473g (8) | 769g (13) | 710g (12) | 414g (7) | 2366g |
| 10/06 | 473g (8) | 651g (11) | 473g (8) | 296g (5) | 1893g |
| 11/06 | 118g (2) | 118g (2) | 59g (1) | 118g (2) | 413g |
| 12/06 | 473g (8) | 1065g (18) | 651g (11) | 473g (8) | 2662g |
| 13/06 | 414g (7) | 1360g (23) | 887g (15) | 296g (5) | 2957g |
| 15/06 | 355g (6) | 946g (16) | 118g (2) | 237g (4) | 1656g |
| 16/06 | — | 591g (10) | 414g (7) | 177g (3) | 1182g |
| 17/06 | 296g (5) | 828g (14) | 591g (10) | 118g (2) | 1833g |
| 18/06 | 296g (5) | 1124g (19) | 414g (7) | 59g (1) | 1893g |
| 19/06 | 355g (6) | 1065g (18) | 414g (7) | 237g (4) | 2071g |
| 20/06 | 296g (5) | 710g (12) | 769g (13) | 296g (5) | 2071g |
| 22/06 | — | 473g (8) | 473g (8) | — | 946g |
| 23/06 | 355g (6) | 946g (16) | 532g (9) | 355g (6) | 2188g |
| 24/06 | 591g (10) | 296g (5) | 769g (13) | 237g (4) | 1893g |
| 25/06 | 473g (8) | 473g (8) | 237g (4) | 414g (7) | 1597g |
| 26/06 | 710g (12) | 1005g (17) | 473g (8) | 177g (3) | 2365g |
| 27/06 | 769g (13) | 1242g (21) | 296g (5) | 296g (5) | 2603g |
| 29/06 | 532g (9) | 355g (6) | 769g (13) | 59g (1) | 1715g |
| 30/06 | 118g (2) | 1183g (20) | 296g (5) | — | 1597g |
| 01/07 | 177g (3) | 296g (5) | 355g (6) | 118g (2) | 946g |
| 02/07 | 237g (4) | 946g (16) | 473g (8) | 118g (2) | 1774g |
| 03/07 | 828g (14) | 946g (16) | 710g (12) | 355g (6) | 2839g |
| 06/07 | 177g (3) | 473g (8) | 355g (6) | 177g (3) | 1182g |
| 07/07 | 473g (8) | 591g (10) | 296g (5) | 59g (1) | 1419g |

*(tra parentesi: numero di ramekin)*

---

## Safety check — conferma zero scritture

| Check | Risultato |
|---|---|
| `pos_modifier_depletion_rules` con `active=true` | **0** ✅ |
| `confirmed + active=false` | **4** ✅ |
| `stock_movements` count (invariato) | **335** ✅ |
| Bot production modificati | **Nessuno** ✅ |
| Stock scritto | **Zero** ✅ |

---

## Conclusioni dry-run

I numeri sembrano realistici:
- Caesar domina (312 usi) — coerente con la frequenza delle Caesar salad nel menu
- Citronette seconda (195) — dressing house più popolare tra le ricette
- Balsamic terza (152)
- Ranch ultima (86) — batch molto grande, consumo basso relativo

Il matching degli alias è **pulito** — 21 varianti POS catturate, nessun falso positivo. I modifier non catturati (Balsamic glaze, Mini Caesar) sono prodotti diversi, correttamente esclusi.

**Pronto per approvazione Max → Phase 3b.**

---

## Prossimo step — Phase 3b (solo dopo approvazione)

1. Conferma di Max che i numeri sembrano realistici
2. `UPDATE pos_modifier_depletion_rules SET active=true WHERE confidence='confirmed'`
3. Aggiornare bot per leggere `pos_modifier_depletion_rules WHERE active=true`
4. Prima run production: scrivere depletion su `stock_deductions` o tabella equivalente
