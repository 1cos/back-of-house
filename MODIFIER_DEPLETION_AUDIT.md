# MODIFIER DEPLETION AUDIT
*Brigade · Zenos on the Square · Weatherford TX*
*Creato: 8 luglio 2026 — Phase 2.2*

---

## Regola cucina — DEFINITIVA (confermata Max, 8 lug 2026)

> **TUTTI i salad dressing vengono serviti nello stesso ramekin da 2 US fl oz.**

Source of truth: **2 fl oz ramekin**  
Conversione: 2 fl oz = 59.147 ml = 59.147 g (density = 1.0)  
Operativo: ≈ 60 g

I vecchi valori nel DB (`serving_qty` = 74g per Balsamic/Ranch, 78g per Citronette) erano dati legacy inseriti prima di questa regola. **Non sono più valori competing.** Non compaiono mai come "alternative" nell'interfaccia.

---

## Stato dressing modifier (Phase 2.2)

| Modifier | Aliases principali | Recipe ID | confidence | qty | unit | normalized_g | Pendente |
|---|---|---|---|---|---|---|---|
| Balsamic | Balsamic, balsamic, BALSAMIC ON SIDE, Extra balsamic | e834c1e2 | estimated | 2 | fl_oz | 59.147g | — |
| citronette | Citronette, Citronette on side, Add Citronette ots | 3f433b8b | estimated | 2 | fl_oz | 59.147g | — |
| Caesar | Caesar, caesar, Caesar dressing, Extra side of Caesar dressing | NULL | estimated | 2 | fl_oz | 59.147g | **recipe/prep link** |
| Ranch | Ranch, ranch | 3cee627c | estimated | 2 | fl_oz | 59.147g | — |

**Tutti i record:** `active = false` — nessun bot production change finché Max non esegue approvazione Fase 3.

---

## Caesar — unica cosa ancora aperta

La **quantità** è confermata: 2 fl oz ramekin = 59.147g.

Il **collegamento recipe/prep_task** è pending:
- Recipe "Caesar Dressing" non esiste nel DB come entità separata (`linked_recipe_id = NULL`)
- Prep_task "Check Caesar" usa `unit = squeezer` — non utilizzabile per deduction automatica
- **Da fare prima di Fase 3:** creare recipe Caesar Dressing nel DB, oppure identificare il prep_task corretto con unità peso/volume

---

## usage_mode — definizioni ufficiali

| Modalità | Significato | Quando usare |
|---|---|---|
| `fixed_quantity` | Il bot usa `normalized_qty_g` da questa tabella | Dressing, aggiunte a quantità fissa |
| `use_recipe_serving` | Il bot consuma 1 porzione logica della ricetta collegata usando la resa/BOM come source of truth. Non si chiedono grammi — la recipe sa già cosa contiene. | + Add Chicken, + Meatballs, + Shrimp — qualsiasi modifier con recipe strutturata |
| `no_depletion` | Nessuno scarico stock | Preferenze, istruzioni cucina (es. "no onions") |

**Regola `use_recipe_serving`:** se una recipe strutturata esiste nel DB, il bot NON chiede di nuovo quanti grammi. Usa la recipe. Esempi:
- `+ Add Chicken` → `linked_recipe = Add Chicken` → `use_recipe_serving` → usa 1 porzione da BOM
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
| `modifier-depletion-lab.jsx` | Artifact React — lab UI + calculator | Phase 2.2, boh-v587 |
| `js/unit-normalizer.js` | Engine conversione unità | boh-v586 |

---

## Fasi

| Fase | Stato | Contenuto |
|---|---|---|
| **Fase 1** | ✅ Completa | unit-normalizer.js (boh-v586), acceptance tests 11/11 |
| **Fase 2.2** | ✅ Completa | Dati modifier corretti (regola 2 fl oz), schema SQL, lab UI |
| **Fase 3** | ⏳ Pending Max | Caesar recipe link → confidence='confirmed' → active=true → primo bot production run |
