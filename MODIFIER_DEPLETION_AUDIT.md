# MODIFIER DEPLETION AUDIT
*Brigade · Zenos on the Square · Weatherford TX*
*Aggiornato: 8 luglio 2026 — Phase 2.3*

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

| Modifier | Recipe ID | confidence (DB) | qty | unit | normalized_g | Qty confermata | Link confermato |
|---|---|---|---|---|---|---|---|
| Balsamic | e834c1e2 | estimated | 2 | fl_oz | 59.147g | ✅ | ✅ |
| citronette | 3f433b8b | estimated | 2 | fl_oz | 59.147g | ✅ | ✅ |
| Ranch | 3cee627c | estimated | 2 | fl_oz | 59.147g | ✅ | ✅ |
| Caesar | NULL | estimated | 2 | fl_oz | 59.147g | ✅ | ⏳ pending |

**Tutti i record:** `active = false` — nessun bot production change finché Max non approva Fase 3.

---

## Caesar — cosa è ancora aperto (solo il link)

La **quantità** è confermata: 2 fl oz ramekin = 59.147g. **Chiusa.**

L'**unica cosa pending** è: dove scaricare? Quale recipe o prep riceve la deduction?

### Stato DB (verificato 8 lug 2026)

| Entità | Tipo | Stato | Utilizzabile? |
|---|---|---|---|
| prep_task 391 "Caesar Dressing" | checklist | **archiviata** | ❌ |
| prep_task 395 "Check Caesar" | checklist, unit=squeezer | attiva, Salad Station | ❌ non è una recipe |
| ingredient "Caesar Dressing" (f47e1c26) | ingrediente raw | usato in Mini Caesar (50g ITEM) | ⚠️ solo come ITEM |
| recipe "Caesar Dressing" | — | **non esiste** | — |

### La domanda per Max (una sola)

**Caesar Dressing a Zenos è prodotto in casa o acquistato pronto?**

**A) Prodotto in cucina** → creare recipe strutturata "Caesar Dressing" con yield (LT o QT) + BOM ingredienti + prep task → modifier si collega alla recipe → `use_recipe_serving` o `fixed_quantity 2 fl oz`

**B) Acquistato pronto** → l'ingredient "Caesar Dressing" (f47e1c26) è già nel DB → si può collegare il modifier direttamente → `fixed_quantity 2 fl oz`, linked_recipe_id punta alla recipe wrapper se esiste, oppure si usa solo `normalized_qty_g` senza link recipe

La scelta A è quella pulita (come Balsamic, Citronette, Ranch hanno tutte recipe strutturate).

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
| `proposed_pos_modifier_depletion_rules.sql` | Schema tabella + INSERT dressing | v3 (Phase 2.2) |
| `modifier-depletion-lab.jsx` | Artifact React — lab UI + calculator | Phase 2.3, boh-v588 |
| `js/unit-normalizer.js` | Engine conversione unità | boh-v586 |

---

## Fasi

| Fase | Stato | Contenuto |
|---|---|---|
| **Fase 1** | ✅ Completa | unit-normalizer.js (boh-v586), acceptance tests 11/11 |
| **Fase 2.2** | ✅ Completa | Dati modifier corretti (regola 2 fl oz), schema SQL, lab UI |
| **Fase 2.3** | ✅ Completa | Audit Caesar DB, chiarimento semantica confidence, questa nota |
| **Fase 3** | ⏳ Pending | Caesar: Max risponde A o B → link → `confidence='confirmed'` → `active=true` → primo bot run |
