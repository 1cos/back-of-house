# MODIFIER DEPLETION AUDIT
*Brigade · Zenos on the Square · Weatherford TX*
*Aggiornato: 8 luglio 2026 — Phase 2.3 (Caesar risolto)*

---

## Regola cucina — DEFINITIVA (confermata Max, 8 lug 2026)

> **TUTTI i salad dressing vengono serviti nello stesso ramekin da 2 US fl oz.**

Source of truth: **2 fl oz ramekin**  
Conversione: 2 fl oz = 59.147 ml = 59.147 g (density = 1.0)  
Operativo: ≈ 60 g

I vecchi valori nel DB (`serving_qty` = 74g per Balsamic/Ranch, 78g per Citronette) erano dati legacy inseriti prima di questa regola. **Non sono più valori competing.** Non compaiono mai come "alternative" nell'interfaccia.

---

## Stato della `confidence` — IMPORTANTE

Lo schema ha un solo campo `confidence`. Per i dressing questo campo ha due dimensioni semantiche distinte:

| Dimensione | Stato |
|---|---|
| **Quantità (2 fl oz ramekin)** | ✅ **CONFERMATA** da Max, 8 lug 2026 |
| **Recipe/prep link** | Balsamic ✅ · Citronette ✅ · Ranch ✅ · Caesar ⏳ pending |
| **Bot active** | ❌ `active=false` — Fase 3 non ancora attiva |

Il valore `confidence='estimated'` nel DB riflette **solo** che le regole non sono ancora in produzione (Fase 3 non attiva), **non** che la quantità sia in dubbio.

> **Chiunque rilegga questo file:** la quantità 2 fl oz = 59.147g è chiusa. Non riaprire la domanda "quanti grammi sono". Non chiedere a Max. Non mettere OQR sulla quantità.

---

## Stato dressing modifier (Phase 2.3)

| Modifier | Target | confidence | qty | normalized_g | Tipo target |
|---|---|---|---|---|---|
| Balsamic | recipe e834c1e2 | estimated | 2 fl_oz | 59.147g | recipe strutturata |
| citronette | recipe 3f433b8b | estimated | 2 fl_oz | 59.147g | recipe strutturata |
| Ranch | recipe 3cee627c | estimated | 2 fl_oz | 59.147g | recipe strutturata |
| Caesar | ingredient f47e1c26 | estimated | 2 fl_oz | 59.147g | prodotto acquistato |

**Tutti i record:** `active = false` — nessun bot production change finché Max non approva Fase 3.

---

## Caesar — RISOLTO (8 lug 2026)

Confermato da Max: **Caesar Dressing è un prodotto acquistato, non prodotto in cucina.**

Gli altri tre dressing (Balsamic, Citronette, Ranch) sono ricette strutturate con BOM e prep task.
Caesar Dressing arriva già pronto — nessuna recipe da creare.

### Target deduction Caesar

| Campo | Valore |
|---|---|
| `linked_recipe_id` | NULL |
| `linked_prep_task_id` | NULL |
| `linked_ingredient_id` | `f47e1c26-b91e-4539-a60b-95a9a11f5aa1` (ingredient "Caesar Dressing") |
| `usage_mode` | `fixed_quantity` |
| `qty` | 2 fl oz = 59.147g |

Lo schema `pos_modifier_depletion_rules` aggiornato in v4 include il campo `linked_ingredient_id` per questo caso — prodotti acquistati senza recipe strutturata.

### Stato DB (verificato 8 lug 2026)

| Entità | Tipo | Stato |
|---|---|---|
| prep_task 391 "Caesar Dressing" | checklist | **archiviata** — ignorata |
| prep_task 395 "Check Caesar" | checklist, unit=squeezer | checklist operativa, non usata per deduction |
| ingredient "Caesar Dressing" (f47e1c26) | ingrediente raw | ✅ **questo è il target** |

---

## usage_mode — definizioni ufficiali

| Modalità | Significato | Quando usare |
|---|---|---|
| `fixed_quantity` | Il bot usa `normalized_qty_g` da questa tabella | Dressing, aggiunte a quantità fissa |
| `use_recipe_serving` | Il bot consuma 1 porzione logica della ricetta collegata usando la **resa/BOM della ricetta come source of truth**. Non si chiedono grammi — la recipe sa già cosa contiene. | + Add Chicken, + Meatballs, + Shrimp — qualsiasi modifier con recipe strutturata |
| `no_depletion` | Nessuno scarico stock | Preferenze, istruzioni cucina (es. "no onions") |

**Regola `use_recipe_serving`:** se una recipe strutturata esiste nel DB, il bot NON chiede di nuovo quanti grammi. Usa la recipe. Esempi:
- `+ Add Chicken` → `linked_recipe = Add Chicken` → `use_recipe_serving` → consuma 1 porzione da BOM
- `+ Meatballs` → `linked_recipe = Meatball Appetizer` → `use_recipe_serving`

---

## Volume di utilizzo (60 giorni — base audit)

| Modifier | Usi/60gg | kg non tracciati (59.147g/porzione) |
|---|---|---|
| Caesar | 312 | ~18.5 kg |
| citronette | 195 | ~11.5 kg |
| Balsamic | 151 | ~8.9 kg |
| Ranch | 86 | ~5.1 kg |
| **TOTALE** | **744** | **~44.0 kg** |

---

## Inventory calculator — formula

```
Stock (qualsiasi unità cuoco) → normalizza in g → dividi per 59.147g → ramekin disponibili
Stock in g → dividi per 2000g (2 LT batch) → batch disponibili
```

Esempio: 5 kg stock → 5000g ÷ 59.147g = **84.5 ramekin** · ÷ 2000g = **2.5 batch**

---

## File e versioni

| File | Descrizione | Versione |
|---|---|---|
| `proposed_pos_modifier_depletion_rules.sql` | Schema tabella + INSERT dressing | v4 (Phase 2.3) |
| `modifier-depletion-lab.jsx` | Artifact React — lab UI + calculator | Phase 2.3, boh-v589 |
| `js/unit-normalizer.js` | Engine conversione unità | boh-v586 |

---

## Fasi

| Fase | Stato | Contenuto |
|---|---|---|
| **Fase 1** | ✅ Completa | unit-normalizer.js (boh-v586), acceptance tests 11/11 |
| **Fase 2.2** | ✅ Completa | Dati modifier corretti (regola 2 fl oz), schema SQL, lab UI |
| **Fase 2.3** | ✅ Completa | Audit Caesar DB, chiarimento semantica confidence, questa nota |
| **Fase 3** | ⏳ Pending Max | Tutti i link confermati → `confidence='confirmed'` → `active=true` → primo bot run |
