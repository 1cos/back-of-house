# BOM Chain Deduction Bot — Station 4 del TouchBistro POS Bot

## Identità

| Campo | Valore |
|---|---|
| **bot_name** | `bot-bom-chain-deduction` |
| **Edge Function** | `bot-bom-chain-deduction` |
| **Commis** | `bom-chain-commis` |
| **Stazione** | Station 4 — TouchBistro POS Bot |
| **Input** | `pos_daily_clean` (action='map', recipe_id IS NOT NULL) |
| **Output** | `stock_deductions` (source='bom_chain') + `commis_observations` |

## Cosa fa

Traversa ricorsivamente il BOM di ogni piatto venduto e scarica:
- **ITEM raw** (ingredienti senza prep_task) → `item_type='ingredient'`
- **Prep non ancora dedotte da direct_recipe** → `item_type='prep'`

## Regole costituzionali (v3 — Safety Mode)

### Regola 1 — PREP STOCKATA = STOP (sempre)

Se una sub-recipe ha un `prep_task` attivo collegato, il bot si ferma lì e non scende dentro il suo BOM interno.

```
SICILIANA sold
├── Siciliana cartoccio (ha prep_task) → STOP ← scarica 2pz, non scende
├── Garlic Oil (ha prep_task) → STOP
└── Spinach (ha prep_task) → STOP
```

I figli interni di `Siciliana cartoccio` vengono scaricati solo quando si **produce** il cartoccio, non quando si **vende** la Siciliana.

Fix v3: lookup live in Supabase se la sub-recipe non è in cache (fix Bug #2 — cache miss su livelli profondi).

### Regola 2 — BATCH SOSPETTA = STOP + warning

Se una sub-recipe **non ha prep_task** ma ha `base_servings > 1`, è considerata ricetta batch. Il bot **non espande** i suoi ingredienti raw.

Scrive una `commis_observation` con:
- `category: 'bom_warning'`
- `severity: 'warning'`
- `metadata.skipped_reason: 'batch_level_bom'`
- `metadata.skipped_components_count`: quanti ingredienti raw saltati
- `metadata.skipped_estimated_quantity_g`: quantità totale stimata saltata

Una sola observation per `(pos_item_name, recipe_id)` — non una per ingrediente.

**Esempi bloccati da questa regola:** Ranch Dressing (bs=106), Berry Coulis (bs=56), Cheesecake (bs=24), Crème Brûlée (bs=16), Gnocchi (bs=10), Texana Soup (bs=9), CITRONETTE (bs=30), BUTTER SPINACH (bs=40), ROSMARY POTATOES (bs=20).

### Regola 3 — VIRTUALE / PER-PORZIONE = espandibile

Se una sub-recipe non ha prep_task e ha `base_servings = 1` (o NULL), è considerata ricetta virtuale per-porzione. Il bot scende nel suo BOM.

### Regola 4 — THRESHOLD SAFETY (quantità anomale su ricette NULL/1)

Anche su ricette virtuali espandibili, se la quantità di un ingrediente per porzione supera le soglie, viene scritta una `commis_observation`. Il bot **non blocca** ma avvisa.

Soglie per porzione:
- Carne/pesce: > 500g → warning
- Salse/brodo/panna: > 500g → warning
- Oli: > 100g → warning
- Formaggi: > 200g → warning
- Generico: > 1000g → warning

Warning de-duplicato: 1 per `(pos_item_name, ingredient_id)` per run.

### Regola 5 — In dubbio: warning, mai scarico

Meglio un dato incompleto dichiarato che un dato sbagliato spacciato per vero.

## Anti-double deduction

Legge `stock_deductions` con `source='direct_recipe'` già presenti prima di iniziare. Salta qualsiasi prep già dedotta da direct_recipe.

## Aggregazione ingredienti (v2+)

Lo stesso ingrediente può apparire in più percorsi della catena BOM. Il bot li aggrega per `(pos_item_name, ingredient_id, unit)` — una sola riga, quantità sommata. Se le unità sono diverse, rimangono separate.

## Idempotenza

```sql
DELETE FROM stock_deductions
WHERE business_date = target_date AND source = 'bom_chain';

DELETE FROM commis_observations
WHERE business_date = target_date
  AND bot_name = 'bot-bom-chain-deduction'
  AND commis_name = 'bom-chain-commis';
```

Non tocca mai `direct_recipe`.

## MAX_DEPTH = 5

Protezione contro catene circolari. Se la traversal supera 5 livelli, genera un warning e si ferma.

## Pipeline Guard

Verifica che `bot-direct-deduction` abbia `status='success'` per la stessa `run_date` prima di partire. Se no, scrive observation e ritorna senza elaborare.

## Cosa NON fa

- ❌ Non tocca `current_stock`
- ❌ Non scrive `stock_movements`
- ❌ Non aggiorna `stock_daily_snapshot`
- ❌ Non hardcoda ricette singole (niente "skip Meatballs")
- ❌ Zero LLM

## Ordine di esecuzione pipeline

1. `bot-pos-importer` → pos_daily_raw
2. `bot-pos-cleaner` → pos_daily_clean
3. `bot-direct-deduction` → stock_deductions (direct_recipe)
4. **`bot-bom-chain-deduction`** → stock_deductions (bom_chain)
5. `bot-stock-consolidator` → stock_daily_snapshot

## Versioni

| Versione | Data | Note |
|---|---|---|
| v1 | 2026-07-07 | Prima release |
| v2 | 2026-07-07 | Aggregazione ingredienti per evitare duplicati da percorsi multipli |
| v3 | 2026-07-07 | Safety mode: batch BOM detection (Regola 2), STOP rule fix cache miss (Regola 1), threshold warnings (Regola 4), de-dup observations |
