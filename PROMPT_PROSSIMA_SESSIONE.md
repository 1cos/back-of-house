---

## SESSIONE 7 LUGLIO 2026 — Sprint 7.1 + Meatballs 3-Level BOM

**Versione sw.js live:** boh-v567
**Supabase:** ydqmumpytgrlceuinoqt

---

### Pipeline Guard — VERIFICATO ✅

**bot-bom-chain-deduction v4:**
- Guard: verifica `bot-direct-deduction` success per la stessa `run_date` prima di girare
- Test negativo (2099-01-01): `bom_chain_rows=0`, observation scritta, zero bot_run → PASS ✅
- Test positivo (2026-07-06): 233 ing, 0 prep, 95 skip_doubled → PASS ✅

**bot-stock-consolidator v4:**
- Guard: verifica `bot-direct-deduction` E `bot-bom-chain-deduction` success
- Se upstream mancanti: aborta, scrive `commis_observation category=system`, ritorna errore

**Regola operativa confermata:**
Ordine esecuzione OBBLIGATORIO e SEQUENZIALE:
1. `bot-pos-cleaner`
2. `bot-direct-deduction`
3. `bot-bom-chain-deduction` (Guard: richiede #2 success)
4. `bot-stock-consolidator` (Guard: richiede #2 e #3 success)

---

### La Dispensa Beta — boh-v566/v567

**Feature aggiunte:**
- Badge `⚡ BETA · Read-only` in titolo e banner
- Bottone **"Segnala errore"** su ogni riga (Cucina + Magazzino + Esploso)
- Modal feedback con 7 tipi: wrong_quantity, wrong_unit, wrong_name, duplicate_deduction, missing_sale, should_not_deduct, other
- Scrive in tabella `dispensa_feedback` (nuova, da migration)
- Swipe-to-close: solo su header/drag-handle, non su contenuto scrollabile
- `overscroll-behavior:contain` su `#dispensaContent`
- Card home: emoji HTML entity `&#x1F6D2;` (fix testo garbage)

**tabella `dispensa_feedback`:**
```sql
id uuid PK, business_date, item_type, item_id uuid,
target_name, source_table, deduction_id uuid nullable,
feedback_type (7 valori CHECK), note, created_by,
status (open/reviewed/resolved/ignored), metadata jsonb, created_at
```

**Test iPhone (ancora da fare):**
- Aprire La Dispensa Beta → scroll non chiude
- Segnala errore → modal apre → submit → riga in `dispensa_feedback`
- Poi query: `SELECT * FROM dispensa_feedback ORDER BY created_at DESC LIMIT 10;`

---

### Meatballs BOM — struttura 3 livelli ✅

**Problema risolto:** BOM Meatballs usava quantità batch-level (2800g Pomodoro per porzione venduta).

**Struttura finale:**

```
Livello 1 — Impasto polpette
  recipe: Meatballs (pos_name=NULL, base_servings=162, unit=pz)
  BOM: Ground Beef 4536g + Pork Sausage 907g + Bread Crumbs 820g
       + Eggs 495g + Parmesan 545g + Milk 1100g + Parsley 135g + ...
  prep_task: "Meatballs" — Sauté Station, unit=pz, supporto
  Logica: 1 batch → 162 polpette (32 buste × 5pz + 2 avanzo)

Livello 2 — Meatball Sauce
  recipe: Meatball Sauce (pos_name=NULL, base_servings=32, serving_weight_g=100g)
  BOM: POMODORO SAUCE 2800g + DEMI FOR RAVIOLI 500g
  prep_task: "Meatball Sauce" — Sauté Station, unit=g, supporto

Livello 3 — Busta POS
  recipe: Meatball Appetizer
  pos_name: "Meatball Appetizer|Meatballs|Add Meatballs"
  base_servings=1, serving_weight_g=380g
  BOM: RECIPE Meatballs 5pz + RECIPE Meatball Sauce 100g
  prep_task: "Meatball Appetizer" — Sauté Station, unit=pz, finale
```

**Pipeline dopo fix (2026-07-06):**
- Meatball Appetizer (9 porz) → Meatballs **45 pz** + Meatball Sauce **900g** ✅
- Meatballs modifier (1 porz) → Meatballs **5 pz** + Meatball Sauce **100g** ✅
- Zero ingredienti raw nel POS scarico (solo quando si produce il batch)
- Zero duplicati direct+bom_chain ✅
- stock_movements: 335 invariato ✅
- current_stock: non toccato ✅

**Nota "Add Meatballs" modifier:**
Ora mappa su `Meatball Appetizer` (stessa busta). Se in futuro "Add Meatballs" 
su pasta usa quantità diverse (es. 3pz invece di 5), creare ricetta separata 
`Add Meatballs` con BOM dedicato e `pos_name='Add Meatballs'`.

---

### Stato pipeline finale sessione (2026-07-06)

| Bot | Status | Rows |
|---|---|---|
| bot-pos-cleaner | success | 146 clean |
| bot-direct-deduction | success | 97 deductions |
| bot-bom-chain-deduction v4 | success | 233 ing, 0 prep, 95 skip_doubled |
| bot-stock-consolidator v4 | success | 163 snapshot rows |

- Duplicati: **0** ✅
- stock_movements: **335** invariato ✅
- current_stock: **non toccato** ✅
- dispensa_feedback: pronta per test iPhone

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v567** |
| bot-bom-chain-deduction | **v4** (Pipeline Guard) |
| bot-stock-consolidator | **v4** (Pipeline Guard) |
| La Dispensa Beta | **v1** con feedback (office.js) |
| dispensa_feedback | tabella creata |
| Meatball Appetizer recipe | **nuova** |
| Meatballs recipe | aggiornata (3 livelli) |
| Meatball Sauce recipe | **nuova** |

---

### PROSSIMA SESSIONE — checklist

1. **Test iPhone La Dispensa Beta** (Max):
   - scroll non chiude panel
   - Segnala errore → scrive in `dispensa_feedback`
   - `SELECT * FROM dispensa_feedback ORDER BY created_at DESC LIMIT 10;`

2. **"Add Meatballs" modifier** — verificare se quantità diversa da busta appetizer.
   Se 3pz invece di 5: creare ricetta `Add Meatballs` con BOM dedicato.

3. **Stock Consolidator v2** (quando La Dispensa Beta è validata):
   - Legge `prep_log` per `loaded_qty`
   - Calcola `stock_end = stock_start + loaded_qty - pos_deducted_qty`
   - Aggiorna `prep_tasks.current_stock`
   - Solo dopo approvazione Max

4. **Meatballs prep_task "Meatballs"**: impostare `current_stock` al prossimo inventario fisico.

---

---

## SESSIONE 7 LUGLIO 2026 — Sprint 5.1 + Sprint 6: La Dispensa v1

**Versione sw.js live:** boh-v564
**Supabase:** ydqmumpytgrlceuinoqt

---

### Sprint 5.1 — BOM Unit Standardization (PASS ✅)

**Regola ufficiale BOM:** grammi per tutto tranne 'pz/each' per cose contabili. Niente ml, l, kg, tbsp, tsp, pinch, cup dentro recipe_bom operative.

**Conversioni sicure applicate via UPDATE recipe_bom:**
- Water: ml→g (stesso numero), l→g (×1000)
- Extra Virgin Olive Oil: ml→g, l→g (×1000)
- Heavy Cream: ml→g, l→g (×1000), kg→g (×1000)
- Milk: ml→g, l→g (×1000)
- Mayo: kg→g (×1000)
- Potatoes: kg→g (×1000)
- Salt: kg→g (×1000)
- Parsley: kg→g (×1000)

**4 warning residui — intenzionali, NON convertire:**
| Ingrediente | Unità miste | Motivo |
|---|---|---|
| Sugar | g + tbsp | tbsp ambiguo — flaggato in commis_observations |
| Parsley | g + pinch | pinch ambiguo |
| White Pepper | g + pinch | pinch ambiguo |
| Eggs | g + pz | regola Max: whole egg=pz, liquid egg=g, NON mescolare |

**8 commis_observations inserite** manualmente per casi ambigui (bom_warning category).

**bot-stock-consolidator v3 deployato:**
- Fix commis_observations: category='bom_warning' (era 'unit_mismatch' che violava CHECK constraint)
- Risultato v3: 167 snapshot rows, 4 warning, commis_observations scritte correttamente ✅

**Verifica finale Sprint 5.1:**
- stock_daily_snapshot: 167 righe (48 prep, 119 ingredient)
- Totali deductions vs snapshot: diff = 0.000 ✅
- Duplicati: 0 ✅
- stock_movements: 335 invariato ✅
- current_stock: non toccato ✅

---

### Sprint 6 — La Dispensa v1 Read-Only

**File modificati:** js/office.js, sw.js (v563→v564)

**Cosa è stato aggiunto in office.js:**

**Bottone home (dopo Bot Center):**
- Card verde scuro "🏪 La Dispensa" con subtitle "Snapshot POS · Read-only"
- Appare solo per admin (stesso livello del Bot Center)
- Click → `openLaDispensa()`

**Funzioni aggiunte (~380 righe):**
- `window.openLaDispensa()` — apre fullscreen panel, stesso pattern di officeBotCenter
- `dispensaInit()` — carica latest date da stock_daily_snapshot, imposta date picker
- `dispensaLoadAll()` — carica in parallelo: stock_daily_snapshot, commis_observations, bot_runs
- `dispensaRenderSummary()` — 4 summary cards: Prep rows, Ingredienti, Warning, Pipeline status
- `window.dispensaTab(tab)` — switcher tra Cucina/Magazzino/Commis/Esploso
- `dispensaRenderPrep(content)` — Tab Cucina: item_type='prep'
- `dispensaRenderIngredients(content)` — Tab Magazzino: item_type='ingredient'
- `dispensaSnapRow(r, type)` — card row con qty, status badge, warning, sources
- `dispensaRenderCommis(content)` — Tab Commis Notes da commis_observations
- `window.dispensaOpenEsploso(type, id, name)` — click su riga → switch a tab Esploso
- `dispensaRenderEsploso(content)` / `dispensaLoadEsploso()` — dettaglio da stock_deductions

**UI features:**
- Safety banner fisso: "Read-only snapshot. POS-based deductions only. Stock not updated yet."
- Date picker: default = ultima business_date disponibile in stock_daily_snapshot
- Summary cards: Prep, Ingredienti, Warning count, Pipeline status (success/error/no run)
- Tab bar: 🥘 Cucina | 📦 Magazzino | ⚠️ Commis | 🧾 Esploso
- Warning badge arancione visibile su ogni riga con problemi
- Click su riga → Esploso con deduction detail (pos_item_name, source, qty, portions, path)
- Swipe-to-close, back button — stesso pattern Bot Center

**ZERO scritture DB dalla UI.** Tutte le funzioni sono SELECT only.

---

### PROSSIMA SESSIONE — Test La Dispensa + decisioni next step

**Test da fare (Max):**
1. Hard refresh (cancella cache Safari per 1cos.github.io)
2. L'Ufficio → scrollare in basso → vedere bottone verde "La Dispensa"
3. Aprire → verificare Cucina, Magazzino, Commis Notes
4. Cliccare una riga → Esploso deve mostrare le deductions

**Se i numeri convincono (dopo qualche giorno di osservazione):**
- Sprint 7: Stock Consolidator v2 — apply current_stock
  - Legge prep_log per loaded_qty
  - Calcola stock_end = stock_start + loaded_qty - pos_deducted_qty
  - UPDATE prep_tasks.current_stock

**Fix aperti in commis_observations (per review manuale con Max):**
- Sugar tbsp in Tiramisu (bom_id 617) e TIRAMISU NEL SIFONE (bom_id 73)
- Water tbsp in LEMON TARTE (bom_id 925)
- EVOO tbsp in SALSA VERDE (bom_id 510)
- Parsley pinch in Scallops Chefs Way (bom_id 150)
- White Pepper pinch in SALMON SAUCE (bom_id 144, qty anomala 0.02) e Scallops (bom_id 151)
- Salt pinch in 4 ricette (bom_id 161, 630, 369, 502) — 1g ciascuna
- Salt in litri CITRUS RISOTTO BUFFET (bom_id 1998) — errore manifesto, ~20g probabile

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v564** |
| bot-stock-consolidator | **v3** (ACTIVE) |
| La Dispensa UI | **v1** (office.js) |

---

---

## SESSIONE 7 LUGLIO 2026 — Sprint 5: Stock Consolidator Bot v1

**Versione sw.js live:** boh-v563 (invariato — zero file frontend toccati)
**Supabase:** ydqmumpytgrlceuinoqt

---

### Sprint 5 — bot-stock-consolidator v1

**Edge Function:** `bot-stock-consolidator` v1 — deployata e ACTIVE
**bot_name:** `bot-stock-consolidator`
**Commis:** `stock-consolidator-commis` (deterministico, zero LLM)
**Input:** `stock_deductions` (direct_recipe + bom_chain)
**Output:** `stock_daily_snapshot` + `commis_observations`

**⚠️ v1 è SNAPSHOT ONLY:**
- Scrive `stock_daily_snapshot` con status='partial'
- NON aggiorna `current_stock` su `prep_tasks`
- NON scrive `stock_movements`
- NON costruisce La Dispensa UI

**Logica aggregazione:**
- Chiave: `(item_type, resolved_item_id, unit)`
  - Per prep: `resolved_item_id = target_recipe_id`
  - Per ingredient: `resolved_item_id = ingredient_id`
- `pos_deducted_qty = SUM(quantity)` da stock_deductions
- `stock_start = NULL`, `loaded_qty = 0`, `stock_end = NULL` in v1
- `metadata` include: sources, deduction_rows, prep_task_id, target_name, consolidator_version

**Safety rules (bot non si blocca — gestisce per riga):**
- Unit mismatch → status='warning', riga separata, commis observation
- item_id mancante → riga saltata, commis observation
- Prep senza prep_task_id → status='warning', commis observation
- Ingredient senza ingredient_id → status='warning'

**Idempotenza:**
```sql
DELETE FROM stock_daily_snapshot WHERE business_date = target_date;
DELETE FROM commis_observations WHERE business_date = target_date AND bot_name = 'bot-stock-consolidator';
```

**File MD creati su brigade-main:**
- `bots/stock-consolidator/STOCK_CONSOLIDATOR_BOT.md`
- `bots/stock-consolidator/STOCK_CONSOLIDATOR_COMMIS.md`
- `bots/stock-consolidator/STOCK_CONSOLIDATOR_TEST.md`
- `bots/stock-consolidator/bot-stock-consolidator.js` (source)

---

### PROSSIMA SESSIONE — Test Sprint 5 + verifica numeri

**Trigger pipeline completa per 2026-07-06:**
1. bot-pos-cleaner
2. bot-direct-deduction
3. bot-bom-chain-deduction
4. **bot-stock-consolidator** ← nuovo

**Verification queries (da STOCK_CONSOLIDATOR_TEST.md):**

```sql
-- 1. Bot run status
SELECT bot_name, status, rows_read, rows_written, warnings_count, summary
FROM bot_runs WHERE bot_name = 'bot-stock-consolidator' ORDER BY created_at DESC LIMIT 5;

-- 2. Snapshot per tipo
SELECT item_type, unit, COUNT(*) AS rows, SUM(pos_deducted_qty) AS total_pos_deducted
FROM stock_daily_snapshot WHERE business_date = '2026-07-06'
GROUP BY item_type, unit ORDER BY item_type, unit;

-- 3. Duplicati (deve essere vuoto)
SELECT item_type, item_id, unit, COUNT(*) AS duplicate_count
FROM stock_daily_snapshot WHERE business_date = '2026-07-06'
GROUP BY item_type, item_id, unit HAVING COUNT(*) > 1;

-- 4. Top deductions
SELECT item_type, item_id, pos_deducted_qty, unit, status, warning, metadata->>'target_name' AS target_name
FROM stock_daily_snapshot WHERE business_date = '2026-07-06'
ORDER BY item_type, pos_deducted_qty DESC LIMIT 50;

-- 5. Commis observations
SELECT severity, category, title, explanation, suggested_action
FROM commis_observations
WHERE business_date = '2026-07-06' AND bot_name = 'bot-stock-consolidator'
ORDER BY severity DESC, created_at DESC;

-- 6. Safety: current_stock non toccato
SELECT 'stock_movements new today' AS check_name, COUNT(*) FROM stock_movements WHERE created_at >= CURRENT_DATE
UNION ALL SELECT 'stock_daily_snapshot 2026-07-06', COUNT(*) FROM stock_daily_snapshot WHERE business_date = '2026-07-06';
```

**Success criteria:**
- stock_daily_snapshot popolata
- zero duplicati
- current_stock NON toccato
- stock_movements NON toccati
- warnings solo per dati davvero ambigui
- totali snapshot ≈ totali deductions
- bot_runs status = 'success'

**Dopo verifica:** decidere se passare a v2 (che leggerà prep_log e aggiornerà current_stock).

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v563** (invariato) |
| bot-stock-consolidator | **v1 (nuovo)** |
| MD docs | bots/stock-consolidator/ (3 file + source) |

---


---

## SESSIONE 7 LUGLIO 2026 (fine sessione) — Sprint UI Bot Center + Analisi unknown modifier

**Versione sw.js live:** boh-v562
**Supabase:** ydqmumpytgrlceuinoqt

---

### Sprint UI — Bot Center Dati Live (boh-v562)

**File modificati:** `js/office.js`, `sw.js`

Aggiunti 3 nuovi bot alla Brigata di Bot nel Bot Center esistente (`office.js`):

**`_botDefs[]` — 3 nuove entry:**
- `pos-touchbistro-bot` | POS TouchBistro Bot | 🔄 | ribbon `#0ea5e9` | `isBrigata:true`
- `recipe-matcher-bot` | Recipe Matcher Bot | 🎯 | ribbon `#6366f1` | `isBrigata:true`
- `stock-drain-bot` | Stock Drain Bot | 📉 | ribbon `#f97316` | `isBrigata:true`

**`_botExplain{}` — 3 nuove spiegazioni** passo-per-passo in italiano.

**`botCenterLoadList` aggiornato:** legge `bot_runs` con `bot_name IN ('pos-touchbistro-bot','recipe-matcher-bot','stock-drain-bot')` — valori reali dal DB (con dash, non underscore).

**`botGetStatus` aggiornato:** gestisce `logTable='bot_runs'` per i nuovi bot.

**Tab "📊 Dati Live"** — appare solo per bot con `isBrigata:true`:

| Bot | Cosa mostra |
|---|---|
| POS TouchBistro Bot | `pos_daily_raw` — food items con menu_group e badge Kids, modifier collassati |
| Recipe Matcher Bot | `pos_daily_clean` — color coding match_type, filtri (Tutti/Matched/Kids/Da rivedere/Unknown/Modifier), confidence % |
| Stock Drain Bot | `stock_movements POS_DRAIN` — trail completo POS item → ricetta → BOM component → quantity_delta, riepilogo totali |

**Date picker:** selezionabile, default `2026-07-06`. Idempotente — cambia data → ricarica dati.

**Contatore aggiornato:** da "7 bot attivi" a "10 bot attivi".

---

### Analisi unknown modifier (pos_daily_clean 2026-07-06)

90 unknown totali — quasi tutti modifier non operativi da `pos_modifiers`:
- **Operativi zero** (non scaricano stock): "Glass", "No Glass", "Goodnight", "Fired at HH:MM", "Medium Rare", "citronette", "TO GO", "Dbl", "Rocks", ecc. — questi sono note al cameriere, tempi di cottura, preferenze drink. Non devono mai scaricare stock.
- **Da food items** (3): Open Food (10), Risotto Mushrooms And Steak (7), Gluten Free Bread (1) — già gestiti.
- **Modifier operativi senza alias**: "Berry Coulis" (5), "Mash potatoes" (2), "Daily risotto" (5), "Caesar" (8), "Risotto" (2), "Spaghetti Pomodoro" (1), "Burratta" (1) — questi POTREBBERO scaricare stock se aggiunti a `pos_item_aliases`.

**Decisione da prendere in sessione dedicata:** quali modifier operativi aggiungere a `pos_item_aliases` e quali lasciare come unknown permanente.

**Nota strutturale:** i modifier "Fired at HH:MM" sono timestamps di firing da TouchBistro — non scaricano nulla, devono essere aggiunti a una lista di esclusione permanente nel Recipe Matcher Bot.

---

### Versioni finali sessione completa 7 luglio 2026

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v562** |
| POS TouchBistro Bot | v6 (Edge Function `bot-pos-importer`) |
| Recipe Matcher Bot | v1 (Edge Function `bot-recipe-matcher`) |
| Stock Drain Bot | v1 (Edge Function `bot-stock-drain`) |
| Bot Center UI | v562 — 10 bot attivi, tab Dati Live per Brigata |

---

### PROSSIMA SESSIONE — Sprint 4: Stock Consolidator Bot

**Obiettivo:** unico bot che aggiorna `current_stock` su `prep_tasks`.

**Logica:**
1. Legge `stock_movements` per `business_date` filtrato per tipo di movimento
2. Legge `prep_log` per `business_date` (carichi dei cuochi)
3. Calcola per ogni `item_id`:
   - `stock_start` = `stock_end` del giorno precedente da `stock_daily_snapshot` (o `current_stock` attuale se primo run)
   - `loaded_qty` = somma movimenti da `prep_log` del giorno
   - `pos_deducted_qty` = somma movimenti `POS_DRAIN` da `stock_movements`
   - `waste_qty` = movimenti `waste` (futuro)
   - `stock_end` = `stock_start + loaded_qty - pos_deducted_qty - waste_qty`
4. Scrive `stock_daily_snapshot` — UNICA fonte di verità per La Dispensa
5. Aggiorna `prep_tasks.current_stock` con `stock_end` dove `item_type='prep'`

**Regole costituzionali:**
- È l'UNICO bot che modifica `current_stock`
- Idempotente: cancella solo snapshot POS_DRAIN per quella data
- Tutti gli altri bot dipendono da lui per leggere lo stock corretto
- `stock_daily_snapshot` alimenterà La Dispensa UI

**Nome ufficiale:**
- bot_name: `stock-consolidator-bot`
- Commis: `stock-consolidator-commis`
- Edge Function: `bot-stock-consolidator`

**Dopo Sprint 4:** La Dispensa UI in L'Ufficio (tab Cucina → vista scrollabile stock per stazione).

---

### Fix da fare in prossima sessione (non urgenti)

1. **Modifier "Fired at HH:MM"** — aggiungere lista esclusione permanente in Recipe Matcher Bot (sono timestamps TouchBistro, non scaricano nulla)
2. **Modifier operativi senza alias**: "Berry Coulis", "Caesar", "Daily risotto" — decidere con Max quali aggiungere a `pos_item_aliases`
3. **Ricette mancanti**: Risotto Mushrooms And Steak, Branzino Chef Style — Max le crea quando ha le ricette pronte
4. **Penne Midnight Half BOM** — usa ancora 60g Penne (porzione intera) invece di 30g — da dimezzare



---

## SESSIONE 7 LUGLIO 2026 (continuazione) — Brigata di Bot Sprint 2 + Sprint 3

**Versione sw.js live:** boh-v561 (invariato — zero file frontend toccati)
**Supabase:** ydqmumpytgrlceuinoqt

---

### Sprint 2 — Recipe Matcher Bot v1

**Edge Function:** `bot-recipe-matcher` (nuova)
**bot_name:** `recipe-matcher-bot`
**Commis:** `recipe-matcher-commis`
**Input:** `pos_daily_raw` | **Output:** `pos_daily_clean`

**Logica:**
- `menu_group = 'Kids menu'` → cerca alias `[Nome] [Kids]` o ricetta Half → `kids_alias` (confidence 0.98)
- Match esatto su `recipes.pos_name` pipe-delimited → `exact` (confidence 1.0)
- Modifier tramite `pos_item_aliases` → `modifier_alias` (confidence 0.95)
- Fuzzy (contiene/è contenuto) → `fuzzy` (confidence 0.70, needs_review=true)
- Nessun match → `unknown` (confidence 0, needs_review=true)
- `fuzzy` e `unknown` NON usati per scaricare stock

**Fix prerequisito:** POS TouchBistro Bot v6 aggiornato per aggregare per `(item_name, menu_group)` invece di solo `item_name`. Aggiunto `menu_group` come colonna esplicita in `pos_daily_raw` e nel UNIQUE constraint.

**Risultati su 2026-07-06:**
- 44 exact, 2 kids_alias, 9 modifier_alias, 1 fuzzy, 90 unknown
- Pere E Pecorino Salad → Pear & Pecorino Salad (exact 1.0) ✅
- Spaghetti Al Ragu Kids → Spaghetti Al Ragu Half (kids_alias 0.98) ✅
- Penne Midnight Kids → Penne Midnight Half (kids_alias 0.98) ✅
- Gift Card: sparita silenziosamente ✅
- Gluten Free Bread: resta, needs_review=true ✅

**Ricette Half create in questa sessione:**
- `Fettuccine Alla Vodka Half` — BOM: fettuccine 1 nido, Pomodoro 125g, Heavy Cream 15g
- `Spaghetti Al Ragu Half` — BOM: spaghetti 1 nido, MK-Ragu 100g, Pomodoro 25g, Rosemary 1g
- Alias `[Kids]` aggiunti a tutte le half esistenti (Cacio e Pepe, La N.4, Penne Midnight, Spaghetti al Pomodoro)

**Naming ufficiale bot:** `[Nome] Bot` / `[Nome] Commis`

---

### Sprint 3 — Stock Drain Bot v1

**Edge Function:** `bot-stock-drain` (nuova)
**bot_name:** `stock-drain-bot`
**Commis:** `stock-drain-commis`
**Input:** `pos_daily_clean` (solo righe sicure) | **Output:** `stock_movements`

**IMPORTANTE:** Stock Drain Bot scrive movimenti REALI in `stock_movements`. Non è teorico.
Ogni POS item venduto → BOM espanso → movimento `POS_DRAIN` negativo per ogni ingrediente/prep.

**Regole:**
- Solo `needs_review=false` + `recipe_id IS NOT NULL` + `match_type IN ('exact','kids_alias','modifier_alias')`
- Esclusi silenziosamente: Gift Card, Open Food
- Idempotente: cancella solo `movement_type='POS_DRAIN'` + `source_bot='stock-drain-bot'` + `business_date`
- NON tocca: `current_stock`, `prep_tasks`, `stock_daily_snapshot`

**Migration applicata:** colonne audit aggiunte a `stock_movements`:
`source_bot`, `source_pos_item_name`, `source_menu_group`, `source_match_type`,
`recipe_id`, `recipe_name`, `bom_item_type`, `bom_item_name`, `sold_quantity`, `bom_quantity_per_recipe`

**Risultati su 2026-07-06:**
- 51 righe POS processate → 335 movimenti POS_DRAIN scritti
- 0 ricette saltate per BOM mancante
- Drain verificati: ARRABBIATA -3225g, MK-RAGU -1700g, POMODORO SAUCE -1700g, SPAGHETTI FRESH PASTA -27each

**File MD creati:**
- `bots/stock-drain-bot/STOCK_DRAIN_BOT.md`
- `bots/stock-drain-bot/STOCK_DRAIN_COMMIS.md`
- `bots/stock-drain-bot/STOCK_DRAIN_TEST.md`

---

### Naming Brigata di Bot — regola fissata

| Bot | Edge Function | bot_name | Commis |
|---|---|---|---|
| POS TouchBistro Bot | bot-pos-importer | pos-touchbistro-bot | pos-touchbistro-commis |
| Recipe Matcher Bot | bot-recipe-matcher | recipe-matcher-bot | recipe-matcher-commis |
| Stock Drain Bot | bot-stock-drain | stock-drain-bot | stock-drain-commis |

Regola: `[Nome] Bot` / `[Nome] Commis`

---

### Sprint 4 — prossimo: Stock Consolidator Bot

Legge `stock_movements` e `prep_log` per la business_date.
Calcola `stock_end = stock_start + loaded_qty - pos_deducted_qty - waste`.
Scrive `stock_daily_snapshot` — UNICO bot che poi aggiorna `current_stock`.
Solo dopo Sprint 4 si costruisce **La Dispensa UI**.

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v561** (invariato) |
| POS TouchBistro Bot | **v6** (fix aggregazione menu_group) |
| Recipe Matcher Bot | **v1** (nuovo) |
| Stock Drain Bot | **v1** (nuovo — scrive movimenti reali) |



---

## SESSIONE 7 LUGLIO 2026 — Brigata di Bot Sprint 1 (DB + Edge Function, nessun bump frontend)

**Versione sw.js live:** boh-v559 (invariato — zero file frontend toccati)
**Supabase:** ydqmumpytgrlceuinoqt
**Edge Function nuova:** bot-pos-importer v1

---

### Cosa è stato fatto

**Architettura Brigata di Bot approvata da Max (documenti voice + allegati).**

Pipeline notturna 04:00–06:00 CDT con regola costituzionale: ogni bot scrive solo la sua tabella. Solo Bot 4 (futuro Stock Consolidator) aggiorna current_stock. Commis AI osservano e scrivono SOLO commis_observations.

**Migration DB `brigata_bot_sprint1_foundation` — 8 tabelle create:**

| Tabella | Scopo |
|---|---|
| `bot_runs` | Registro turni notturni di ogni bot |
| `pos_daily_raw` | Output grezzo POS Importer |
| `pos_daily_clean` | Output futuro POS Cleaner (Bot 2) |
| `stock_deductions` | Scarichi calcolati (Bot 3A/3B, futuri) |
| `stock_movements` | Ledger universale movimenti |
| `stock_daily_snapshot` | Alimenta La Dispensa — SOLO Bot 4 scrive qui |
| `commis_observations` | Osservazioni Commis AI |
| `menu_item_status` | Lifecycle item POS — vuota, futuro |

**Edge Function `bot-pos-importer` v1:**
- Legge pos_sales_by_item + pos_modifiers per una business_date
- Scrive pos_daily_raw (idempotente)
- Scrive bot_runs con status/conteggi/summary
- Lancia Commis POS Auditor (deterministico, zero LLM)
- NON tocca: current_stock, prep_tasks, stock_daily_snapshot

**Commis POS Auditor (dentro bot-pos-importer):**
- Menu change date: 2026-06-27 — storico pre-cambio ignorato
- Min 2 occorrenze post-cambio per generare warning
- Regola 1: zero anomalo → warning (media > 3) o info (storico insufficiente)
- Regola 2: vendita > 2.5× media → info
- Regola 3: nome non mappato a ricetta → info (missing_mapping)
- Idempotente: cancella observation precedenti prima di riscrivere

**File MD creati in `/bots/pos-importer/`:**
- POS_IMPORTER_BOT.md
- POS_IMPORTER_COMMIS.md
- POS_IMPORTER_TEST.md

---

### PRIMO PASSO PROSSIMA SESSIONE — Test bot

Il bot non è stato ancora triggerato (dominio Supabase fuori allowlist container Claude).
Max deve triggerarlo da Supabase Dashboard:

Edge Functions → bot-pos-importer → Body: {"business_date": "2026-07-06"} → Send

Poi verificare:
```sql
SELECT business_date, source_table, COUNT(*), SUM(portions_sold)
FROM pos_daily_raw WHERE business_date = '2026-07-06'
GROUP BY 1, 2;

SELECT bot_name, status, rows_read, rows_written, warnings_count, summary
FROM bot_runs WHERE bot_name = 'pos-importer' ORDER BY started_at DESC LIMIT 3;

SELECT severity, category, title
FROM commis_observations WHERE business_date = '2026-07-06' ORDER BY severity DESC;
```

Attesi: ~104 righe sales + ~96 modifier in pos_daily_raw. stock_daily_snapshot e stock_deductions devono restare vuote.

---

### Sprint 2 — dopo verifica Sprint 1

Bot 2 — POS Cleaner: legge pos_daily_raw, mappa pos_item_name → recipe_id usando recipes.pos_name (alias pipe-delimited), scrive pos_daily_clean con match_type (exact/alias/fuzzy/unknown) e confidence.

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v559** (invariato) |
| bot-preplist-builder | v42 (Supabase v67) — invariato |
| bot-pos-importer | **v1 (nuovo)** |
| Migration | `brigata_bot_sprint1_foundation` |



---

## SESSIONE 7 LUGLIO 2026 — Bot Preplist Debug continuo + Fix dati spaghetti (DB only, boh-v557)

**Versione sw.js live:** boh-v557 (nessun bump questa sessione — solo DB)
**Supabase:** ydqmumpytgrlceuinoqt
**Bot:** bot-preplist-builder v42 (Supabase v67), bot-preplist-sim v7 (Supabase v13)

---

### Contesto sessione

Continuazione debug bot-preplist-builder. Max ha esaminato le card prep in produzione e identificato ulteriori incongruenze. Focus su: unità sbagliate, calcolo spaghetti nests, anomalie numeriche.

---

### Fix unità — ultimi task rimasti con unità errate

| Task | Fix | Note |
|---|---|---|
| **Soffritto Livornese (397)** | `unit='buste'` → `unit='g'` | Bot ora mostra "1.4kg" ✅ |
| **Italian cream (385)** | `unit='kg'` → `unit='g'` | Fix completato sessione precedente, confermato |
| **Parmesan Grated (439)** | `unit='kg'` → `unit='g'` | Fix sessione precedente, ancora "26kg" anomalo — problema nel calcolo, non nell'unità |

---

### Fix Spaghetti fresh pasta — calcolo nests

**Problema:** bot calcolava male il consumo nests per spaghetti. Tre errori distinti.

**Errore 1 — serving_qty/serving_unit sbagliati:**
- La N°4: già corretto da Max a mano (`serving_unit='nests'`) ✅
- Spaghetti Al Ragu: già corretto da Max a mano (`serving_qty=2, serving_unit='nests'`) ✅
- **Spaghetti al Pomodoro Half:** `serving_unit='porzione'` → `serving_unit='nests'` ✅ (fatto in questa sessione)
- Maccheroni lasciato fuori (pasta diversa, non spaghetti)

**Errore 2 — Modifier non scaricati:**
- Vendite verificate: "Add spaghetti half" 38 venduti, "Add half spaghetti" 28 venduti
- `pos_name` di SPAGHETTI FRESH PASTA era vuoto `''`
- Fix: `pos_name='Add spaghetti half|Add half spaghetti|Spaghetti'` ✅

**Errore 3 — Wheel Pasta non collegata:**
- Wheel Pasta scarica 2 nests per ogni venduta ma non era nel subMap
- Fix: INSERT `recipe_bom` (bom_id 2055): `parent_recipe_id=Wheel Pasta`, `sub_recipe_id=SPAGHETTI FRESH PASTA`, `component_type='RECIPE'`, `quantity=1`
- Nota: Wheel Pasta ha `serving_qty=2, serving_unit='nests'` → bot moltiplica 1×2=2 nests per vendita ✅

**Vendite spaghetti dal DB (verificate):**
- "Add shrimp" modifier: 144 vendute in 22 giorni → più frequente di molti piatti
- Ultima data con vendite: 3 luglio 2026 (4-5 luglio chiusi)

---

### Fix ADD SHRIMP — collegamento ricetta

**Problema:** `calcConsumo` ritornava `sold` grezzo (5 porzioni) invece di grammi perché `serving_weight_g=NULL` su ADD SHRIMP.
**Vendite verificate da pos_modifiers:** "Add shrimp" presente, ieri (5 luglio) zero vendite (chiusi).
**Fix:**
1. `pos_name='Add shrimp'` aggiunto a ricetta ADD SHRIMP (`8346fbee`)
2. prep_task Shrimp (470): `recipe_id='8346fbee'`, `ingredient_id=NULL`
**Risultato:** "Hai 1.2kg - good through Thursday" ✅

---

### Fix Italian cream — BOM Limoncello Cake

**Problema strutturale:** il bot usa `subMap` dove ogni porzione di Limoncello Cake moltiplicava per 1450g (peso intera torta) invece di 121g (peso per fetta = 1450÷12).
**Verifica vendite Limoncello Cake:** media ~5 porzioni/giorno, 12 in casa → bot calcolava 33kg fabbisogno (assurdo).
**Fix:** `recipe_bom bom_id=1856: quantity=1450` → `quantity=121` ✅
**Risultato:** "Stock basso - 1.4kg - arrivi a Lunedì" (lunedì = prossimo giorno aperto dopo shelf_life 4gg) ✅

**Nota su Mimosa stock:** 12 pezzi in casa, con vendite medie ~5/giorno arriva a mercoledì — il bot calcola Italian cream sulla base delle vendite storiche, non sullo stock fisico delle torte finite. Questo è comportamento corretto ma può divergere dalla realtà.

---

### Basil Flowers — ingrediente creato e collegato

Già documentato nella sessione precedente. Confermato funzionante: `ingredient_id='064cf37a'` (Basil Flowers), bot mostra "1 pezzo" (fallback minimo — no BOM, confidence low).

---

### bot-preplist-sim v7

**Deploy:** solo tag versione (v6→v7), logica invariata. Supabase version 13.

**Divergenza sim vs bot reale:**
- La sim ricalcola con dati correnti; il bot reale ha già scaricato lo stock alle 04:00
- Con ristorante chiuso domenica, non c'è scarico → i due dovrebbero allinearsi
- Differenze residue verificate: solo Salmoriglio (borderline yellow/red) e display bug nests spaghetti

**Bug Spinach nella sim:** sim dice "1200 cup", bot reale dice "make 2 batches (80 cups)". Bug noto nel percorso cup della sim — `calcConsumo` con `ingRecMap` ritorna grammi ma vengono interpretati come cup. NON corretto in questa sessione.

---

### Discussione calcolo nests spaghetti

**Stock verificato da bot_debug_runs:**
- 3 luglio (sim): stock=517 nests, scarico=40.5 nests (vendite giovedì 2)
- 4 luglio (sim): stock=457 nests, scarico=30 nests (vendite venerdì 3)
- 5-6-7 luglio: stock=457 nests, scarico=0 (chiusi domenica + festività)

**Vendite verificate da pos_sales_by_item:**
- Giovedì 2 luglio: ~45 nests (Cacio 11+Half 5, La N°4 7+Half 11, Ragu 9+5)
- Venerdì 3 luglio: ~30 nests (Cacio 10+Half 5+Child 1, La N°4 7+Half 4, Ragu 6)
- Giovedì ha più vendite di venerdì — confermato dai dati, non anomalia

**Bug "40 nests" nel testo:** il testo `suggested_note` mostra "40 nests" ma lo stock reale è 457. Il numero 40 è il batch suggerito (multiplo di `bs×sq=20×2=40`), non lo stock. Bug in `buildNote` per nests: mostra `ss.text_it` (batch) invece dello stock reale. Da fixare in v43.

---

### Incongruenze ancora aperte per prossima sessione

| Item | Problema | Note |
|---|---|---|
| **Parmesan Grated (439)** | "26kg" anomalo nonostante fix unità | Calcolo sub_recipe o ingRecMap sproporzionato — da investigare |
| **GF sponge cake (382)** | "164 pezzi" con `base_servings=NULL` | Da investigare |
| **Maccheroni (412)** | testo "2 Grams" | pack driver sbagliato (Semolina ha pack_description "Grams") |
| **Spaghetti nests display** | "40 nests" = batch, non stock | Bug in `buildNote` — da fixare in v43 |
| **Task rossi stock=0 senza dati** | Choco logo, Lemon Zest, Powder sugar, Goat cheese, Honey, Mint liquid | Rumore — diventano rossi per fallback. Da gestire con skip o grey |
| **Spinach sim** | "1200 cup" in sim vs "80 cup" bot reale | Bug mismatch unità cup nel percorso ingRecMap della sim |
| **Artichoke (261)** | "hai 1 pezzi" — singolare/plurale sbagliato | Bug display |

---

### Decisioni architetturali confermate in sessione

1. **unit del prep_task deve essere quello fisico** — grammi per tutto quello che si pesa. MAI "buste", "kg", "9pan", "porzioni" se il cuoco inserisce grammi.
2. **suggested_qty in grammi con fmtGrams()** — il testo si formatta automaticamente in kg quando ≥1000g.
3. **pos_name pipe-delimited** per alias modifier — "Add spaghetti half|Add half spaghetti|Spaghetti" funziona.
4. **subMap usa quantity dal BOM per porzione** — non per batch. Se il BOM ha la quantità per torta intera, va divisa per `base_servings` manualmente nel BOM stesso (fix bom_id 1856: 1450→121).
5. **Bot Debug (sim)** — legge `suggested_note` già scritto dal bot reale, non ricalcola. Unica fonte di verità è il run delle 04:00.

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v557** (invariato) |
| bot-preplist-builder | **v42** (Supabase v67) — invariato |
| bot-preplist-sim | **v7** (Supabase v13) — invariato |



---

## SESSIONE 6 LUGLIO 2026 — Bot Preplist Debug + Fix dati (DB only, boh-v536)

**Versione sw.js live:** boh-v536 (nessun bump — solo DB + Edge Functions)
**Supabase:** ydqmumpytgrlceuinoqt
**Bot:** bot-preplist-builder v42 (Supabase v67), bot-preplist-sim v7 (Supabase v13)

---

### Fix source office_items — bot-preplist-builder v41→v42

**Root cause:** `source='bot-preplist-builder'` violava CHECK constraint su `office_items.source` (valori accettati: tell_chef/operation_note/ai_scan/sous_chef_chat).
**Fix chirurgico (4 punti):**
1. `upsertOfficeItem` SELECT dedup: `source='bot-preplist-builder'` → `source='ai_scan'` + `bot_id='preplist_builder'`
2. `upsertOfficeItem` INSERT anomalie: stesso fix
3. INSERT riepilogo run finale: `source='ai_scan'` + `bot_id='preplist_builder'`
4. Versione: `v41` → `v42`

**Verificato:** riepilogo "Preplist 07/06 - 13 prepara oggi - 39 domani - 47 ok" scritto in office_items ✅

---

### Fix unità DB — `unit='kg'` → `unit='g'` su 21 prep_tasks

**Problema:** `current_stock` era inserito in grammi ma `unit='kg'` → testi assurdi ("2552 kg in casa" invece di "2.6kg").
**Fix:** `UPDATE prep_tasks SET unit='g' WHERE id IN (412,439,472,265,343,292,294,468,392,389,385,354,332,333,334,233,291,423,449,415,399)`
**Risultati:** Cantaloupe "2552 kg" → "2.6kg", Grilled Chicken "4831 kg" → "4.8kg" ✅

---

### Fix specifici prep_tasks e ricette

| Fix | Dettaglio |
|---|---|
| **Orange supreme (250)** | `prep_type='checklist'`, `daily_reset=true` — era "2 arance ricorrente", bot la ignorava correttamente |
| **halved tomatoes (346)** | `unit='pezzi'` → `unit='g'` — stock 2694 erano grammi |
| **Olives (355)** | `unit='9pan'` → `unit='g'` — stock 441 erano grammi |
| **Shrimp vendor** | `pack_description='2.5 LB'`, `conversion_to_base=1134` (era 20 LB sbagliato) |
| **Soffritto Livornese (397)** | `unit='buste'` → `unit='g'` — bot ora usa fmtGrams(), "1.4kg" ✅ |
| **Italian cream (385)** | `unit='kg'` → `unit='g'` |
| **Italian cream ricetta** | `base_weight_g=1450`, `base_servings=12` |
| **BOM Limoncello Cake (bom_id 1856)** | `quantity=1450` → `quantity=121` (1450÷12 porzioni — bot moltiplicava per torta intera invece che per fetta) |

---

### Basil Flowers — ingrediente separato

**Problema:** prep_task 235 aveva `ingredient_id` → Basil generico (usato in 26+ ricette) → bot sommava tutto → 515 pezzi.
**Fix:**
- Creato ingrediente `Basil Flowers` (id `064cf37a`, measure_type='each')
- `UPDATE prep_tasks SET ingredient_id='064cf37a' WHERE id=235`
- Bot trova 0 ricette BOM → confidence low → nessun numero assurdo ✅

---

### Shrimp (470) — collegamento a ricetta ADD SHRIMP

**Problema:** `ingredient_id` → Shrimp generico → bot trovava grammi da BOM misto → 5g (erano le 5 vendite medie di "Add shrimp" senza conversione, perché `serving_weight_g=NULL`).
**Fix:**
1. `pos_name='Add shrimp'` aggiunto a ricetta ADD SHRIMP (`8346fbee`)
2. prep_task 470: `recipe_id='8346fbee'`, `ingredient_id=NULL`
**Risultato:** "Hai 1.2kg - good through Thursday" ✅

---

### Spaghetti fresh pasta — fix serving e modifier

**Problema:** bot calcolava male il consumo nests per spaghetti.
**Fix 1 — serving_qty/serving_unit ricette:**
- La N°4: `serving_unit='g'` → `serving_unit='nests'` (già corretto da Max a mano prima del fix)
- Spaghetti Al Ragu: `serving_qty=1, serving_unit='porzione'` → `2, nests` (già corretto da Max)
- Spaghetti al Pomodoro Half: `serving_qty=1, serving_unit='porzione'` → `serving_unit='nests'` ✅
- Maccheroni lasciato fuori (pasta diversa)

**Fix 2 — Modifier nel pos_name SPAGHETTI FRESH PASTA:**
- `pos_name='' (vuoto)` → `pos_name='Add spaghetti half|Add half spaghetti|Spaghetti'`
- Dati vendite verificati: "Add shrimp" 38 vendite luglio, "Add half spaghetti" 28 — bot ora li scarica

**Fix 3 — BOM Wheel Pasta:**
- INSERT `recipe_bom` (bom_id 2055): `parent_recipe_id=Wheel Pasta`, `sub_recipe_id=SPAGHETTI FRESH PASTA`, `component_type='RECIPE'`, `quantity=1`

---

### Parmesan Grated (439) — ancora "26kg" anomalo

**Status:** problema non risolto in questa sessione. Il calcolo sembra venire da sub_recipe o ingRecMap con quantità sproporzionate. Da investigare in sessione dedicata.

---

### bot-preplist-sim v7

**Aggiornamento:** solo tag versione da v6 a v7, logica invariata. Supabase version 13.
**Nota:** Il bug Spinach "1200 cup" nella sim è confermato — è diverso dal bot reale (che dice "make 2 batches (80 cups)"). Bug noto nel percorso cup della sim, logica non corretta in questa sessione.

---

### Confronto bot reale vs sim

**Conclusione sessione:** dopo trigger multipli, bot v42 e sim v7 sono sostanzialmente allineati. Le differenze residue:
1. **Spaghetti "40 nests"** — il testo nel suggested_note è il batch suggerito (multiplo di 40), non lo stock. Bug di display nel buildNote per nests.
2. **Salmoriglio** — pill borderline tra yellow e red, calcolo marginalmente diverso.

**Dati storici stock spaghetti confermati da bot_debug_runs:**
- 3 luglio: stock=517 nests, scarico=40.5 nests
- 4 luglio: stock=457 nests, scarico=30 nests
- 5-6 luglio: stock=457 nests, scarico=0 (chiusi domenica + festività)

**Vendite spaghetti confermati da pos_sales_by_item:**
- Giovedì 2 luglio: ~45 nests (Cacio e Pepe 11+Half 5, La N°4 7+Half 11, Spaghetti Al Ragu 9+5)
- Venerdì 3 luglio: ~30 nests (Cacio e Pepe 10+Half 5+Child 1, La N°4 7+Half 4, Spaghetti Al Ragu 6)

---

### Incongruenze note ancora aperte

| Item | Problema | Priorità |
|---|---|---|
| **Parmesan Grated (439)** | "26kg" — calcolo anomalo | Alta |
| **GF sponge cake (382)** | "164 pezzi" con `base_servings=NULL` | Media |
| **Maccheroni (412)** | testo "2 Grams" — pack driver sbagliato | Media |
| **Spinach (318)** | sim dice "1200 cup", bot reale "80 cup" — bug sim noto | Bassa |
| **Spaghetti nests display** | "40 nests" = batch, non stock — buildNote bug | Media |
| **Task rossi con stock=0 senza dati** (Choco logo, Lemon Zest, Powder sugar, Goat cheese) | Rumore e sfiducia — diventano rossi per fallback | Alta |
| **Basil flowers** | "1 pezzo" fallback — accettabile, nessun BOM disponibile | Bassa |

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v536** (invariato) |
| bot-preplist-builder | **v42** (Supabase v67) |
| bot-preplist-sim | **v7** (Supabase v13) |


# PROMPT PROSSIMA SESSIONE — Brigade

---

## SESSIONE 5 LUGLIO 2026 (sera) — Prep fix struttura dati parte 3 (DB only, boh-v505)

**Versione sw.js live:** boh-v505 (nessun bump — solo DB)
**Supabase:** ydqmumpytgrlceuinoqt

### Prep items fixati in questa sessione

| Prep | Fix | Dettaglio |
|---|---|---|
| **Salmon Flow (Thaw)** | Architettura 3 livelli completata. Ricetta "Thaw Salmon" creata `c2fe373a`, BOM: RECIPE Salmon Filets 1pz. prep_task id=413 aggiornato: prep_type=finale, unit=pezzi, daily_reset=false, recipe_id=c2fe373a, category=Oven Station. Amalfi Salmon bom_id=1614: Salmon Filets -> RECIPE Thaw Salmon 1pz. Salmon Whole bom_id=1863 (NEW): RECIPE Thaw Salmon 1pz. Pull Salmon filets (id=278): archived=true, recipe_id=NULL. | Flusso: baffa -> Salmon Filets [freezer id=317] -> Thaw Salmon [linea id=413] -> Amalfi Salmon + Salmon Whole (1 filetto intero ciascuno) |
| **Salmon Aioli** | Ricetta creata `88ec1dc5`, base_servings=13, batch=520g, serving=40g, shelf_life=5gg, no pos_name. prep_task id=255 collegato. Salmon Cakes BOM: aggiunto RECIPE Salmon Aioli 40g (bom_id 1864). | BOM Salmon Aioli vuoto — Max aggiunge ingredienti quando ha la ricetta |
| **Seed Mix** | Ricetta creata `a5f26f01`, BOM: Sunflower Seed 50g + Pumpkin Seed 50g (50/50), shelf_life=30gg, no pos_name. prep_task id=365 collegato. House Salad/Mediterranean/Pear Pecorino/Salmon Salad: tutti convertiti da ITEM Seeds generico -> RECIPE Seed Mix 10g/porzione. | 4 ricette convertite. Seed Mix = Sunflower 50% + Pumpkin Seeds 50% |
| **Shaved Parmesan** | Audit confermato: struttura gia corretta. 4 ricette POS usano RECIPE Shaved Parmesan (Bresaola 30g, Mini Caesar 40g, Tagliata 10g, Tuscany Road Trip 5g). Ricette con ITEM Parmesan Cheese lasciate invariate (salse/pesto/catering). | Nessun fix necessario |
| **Shredded Carrots** | Ricetta creata `557fab23`, BOM: Carrots raw (Hardie fresche, grattugiate in cucina) 1000g, serving=20g, shelf_life=4gg, no pos_name. prep_task id=366 collegato. House Salad bom_id=856: ITEM Shredded Carrots (468f601c) -> RECIPE Shredded Carrots 20g. | Ingrediente "Shredded Carrots" (468f601c) non piu usato in BOM attivi |

### Flusso Salmon — architettura finale DB

```
Salmon baffa (Fruge, per lb)
    prep_task id=317 "Salmon filets" (Table Side, supporto)
    ricetta Salmon Filets (1e31334d), BOM: Salmon 190g
Salmon Filets [FREEZER] — stock pezzi
    prep_task id=413 "Thaw Salmon" (Oven Station, finale)
    ricetta Thaw Salmon (c2fe373a), BOM: RECIPE Salmon Filets 1pz
Thaw Salmon [LINEA] — stock pezzi
    vendita POS
    -> Amalfi Salmon BOM: RECIPE Thaw Salmon 1pz
    -> Salmon Whole BOM: RECIPE Thaw Salmon 1pz
```

Archiviato: id=278 "Pull Salmon filets" — era legacy con recipe_id errato (puntava a Salmon Whole modifier).

### Note tecniche

- bom_id questa sessione: 1862->1867
- Ricette create: Thaw Salmon (c2fe373a), Salmon Aioli (88ec1dc5), Seed Mix (a5f26f01), Shredded Carrots (557fab23)
- Prep tasks archiviati: id=278 Pull Salmon filets
- Nessun file frontend toccato — solo DB

### Pendenti aperti

1. Salmon Aioli BOM — ingredienti da aggiungere quando Max ha la ricetta pronta
2. Bruschetta/Garlic Oil — Max sistema manualmente
3. Grated Pecorino candidati — Cacio e Pepe, La N4, Maccheroni Arrabbiata (30g/15g/20g/10g/30g)
4. Shredded Carrots resa — batch 1000g carote raw -> shredded da validare in cucina
5. Ingrediente "Shredded Carrots" (468f601c) — non piu in BOM, da archiviare in sessione futura
6. Prossimo prep item — continuare lista audit bot-preplist-builder


---

## SESSIONE 4-5 LUGLIO 2026 (pomeriggio/notte) — v492→v505 — Bot Debug fix + Sim stabile

### Versioni deployate
- Brigade frontend: **v493→v505**
- bot-preplist-sim: **v3→v6** (Supabase v3→v6)
- admin.js: fix bottone Stampa + fmtN display unit

### Completato

**v493 — fix bottone Stampa Bot Debug**
- `display='inline-block'` invece di `''` (funziona su iOS)
- Al reopen del modal, mostra Stampa se `_botSimRows` già presenti
- Diagnosi: GitHub Pages deploy fallito (cancel-in-progress su commit multipli ravvicinati) — risolto con `workflow_dispatch` manuale

**v494 — Stampa → Condividi (Web Share API iOS-safe)**
- `window.print()` non funziona in PWA iOS → sostituito con `navigator.share()`
- Bottone: `📤 Condividi / Salva PDF` → menu nativo iOS Share Sheet
- Fallback desktop: `window.print()`
- Funzione `botSimShare()` aggiunta in admin.js

**v495 — fix fmtN colonne Bot Debug — mostra unità inventory**
- `fmtN` nelle colonne: aggiunto ramo `isNests` e `showUnit` per nests/cup/buste/cartocci
- Prima: "157" (numero nudo). Dopo: "157 nests"
- Fix applicato a tutte e 3 le istanze di `fmtN` in admin.js

**bot-preplist-sim v4/v5/v6 — stabilizzazione messaggio finale**
- v4: introdotto `fmtDisplay(v, unit, isPhys)` per suggText/coverList/percorso
- v5: tentativo conversione grammi→unità fisiche (rollback richiesto da Max)
- v6 STABILE: messaggio copia `stockPresunto` e `fin` già calcolati senza ricalcoli
  - Regola definitiva: `fmtDisplay(v, unit, isPhys)` = identico a `fmtN` nelle colonne
  - Nessuna conversione aggiuntiva. Se il numero è sbagliato, il bug è in `calcConsumo`, non nel display.

### Problema aperto — unità fisiche con calcConsumo in grammi
**Sintomo:** Spinach (cup), Soffritto (buste) mostrano valori troppo alti nel messaggio.
**Causa:** `calcConsumo` per questi task usa `sw` o `bw/bs` → restituisce grammi.
`stockPresunto` = `stock (in cup) - soldYesterday (in grammi)` → mismatch unità.
**Radice:** `stock` è in cup (es. 5), `calcConsumo` restituisce grammi (es. 60g/porzione × 20 vendite = 1200g).
**Fix corretto (NON fatto ancora):** per task con `isPhys=true` e `calcConsumo` che usa `sw/bw_bs`,
convertire `soldYesterday` in unità fisiche prima di sottrarre da `stock`.
Formula: `soldYesterdayPhys = soldYesterday / gramsPerUnit` dove `gramsPerUnit = sw ?? (bw/bs)`.
Questo fix deve essere fatto anche nel bot-preplist-builder v41 — altrimenti il bot stesso
calcola lo scarico stock in grammi per task con unità fisiche.

**⚠️ Prossima sessione: verificare se bot-preplist-builder v41 ha lo stesso mismatch per Spinach/cup.**

### Decisioni architetturali confermate
- `pos_name` NON va rimosso dalle prep_task
- `base_servings` corretto solo per Menu Item — per Prep Recipe usa yield/subMap
- Bot Debug (bot-preplist-sim) deve replicare ESATTAMENTE la logica del bot reale
- Regola display: mai convertire unità nel layer display — la conversione appartiene al calcolo
- `SKILL_ISSUE_TYPES` in office.js: aggiungere solo quando Skill è implementata davvero

### Visione Chef AI confermata
> "The Office is Chef AI's workspace. His only job is to make decisions. Everything else is Chef AI's responsibility."
> Test: "Riduce il numero di decisioni che Max deve costruire da solo?"



---

## SESSIONE 4 LUGLIO 2026 (mattina) — v489→v492 — Chef AI Skill Engine + bot fixes

### Versioni deployate
- Brigade frontend: **v489→v492**
- bot-preplist-builder: **v40→v41** (Supabase v59→v60)
- bot-preplist-sim: **v2→v3** (Supabase v2→v3)
- chef_ai_skill_history: nuova tabella creata
- office_items.snoozed_until: nuova colonna aggiunta

### Completato in questa sessione

**1. Fix preview Bot Config — unit=nests (v489)**
- `office.js`: aggiunto ramo `isNests` nel caso `green` di `botLiveCalcAsync`
- Prima: "487g in casa" anche con unit=nests. Dopo: "487 nests in casa"

**2. Fix preview iniziale liveQty (v490)**
- Quando `suggested_qty=NULL` e `current_stock>0`, la preview mostra stock attuale invece di "—"
- Fix chirurgico nella riga di render iniziale del `liveQty_` div

**3. Chef AI Skill Engine v1 (v491)**
- `officeSkillDispatch(itemId, issueType)` — dispatcher generico plug-and-play
- Skill #001 `UNKNOWN_UNIT` (`bom_unknown_units`) — bottom sheet completa:
  - Carica righe BOM con unità sconosciuta
  - Suggerisce solo unità compatibili con `measure_type` dell'ingrediente
  - Salva in `recipe_bom`, verifica risoluzione, chiude `office_item` automaticamente
  - Logga in `chef_ai_skill_history`
- Nuovi bottoni sulle card: `🧠 Resolve` (solo se Skill esiste) + `🕒 Later` + `✓ Solved`
- `chef_ai_skill_history` table: skill_name, office_item_id, recipe_id, ingredient_id, bom_id, old_value, new_value, field_name, resolved_by, resolved_at

**4. Honest buttons per tutte le card ai_scan (v492)**
- Regola: `🧠 Resolve` appare SOLO se `issue_type` ha una Skill registrata in `SKILL_ISSUE_TYPES`
- Card senza Skill: solo `🕒 Later` + `✓ Solved` — nessun bottone fake
- `🕒 Later` = snooze 7 giorni reale (`status=snoozed`, `snoozed_until=+7d`)
- `✓ Solved` = `status=resolved`, `resolution=resolved_manual`, card sparisce con animazione
- Rimossi: "Fix now", "Snooze 7 days", "Ignore"
- `office_items.snoozed_until` colonna aggiunta via migration

**5. bot-preplist-builder v41 — fix missing_base_servings**
- Warning `missing_base_servings` ora scatta SOLO se il bot non ha NESSUN modo di calcolare il consumo
- Condizione v41: `hasPosName && hasBom && !hasBaseServings && !botCanCalculate`
  - `botCanCalculate = hasSw || hasBwBs || hasPhysicalQty`
  - `hasSw` = serving_weight_g presente e > 0
  - `hasBwBs` = base_weight_g + base_servings entrambi presenti
  - `hasPhysicalQty` = unità fisica (pezzi/cup/nests) con serving_qty presente
- Eliminato falso positivo su Balsamic Dressing (aveva serving_weight_g=74g)

**6. bot-preplist-sim v3 — allineato a v41**
- Logica identica al bot reale: confidence engine, blended demand (50%+30%+20%), calcOpenStatus, BUFFER_BY_CONF, fix missing_base_servings v41
- Bot Debug ora simula esattamente quello che il bot farebbe stanotte

### Architettura decisionale (visione Chef AI)
> "The Office is Chef AI's workspace. During the night, Chef AI observes, analyzes, groups, prioritizes and prepares decisions. When Chef Max opens the Office in the morning, he should never have to search, interpret or investigate. His only job is to make decisions. Everything else is Chef AI's responsibility."

Test per ogni nuova funzione Ufficio: "Riduce il numero di decisioni che Max deve costruire da solo?"

Skill future da registrare in `SKILL_ISSUE_TYPES` (dispatcher in office.js):
- `bom_partial` → Skill BOM_INCOMPLETE (ingredienti candidati da ricette simili)
- `missing_base_servings` → Skill MISSING_SERVING (calcolo automatico o OQR)  
- `missing_photo` → Skill MISSING_PHOTO (raggruppa 89 in 1, ordina per vendite)
- `missing_procedure` → Skill MISSING_PROCEDURE (archivia 0-vendite, presenta resto)

### Audit office_items (212 card aperte)
| Tipo | N | Azione suggerita |
|---|---|---|
| missing_photo | 89 | Raggruppa in 1 card, ordina per vendite, archivia 0-vendite |
| missing_procedure | 81 | Archivia 0-vendite 30gg, presenta le altre in ordine |
| tell_chef | 32 | Tipo A (BOM edit) → Skill; Tipo B (bug) → backlog; Tipo C (prep) → task; Tipo D (info) → no action |
| bom_partial | 4 | Skill BOM_INCOMPLETE con ingredienti candidati |
| bom_empty | 3 | Skill BOM_INCOMPLETE |
| missing_base_servings | 2 | Skill MISSING_SERVING — calcolo automatico |
| bom_unknown_units | 1 | ✅ Skill #001 UNKNOWN_UNIT già attiva |

### Note architetturali
- `base_servings` è corretto per Menu Item, non per Prep Recipe a peso (yield)
- Per Prep Recipe il consumo viene calcolato dal `subMap` (BOM dei piatti padre) — `base_servings` non viene usato
- `pos_name` NON va rimosso: 30/32 prep_task con pos_name non sono nel BOM di nessun piatto padre
- bot-preplist-builder usa `subMap` per Prep Recipe (Arrabbiata ecc.) → calcolo corretto per piatto
- `calcConsumo` con fallback `bw/bs` usato solo per task con `pos_name` diretto



## CARICA SUBITO — UNA SOLA VOLTA A INIZIO SESSIONE
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Leggi TUTTI i file .md da brigade-main **una sola volta all'inizio della sessione** — NON rileggere tra un messaggio e l'altro nella stessa sessione
3. Controlla versione live sw.js prima di qualsiasi push
4. Repo: `1cos/back-of-house`, branch `brigade-main` — MAI `brigade-dev`

---

## VERSIONE LIVE
- Brigade frontend: **v505** (sw.js `boh-v505`)
- bot-preplist-builder: **v41** (Supabase versione 60)
- bot-preplist-sim: **v6** (Supabase versione 6) — stabile, allineato a v41
- Edge Function gmail-touchbistro-import: **v22**
- Supabase project: `ydqmumpytgrlceuinoqt`

---

## SESSIONE 4 LUGLIO 2026 — bot-preplist-builder v39

### Completato in questa sessione

**bot-preplist-builder aggiornato da v34 (Supabase v57) a v39 (Supabase v58).**

**Nuove funzionalità aggiunte (tutte additive, nessuna regressione):**

1. **Confidence engine (high/medium/low)**
   - `high`: pos_name + BOM + base_servings + sales ≥7gg + stock>0
   - `medium`: pos_name + BOM ok, ma dati limitati o stock stimato
   - `low`: manca pos_name o BOM vuoto o no sales <3gg
   - Salvato nel log `[pill][confidence]` per ogni task

2. **Trend 7 giorni** (nuova query `pos_sales_by_item` ultimi 7gg)
   - Calcola media giornaliera per ogni menu_item negli ultimi 7 giorni di servizio (esclude domenica)
   - `salesDaysCount(pn)` → conteggio giorni dati disponibili → usato per confidence
   - Integrato nel blended demand: **50% DOW avg storico + 30% trend 7d + 20% ieri**

3. **Adaptive buffer per confidence**
   - `high`: 1.10 (invariato rispetto a v34)
   - `medium`: 1.15
   - `low`: 1.20

4. **buildNote con confidence** — se `confidence='low'` e `pill='red'`, il note viene forzato a `yellow` con testo "Controlla prima di produrre · dati incerti" invece di inviare prep aggressiva

5. **Office items per anomalie specifiche (anti-spam)**
   Cinque tipi di anomalie generano `office_items` individuali invece di un solo riepilogo:
   - `null_stock`: task skippato perché `current_stock = NULL`
   - `missing_pos_name`: ricetta con `recipe_id` ma nessun `pos_name`
   - `empty_bom`: ricetta con `pos_name` ma BOM vuoto
   - `missing_base_servings`: ricetta con BOM e pos_name ma `base_servings = NULL`
   - `sales_spike`: vendite ieri > 2.2× media DOW storica

   Anti-spam: SELECT per `source='bot-preplist-builder' + status='open' + title` prima di ogni insert. Se esiste → UPDATE `times_seen++` e `last_seen_at`. Se no → INSERT.

6. **Migration DB**: aggiunta `office_items.prep_item_id` (bigint → prep_tasks) e `office_items.pos_name` (text).

**Logica invariata rispetto a v34:**
- `smartQty` / `translateUnit` / `fmtGrams` — identici
- `simulateCoverage` — identico
- Scarico stock da vendite ieri — identico
- Sub-ricette (subMap) — identico
- Modifier support — identico
- `closed_dates` awareness — identico
- Formato `suggested_note`: `color|testo_it|testo_en|testo_es` — identico
- `SKIP_PACK` set — identico

**Riepilogo office item finale** aggiornato: mostra `confidence: X alta / Y media / Z bassa` e lista anomalie.

---

- Supabase project: `ydqmumpytgrlceuinoqt`

---

## SESSIONE 29 GIUGNO 2026 (pomeriggio) — v412→v420 — Flusso prep card completo

### Completato in questa sessione

**Flusso card prep — completamente riscritto:**

- `laterBtn` eliminato — non esiste più
- `noNeedBtn` eliminato — non esiste più
- Tre stati card con bordatura colorata:
  - 🔴 **Rosso** — stock zero/urgente → solo **START**
  - 🟡 **Giallo** — quasi finito → solo **START**
  - 🔵 **Blu** — in progress, step intermedio → **SEE STEPS**
  - 🔵 **Blu** — in progress, ultimo step → **DONE**
  - ⚪ **Grigio** — stock ok → nessun bottone
- Pill bot human-readable: "hai 1.8 kg in casa" / "hai 0 in casa" / "quasi finito · hai 0.4 kg"
- Font card aumentati +2px: nome 17px, badge 12px, pill/tag 13px, bottoni 15px

**Wake Lock:**
- Timer START → `navigator.wakeLock.request('screen')` — schermo rimane acceso
- Timer stop / DONE → rilascia wake lock
- Supportato iOS 16.4+ e Android Chrome 84+

**Step tracking in memoria locale:**
- `window._taskStep[prepTaskId]` — ricorda a che step sei
- `window._taskStepTotal[prepTaskId]` — totale steps
- `window.prepOnStepChange(id, currentStep, total)` — callback da recipe-modal
- Reset al DONE

**Recipe modal adattivo (v4) — 4 modalità:**
1. Ha `recipe_id` + BOM o `recipe_steps` → modal completo (ingredienti scalabili + steps + note)
2. Ha solo `prep_steps` (senza ricetta) → modal leggero solo steps con timer
3. Ha solo nota → modal bare con testo + DONE
4. Niente → modal bare con solo DONE

**`prep_steps` — tabella esistente:**
- Campi: `id`, `prep_task_id`, `sort_order`, `title`, `note`, `timer_minutes`
- Usata per task operativi senza ricetta (salse semplici, check con steps)
- Timer in `timer_minutes` (non seconds) — convertito automaticamente nel modal

**Fix critici:**
- `prepStart()` apre modal anche senza `recipe_id` (fix: `recipeModal.open(null, id)`)
- `prepSeeSteps()` non blocca più su `recipe_id` mancante
- `openDoneSheet()` normalizza id int/stringa per lookup `tasks[key]`
- Modal bare DONE: usa event listener (non onclick inline — IIFE scope bug)
- Modal bare DONE: rimuove overlay PRIMA di aprire done sheet (timing fix)

**Pill bot troncata:**
- `suggested_note` tronca a 60 char per evitare pill lunghissime (bug bot temporaneo)

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. Bot-preplist-builder — riscrittura testo (PRIORITÀ 1)
Il bot deve scrivere testi da sous chef, non da foglio Excel.
Tre casi chiari:
- 🔴 "Prepara oggi · con 14 kg arrivi a venerdì"
- 🟡 "Hai 10 kg in casa · arrivi fino a sabato · non serve oggi"
- 🟢 "Prepara domani · controlla ingredienti"

Logica: `current_stock ÷ consumo_medio_giornaliero = giorni_coperti` → calcola data copertura

**Formato suggested_note nuovo:** `color|testo_it|testo_en|testo_es`
Frontend prep.js legge indice lingua da `user.lang` (1=IT, 2=EN, 3=ES)

**Bug da correggere nel bot:**
- Caprese seasoning: giorni ripetuti (Ven/Sab 10 volte) — calcolo finestra storica sbagliato
- Check Basil Oil: `suggested_qty=13315 buste` — confonde grammi con kg
- Generale: mostra percorso ragionamento invece del risultato

### 2. Stazioni ancora da completare
- **Finishing Oven** — categorizzazione prep_type non ancora toccata
- **Plating Station** — categorizzazione prep_type non ancora toccata

### 3. Manager Station — ancora aperti
- Basil flowers → BOM da collegare alle ricette
- Confit tomatoes → ricetta da creare + BOM
- Porterhouse task (id 461) → collegare a ricetta Porterhouse alla Fiorentina
- Spinach (id 318) → decidere: stessa ricetta di Butter Spinach o separata?

### 4. Dati ricette mancanti
- **Brisket** — `base_weight_g` (verificare in cucina)
- **Truffle Butter** — `base_weight_g`
- **THYME BUTTER** — `base_weight_g = 5g` sembra placeholder
- Varie Pastry — `shelf_life_days` mancanti

### 5. Recipe steps — placeholder dinamici (backlog)
Steps devono usare `{item_id}` invece di quantità hardcoded.
Il modal risolve i placeholder dal BOM scalato in tempo reale.

### 6. Dish Crew Home (Fase 2) — backlog
Detect `user.default_station === 'Dish Crew'` → home semplificata.

---

## REGOLE CRITICHE DA NON DIMENTICARE
- **BOM mai toccato** — connesso a bot, POS, food cost
- **pos_name immutabile** — solo alias con pipe `|`
- **tasks lookup** — sempre normalizzare id con `Object.keys(tasks).find(k=>String(k)===String(id))`
- **Modal IIFE** — mai onclick inline dentro recipe-modal.js, sempre event listener
- **sw.js** — sempre leggere versione live prima di pushare, incrementare di +1

---

## SESSIONE v427 → v428 (30 giugno 2026)

**Nota:** il log si era fermato a v420 ma sw.js live era già a v427 — mancavano i riepiloghi di sessioni parallele (v421-v427: pill bot trilingue, fix tell-chef, step editor recipe_steps in openRecipeEditor). Da recuperare quando le altre sessioni chiudono.

**Bug fix — swipe-to-close che chiudeva le sheet durante lo scroll (v428):**

1. **Vendor Documents (`vendor-documents-review.js`)** — c'erano DUE listener di swipe-to-close attaccati allo stesso pannello: uno vecchio inline senza protezione scroll (chiudeva la sheet se il drag verticale superava 80px, ovunque partisse il touch) e uno nuovo condiviso (`addSwipeToClose` in utils.js, che ignora il drag se parte dentro un container scrollabile). Il primo interferiva sempre. Fix: rimosso il listener vecchio, lasciato solo `addSwipeToClose`.

2. **L'Ufficio (`office.js`, funzione `officeAddSwipeDown`)** — il check usava solo `list.scrollTop` letto in tempo reale al `touchmove`, senza considerare se il touch fosse partito dentro la lista. Quando l'utente era in cima alla lista (`scrollTop ≈ 0`) e provava a scrollare/guardare il contenuto, il gesto veniva letto come chiusura sheet. Fix: ora si traccia se il touch è partito dentro `#officeFolderList` (`touchInList`); se sì e la lista può ancora scrollare verso l'alto (`scrollTop > 0`), il drag-to-close è disattivato e priorità allo scroll nativo. Se l'utente è già in cima e continua a tirare giù, il drag-to-close si riattiva (gesto naturale iOS).

**Segnalato da Max ma NON ancora risolto — bottom bar fluttuante:**
- A volte durante lo scroll (Vendor Documents, sottomenu L'Ufficio) la bottom bar (`<nav class="fixed bottom-0...">` in index.html) si stacca e finisce "nel mezzo" dello schermo invece di restare ancorata in fondo.
- Causa probabile: nessuno scroll-lock sul `body` quando si apre una sheet/modal → il bounce/rubber-band di iOS Safari può spostare temporaneamente elementi `position:fixed`.
- Piano proposto (in attesa di conferma Max): al momento dell'apertura di una sheet/modal, bloccare lo scroll del body (`position:fixed` su body) e sbloccarlo alla chiusura. Max ha chiesto di aspettare e verificare prima se il fix dello swipe-to-close (sopra) risolve già il sintomo. Test in corso da parte di Max — risultato preliminare "va meglio" ma non ancora confermato del tutto risolto.
- Se riemerge: applicare lo scroll-lock, inizialmente solo su Vendor Documents + L'Ufficio (non a tutte le sheet/modal, su richiesta esplicita di Max in quella conversazione).

**File modificati:** `js/vendor-documents-review.js`, `js/office.js`, `sw.js` (v427→v428)

**Nota per sessioni parallele:** Max sta lavorando contemporaneamente su altre chat che devono ancora chiudere e scrivere i loro riepiloghi. I 6 file MD principali (BOH_OS_BACKLOG, BOH_OS_DECISIONS, BOH_OS_SPEC, BOH_OS_WARNINGS, BRIGADE_DB_SCHEMA, BRIGADE_VISION) sono risultati molto disallineati rispetto allo stato reale del DB/app (fermi tra il 12 e il 27 giugno, prima del lancio in produzione) — aggiornamento generale rimandato finché le sessioni parallele non chiudono, per non sovrascrivere lavoro in corso.

---

## SESSIONE v427 — Steps editor UI in openRecipeEditor (recipe-steps, sessione parallela "ricette contorni")

**Scoperta di partenza:** Max ha notato due sistemi di visualizzazione ricetta scollegati: la modal vecchia (`recipes.js`, colonna testo libero `recipes.procedure`, aperta da "Edit") e la modal nuova con tab Ingredients/Steps/Notes, progress bar e timer (`recipe-modal.js`, legge dalla tabella `recipe_steps`: `step_number`, `title`/`title_it`/`title_es`, `instruction_en`/`instruction_it`/`instruction_es`, `timer_seconds`). L'editor "Edit" scriveva solo sul vecchio `procedure`, quindi **non esisteva alcuna UI per editare `recipe_steps`** — Max aveva popolato 19 ricette a step manualmente via query dirette.

**Censimento sullo stato reale (216 ricette totali, 30/06):**
- 16 ricette con solo `procedure` vecchio testuale
- 19 ricette con solo `recipe_steps` (nuovo formato)
- 6 ricette in doppio binario (entrambi i sistemi popolati): Amalfi Salmon, Arrabbiata, Artichoke, Chicken Parmesan, Fried Calamari, Salmon Cakes — **rischio di disallineamento se editate dal vecchio editor**
- 187 ricette senza procedimento da nessuna parte

**Decisione Max:** il formato a step è quello corretto (più nuovo, più veritiero, dati freschi). Il vecchio `procedure`/`procedure_en`/`procedure_es` resta per ora intatto (non rimosso, non migrato) — migrazione delle 16+6 ricette vecchie rimandata a sessione futura, priorità era avere prima l'editor.

**Costruito (v427):**
- `js/recipes.js` — `openRecipeEditor` reso `async`, carica gli `recipe_steps` esistenti (se `rec.id`) prima di renderizzare la modal. Nuova sezione "👨‍🍳 Steps" sotto Ingredients: righe con titolo IT + istruzione IT + timer (minuti), pulsanti aggiungi/rimuovi/riordina (↑/↓), pulsante "🌐 Traduci EN/ES" per riga che chiama `groqTranslate` (stessa funzione/Edge Function `ai-translate` già usata per `procedure_en/es`) per popolare titolo+istruzione in EN/ES. Nuova funzione `saveRecipeSteps(recipeId, steps)` — pattern delete+reinsert identico a `saveRecipeBOM`, chiamata nel flusso di `saveR` dopo `saveRecipeBOM`.
- `js/utils.js` — chiavi i18n aggiunte in IT/EN/ES: `noSteps`, `translateStepsBtn`.
- Equipment/Procedure (vecchio editor) lasciati intatti e ancora presenti nella modal, sotto la nuova sezione Steps — nessuna rimozione per ora.

**Verifica richiesta a Max:** aprire Edit su "Brussel Sprouts" (che ha 4 step già popolati) e controllare che il nuovo editor li carichi e mostri correttamente prima di fidarsi per nuove ricette.

**File modificati:** `js/recipes.js`, `js/utils.js`, `sw.js` (v426→v427)

---

## SESSIONE v428+ — Nuove ricette contorni per La Griglia (sessione parallela "ricette contorni")

Mentre si attendeva conferma del test sull'editor Steps sopra, Max ha chiesto di procedere comunque a inserire ricette contorni via SQL diretto (stesso formato di Brussel Sprouts: `recipes` + `recipe_bom` + `recipe_steps`), così risultano già editabili/correggibili dal nuovo editor una volta confermato funzionante.

**Ricette create (categoria `SECONDI|contorni`, `base_servings=10`):**

1. **Roasted Cauliflower** (id `cffcebf1-a29e-4447-8544-9d7e250d1f26`) — 35 min prep, shelf life 2 giorni. BOM: Cauliflower 1500g, EVOO 80ml, Salt 8g, Black Pepper Whole 3g, Pecorino Romano 150g, Bread Crumbs 100g. 4 step: taglio+condimento → forno 22 min (1320s) → tostatura pangrattato 3 min (180s) → assemblaggio con pecorino e pangrattato.

2. **Marsala Onions** (id `51218cd3-34fe-4ebd-959e-3762aaa311fc`) — 45 min prep, shelf life 3 giorni. BOM: Red Onions 1800g, Butter 60g, EVOO 40ml, Marsala Wine 250ml, Brown Sugar 30g, Salt 6g, Black Pepper Whole 2g. 4 step: affettatura → caramellizzazione 25 min (1500s) → sfumatura Marsala e riduzione 10 min (600s) → raffreddamento/conservazione.

**Nuovo ingrediente creato:** Marsala Wine (id `04adaed2-e019-4671-bfa1-78a826da6a31`, categoria Beverages & Spirits, non esisteva nel DB).

**Nessuna modifica a file GitHub per questa parte** — solo inserimenti DB via Supabase MCP (`recipes`, `recipe_bom`, `recipe_steps`, `ingredients`).

**Prossimi contorni in coda (proposti da Max, non ancora confermati/costruiti):** Carote arrostite miele/timo/nocciole, Funghi misti burro nocciola, Polenta cremosa al parmigiano, Broccolini aglio/peperoncino/limone, Patate al forno con pancetta, Insalata rucola/parmigiano/balsamico, Crema di sedano rapa, Radicchio grigliato miele/gorgonzola, Fagioli cannellini rosmarino/aglio, Tortino patate gratinate. Max deve ancora scegliere quali tra queste procedere.

**File modificati:** nessuno (solo DB)


## SESSIONE v396→v426 — Bug fixing sparsi (CORS, Schedule Oggi/Domenica, Prep Later, Recipe Pomodoro, Tell Chef crash)

Sessione separata in parallelo alle due sopra (steps editor + ricette contorni). Lavorato su file diversi, nessun conflitto noto.

**1. CORS fix Edge Function `notifications` (v33 Edge Function, no bump app):**
- `notifications` aveva `verify_jwt: true` → chiamate da `operation-notes.js` con ANON KEY fallivano il preflight CORS (niente header `Access-Control-Allow-Origin`), bloccate dal browser.
- Fix: rideploy con `verify_jwt: false` + handler esplicito per `OPTIONS` preflight + `CORS_HEADERS` su tutte le response (success ed errore).
- Risolto anche l'errore visibile in console `[OperationNote] Push failed: Failed to fetch`.

**2. Schedule — tab "Oggi" bloccato su data vecchia (v394→v397):**
- Bug: `schedCurrentDayIndex` inizializzava a `0`, usato sia come sentinella "non ancora selezionato" sia come index reale del primo giorno. Cliccando un giorno diverso da indice 0 il valore restava sporco; alla riapertura, se la data odierna non coincideva col giorno a index 0 della settimana, l'app restava bloccata sul vecchio giorno selezionato in sessioni precedenti.
- Fix v394: sentinella cambiata da `0` a `-1`; reset esplicito a `-1` ogni volta che si apre `showSchedule()`; auto-select cerca l'indice di oggi in `weekDates` solo quando `< 0`.
- Fix v397 (logica domenica, Zenos chiuso): `schedGetWeekDates()` ora filtra fuori le settimane passate (calcola il lunedì corrente — o il prossimo se oggi è domenica — e tiene solo `date >= cutoff`, con fallback a tutte le date se non ce ne sono future). `schedRenderOggi()` rileva `isSundayToday` e se vero salta direttamente al primo giorno disponibile (lunedì prossimo) invece di cercare la data odierna. Aggiunto banner "🌙 Zenos è chiuso oggi — Buon riposo a tutta la brigata. Prossimo turno: [data]" sopra le stats quando è domenica. Stessa logica si applica a colpo solo (week dates già filtrate) anche in view Settimana, che quindi si apre già sulla settimana prossima.
- File: `js/schedule.js`.

**3. Prep — bottone "Later" confuso/inutile, segnalato da Samantha (Pastry) via Tell Chef (v399→v411):**
- Bug riportato: "When I hit the do it later button it makes it say in progress" — tap veloce sul bottone Later in realtà chiamava `setWip()` diretto (impostava `in_progress: true`) invece di aprire il modal di scelta. Già un primo fix (v399) ha corretto `endWipPress` per chiamare `openWipNoteSheet` invece di `setWip` direttamente — ma poi si è scoperto che la vera causa di confusione era nel modal stesso: c'era **un solo bottone visibile** ("Mark In Progress"), quindi Samantha tappava quello pensando fosse il "conferma later" e il task finiva comunque in progress.
- Fix v411: modal con due bottoni affiancati e chiari — "Do it later" (grigio, chiude senza modificare il task) e "Mark In Progress" (blu, setta `in_progress: true`).
- **Nota importante per la prossima sessione (richiesta esplicita da Max, NON ancora implementata):** Max ha chiarito in chat che la UX di "Later" così com'è non ha senso e va ripensata da zero in una sessione dedicata. Logica voluta da Max, riassunta:
  - Bottone **"Later" va eliminato del tutto** da ogni card — se un task non interessa ora, si scorre oltre, non serve un'azione esplicita.
  - **Card "checklist"** (prep_type=`checklist`): solo pulsante Check, nessun concetto di Start/In Progress/Done.
  - **Card bordata di rosso (urgente/da fare)**: deve mostrare **Start**, non Done — non ha senso vedere "Done" su un task mai iniziato. Start apre la ricetta/steps con timer; si può navigare via e tornare dopo (più ricette aperte "in parallelo", es. avvii il soffritto dell'Arrabbiata, passi alla Cacio e Pepe a far bollire l'acqua, torni indietro sull'Arrabbiata per lo step successivo — ogni ricetta mantiene il proprio stato/step/timer in background). Una volta avviato → stato "In Progress", bordo cambia colore. **Done diventa disponibile solo dopo aver completato tutti gli step** della ricetta — non si può segnare Done saltando step.
  - **Card non bordata di rosso (non urgente)**: comportamento più semplice, Done diretto disponibile da subito senza dover passare da Start — fa solo da log/archivio con timestamp di quando è stata fatta, la card resta visibile con etichetta "Done".
  - Dopo che una card a step è stata completata (bordo tolto, va in fondo lista) e si volesse **rifarla**, va chiesta conferma esplicita ("Sei sicuro? L'hai appena completata") prima di farla ripartire da Start.
  - Max ha esplicitamente chiesto di **rimandare questo refactor a una sessione dedicata separata**, per non mischiarlo con fix minori. Prossima sessione: ripartire da qui, leggere `js/prep.js` live (versione corrente al momento dell'apertura, non fidarsi di questo riassunto per i numeri di riga) e implementare la logica sopra da zero, eliminando tutta la vecchia logica `startWipPress`/`endWipPress`/`openWipNoteSheet`/`saveWip` legata al concetto di "Later".
- File: `js/prep.js`.

**4. Recipe Pomodoro — can size sbagliato, segnalato da Cole (Saucier) via Tell Chef:**
- Bug: ricetta POMODORO SAUCE (id `498a2cf2-e425-4f08-8f5c-0edca4ca6f9e`) impostata per lattine piccole (5200g pomodoro, non multiplo di una lattina standard). Zenos usa lattine da 3kg.
- Fix: ricalcolata l'intera ricetta proporzionalmente su 1 lattina = 3000g pomodoro (fattore 0.5769). Aggiornati `base_servings` (20→12), `base_weight_g` (6122→3532) e tutti gli ingredienti nel BOM (Onions 800→461g, Carrots 200→115g, Celery 100→58g, EVOO 200→115g, Basil×2 50→29g e 100→58g, Water 1000→577ml, Salt 2→1g). Nessuna modifica a file GitHub — solo query dirette su `recipes`/`recipe_bom` via Supabase MCP.

**5. Tell Chef — crash JS su chiusura modal (v413):**
- Bug visto in console da Max: `Uncaught ReferenceError: tellChefStopVoice is not defined` su `closeTellChef()` (tell-chef.js:138). Funzione residua da un vecchio sistema di dettatura vocale custom, mai definita nel file attuale — l'app ora usa la dettatura nativa iOS dalla tastiera, non serve più.
- Fix: rimossa la chiamata a `tellChefStopVoice()` da `closeTellChef()`.
- File: `js/tell-chef.js`.

**File modificati in questa sessione:** `js/schedule.js`, `js/prep.js`, `js/tell-chef.js`, `sw.js` (v393→v396→v397→v398→v399→v411→v412→v413, poi riallineato a v425→v426 dopo essersi accorto che un'altra sessione parallela era già a v410+ — vedi nota sotto). Edge Function `notifications` (Supabase, v33, non versionata in sw.js).

**⚠️ Nota importante — collisione tra sessioni parallele rilevata e corretta in corsa:** durante questa sessione è stato inizialmente fatto un push su `js/prep.js` partendo da una versione letta a inizio sessione (corrispondente a v393), mentre nel frattempo un'altra sessione parallela aveva già riscritto sia `prep.js` che il modulo recipe-view fino a v410. Max ha bloccato in tempo ("siamo alla versione 410, non fare casino") prima che si creasse un conflitto serio. Il fix del bottone Later (punto 3 sopra) è stato poi rifatto correttamente leggendo dal vero stato live v410. **Lezione confermata per il futuro: rileggere sempre sw.js live immediatamente prima di ogni modifica, mai fidarsi di uno SHA letto a inizio sessione se la sessione è lunga o se si sa che Max lavora in parallelo altrove.**



---

## SESSIONE v425+ — Oven Station: tutti gli steps completati + fix struttura recipe_steps

**Contesto:** Sessione "RICETTE A STEPS" — Max ha chiesto di compilare `recipe_steps` per tutte le ricette ancora prive di steps, lavorando una stazione alla volta. Iniziata da Oven Station. Workflow stabilito da Max: Claude propone steps basati sul BOM reale → Max corregge a voce (spesso il processo reale è molto diverso da quanto dedotto dal solo BOM) → Claude salva nel DB → Claude riverifica con SELECT che sia tutto salvato correttamente.

**Fix struttura DB importante:** la tabella `recipe_steps` aveva solo `title` (singola colonna, niente i18n) mentre le istruzioni (`instruction_it/en/es`) erano già trilingue. Max ha notato nello screenshot dell'app che i titoli apparivano sempre in italiano anche con istruzioni in inglese. Aggiunta migration:
```sql
ALTER TABLE recipe_steps ADD COLUMN title_it text, ADD COLUMN title_es text;
```
Tutti i titoli esistenti (74 steps, incluse le ricette Saucier della sessione precedente) sono stati retrocompilati in IT/EN/ES. **`js/recipe-modal.js` aggiornato** (v425) per leggere `title_it`/`title_es`/`title` in base a `window.user?.lang` — stessa logica già usata per le istruzioni. File modificato: `js/recipe-modal.js`, `sw.js` (v424→v425).

**Regola "Note di servizio" stabilita da Max:** le istruzioni di piattaggio/finitura/servizio (cosa fare al pass durante il servizio, diverso dalla prep di produzione mattutina) NON vanno negli step di `recipe_steps`, ma nel campo `recipes.procedure` — che il tab "Notes" della recipe-modal già legge e mostra. Questo evita di mescolare "cosa preparo stamattina" con "cosa faccio quando arriva la comanda".

**Ricette Oven Station completate (9/9 — stazione conclusa al 100%):**

1. **Tempura Batter** (4 step) — soda water fredda + farina frustata + ghiaccio, si rifrusta se si rompe, si fa fresca ogni giorno, conserva in contenitore 1/6 profondo in frigo.
2. **Croutons** (4 step, timer 2400s) — pane a cubetti + condimento, **forno Rational programma "Croutons" 120°C per 40 min** (non 350°F/15min come da ipotesi iniziale), verificare croccantezza fino all'interno prima di togliere.
3. **Rosemary Potatoes** (4 step) — niente risciacquo delle patate (il forno le rende comunque croccanti), **forno Rational programma "Rosemary Potato Par Cook"**, si raffredda su teglia poi si trasferisce in **1/3 pan** (non hotel pan).
4. **Brussel Sprouts** (4 step, timer 540s) — processo completamente diverso dall'ipotesi forno: si **bollono interi 9 min in acqua salata**, si raffreddano in placca con acqua e ghiaccio, si taglia il culetto e si tagliano a metà, poi si mescolano con pomodorini a metà e basilico nelle proporzioni ricetta in un contenitore 1/3, condimento EVOO/sale/pepe, si conservano in frigo crudi (non si cuociono in forno per il prep — la cottura finale è al momento del servizio, non documentata in questa sessione).
5. **Fried Calamari** (3 step, timer 1200s — solo prep) — calamari congelati, **scongela 20 min in acqua fredda** (non nella confezione), pulisci/separa teste (contenitore 1/6 basso) e tubi tagliati a strisce 1cm (contenitore 1/6 profondo). Note di servizio in `procedure`: porzione 100g tubi + 50g teste, farina abbondante (si recupera l'eccesso), frittura 2-3 min, sale, servito con ramekin 2oz Arrabbiata.
6. **Artichoke** (3 step, timer 1800s) — carciofi congelati in confezioni da 20: **scongelano nella confezione chiusa 30 min** (non in acqua), poi si aprono e si dispongono a gruppi di 2 interfogliati con carta forno in contenitore 1/3; cipolle rondelle aperte in contenitore 1/6. Note di servizio in `procedure`: seasoning con Ribeye Salt, griglia 1.5-2 min, forno 2.5 min, 4 anelli cipolla fritti in tempura (tempura già pronta — non rifatta al momento), piatto con Artichoke Sauce + 2 carciofi + 3 anelli + parmigiano + prezzemolo.
7. **Salmon Cakes** (4 step) — processo diverso dall'ipotesi "soffritto in padella": **salmone cotto in forno** condito con EVOO+White Wine, raffreddato, poi mix con **verdure/erbe tritate a crudo** (non soffritte), formate e conservate in contenitore 1/6 a gruppi di 4 con carta forno. Note di servizio in `procedure`: teglia con olio staccante, **forno Rational programma "Salmon Cake" o "Patate Focaccia"**, piattino con insalatina + pomodori bruschetta, salmon cakes rivolte con parte arrostita verso l'alto, Salmon Aioli, zest di limone.
8. **Chicken Parmesan** (2 step, timer 3600s sul riposo) — petto pulito **~240-250g** (non 300g come da ipotesi BOM, lo scarto di pulizia è significativo), cura con **Poultry Salt 8g/kg**, marinato in EVOO min 1 ora, impanatura **pangrattato→uovo→pangrattato** (non uovo→pangrattato semplice), conservato in teglia mezza a 2 fette per strato con carta forno. Note di servizio in `procedure`: frittura 2.5 min in friggitrice, poi Arrabbiata+mozzarella in forno 2.5-3 min, **controllo temperatura interna col termometro prima di mandare**, impiattato su mezza porzione spaghetti Arrabbiata con rucola e fiore.
9. **Amalfi Salmon** (2 step) — solo prep mattina: controllo filetto + cura con Fish Salt, insalata finocchio/arancia/olive/citronette a parte. Note di servizio in `procedure`: **forno Rational programma "Salmon" 7 minuti** (non padella come da ipotesi iniziale — niente sear in padella), burro spray sulla teglia, impiattato su insalata con Salmoriglio abbondante e ciuffi di finocchio fresco.

**Pattern emerso (utile per le prossime stazioni):** il BOM da solo NON è sufficiente a dedurre il procedimento reale — più volte il metodo di cottura ipotizzato (padella, forno generico, acqua bollente) era sbagliato rispetto al metodo reale usato in cucina (programmi specifici del forno Rational, bollitura invece di forno, scongelamento in confezione invece che in acqua). Continuare a proporre come bozza di partenza ma aspettarsi correzioni sostanziali su ogni ricetta, specialmente su: metodo di cottura, temperature/programmi forno Rational, tempi, e step mancanti per scongelamento/prep di materie prime congelate.

**Prossima stazione:** Sauté Station (6 ricette individuate, non ancora iniziata): Asparagus, Artichoke Sauce, Butter Spinach, Risotto Base, SALMORIGLIO, Siciliana. (Lemon Cream esclusa — risulta archiviata/non più in uso, da confermare con Max).

**File modificati:** `js/recipe-modal.js`, `sw.js` (v424→v425). Tutto il resto solo DB (`recipe_steps`, `recipes.procedure`, migration `title_it`/`title_es`).

---

## SESSIONE 30 GIUGNO 2026 (sera) — Aggiornamento completo dei 6 file MD principali (v428, nessun bump frontend)

**Contesto:** sessione dedicata esclusivamente a rileggere e aggiornare BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md, BOH_OS_SPEC.md, BOH_OS_WARNINGS.md, BRIGADE_DB_SCHEMA.md, BRIGADE_VISION.md — erano rimasti disallineati dallo stato reale (alcuni fermi al 26-27 giugno, uno addirittura a uno stack Flutter mai esistito nello schema reale). Nessuna modifica a codice/DB in questa sessione, solo documentazione, verificata punto per punto contro `information_schema.columns`, `list_edge_functions`, `cron.job` live e contro il codice JS reale (non per sentito dire).

**Scoperte importanti emerse durante la verifica (non note prima):**
- 28 Edge Functions attive (non 14 come documentato) — incluse `bot-recipe-guardian` (nuovo bot, 7° del sistema, scansiona ricette vendute con BOM vuoto/parziale/dati mancanti, cron giornaliero 6AM CDT, scrive in office_items), `generate-briefing` (relazione con sc-nightly-brief da chiarire — girano entrambe sullo stesso cron 10:00 UTC), `pos-import`, `translate` (separata da ai-translate), `tripleseat-sync` v24, `sevenshift-sync`/`sevenshift-explore`, `rapid-worker`, `batch-translate-recipes`
- 8 cron job attivi (non documentati prima nella loro interezza): incluso `daily-reset-prep-tasks` (5:00 UTC)
- **50 tabelle hanno RLS disabilitato** — incluso `users` con `password_hash`/`pin` in chiaro, esposte a chiunque abbia la anon key. Segnalato a Max, NON risolto in questa sessione (rischio di bloccare l'app se applicato senza policy pronte) — da affrontare in sessione dedicata futura.
- `recipe_bom.component_type` è `'ITEM'`/`'RECIPE'` maiuscolo — confermato, vari file vecchi dicevano lowercase
- 7shifts: confermato da Max che resta un **workaround parziale** (CSV manuale), non un'integrazione risolta, nonostante `sevenshift-sync`/`sevenshift-explore` esistano — quelle funzioni sono solo script di diagnostica/test API (`whoami` ecc.), non importer automatici

**Correzioni importanti fatte su giudizio esplicito di Max (non solo verifica tecnica):**
- **Warning Center: va ricostruito da zero.** Il codice tecnicamente implementa quasi tutti i codici OQR del registro (verificato nel routing di vendor-documents-review.js), ma Max ha sentenziato che l'esperienza reale non funziona ("fa cagare"). BOH_OS_WARNINGS.md, BOH_OS_BACKLOG.md e BRIGADE_VISION.md sono stati corretti per non dare la falsa impressione che il modulo sia a posto solo perché il codice risponde ai codici. **Prossima sessione su questo: ripartire ascoltando da Max cosa esattamente non funziona, prima di toccare codice.**
- **Ciclo fondamentale di Brigade ridefinito:** non più sera→notte→mattina→sera con la checklist serale come motore della preplist. Il ciclo reale è **notte→mattina**: di notte bot-preplist-builder scarica il venduto POS, calcola current_stock, genera la preplist; la mattina la brigata produce. La checklist serale di chiusura esiste ancora ma è un controllo di verifica separato, non l'input della preplist. BRIGADE_VISION.md aggiornato di conseguenza — segnalata tensione concettuale sulla vecchia voce backlog "collegamento automatico checklist sera → preplist mattina", da chiarire con Max.
- **TripleSeat:** confermato fermo solo per attesa esterna (Authorize OAuth di Monica), non per lavoro mancante su Brigade — codice (tripleseat-sync v24) pronto.
- **TV Display:** confermato fatto e in produzione, non più "da costruire" — resta solo lo slideshow foto come discorso separato.
- **Fase 2 Flutter/BIOS:** confermato che è un'app gemella **in pausa, non abbandonata ma senza sviluppo attivo** — "resta un sogno" per ora, focus totale su Brigade.
- **Tela:** titolo corretto ovunque da "Kitchen Manager" a "Kitchen Operation Coordinator" nei file MD — il codice/DB usa ancora "Manager Station" come nome stazione finché il rename (già in backlog) non viene fatto.

**File modificati:** tutti e 6 i file MD principali, nessun file JS, nessun bump sw.js (nessuna modifica a codice in questa sessione).

**Lezione per sessioni future:** quando si verifica lo stato di un modulo per aggiornare la documentazione, non basta controllare che il codice "risponda" o sia "implementato nel routing" — va sempre chiesto a Max se l'esperienza reale lo soddisfa, prima di marcare qualcosa come ✅ fatto/risolto. La verifica tecnica e il giudizio di qualità sono due cose diverse.

---

## SESSIONE 30 GIUGNO 2026 (sera) — v428→v430 — Fix Edit Ingredient (measure_type / peso a pezzo)

**Contesto di partenza:** sessione dedicata al file Prep_Reference.xlsx (154 prep_tasks, logica POS↔prep, caso Calamari/Cantaloupe/Burrata — porzioni teoriche vs kg materia prima con resa/scarto). Prima di arrivare al file, Max ha segnalato un bug bloccante nell'editor ingredienti scoperto provando a editare "Lobster Tail" (screenshot allegato): il modal "Edit Ingredient" mostrava solo NAME/CATEGORY/BASE UNIT/YIELD%/NOTES — niente modo di impostare il peso del singolo pezzo per ingredienti a conteggio (`measure_type='each'`).

**Bug trovato in `js/ingredients.js` (funzione `openEditIngredient`/`saveEditIngredient`):**
- Le label HTML "AVG UNIT WEIGHT (g)" e "UNIT VOLUME (ml)" esistevano nel modal ma senza i relativi `<input>` — div vuoti, codice abbandonato a metà in una sessione precedente.
- `saveEditIngredient` leggeva `document.getElementById('editIngrWeight')` e `'editIngrVol'`, ID mai esistiti nell'HTML → sempre `NaN`.
- L'oggetto `updates` inviato al DB non includeva comunque `avg_unit_weight_g` — anche con gli input presenti, non si sarebbe salvato nulla.
- Verificato che `unit_volume_ml` **non esiste** come colonna in `ingredients` (confermato via `information_schema.columns`) — il campo "UNIT VOLUME" era morto due volte. Rimosso dal modal.

**Discussione concettuale con Max (voce, prima di scrivere codice):**
- Max ha chiarito che il peso del pezzo va scritto nell'unità che preferisce lui in quel momento (es. once, perché le code di lobster cambiano calibro) — non vuole convertire a mano in grammi. Il software deve convertire da solo.
- Max ha chiarito anche il flusso a 3 livelli che vuole arrivare a costruire (NON tutto fatto in questa sessione, solo l'ingrediente): 1) sull'ingrediente si fissa una volta "1 pezzo = X once/grammi", 2) nel BOM della ricetta si scrive "1 each" (non i grammi), 3) il prep_task/bot deve restituire un numero di pezzi interi ("scongela 2 code"), non grammi o porzioni teoriche. Verificato sul DB che oggi il BOM di "Lobster Fettucine" è già scritto come "4.5 oz" (probabilmente già corretto come quantità ma nella forma sbagliata, non "1 each") e che `prep_tasks` non ha alcun meccanismo di arrotondamento a pezzi interi. **Esplicitamente rimandato a sessione futura dedicata** — Max ha chiesto di non mescolare questo con il fix dell'editor.
- Punto importante chiarito con Max: lui voleva piena autonomia per modificare questi valori da solo in app, senza doverli dettare a voce in chat — il modal doveva essere completo e funzionante prima di chiudere la sessione su questo tema.
- Verificato (su richiesta indiretta di Max, dubbio su Frugé $27.50) che `ingredient_vendors.unit_price` per Lobster Tail è correttamente $27.50/lb (`price_type: per_lb`, `price_per_100g` calcolato giusto) — il dato DB era corretto, era solo il mockup di Claude ad aver presentato il prezzo in modo ambiguo (sembrava un totale invece che un prezzo unitario). Nessun fix DB necessario qui, solo attenzione alla presentazione nel modal.

**Fix implementato e pushato (`js/ingredients.js`, due push):**
1. Aggiunto campo "PESO DI UN PEZZO" funzionante: input numerico + selettore unità (oz/g/lb, default oz), mostra sempre il valore già salvato convertito nelle tre unità per riferimento. Se il campo viene lasciato vuoto al salvataggio, il valore esistente NON viene toccato (niente azzeramenti accidentali). Conversione riusa la costante esistente `UNIT_CONVERSIONS` già presente nel file (lb:453.592, oz:28.3495) invece di duplicarla.
2. Rimosso "BASE UNIT" dal modal (su richiesta esplicita di Max — "fai sparire quella cosa che non capisco") — il campo resta nel DB invariato, semplicemente non è più editabile/visibile da questo editor.
3. Aggiunto "MEASURE TYPE" (each/weight) al posto di BASE UNIT — è il campo che decide se l'ingrediente si conta a pezzo o a peso.
4. Aggiunto riquadro "VENDOR / PACK" in sola lettura (vendor, pack_description, prezzo per unità d'acquisto) per dare contesto senza permettere modifica da qui (i prezzi fornitore restano editabili solo dalla riga vendor dedicata).
5. **Bug trovato DOPO il primo push** (segnalato da Max): la lista ingredienti e la scheda dettaglio continuavano a mostrare "g" anche per Lobster Tail dopo il salvataggio corretto (verificato su DB: salvataggio era OK, `measure_type='each'`, `avg_unit_weight_g=127.57`). Causa: la UI di lista/dettaglio leggeva solo `base_unit` (che non viene più toccato, resta sempre "g") e ignorava `measure_type`. Fix: lista ora mostra "each" se `measure_type==='each'` altrimenti `base_unit`; scheda dettaglio mostra "each · [peso]g/pz" invece di "g · each" ridondante. Aggiunta `avg_unit_weight_g` alla query SELECT della scheda dettaglio (mancava, quindi non sarebbe mai apparso anche col fix di visualizzazione).

**Stato finale verificato su DB:** Lobster Tail → `measure_type: "each"`, `avg_unit_weight_g: 127.57` (= 4.5oz), `yield_factor: 1.0` (non toccato in questa sessione).

**Versioni:** v428 → v429 (fix editor) → v430 (fix visualizzazione lista/dettaglio). File modificato: solo `js/ingredients.js` + `sw.js`. Nessuna migration DB necessaria — tutte le colonne usate (`measure_type`, `avg_unit_weight_g`, `yield_factor`) esistevano già nello schema.

**Aperto per sessione futura dedicata (NON iniziare senza che Max lo chieda esplicitamente):**
- BOM delle ricette scritto in "each" invece che in once/grammi per ingredienti a conteggio (caso pilota: Lobster Tail su "Lobster Fettucine", oggi "4.5 oz" invece di "1 each").
- `prep_tasks` deve poter arrotondare a pezzi interi quando l'ingrediente collegato è `measure_type='each'` (oggi non esiste questo meccanismo — il bot/prep ragiona sempre in grammi o porzioni teoriche, mai in "code", "uova", ecc.).
- Stesso filo logico delle prep Calamari/Cantaloupe/Burrata discusse a inizio sessione (porzioni teoriche vs kg materia prima con resa/scarto) — sono la stessa famiglia di problema, da affrontare insieme quando Max avrà tempo di andarci con calma.

**Nota:** sessione svolta in parallelo con un'altra sessione di Max sul Kitchen Display/gestione foto — verificato live sw.js prima di ogni push (mai conflitti in questa sessione, nessuna sovrapposizione di file toccati).



---

## SESSIONE 30 GIUGNO 2026 (tarda sera) — Tentativo sync foto iCloud per Kitchen Display — ABBANDONATO su richiesta Max

**Contesto:** Max voleva mostrare le foto dei piatti su Kitchen Display (`display.html`), prendendole da un Album Condiviso iCloud (per non dover caricare foto manualmente). Esplorato in dettaglio.

**Cosa è stato provato:**
- Max ha creato un album condiviso e mandato il link nuovo formato Apple (giugno 2026): `https://photos.icloud.com/shared/album/<TOKEN>` — diverso dal vecchio formato `icloud.com/sharedalbum/#TOKEN` usato da tutte le librerie/script community esistenti.
- Creata tabella `kitchen_display_photos` (poi droppata) e Edge Function `icloud-photos-sync` (deployata, v1, mai schedulata su cron) che tentava di chiamare il vecchio endpoint reverse-engineered `p23-sharedstreams.icloud.com/<TOKEN>/sharedstreams/webstream`.
- **Test reale via `net.http_post` + log su `net._http_response`: risposta HTTP 404.** Confermato che il nuovo formato di link (`photos.icloud.com/shared/album/...`, introdotto nel redesign Apple di giugno 2026 per supporto Android/Windows — vedi MacRumors 8 giugno 2026) **non è compatibile con il vecchio endpoint `sharedstreams.icloud.com`**. Nessuna documentazione community trovata per il nuovo endpoint (troppo recente).
- Tentato di individuare il nuovo endpoint ispezionando il bundle JS della pagina via web_fetch — non praticabile (SPA, JS non eseguito da web_fetch, solo HTML/markdown estratto).
- Proposto a Max di usare Safari Web Inspector (da Mac, via cavo USB con iPhone) per intercettare la chiamata di rete reale e scoprire l'endpoint — Max non ha un Mac comodo a disposizione, non perseguito.

**Decisione di Max: ABBANDONATO il discorso iCloud per ora.** Non vuole occupare storage Supabase (avrebbe richiesto il piano B con upload manuale + Supabase Storage bucket, scartato per lo stesso motivo — voleva la foto "gratis" via iCloud, non un upload che consuma storage Supabase).

**Cleanup eseguito:**
- Tabella `kitchen_display_photos` → **droppata** (`DROP TABLE`)
- Edge Function `icloud-photos-sync` → resta deployata su Supabase ma **inerte**: nessun cron job creato, nessuna chiamata da `display.html` o altri file, non consuma risorse né causa effetti. Non rimossa solo perché lo strumento disponibile non permette delete di Edge Function, ma è sicura da ignorare. **Se in futuro si riprende questo discorso, ripartire da qui — non ricreare da zero.**
- **`display.html` non è stato toccato in nessun modo** — nessuna modifica, nessun bump sw.js. Resta identico a prima di questa sessione (slideshow foto NON presente, come da richiesta esplicita di Max: "non mettere niente, lascia tutto com'era prima").

**Se si riprende in futuro:** prossimo passo naturale sarebbe verificare l'endpoint reale del nuovo formato `photos.icloud.com/shared/album` via Safari Web Inspector (richiede Mac + cavo USB con iPhone, vedi istruzioni date a Max in questa sessione) prima di scrivere altro codice. In alternativa, riconsiderare il piano B (upload manuale + Supabase Storage) se Max cambia idea sul tema storage.

**File modificati:** nessuno. Solo Edge Function deployata (inerte) + tabella creata e poi droppata.

---

## SESSIONE 30 Giugno 2026 — Inventario completo prep_tasks

**Cosa è stato fatto:**
- Inventario fisico completo di tutte le stazioni — fogli compilati a mano da Max e fotografati
- `current_stock` aggiornato su ~90 prep_tasks da zero (era tutto NULL tranne pochi test)
- Unità corrette su vari item (vedi sotto)
- 2 nuovi prep_tasks creati: `Shrimp` (Pasta Station, g) e `Lamb` (Table Side, pezzi)
- Lista stampabile inventario generata come HTML (pagina bianca, scritte nere, divisa per stazione)

**Correzioni unità applicate:**
- Chicken Parmesan: `g` → `pezzi` (16 pz)
- Brownies: `pezzi` → `g` (568g)
- Mint bavarese: `g` → `pezzi` (60 pz)
- Grilled Chicken: `kg` → `g` (4838g)
- Ranch: `kg` → `g` (5398g)
- Honey: `squeezer` → `g` (398g)
- Cantaloupe: `porzioni` → `g` (1308g)
- Pancetta: `porzioni` → `g` (1307g)
- Gnocchi: `porzioni` → `g` (3982g)
- Tempura: `batch` → stock in g (695g) — unità ancora `batch`, da allineare
- Artichoke: rimane `pezzi` (29 pz) — 2 pz per porzione, conversione da fare nel bot

**Item trovati nel DB ma mancanti dal foglio stampato (prep_type = NULL):**
- Fettuccine (id 313): `nests`, recipe_id presente MA punta a `SPAGHETTI FRESH PASTA` — ERRORE
- Spaghetti (id 314): `nests`, stessa recipe_id di Fettuccine — probabile errore di collegamento
- Gnocchi (id 388): nessuna recipe collegata
- Tutti e tre con `prep_type = NULL` → bot li ignora, non apparivano sul foglio stampato

**DA FARE — PROSSIMA SESSIONE (priorità):**
1. Verificare e correggere recipe_id di Fettuccine (id 313) — trovare `FETTUCCINE FRESH PASTA` nel DB e collegare
2. Verificare recipe_id Spaghetti (id 314) — stesso problema
3. Impostare `prep_type = 'supporto'` su Fettuccine, Spaghetti, Gnocchi
4. Lasagne: struttura da definire (monoporzione vs teglia 6 porzioni) — SKIP per ora
5. Parm chunk: da classificare (grated o shaved) — SKIP per ora, non inserito nel DB
6. Lista stampabile: correggere filtro per includere item con `prep_type = NULL`
7. Correggere unità Tempura da `batch` a `g`
8. Discutere logica bot per Artichoke (pezzi vs porzioni, 2 pz = 1 porzione)

**Note operative:**
- Item barrati in verde sul foglio (Cook Focaccia, Lemon cream, Lemon sliced, Risotto Base, Season Focaccia) = non disponibili oggi, current_stock lasciato NULL — non eliminare dal DB
- Spinach (Manager Station) barrato = lasciato NULL
- Plating Station (Lemon Zest, Orange supreme) = non contati, NULL
- Max: "tutto in grammi, mai in chili tranne se è 1 punto qualcosa"

---

## SESSIONE 30 GIUGNO 2026 (sera) — Inventario reale + allineamento unità + ricette Saucier Station

**Versione:** v430 (nessun bump frontend — solo DB)
**Contesto:** prima sessione con inventario fisico reale inserito. Obiettivo: allineare unità di misura dei prep_tasks con quello che il cuoco vede fisicamente, e pulire i suggerimenti fittizi del bot.

---

### Principio fondamentale stabilito da Max (OQR Philosophy)

> "L'unità di inventario deve essere quello che il cuoco vede e conta fisicamente nel frigo/in cucina."

- **Grammi** → tutto quello che si pesa sulla bilancia
- **Pezzi** → tutto quello che si conta (salmon cakes, chicken parm, artichoke, lobster...)
- **Cup/porzioni** → solo quando il cuoco vede fisicamente quella unità (es. spinaci in cup da 80g)
- **Buste** → solo per item confezionati contabili (es. Soffritto Livornese)
- MAI "porzioni" come unità astratta — non è qualcosa che si pesa o conta fisicamente

**Il modello a 3 livelli definito con Max:**
1. **INVENTARIO** → grammi o pezzi (quello che il cuoco misura/conta)
2. **BOT NOTTURNO** → legge grammi/pezzi, calcola fabbisogno, dice **quanti batch fare** in linguaggio cucina (es. "2 latte di pelati", "3 batch interi") — sempre arrotondato **su**, mai frazioni
3. **PREP CARD** → il cuoco vede batch da fare, li fa, conferma i batch completati

---

### Operazioni DB eseguite

**1. Azzeramento suggerimenti bot fittizi**
- `suggested_qty`, `suggested_note`, `suggested_at`, `suggested_by` → NULL su tutti i 91 prep_tasks con suggerimenti
- `current_stock` intatto — è l'inventario reale inserito oggi
- Stanotte il bot ricalcola tutto da zero partendo dallo stock reale

**2. Oven Station — unità corrette**

| Item | Da | A | Note |
|---|---|---|---|
| Brussels sprouts | porzioni | g | già grammi nel current_stock |
| Calamari | porzioni | g | già grammi nel current_stock |
| Onion rings | porzioni | g | già grammi nel current_stock |
| Rosmary potatoes | porzioni | g | già grammi nel current_stock |
| Tempura | batch | checklist | prep_type=checklist, daily_reset=true, current_stock=NULL — si fa ogni mattina, si butta la sera |

**Decisioni Oven Station (da Max):**
- Artichoke → pezzi ✅ — ricetta scarica anche Artichoke Sauce (g)
- Brussels sprouts → g, no batch fisso (si può fare liberamente)
- Calamari → g — ricetta scarica anche Arrabbiata (g)
- Chicken Parmesan → pezzi ✅ — ricetta scarica: Arrabbiata + Mozzarella + 1 nest Spaghetti + Arrabbiata per spaghetti
- Pull Salmon filets → pezzi ✅ (annotato: appartiene a Oven Station, confermato)
- Tempura → checklist giornaliera automatica, niente stock

**3. Pasta Station**
- Diced butter → `porzioni` → `g` (current_stock 2238 era già grammi) ✅

**4. Saucier Station**
- Soffritto Livornese → `buste` ✅ (current_stock 2 buste confermato)

**5. Texana Soup — ricetta completa inserita**
- Ricetta esisteva nel DB vuota (solo pos_name). Completata:
  - `base_servings=9`, `base_weight_g=2520`, `serving_weight_g=280`, `menu_group=Soups`, `category=ZUPPE`, `shelf_life_days=5`, `prep_time_minutes=40`
  - Nuovo ingrediente creato: **Chicken Broth** (id `cb07f823-1661-4c60-8305-030cd649c98e`, categoria Prepared, fatto in casa)
  - BOM: Bacon 454g, Pork Sausage 454g, Chicken Broth 1200g, Heavy Cream 960g, Potatoes 680g, Gold Onion 150g, Garlic 10g, Spinach 250g
  - 6 recipe_steps IT/EN/ES con timer: Cuoci bacon/salsiccia (5min) → Prepara patate → Bolli in brodo (10min) → Soffriggi cipolla/aglio (7min) → Unisci e finisci (13min) → Porziona in buste 200g solidi + 80g liquido
  - Porzione = 280g (200g solidi + 80g liquido) — in buste

**6. Thyme Butter — base_weight_g corretto**
- Era `450000g` (errore inserimento). Corretto:
  - `base_servings=24`, `base_weight_g=484` (1 lb burro + 30g timo), `serving_weight_g=20`, `shelf_life_days=30`

**7. Brisket — ricetta dedicata creata**
- Creata ricetta "Brisket" (id `90e0ec76-f2c4-4fa8-ad85-d30bdd86f395`)
  - `base_servings=1`, `base_weight_g=2000`, `category=SECONDI|supporto`, `menu_group=Bases`, `shelf_life_days=5`
- prep_task Brisket (id 285) collegato alla nuova ricetta (era collegato a Beef Ravioli — sbagliato)
- BOM e steps da aggiungere in sessione futura quando Max ha la ricetta completa

**8. Truffle Butter — base_weight_g impostato**
- `base_weight_g=20`, `serving_weight_g=20` (20g per porzione di Truffle Fettuccine)
- Il bot ora scarica 20g per ogni Truffle Fettuccine venduta

---

### Priorità prossima sessione su questo tema

1. **Salad Station** — unità da verificare e correggere (molti item con "porzioni" o unità astratte)
2. **Pastry Station** — stessa cosa
3. **Sauté Station** — unità + ricette steps mancanti
4. **Manager Station** — Confit tomatoes (ricetta mancante), Flowers (BOM), Spinach (cup vs g)
5. **Spinaci** — chiarire unità: Max ha confermato che gli spinaci vanno a **cup** (ogni cup = 80g, dalla ricetta Butter Spinach). Il bot deve sapere che 1 cup = 80g e ragionare in cup nell'inventario
6. **Bot logic** — una volta che tutte le unità sono allineate, riscrivere la logica di conversione grammi→batch nel bot-preplist-builder (priorità già in backlog)
7. **Brisket** — BOM e recipe_steps da completare
8. **Fresh Pasta Station** — Grated Pecorino e Parmesan Grated hanno unità g ma il bot ragiona in batch astratti (no ricetta collegata)

---

### Note operative importanti
- Il bot gira stanotte alle 4AM CDT — primo calcolo su dati reali
- Tutti i current_stock inseriti oggi (30/06) sono dati reali, primo inventario fisico completo
- Dati pre-30/06 erano test/fittizi — ora tutto è reale
- sw.js NON bumpato in questa sessione (nessuna modifica a file frontend)


---

## SESSIONE 30 GIUGNO 2026 (tarda sera) — Fresh Pasta Station + Bot v20 + Arrabbiata ricalcolata

**Versione:** v430 frontend (nessun bump — solo DB + Edge Function)
**Bot:** bot-preplist-builder v20 (Supabase version 39)

---

### Fresh Pasta Station — completata ✅

**Fettuccine (prep_task id 313):**
- Collegato a `FETTUCCINE FRESH PASTA` (era erroneamente collegato a SPAGHETTI FRESH PASTA)
- `base_weight_g = 3500`, `base_servings = 25`, `serving_qty = 2`, `serving_unit = nests`
- `prep_type = supporto` impostato
- Spolvero (Semolina 500g, bom_id 1525) rimosso dal BOM

**Spaghetti (prep_task id 314):**
- Già collegato a `SPAGHETTI FRESH PASTA` ✅
- `base_weight_g = 3500`, `base_servings = 20`, `serving_qty = 2`, `serving_unit = nests`
- `prep_type = supporto` impostato
- Spolvero (Semolina 500g, bom_id 1720) rimosso dal BOM
- BOM pulito: Liquid Egg 1kg + Semolina 2.3kg + Caputo Flour 200g

**Gnocchi (prep_task id 388):**
- Collegato a `GNOCCHI` (id `c3836a65-d74d-47ac-8944-ad439f76200f`)
- `base_weight_g = 2000`, `base_servings = 10`, `serving_weight_g = 200`, `shelf_life_days = 30` (congelati)
- `pos_name = 'Shrimp Gnocchi|Gnocchi'` — scarica sia da piatto che da modifier
- `prep_type = supporto`, `unit = g`
- Spolvero (Flour 200g + Semolina 100g, bom_id 1728/1729) rimosso dal BOM
- BOM pulito: Water 1200g + Gnocchi Flour 800g + Nutmeg 4g

**Grated Pecorino (prep_task id 438):**
- Nuova ricetta creata: `Grated Pecorino` (id `27213a2e-e8fd-4100-9fb8-4ebf57cfab1e`)
- `base_weight_g = 7000`, `base_servings = 1`, `shelf_life_days = 7`
- Prep_task collegato ✅

**Parmesan Grated (prep_task id 439):**
- Nuova ricetta creata: `Parmesan Grated` (id `6357c9f1-f944-4153-8d7f-afb11336d91a`)
- `base_weight_g = 7000`, `base_servings = 1`, `shelf_life_days = 7`
- Prep_task collegato ✅

**Regola confermata da Max:** entrambi i formaggi si grattano in batch da 7kg per volta.

---

### Arrabbiata — ricalcolata su latta #10 Global Gourmet

- Fornitore vecchio: latte da 2550g → **nuovo: latte #10 da 2950g** (Global Gourmet Foods "La Carmela")
- Batch ricalcolato su **1 latta #10** (unità minima):
  - `base_weight_g = 3185`, `base_servings = 12`, `serving_weight_g = 265`
  - BOM aggiornato: Canned Tomatoes 2950g, Garlic 52g, EVOO 145g, Red Flakes 1g, Parsley 58g, Salt 38g, Sugar 12g, Water 1156g
- Vendor Global Gourmet inserito per Canned Tomatoes: `pack_description = '6/#10 cans "La Carmela"'`, `conversion_to_base = 17700`, `unit_price = 35.00`

**Fattura Global Gourmet Foods letta (invoice #20404, 5/26/2026, $1,859.07):**
Contiene anche: EVOO 3/5lt "Oleoestepa", Pecorino Toscano Fresco DOP, Pecorino Romano "Monti Trentini", Carnaroli Rice, Bresaola, Prosciutto Italiano, Sea Salt Coarse/Fine, Gnocchi C-Catering "Molino Pasini", GF Veal Rib Chops. Parser Global Gourmet ancora da costruire (vedi BOH_OS_BACKLOG.md).

---

### Bot-preplist-builder v20 — nuova logica linguaggio cucina

**Deployato come Supabase version 39.**

**Novità rispetto a v19b:**

1. **Linguaggio cucina reale per tipo:**
   - `unit = pezzi/pz/buste` → conta fisica (es. "22 pezzi", "3 buste")
   - `serving_unit = nests` → pasta fresca in nests (es. "50 nests"), arrotondato a batch interi
   - Salse con `pack_description` su vendor → usa il pack (es. "3 × 6/#10 cans La Carmela")
   - Tutto il resto → kg/g arrotondati a batch interi

2. **Guard anomalie:** salta task con `base_weight_g > 500000` (placeholder mostruosi) invece di produrre numeri assurdi. Logga `[SKIP-ANOMALY]` per debug.

3. **Carica vincoli acquisto:** per ogni ricetta legge il `pack_description` del primo ingrediente con vendor attivo — usato nel testo suggerimento.

4. **Arrotondamento sempre su** a batch interi (invariato da v19b).

**Fix dati anomali eseguiti contestualmente:**
- Brussels sprouts: `base_weight_g = 1500000` → corretto a `1500` (10 porzioni × 150g)
- Croutons: `base_weight_g = 15` (placeholder) → impostato a NULL (bot skippa, da correggere con valore reale)

---

### DA FARE — priorità prossima sessione

1. **Croutons** — `base_weight_g` da inserire (quanto pesa un batch reale di croutons?)
2. **Salad Station + Pastry Station** — unità da verificare (molti item ancora in "porzioni")
3. **Sauté Station** — unità + ricette steps mancanti
4. **Cacio e pepe sauce** — Milk non ha vendor/pack nel DB (1 gallone = 3785g) — da inserire
5. **EVOO** — nessun vendor nel DB (Global Gourmet: 3/5lt per case = 15lt = ~13800g) — da inserire
6. **Pomodoro sauce** — ingrediente driver è Onions (sbagliato per vincolo acquisto) — il vero driver è Canned Tomatoes, stessa latta dell'Arrabbiata — da correggere BOM sort_order
7. **Ground Beef** — pack aggiornato a 10lb = 4536g ✅ ma Ragu ha `base_weight_g = 13700` → bot dirà "fai 13.7kg" — verificare con Max se il testo ha senso o serve pack_description HEB
8. **Verifica bot domani mattina** — controllare log in L'Ufficio dopo run 4AM CDT, verificare che i testi siano leggibili dai cuochi

---

### Note tecniche
- sw.js NON bumpato (nessuna modifica frontend)
- Tutti i dati sono reali da oggi 30/06 — primo inventario fisico completo
- bot-preplist-builder gira alle 4AM CDT ogni notte (cron `0 9 * * *` UTC)


---

## SESSIONE 1 LUGLIO 2026 (mattina) — Bot v21 + audit + fix shelf life + Pears

**Versione:** v430 frontend (nessun bump)
**Bot:** bot-preplist-builder v21 (Supabase version 40)

---

### Bot v21 — fix fallback unità

Problema identificato in v20: item con `unit='g'` senza ricetta collegata mostravano "porz" nel testo invece di kg/g.

**Fix in v21:**
- Nuovo blocco in `smartQty`: se `unit='g'` e nessun `base_weight_g` → mostra direttamente in kg/g via `fmtGrams()`
- Fallback finale ora mostra `numero + unità raw` invece di "porz"
- Aggiunta `SKIP_PACK` set: ricette dove il primo ingrediente BOM non è il driver acquisto rilevante (Bechamel, Thyme Butter, Texana Soup, Rosemary Oil, Citronette, Salmoriglio, Mash Potato, Garlic Oil) → non usa pack_description per queste

**Risultati post-v21:**
- Calamari → "2.2kg" ✅
- Brussels sprouts → "4.5kg" ✅  
- Croutons → "789g" ✅
- Texana Soup → "fai 5kg" ✅
- Siciliana cartoccio → "fai 4 cartocci" ✅

**Fix dati contestuali:**
- `Spring mix` → unit cambiata da 'porzioni' a 'buste' (il cuoco conta le buste)
- `Confit tomatoes` → current_stock = NULL (stock 0 senza ricetta → bot skippa)

---

### Audit bot v21 — risultati 1 luglio

**🔴 Prepara oggi:**
- Chicken Parmesan: 9 in casa → fai 16 pezzi (Mer5+Gio6+Ven11.7=22.7 × 1.1 = 25, mancano 16) ✅ corretto
- Thaw Lobster: 0 in casa → fai 15 pezzi (dopo fix shelf_life=2gg: Mer6.7+Gio8.3=15) ✅
- Cheesecake: 0 in casa → fai 72 pezzi (7gg × vendite = 3 batch da 24) ✅
- Creme Brulee: 0 in casa → fai 48 pezzi (6gg × vendite = 3 batch da 16) ✅
- Pears: 2 in casa → fai 16 pezzi ✅
- Thyme Butter: 0 → fai 484g ✅

**🟡 Domani:**
- Texana Soup: 3.7kg → fai 5kg
- Siciliana cartoccio: 8 cartocci → fai 4 cartocci
- Garlic oil: 600g → stock basso

**🟢 OK:** 86 task restanti tutti in kg/g/pezzi leggibili

---

### Shelf life aggiornate

| Ricetta | Shelf life | Note |
|---|---|---|
| Lobster Fettucine | 2 gg | scongelata, deperibile rapido |
| Cheesecake | 7 gg | si fa una volta a settimana |
| Crème Brûlée | 6 gg | — |
| Pear & Pecorino Salad | 3 gg | — |

---

### Pears — logica corretta

- 1 pera = 4 porzioni di Pear & Pecorino Salad
- Aggiornato: `base_servings=4`, `serving_qty=1`, `serving_unit='pezzi'`
- `pos_name` corretto da 'Pere E Pecorino Salad' → 'Pear & Pecorino Salad' (allineato al POS)
- Il bot ora calcola: 1 salata venduta = 0.25 pere consumate

---

### DA FARE — priorità prossima sessione

1. **Salad Station** — molti item ancora in unità astratte (porzioni, wedge, 9pan) — completare allineamento
2. **Pastry Station** — Chopped dark/white choc, Mint liquid, Cocoa powder, Powder sugar → stock 1g = placeholder, da azzerare o misurare reali
3. **Cacio e pepe sauce** — Milk senza vendor/pack (1 gallone = 3785g) — da inserire
4. **EVOO** — nessun vendor (Global Gourmet: 3/5lt per case) — da inserire  
5. **Pomodoro sauce** — ingrediente driver è Onions (sbagliato), il vero driver è Canned Tomatoes — correggere sort_order BOM
6. **Chicken Parmesan shelf_life** — non impostato, usa default 3gg — verificare con Max
7. **Croutons** — base_weight_g ancora NULL (bot skippa) — chiedere a Max peso batch reale
8. **Brisket** — BOM e recipe_steps da completare
9. **Verifica vendite Pear & Pecorino** — pos_name era sbagliato, potrebbero esserci 0 dati storici — verificare dopo prossimo run bot


---

## SESSIONE 1 LUGLIO 2026 (mattina/pomeriggio) — v430→v431 — Audit bot, fix dati, Bot Config UI

**Versione:** v431 frontend, bot-preplist-builder v22 (Supabase version 41)

---

### Cosa è stato fatto

**1. Salad Station — unità corrette**
- Shredded Carrots, Sliced Mozzarella, Sliced Tomatoes → `g` (erano "porzioni")
- Seed mix → `g` (era "contenitore", stock 230g confermato)
- Pecorino fresh wedge → `g` (26 wedge × 10g = 260g, 1 pecorino = 100 wedge, 2 pecorini = 4.39 lb)
- Romaine → `g`, `recipe_id=NULL` (bot calcola da BOM di tutte le ricette che usano Romaine)
- "Pere E Pecorino Salad" → `pos_name=NULL` (disattivata, "Pear & Pecorino Salad" è quella attiva)
- Spring mix → `current_stock=NULL` (bot skippa)
- Mini Caesar Salad → `base_servings=8` (1 contenitore = 8 porzioni Caesar)

**2. Pastry Station**
- Chopped dark/white choc, Cocoa powder, Mint liquid, Powder sugar → `current_stock=NULL`
- Shelf life impostate su ricette: Cheesecake/Creme brulee/Panna cotta 7gg · Tiramisu/Italian cream 4gg · Cremino/Mimosa/GF sponge cake 30gg · Mint Bavarese NULL (da confermare)
- Cheesecake → `base_servings=12` (era 24, corretto da Max)

**3. Dati ricette completati**
- Calamari: `base_weight_g=1800`, `base_servings=12`, `serving_weight_g=150` (1 busta 2.5lb → 1800g prodotto finito)
- Rosemary Potatoes: `base_weight_g=3200`, `base_servings=20`, `serving_weight_g=160`
- Salmon Cakes: `base_weight_g=2985`, `base_servings=13`, `serving_qty=3`, `serving_unit=pezzi` (totale BOM reale)
- Croutons: `base_weight_g=1080`, `base_servings=72`, `serving_weight_g=15` (da ricetta fisica: 1000g pane + condimenti). BOM aggiornato con valori reali dalla ricetta.
- Artichoke: `serving_qty=2`, `serving_unit=pezzi` (2 carciofi per porzione — visibile nel BOM come "Artichokes 2 each")

**4. Vendor inseriti**
- Milk → Walmart, 1 gallon = 3785g, $3.32
- EVOO → Global Gourmet Foods, 3/5lt "Oleoestepa", $32.80/case, 15kg
- Pomodoro Sauce BOM → Canned Tomatoes portato a sort_order=0 (driver corretto per vincolo acquisto)

**5. Shelf life completate**
- Salmon Cakes 7gg · Garlic Oil 4gg · Rosemary Oil 15gg · Maccheroni fresca 30gg · Croutons 30gg · Mushrooms 30gg · Ragù 30gg · Bechamel 5gg · Demi 7gg · Artichoke Sauce 3gg

**6. Ricette Salmon/Scallops**
- Ricetta "Salmon Whole" creata: `pos_name='Add salmon whole|add salmon whole|add salmon|Add salmon'`, `serving_qty=1`, `serving_unit=filetto`, `shelf_life_days=2`. Collegata a prep_task "Pull Salmon filets" (id 278). Risolve il falso positivo modifier→Salmon Cakes.
- Scallops Chefs Way: `pos_name='Scallops Chefs Way|Scallops'`, `serving_qty=4`, `serving_unit=pezzi`
- Scallops Asparagus Gnocchi: `pos_name='Scallops Asparagus Gnocchi|Scallops add on'`, `serving_qty=3`, `serving_unit=pezzi`
- Prep_task Scallops (id 279) collegato a "Scallops Chefs Way"

**7. Spinach (id 318)**
- Collegato a ricetta "BUTTER SPINACH", `unit=cup`, `serving_weight_g=80`, `serving_unit=cup`, `serving_qty=1`
- Regola confermata da Max: il cuoco conta le cup nel frigo. 1 cup = 80g. Bot legge dalla ricetta.
- PROBLEMA: Butter Spinach usa "Fresh Spinach" nel BOM, non "Spinach" — sono due ingredienti separati nel DB. Il bot v22 trovava "Spinach" solo in Texana Soup (250g) producendo numeri assurdi. Fix: collegamento diretto ricetta risolve il problema per il prep_task Spinach.

**8. Romaine**
- `unit=g`, `recipe_id=NULL`, `current_stock=0`
- Bot v22 calcola consumo da BOM di tutte le ricette che usano l'ingrediente Romaine (Caesar, Mediterranean, Parmesan Nest Caesar)
- Suggerisce 954g — circa 1.5 cespi (1 cespo = 626g, già in `ingredients.avg_unit_weight_g`)

**9. Bot-preplist-builder v22 deployato (Supabase version 41)**
Fix rispetto a v21:
- **Salmon Cakes bug risolto**: quando `unit=pezzi` e `serving_qty>0`, bot calcola `avg * serving_qty` (pezzi fisici) invece di grammi. Poi `finalSuggested = Math.ceil(pezzi / baseServings) * baseServings`
- **Romaine/ingredienti senza recipe_id**: nuovo percorso — bot cerca ingrediente per nome del task in `ingredients`, poi somma consumo da tutte le ricette nel BOM che lo usano
- **SKIP_PACK** aggiornato: aggiunta "Salmon Whole"

**10. Bot Config UI — v431**
- Aggiunta sezione "🤖 BOT CONFIG" nel modal edit prep_task (`js/admin-prep.js`)
- Campi: "Nel frigo conto..." (unit), "1 [unità] pesa (grammi)" (conversione, visibile solo se unit≠g), "Dura... (giorni)" (shelf_life), "Il bot dice..." (read-only, ultimo testo IT)
- Si popola automaticamente da ricetta collegata (shelf_life_days, serving_weight_g)
- Salva: unit su prep_task, shelf_life_days + serving_weight_g su ricetta collegata

---

### Bug noti aperti — PRIORITÀ PROSSIMA SESSIONE

**1. 🔴 Bot v23 — "good through Wednesday" quando stock=0 (oggi è mercoledì)**
Il bot mostra il giorno di copertura dello STOCK ATTUALE (0 giorni = oggi) invece del giorno raggiunto CON il batch suggerito. Fix: quando `currentStock=0` o insufficiente, "good through X" deve calcolare partendo dal batch suggerito, non dallo stock attuale.

**2. 🔴 Bot v23 — bot deve leggere il BOM per pezzi, non serving_qty**
Artichoke: il BOM dice già "Artichokes 2 each" per porzione. Il bot deve leggere il BOM per sapere quanti pezzi fisici consuma ogni vendita, invece di affidarsi a `serving_qty` sulla ricetta (che è un workaround). Architettura corretta: BOM è la fonte di verità per il consumo.

**3. 🟡 Traduzione unità — "pezzi" in EN/ES**
"make 33 pezzi" → deve essere "make 33 pieces" (EN) / "haz 33 piezas" (ES). Il bot costruisce il testo con l'unità raw del task senza tradurla.

**4. 🟡 Lamb (Table Side, id 471) — suggested_qty=1352 pezzi**
Stesso bug Spinach/Scallops: bot cerca "Lamb" nel BOM di altre ricette e trova grammi, produce numero assurdo. Da collegare a ricetta o escludere. Quante costolette per porzione? (da chiedere a Max)

**5. 🟡 Honey (Salad Station) — suggested_qty=2389g**
Il bot suggerisce 2.4kg di miele. Honey non ha ricetta collegata e il bot v22 trova "Honey" nel BOM di qualcosa e somma tutto. Da verificare/escludere.

---

### Concetti fondamentali stabiliti oggi (NON ridiscutere)

**Regola unità fisiche (stabilita da Max, terza volta — non dimenticare mai più):**
> "L'unità di inventario deve essere quello che il cuoco vede e conta fisicamente nel frigo/in cucina."
- Grammi → si pesa sulla bilancia
- Pezzi → si conta (salmon cakes, chicken parm, artichoke...)
- Cup → si conta la cup (spinaci, porzioni pre-porzionate)
- Buste → si conta la busta (soffritto livornese, spring mix)
- MAI "porzioni" come unità astratta

**Il bot deve leggere il BOM, non serving_qty:**
- Artichoke BOM dice "2 each" → bot sa che 1 vendita = 2 pezzi
- serving_qty è un workaround da eliminare in v23

**Bot Center — da costruire nella prossima sessione dedicata:**
Schema approvato da Max: L'Ufficio → sezione "🤖 Bot" → lista 7 bot → clicco → scheda con:
1. Identità (cosa fa, quando gira, stato)
2. Ultima run (log leggibile)
3. Configurazione editabile (SKIP_PACK, soglie, buffer%)
4. Trigger manuale con risultato live
Partire da Bot 3 (Preplist Builder) come primo bot.

**Interfaccia editabile ricette — serving_qty visibile:**
Il campo "Per ogni porzione venduta uso... [N] [unità]" deve essere visibile e modificabile nell'editor ricetta. Oggi non esiste nell'UI — Max non ha modo di verificare o correggere senza passare da Claude. Da aggiungere in prossima sessione.

---

### Nota per sessioni future
Max lavora su più chat in parallelo. Oggi ha aperto una chat separata per il Bot Center (partendo dallo schema definito qui sopra). Verificare versione live sw.js prima di qualsiasi push.

---

## SESSIONE 1 LUGLIO 2026 (pomeriggio) — v447→v448 — Fix stock prep + Timer Bar persistente

**Versione:** v448 frontend
**File modificati:** `js/prep.js`, `js/recipe-modal.js`, `js/init.js`, `sw.js`

---

### Fix 1 — v447: current_stock sommato invece di sovrascritto

**Bug:** quando un cuoco segnava DONE su una prep con quantità prodotta (es. +40 cremino cake), il sistema sovrascriveva `current_stock = qty` invece di sommarlo allo stock esistente. Risultato: lo stock precedente veniva azzerato.

**Fix in `js/prep.js` — 3 punti:**
- `suggestedSave`: `current_stock: qty` → `current_stock: (parseFloat(it.current_stock)||0) + qty`
- `detailSave`: stesso fix
- `_finishTask` (stato locale): `tasks[id].current_stock = qty` → `tasks[id].current_stock = (parseFloat(tasks[id].current_stock)||0) + qty`

**Regola:** quando il cuoco conferma una prep completata, la quantità prodotta si AGGIUNGE allo stock esistente, non lo sostituisce.

---

### Fix 2 — v448: Timer Bar persistente (sopravvive alla navigazione)

**Bug segnalato dalla brigata:** avviando un timer in una ricetta/step e poi navigando ad altra pagina, il timer si resettava. Non era possibile cucinare multi-task (es. avviare il soffritto e andare a controllare un'altra ricetta).

**Architettura nuova:**

- `window._timerState{}` — oggetto globale persistente (non muore mai durante la sessione). Contiene per ogni timer attivo: `totalSecs`, `startedAt` (timestamp reale), `meta` (taskName, stepTitle, prepTaskId, recipeId).
- `timers{}` — interval handles locali al modal (DOM only). Vengono distrutti alla navigazione ma non portano con sé lo stato.
- `startTimer(key, secs, onTick, onDone, meta)` — salva in `_timerState` + avvia interval locale.
- `stopTimer(key)` — ferma solo l'interval locale, **NON cancella `_timerState`** — il timer continua in background.
- `stopTimerFully(key)` — ferma tutto (stop manuale dall'utente).
- `_timerRem(key)` — calcola secondi rimasti da `Date.now() - startedAt`, non da un counter locale.

**Timer Bar (`_timerBarUpdate()`):**
- Div fisso `position:fixed; bottom:72px; z-index:45` (sopra bottom nav z-40, sotto modals z-60+)
- Una riga per ogni timer attivo in `window._timerState`
- Mostra: nome task · nome step · countdown · barra progresso
- Colori: blu scuro (normale) → rosso (< 60 secondi) → verde (completato)
- Click su riga → `recipeModal.open(recipeId, prepTaskId)` — torna allo step giusto
- Si aggiorna ogni secondo con `_timerBarUpdate()` chiamata dall'interval

**Quando il modal riapre:**
- `renderStepView` legge `window._timerState` per lo step corrente — se in corso, mostra già lo stato running con il tempo rimasto reale
- `bindStepEvents` riattacca l'interval locale se `_timerState[key]` esiste ma `timers[key]` no
- `recipeModal.open` NON killa più i timer globali — pulisce solo interval orfani
- `closeModal` ferma interval locali ma NON cancella `_timerState`

**`window._taskNames` (in `js/init.js`):**
- Mappa `id → name` popolata ad ogni `init()` dopo caricamento prep_tasks
- Usata dalla timer bar per mostrare il nome del task invece dell'id

**Regola:** il timer appartiene alla sessione browser, non al modal. Il modal è solo la UI del timer — può aprirsi e chiudersi liberamente senza interrompere il countdown.

---

### Nota versioni: da v431 (documentata) a v447 (live pre-questa sessione)

I file MD si erano fermati a v431. La versione live era già a v446 prima di questa sessione — mancano 15 versioni di storia (v432→v446) da sessioni parallele non ancora documentate. Se Max ricorda cosa è stato fatto in quelle sessioni, aggiornare questo file con un log retroattivo.

**Versione attuale confermata:** v448


---

## SESSIONE 1 LUGLIO 2026 (pomeriggio/sera) — v449→v452 — TripleSeat, fix crash iOS, min_cover_days, Brussels/Chicken split

**Versione:** v452 frontend, bot-preplist-builder v25 (Supabase version 45)
**File modificati:** `js/prep.js`, `js/admin-prep.js`, `sw.js`
**DB:** migration `min_cover_days`, nuovi prep_tasks, nuove ricette, nuovi recipe_steps

---

### 1. TripleSeat — tentativo connessione (v25→v26 Edge Function)

- tripleseat-sync v25 e v26 deployate (diagnostica)
- Le due chiavi inserite in Supabase Secrets (`TRIPLESEAT_PUBLIC_KEY`, `TRIPLESEAT_SECRET_KEY`) sono le chiavi OAuth dell'app, non API keys per Basic Auth → tutti gli endpoint rispondono 401
- **Problema:** TripleSeat non supporta Basic Auth con queste chiavi. Serve un `access_token` OAuth ottenuto dopo il flow di autorizzazione (Monica deve autorizzare da `zottsllc.tripleseat.com/settings/api`)
- **Stato:** in attesa che Max/Monica completino il flow OAuth. Codice pronto, solo autenticazione bloccata
- Edge Function tripleseat-sync è a v26 (diagnostica), da riscrivere in v27 quando arriva il token corretto

---

### 2. v450 — Fix crash iOS su elimina prep (`js/admin-prep.js`)

**Bug:** premendo 🗑 su una prep task, l'app crashava e si riavviava su iOS Safari.
**Causa:** `location.reload()` nelle funzioni `adminDel` e `restorePrep` — su iOS Safari il reload dopo operazione async a volte crashia l'app invece di ricaricare.
**Fix:** rimosso `location.reload()`. Ora `adminDel` rimuove il task da memoria locale (`delete tasks[id]`, `items = items.filter(...)`) e chiama `renderM()` + `renderS()` + `renderHomeStations()` + `renderFocusFeed()` per aggiornare la UI sul posto. `restorePrep` chiama `init()` per ricaricare lista completa.

---

### 3. v451 — Pill bot si azzera al DONE (`js/prep.js`)

**Bug:** dopo DONE, la pill del bot rimaneva con i dati vecchi (es. "Low stock · 39 pieces") mentre lo stock pill mostrava il nuovo valore aggiornato — due informazioni contraddittorie visibili insieme.
**Fix (3 punti in prep.js):**
- `suggestedSave`: aggiunta `suggested_note: null, suggested_qty: null` nell'update DB
- `detailSave`: stesso fix
- `_finishTask`: aggiunta `tasks[id].suggested_note = null; tasks[id].suggested_qty = null;` per aggiornamento locale immediato

**Effetto:** dopo DONE entrambe le pill spariscono e rimane solo la stock pill verde aggiornata. Il bot alle 4AM le riscrive basandosi sullo stock reale.

---

### 4. v452 — min_cover_days: logica "cibo fresco" nel bot (`admin-prep.js`, `bot-preplist-builder v25`)

**Problema:** il bot suggeriva prep anche quando lo stock era abbondante (es. Salmon Cakes: 62 pezzi in casa, bot diceva "low stock"). Il bot non aveva il concetto di "non preparare in anticipo il cibo fresco".

**Soluzione:**
- Nuova colonna `prep_tasks.min_cover_days INTEGER DEFAULT 2` — indica quanti giorni minimi di copertura stock devono esserci prima che il bot smetta di suggerire prep
- **Logica bot v25:**
  - 🟢 Verde se `daysCovered >= minCoverDays` → nessun suggerimento
  - 🟡 Giallo se `1 <= daysCovered < minCoverDays` → prepara presto
  - 🔴 Rosso se `daysCovered < 1` o stock=0 → prepara oggi
- **Default 2** → prepara solo se non arrivi a dopodomani
- Per pasta fresca (si fa ogni giorno): `min_cover_days=1`
- Per prep in anticipo (ragù, brisket): `min_cover_days=4-5`
- **UI:** nuovo campo "Prepara quando scende sotto... (giorni coperti)" nell'editor prep task (sezione Bot Config)

---

### 5. DB — Brussels Sprouts split in due prep task

**Problema:** Brussels Sprouts era un unico task "finale" che scaricava dal POS. In realtà sono due preparazioni distinte.

**Soluzione:**
- **id 265 — Brussels Sprouts Ready to Sell** (ex "Brussels sprouts"): rinominato, `prep_type=finale`, `shelf_life_days=3`, POS `Brussel Sprouts|Brussels|Box Brussels`, `min_cover_days=2`. Scaricato dal venduto ogni notte.
- **id 472 — Brussels Sprouts Par Cook** (NUOVO): `prep_type=supporto`, `shelf_life_days=6`, nessun pos_name. Recipe `da5b0e5c` creata. 4 recipe_steps IT/EN/ES:
  1. Bolli in acqua salata (⏱ 9 min)
  2. Bagno in acqua e ghiaccio (⏱ 3 min)
  3. Taglia e dividi
  4. Conserva in 1/3 gastronorm — scrivi data, dura 6gg

---

### 6. DB — Grilled Chicken / Diced Grilled Chicken split

**Problema:** "Grilled Chicken" (id 468) aveva `pos_name` con i modifier POS → il bot scaricava lo stock del pollo grigliato dal venduto. Ma il pollo grigliato è sottovuoto (dura 15gg) e non deve essere scaricato dal POS — solo il pollo tagliato a dadini in linea lo è.

**Soluzione:**
- **id 468 — Grilled Chicken** (par cook sottovuoto): `shelf_life_days=15`, `pos_name=NULL` (rimosso). `prep_type=supporto`. 5 recipe_steps aggiunti su ricetta `7502f23f`:
  1. Taglia le fette
  2. Condisci con sale kosher
  3. Olio e grill seasoning
  4. Griglia (T° interna 74°C)
  5. Raffredda e metti sottovuoto — scrivi data, dura 15gg

- **id 473 — Diced Grilled Chicken** (NUOVO): `prep_type=finale`, `shelf_life_days=4`, `pos_name='Add chicken|Add Chicken|Add chicken for number 4|Blackened chicken'`. Recipe `d4e1cd5f` creata. 4 recipe_steps IT/EN/ES:
  1. Taglia il pollo a dadini
  2. Condisci con red pepper flakes e prezzemolo
  3. Aggiungi 20g di burro
  4. Metti nel 1/6 pan con data — dura 4gg

---

### Principi confermati in questa sessione

**Due categorie di prep task:**
- `prep_type=supporto` → par cook, nessun pos_name, bot non scarica dal POS, dura più giorni
- `prep_type=finale` → pronto al servizio, pos_name collegato, bot scarica dal venduto

**min_cover_days — regola Max:** il cibo fresco non si prepara in anticipo. Il bot deve suggerire solo quando lo stock non copre il minimo di giorni operativi. "Se ne hai per oggi e domani, non serve prepararli adesso — sarebbero vecchi quando li servi."

---

### Stato versioni
- sw.js: **boh-v452**
- bot-preplist-builder: **v25** (Supabase version 45)
- tripleseat-sync: **v26** (diagnostica, in attesa token OAuth)
- admin-prep.js: fix crash + min_cover_days UI
- prep.js: pill azzerate al DONE

### Priorità prossima sessione
1. TripleSeat — quando Monica autorizza, aggiornare tripleseat-sync v27 con il token reale
2. Brussels Sprouts Ready to Sell — recipe steps da aggiungere (Max ha detto "no" per ora)
3. Cube Grilled Chicken (id 242, checklist) — da rivedere ora che esiste Diced Grilled Chicken
4. Scallops — due task (id 279 e id 257) da unificare
5. Dish Crew Home (Fase 2) — ancora in coda, priorità alta


---

## SESSIONE 1 LUGLIO 2026 (sera) — v453 — Fix ordinamento prep + fix Pomodoro stock

**Versione:** v453 frontend
**File modificati:** `js/prep.js`, `sw.js`
**DB:** fix prep_log Pomodoro

---

### 1. Fix Pomodoro sauce — stock corretto

**Bug:** Max aveva loggato la Pomodoro sauce due volte:
- id 542: `qty=14.74` (inserito in grammi invece di kg — errore UI)
- id 544: `qty=14740` (corretto — 14.74 kg in grammi)

Il sistema sommava entrambi → `current_stock = 18392.74g` (numero con decimali assurdi visibile in app).

**Fix:**
- Eliminato prep_log id 542 (il log sbagliato)
- `current_stock` corretto a `14740g` su prep_task Pomodoro sauce
- Valore verificato: 14.74 kg di Pomodoro sauce in casa al 1/7/2026

---

### 2. Ordinamento prep — 🔴→🟡→🟢 con soglia 30%

**Richiesta Max:** in lista prep, le card devono essere ordinate per urgenza:
- 🔴 Rosse (da fare) in cima
- 🟡 Gialle (quasi ok) al centro  
- 🟢 Verdi (ok) in fondo
- Quando si segna DONE → la card scende automaticamente in fondo

**Fix in `js/prep.js` — funzione `renderM()`:**

Vecchio sort score:
```js
const score = i => (i.in_progress?3:0) + (i.need_tomorrow?2:0);
```

Nuovo sort score (5 livelli):
```js
const score = i => {
  if(i.in_progress) return 5;
  const stock = parseFloat(i.current_stock);
  const sq = parseFloat(i.suggested_qty||0);
  if(i.need_tomorrow){
    if(isNaN(stock)||stock===0||i.current_stock===null||i.current_stock===undefined) return 4; // rosso
    if(sq>0 && stock<=sq*0.3) return 3; // giallo: stock <= 30% suggested
    return 2; // need_tomorrow generico
  }
  return 0; // verde / ok
};
```

**Soglia Max:** 30% (non 50%) — sotto il 30% del suggested_qty diventa gialla.

**Comportamento DONE:** quando si completa una prep, `need_tomorrow` diventa `false` → score scende a 0 → card va automaticamente in fondo alla lista verde. Nessuna logica aggiuntiva necessaria.

---

### 3. Bug aperto — Artichoke Sauce: note sempre in italiano

**Segnalato da Max (screenshot):** tab Notes della ricetta Artichoke Sauce mostra la nota sempre in italiano ("Mettere tutto in una bowl, mischiare con la frusta e travasare in uno squeezer bottle.") anche per utenti EN/ES.

**Verifica DB:** `procedure_en` e `procedure_es` esistono e sono popolati su questa ricetta (confermato via SELECT). Il problema è nel **frontend** — `recipe-modal.js` legge sempre il campo `procedure` (italiano) invece di scegliere in base a `window.user?.lang`.

**Fix NON ancora fatto** — da fare nella prossima sessione su `js/recipe-modal.js`.

---

### Priorità prossima sessione

1. **Fix recipe-modal.js** — tab Notes deve leggere `procedure_en`/`procedure_es`/`procedure` in base a `user.lang`
2. **44 coperti venerdì prossimo** — Max ha menzionato evento con 44 persone. Da chiarire: serve gestione in Brigade (evento, preplist speciale, menu fisso)?
3. **TripleSeat** — quando Monica autorizza OAuth
4. **Dish Crew Home (Fase 2)** — ancora priorità alta in coda
5. **Scallops** — due task (id 279 e id 257) da unificare


---

## SESSIONE 1 LUGLIO 2026 (tarda sera) — v454→v456 — TripleSeat edit, Closing Checks, ingredient_id

**Versione:** v456 frontend
**File modificati:** js/calendar.js (v454, v455), js/admin-prep.js (v456), sw.js
**DB:** nuove closing_checks, migration ingredient_id su prep_tasks

---

### 1. v454 — Fix edit eventi TripleSeat (calendar.js)

**Bug:** bottone Edit non appariva sugli eventi con source=tripleseat.
**Fix:** rimossa la condizione source !== tripleseat — Edit appare su tutti gli eventi per admin.
**Fix 2:** quando si salva un evento TripleSeat dopo edit, mantiene source=tripleseat invece di sovrascrivere con manual.

---

### 2. v455 — Notes TripleSeat read-only + preview pulita (calendar.js)

**Fix 1 — Preview:** quando event_recipes ha dati strutturati, le note grezze di Monica spariscono dalla preview.
**Fix 2 — Editor:** per eventi TripleSeat, il campo Notes diventa read-only con label "TripleSeat Notes (read-only)" e sfondo grigio.

**Sistema event_recipes (scoperto in questa sessione):**
- events.event_recipes gia esisteva come JSONB con struttura {type, recipe_id, recipe_title, portions, note}
- Editor gia ha autocomplete ricette Brigade, sezioni, food cost
- Max compila il menu catering in Brigade collegando ricette reali del DB

---

### 3. DB — Nuove Closing Checks (6 stazioni)

**Decisione Max:** checklist di chiusura completamente rinnovate con task operativi reali.
**Operazione:** archiviate tutte le 80 closing_checks esistenti (archived=true), inseriti 35 nuovi item.

| Stazione | Item |
|---|---|
| Plating Station | 6 |
| Salad Station | 5 |
| Pasta Station | 6 |
| Oven Station | 6 |
| Sauté Station | 5 |
| Grill & Features | 7 |

**Trigger operation notes:** invariato — appare dopo che il cuoco ha checkato tutti gli item della sua stazione.

---

### 4. v456 — ingredient_id su prep_tasks (admin-prep.js + migration DB)

**Migration:** `ALTER TABLE prep_tasks ADD COLUMN ingredient_id uuid REFERENCES ingredients(id) ON DELETE SET NULL`

**UI admin-prep.js:**
- Nuovo dropdown "Collega ingrediente" (434 ingredienti attivi con categoria) tra Collega ricetta e Nota
- `kg` aggiunto al selettore "Nel frigo conto..." — riga conversione si nasconde per kg come per g
- Salva ingredient_id nel DB sia su insert che su update

**Schema A a Z concordato con Max (bot che dice ordina Mozzarella da Hardies):**

- STEP 1 FATTO: prep_tasks.ingredient_id
- STEP 2 GIA ESISTE: ingredient_vendors
- STEP 3 GIA ESISTE: bot legge current_stock + consumo storico
- STEP 4 DA FARE: soglia riordino (prep_tasks.reorder_days)
- STEP 5 DA FARE: bot scrive in office_items "Ordina Mozzarella da Hardies" con vendor + pack + ultimo prezzo
- STEP 6 GIA ESISTE: Tela vede in L Ufficio e ordina

---

### Versioni

- sw.js: **boh-v456**
- admin-prep.js: ingredient_id + kg unit
- calendar.js: edit TripleSeat + notes read-only

### Priorita prossima sessione

1. **Step 4+5 riordino** — reorder_days su prep_tasks + bot scrive in office_items con info fornitore
2. **Fix recipe-modal.js** — tab Notes deve leggere procedure_en/procedure_es in base a user.lang
3. **Dish Crew Home Fase 2** — priorita alta in coda
4. **TripleSeat** — quando Monica autorizza OAuth
5. **Scallops** — unificare task id 279 e id 257




---

## SESSIONE 2 LUGLIO 2026 — v456→v459 — Card prep, bot-preplist-builder v30, closed_dates

**Versione finale:** v459 frontend, bot-preplist-builder v30 (Supabase version 53)

---

### 1. Fix card prep — urgenza solo dal bot (v457→v458)

**Problema:** badge URGENT e bordo rosso venivano da `need_tomorrow` (flag booleano vecchio), non dal bot. Card checklist mostravano URGENT, Ribeye con 22 pezzi in casa mostrava URGENT.

**Fix in `js/prep.js`:**
- `buildStockPill`: se `prep_type==='checklist'` → return '' (checklist non hanno stock)
- `cardBorderColor`: bordo viene SOLO da `suggested_note` del bot (`red/yellow/green`). Checklist bordo grigio-blu neutro fisso (`#64748b`). Nessun `need_tomorrow`.
- `cardButton`: START su tutti i task sempre (checklist incluse). Dopo START → CONTINUE/SEE STEPS/DONE come prima.
- `score()` nel sort: urgenza da bot (`red=4, yellow=3, green=2`), checklist fisso a 1, nessun dato bot a 0.
- Badge URGENT: appare SOLO se `suggested_note` inizia con `red` E `prep_type!=='checklist'`.

**Decisione architetturale confermata:**
- L'UNICA fonte di urgenza visiva è `suggested_note` del bot.
- `need_tomorrow` rimane nel DB come flag tecnico per il cron reset, ma NON guida più nessuna UI.
- Checklist = nessun badge, nessuna pill, bordo neutro, START sempre visibile.

---

### 2. Checklist daily_reset (DB only)

Tutti i prep_tasks con `prep_type='checklist'` aggiornati:
- `daily_reset = true` (cron li resetta ogni notte a mezzanotte CDT)
- `need_tomorrow = true` (appaiono nella lista ogni mattina)
- Eccezioni: Tempura (id 283) e Thaw Scallops (id 464) — già avevano `daily_reset=true` ma `need_tomorrow=false`, lasciati invariati.

---

### 3. closed_dates — giorni chiusura straordinaria (v459)

**Nuova tabella DB:**
```sql
CREATE TABLE closed_dates (
  date date PRIMARY KEY,
  reason text,
  created_by text DEFAULT 'Max',
  created_at timestamptz DEFAULT now()
);
```

**UI admin:** bottone "Closed" (rosa) nel menu admin → sheet con lista giorni chiusi, campo data + motivo, bottone +, cancella con ✕.
File modificati: `js/admin.js` (funzioni openClosedDates/addClosedDate/deleteClosedDate), `index.html` (bottone Closed nel menu).

**4 luglio 2026 già inserito** nella tabella come giorno chiuso.

---

### 4. bot-preplist-builder — evoluzione v25→v30

Tutte le versioni deployate oggi in ordine:

**v26** — consumo giorno-per-giorno reale con medie DOW + giorni chiusi da shifts_schedule (abbandonato: shifts_schedule inaffidabile — schedule si fa giovedì/venerdì, bot gira alle 4AM).

**v27** — closed_dates da tabella dedicata invece di shifts_schedule. Giorni aperti = non domenica E non in closed_dates.

**v28/v28b** — fix percorso ingrediente senza ricetta + buffer +10% su tutto il consumo atteso. `ingredient_id` aggiunto alla select del bot (usa `prep_tasks.ingredient_id` per lookup invece di cercare per nome task).

**v29** — fix fondamentale logica shelf_life:
- `calendarDays()` per la finestra shelf_life — roba va male anche domenica e giorni chiusi
- `nextServiceDays()` solo per `coverDays` (minCoverDays — giorni di servizio aperti)
- `cPerDow(dow, date)` → ritorna 0 per domenica e giorni chiusi (nessun consumo quei giorni ma il cibo va male lo stesso)
- `simulateCoverage` passa `date` a `cPerDow`

**v30** — `expected_duration_days` dal prep_task come fonte primaria per shelf_life:
```
priorità: task.expected_duration_days → recipes.shelf_life_days → ingMaxShelf → default 3
```
Architettura corretta: la shelf_life appartiene alla PREP, non alla ricetta finale. Mini Caesar Salad shelf_life_days = NULL (si fa al momento). Chop Romaine expected_duration_days = 2.

**Buffer +10%:** aggiunto in v28, costante `BUFFER = 1.10` applicata a tutto `cPerDow`.

---

### 5. Chop Romaine (ex "Romaine") — prep_task

- Rinominato da "Romaine" → "Chop Romaine" (id 364)
- `ingredient_id = 'd5adf2db-9fde-4587-83da-47722c38c228'` (ingrediente "Romaine") — collegato per il bot
- `expected_duration_days = 2` — shelf_life 2 giorni di calendario (include domenica/chiusure)
- `recipe_id = null` — il bot usa percorso ingrediente, somma consumo da Mini Caesar (60g/porzione) + Mediterranean Salad (100g/porzione)
- Mini Caesar e Mediterranean: `shelf_life_days` resettati a NULL (erano stati erroneamente impostati a 2 — la shelf_life appartiene alla prep, non alla ricetta finale)

**Logica confermata da Max:**
- Il cuoco taglia la romana → segna DONE con il peso → `current_stock` in grammi
- Il bot somma il consumo atteso da tutte le ricette POS che usano Romaine nel BOM
- La finestra di calcolo = `expected_duration_days` giorni di calendario (2 gg) — domenica inclusa
- I giorni chiusi/domenica: 0 consumo (nessuna vendita) ma il cibo va male lo stesso

---

### 6. Decisioni architetturali stabilite oggi (NON ridiscutere)

**Shelf_life:**
- Appartiene al **prep_task** (`expected_duration_days`), non alla ricetta finale
- Ricette finali (Mini Caesar, Chicken Parmesan, ecc.) = si fanno al momento → `shelf_life_days = NULL`
- Prep intermedie (Chop Romaine, Pollo impanato, ecc.) = `expected_duration_days` sul prep_task

**Giorni chiusi:**
- Tabella `closed_dates` = fonte di verità per chiusure straordinarie
- `shifts_schedule` NON usato dal bot per determinare giorni aperti (troppo in ritardo)
- Domenica = sempre chiusa (hardcoded)

**Bot buffer:** +10% fisso su tutto il consumo atteso (costante `BUFFER=1.10`)

**Urgenza card:** SOLO da `suggested_note` del bot. `need_tomorrow` = flag tecnico DB, non UI.

---

### 7. Stato sw.js e versioni

- **Brigade frontend:** v459
- **bot-preplist-builder:** v30 (Supabase version 53)
- **admin.js:** aggiunta UI closed_dates
- **index.html:** bottone Closed nel menu admin

---

### Priorità prossima sessione

1. **`expected_duration_days`** — audit e impostazione su tutti i prep_tasks che lo mancano (molti ancora a NULL → bot usa default 3gg). Fare per stazione.
2. **Fix recipe-modal.js** — tab Notes legge `procedure_en`/`procedure_es` in base a `user.lang` (bug aperto da sessioni precedenti)
3. **Dish Crew Home Fase 2** — priorità alta in coda
4. **Reorder bot Steps 4+5** — `reorder_days` su prep_tasks + bot scrive in office_items con info fornitore
5. **Scallops** — unificare task id 279 e id 257
6. **TripleSeat** — quando Monica autorizza OAuth
7. **Warning Center** — ricostruire da zero (sessione dedicata, ascoltare Max prima di toccare codice)
8. **PROMPT_PROSSIMA_SESSIONE update** — aggiornare BOH_OS_BACKLOG.md con tutte le decisioni di oggi



---

## IDEA ANNOTATA — 2 Luglio 2026 — Pomodori Caprese (fette)

**Contesto:** il prep task "Sliced Tomatoes" (Salad Station) deve essere calcolato in fette, non in grammi generici, perché ogni piatto usa un numero diverso di fette.

**Regola fette per piatto (da Max, voce):**
- Classic Caprese → 5 fette di pomodoro
- Tuscany Road Trip → 3 fette di pomodoro

**Cosa fare (non ancora implementato):**
1. Verificare che `Sliced Tomatoes` esista come ingrediente nel BOM di entrambe le ricette
2. Se no, aggiungere al BOM con `component_type='ITEM'`, `quantity=5` (o 3), `unit='fette'`
3. Il prep_task "Sliced Tomatoes" (Salad Station) deve avere `unit='fette'` e `ingredient_id` collegato
4. Il bot somma le vendite di Classic Caprese × 5 + Tuscany Road Trip × 3 = fette totali da tagliare
5. Per convertire fette → pomodori interi: serve `avg_unit_weight_g` su ingrediente Tomato + peso medio di una fetta (~30-35g), oppure definire "1 pomodoro = N fette" — **chiedere a Max quante fette si ricavano da un pomodoro**

**Domanda aperta:** quante fette si ricavano da un pomodoro? (serve per convertire fette totali → pomodori da tagliare)

---

## IDEA ANNOTATA — 2 Luglio 2026 — Open Food POS / scarico manuale stock

**Situazione verificatasi oggi:** cheesecake intero venduto to-go con Nutella e berry topping. Lo staff non trovava il tasto POS corretto → venduto come **"Open Food" a $65**. Questo codice non è collegato alla ricetta Cheesecake in Brigade → il bot NON scaricherà automaticamente 1 cheesecake dallo stock stanotte.

**Problema strutturale:** ogni volta che qualcosa viene venduto come "Open Food" (o voce POS generica), Brigade non sa cosa è stato consumato. Lo stock rimane gonfiato.

**Workaround immediato applicato oggi:** nessuno (da fare manualmente se serve).

**Domande aperte per Max:**
1. Quanto spesso succede che lo staff usi "Open Food" per non trovare il tasto giusto?
2. Vuoi che Brigade abbia un modo per registrare scarichi manuali di stock (es. "ho venduto 1 cheesecake intero fuori POS")?
3. Oppure meglio risolvere a monte aggiungendo il tasto POS "Cheesecake Intero To-Go" con i topping?

**Possibile soluzione Brigade:** aggiungere in L'Ufficio (o nella home admin) un bottone "Scarico manuale stock" → scegli prep_task → inserisci quantità → motivo (vendita fuori POS, scarto, evento, ecc.) → aggiorna current_stock e logga in prep_log. Il bot la mattina dopo parte dallo stock corretto.

**Nota:** `pos_excluded_items` esiste già nel DB (6 righe) — "Open Food" probabilmente è già lì come voce esclusa. Verificare.

---

## IDEA ANNOTATA — 2 Luglio 2026 — "L'hai già fatto?" — alert doppio log prep

**Problema:** il cuoco non è sicuro se ha già inserito una prep o no. La rimette → stock gonfiato.

**Flusso desiderato (da Max, voce):**
Quando il cuoco apre la DONE sheet di un prep_task, Brigade controlla il prep_log di oggi per quel task. Se trova già un log nella giornata corrente:

1. Mostra un alert PRIMA di salvare:
   > "⚠️ Già inserita oggi — Cole ha segnato 5kg alle 9:30. Vuoi aggiungerne altra?"
   > **[Sì, aggiungi]** · **[No, annulla]**

2. Se il cuoco conferma → salva normalmente (somma allo stock)
3. Se annulla → non fa nulla

**Dove implementare:** `js/prep.js` — funzione `openDoneSheet()` o all'inizio di `suggestedSave()`/`detailSave()`. Prima di aprire la sheet (o prima di salvare), query su `prep_log` WHERE `item = task.name` AND `log_date = today` AND `user_name != null`. Se trova righe → mostra alert con riepilogo (chi, quanto, quando in CDT).

**Bonus UX:** nella card prep, sotto il nome del task, mostrare in piccolo gli ultimi 3 log del giorno come indicatore visivo passivo — "Cole 5kg · 9:30" — così il cuoco lo vede prima ancora di aprire la DONE sheet.

**Nota tecnica:** `prep_log.created_at` è UTC — convertire a CDT per display (America/Chicago).


---

## SESSIONE 4 LUGLIO 2026 — bot-tell-chef-reader v17 (Supabase version 19)

**Bot:** `bot-tell-chef-reader` — Supabase version 19 (codice interno v17)
**sw.js:** invariato (nessuna modifica frontend)
**Migration DB applicata:** 9 nuove colonne su `office_items` (source_report_ids, summary, category, station, service_date, service_period, recipe_name, equipment_name, checklist_name)

### Cosa cambia rispetto alla v5/v18

- **Categorie:** da 5 a 11 — aggiunge QUALITA_STANDARD, FOOD_SAFETY, EQUIPMENT, INVENTORY_SHORTAGE, STAFF_COMMUNICATION, TRAINING_NEEDED, CATERING_EVENT_RISK, NOT_ACTIONABLE
- **Priority:** da 3 livelli (red/orange/blue) a 4 (critical/high/normal/low) + severity automatica (blocking/alert/insight)
- **Entity detection:** station, recipe_name, ingredient_name, equipment_name, checklist_name, service_period estratti da ogni messaggio
- **Deduplication:** fingerprint nel JSON AI → match fuzzy sul titolo → merge in office_item esistente (times_seen++, priority escalation, body concatenato con nuovo report)
- **ai_options strutturate:** 2-4 opzioni per categoria con action + params (non più stringhe libere)
- **bot_id:** ogni office_item ha `bot_id='tell_chef_reader'` per filtrare per bot
- **Gossip mode:** prompt riscritto — summary in prima persona plurale, en, specifico, come un kitchen manager informato
- **Analytics:** fase 4 produce/aggiorna "Tell Chef — Brigade Summary (30 days)" con volume per persona, % actionati, avg response time, top category

### ai_options per categoria (riferimento)
- PROBLEMA_OPERATIVO: add_to_service_notes, create_task, reply_to_sender, mark_resolved
- GAP_CHECKLIST: add_checklist_item, update_checklist, create_training_note, dismiss
- CONTRIBUTO_RICETTA: open_recipe_review, create_recipe_note, add_to_test_batch, dismiss
- QUALITA_STANDARD: create_quality_note, schedule_tasting, reply, resolve
- FOOD_SAFETY: create_urgent_task, assign_cleaning_task, notify_manager, resolve
- EQUIPMENT: log_equipment_issue, schedule_repair, add_to_service_notes, resolve
- INVENTORY_SHORTAGE: add_to_walmart_list, create_vendor_order_note, emergency_prep_task, resolve
- STAFF_COMMUNICATION: create_private_note, add_to_briefing, reply, dismiss
- TRAINING_NEEDED: create_training_note, schedule_demo, reply, dismiss
- CATERING_EVENT_RISK: add_to_event_brief, notify_coordinator, create_urgent_task, resolve
- NOT_ACTIONABLE: reply, dismiss




---

## SESSIONE 4 LUGLIO 2026 (pomeriggio) — v495→v496 — Audit Guardian Mode

**Versione:** v496 frontend
**File modificati:** `js/prep.js`, `sw.js`
**DB:** nessuna modifica

### Cosa è stato fatto

**Audit Guardian Mode — modalità diagnostica embedded nelle card prep:**

Max ha fornito una lista di ~35 item che non vengono scalati o scalano in modo sospetto dal bot-preplist-builder. Prima di fare correzioni, è stato richiesto un audit "read-only" completo per capire se il problema è nel motore o nei dati DB.

**Audit interattivo (JavaScript in-app):**
- Eseguita analisi DB live con due query SQL + simulazione bot v41 (bot-preplist-sim)
- Classificati tutti i 35 item in 4 categorie: Struttura mancante (15), Problema motore (5 critici), Problema dati (4), Comportamento corretto (3)
- Risultati principali:
  - **Struttura mancante** (viola): 15+ item senza recipe_id, ingredient_id, pos_name — il motore è sano ma non ha percorso
  - **Problema motore critico**: Soffritto Livornese (1336 buste — base_weight_g=null su unit=buste), Spinach (1200 cup — confonde grammi con cup), Watermelon Cubes (8g — fallback 1g/vendita), Spring Mix (1 busta=1 salad sbagliato)
  - **Problema dati**: Diced Grilled Chicken (current_stock=NULL skippato), Nutella/Texana Soup (1 vendita ieri, non bug)

**Implementato in Brigade (v496) — `js/prep.js`:**

Aggiunto `buildAuditPanel()` e relativa infrastruttura in `prep.js`:
- Funzione asincrona `loadAuditData(taskId)` — carica on-demand dal DB: sub-ricette padre con pos_name, BOM della ricetta collegata, vendite ieri da pos_sales_by_item e pos_modifiers, ricette che usano ingredient_id come ITEM
- Cache in `window._auditCache` — ogni task viene caricato una sola volta per sessione
- Funzione `auditDiagnose(task, data)` — classifica il problema in: Missing link, POS name mancante, BOM vuoto, Problema motore (cup/buste), Zero vendite ieri, Calcolo fallback, OK
- `window.toggleAuditPanel(taskId)` — apre/chiude il panel inline nella card, carica dati solo al primo tap
- Pulsante `🔍 Audit` sotto la botPill — visibile solo per admin, non interferisce con la UX normale
- Panel mostra: badge stato colorato, causa, azione suggerita, consumo teorico, consumo ieri reale, ricette POS collegate, BOM trovati, dati tecnici (recipe_id, ingredient_id, pos_name)
- Card ha attributo `data-audit-id` per lookup DOM — il panel non usa `fixed`, non tocca lo scroll
- `window._auditMode` e `window.toggleAllAudit()` preparati per futura toolbar toggle (non ancora usati)

**Architettura decisionale:**
- Il panel è ON-DEMAND: tap 🔍 → carica → mostra. Non appesantisce il render normale.
- La card rimane completamente modificabile: ✏ e 🗑 presenti, editor prep invariato
- Nessuna modifica al DB, nessuna modifica al bot

**Problemi identificati da risolvere (prossima sessione):**

| Item | Problema | Fix da fare |
|---|---|---|
| Soffritto Livornese | unit=buste, base_weight_g=null → 1336 buste assurde | Impostare base_weight_g (peso 1 busta in g) sulla ricetta |
| Spinach | base_weight_g=1200g confuso con 1200 cup | Rivedere logica cup nel bot: usare serving_qty×vendite, non bw/bs |
| Watermelon Cubes | base_weight_g=null su Med Salad → 8g/sale | Impostare base_weight_g o serving_weight_g su Mediterranean Salad |
| Spring Mix | 1 House Salad = 1 busta (sbagliato) | Impostare base_weight_g busta + serving_weight_g per salad |
| Diced Grilled Chicken | current_stock=NULL → skippato | Impostare current_stock=0 |
| 15+ item struct | Nessun recipe_id, ingredient_id, pos_name | Sessione dedicata: collegare un item alla volta |
| Fettuccine/Spaghetti | pos_name='' (stringa vuota, non null) → subMap funziona ma POS path no | Correggere pos_name a null o al nome POS reale |

**Versione attuale confermata:** v496



---

## SESSIONE 5 LUGLIO 2026 — Prep fix struttura dati (DB only, nessun bump frontend)

**Versione sw.js live:** boh-v505 (nessun bump — solo DB)
**Supabase:** ydqmumpytgrlceuinoqt

### Prep items fixati oggi (struttura BOM/recipe/prep_task)

Ogni fix ha seguito il pattern: crea ricetta intermedia (pos_name=NULL) → BOM con ingrediente raw → collega prep_task → aggiorna BOM ricette POS che consumano quella prep.

| Prep | Fix | Note |
|---|---|---|
| **Filet Branzino** | Ricetta creata, BOM: Whole branzino 1pz (resa 2:1), prep_task 448 collegato, Siciliana BOM: Orata Filet → RECIPE Filet Branzino 1pz | f7f46c56 |
| **Filets (tenderloin)** | Ricetta creata, BOM: Beef Filet placeholder, prep_task 244 collegato, Filetto di manzo BOM: Beef Filet → RECIPE Filets 1pz | 1eb7f1fa |
| **Diced Butter** | Ricetta creata, BOM: Butter 454g (1lb→20 cubetti), step procedimento coltello manico bianco, prep_task 292 collegato | 02240420 |
| **Garlic Oil** | shelf_life 3gg, batch 1900g reale, serving 30g/ladle. Scoglio + Siciliana convertiti a RECIPE Garlic Oil 30g | 3fe428bd (già esisteva) |
| **Grated Pecorino** | BOM inserito: Pecorino Romano 7000g. Penne Midnight/Half, Artichoke, Butter Spinach, Meatball, Chicken Caesar → RECIPE Parmesan Grated | 27213a2e |
| **Grilled Chicken** | BOM: Chicken Breast 3000g + EVOO 150g + Poultry Salt 24g (nuovo ingrediente). Diced Grilled Chicken BOM: RECIPE Grilled Chicken 2550g (85%). add chicken BOM: RECIPE Diced Grilled Chicken 60g | 7502f23f |
| **Halved Tomatoes** | Ricetta creata, BOM: Cherry Tomatoes 1000g. Brussel Sprouts + House Salad → RECIPE Halved Tomatoes | ffa6788c |
| **Mash Potato** | Scallops Chefs Way: 1pz→150g. Ribeye, Filetto, Porterhouse, Dino Rib: aggiunti RECIPE Mash Potato 150g | 73961be5 |
| **Mint Bavarese** | Fix display decimali v505 (admin-prep.js isPhysUnit). Berry Coulis + Nutella: Both/Both on one plate/Both on side aggiunti ai pos_name | frontend v505 |
| **Nutella Mix** | Italian Marble Cake BOM: aggiunto RECIPE Nutella Mix 40g (bom_id 1852) | fb674769 |
| **Olives** | prep_task 355: ingredient_id → Kalamata Olive (7bedb3ae). Nessuna recipe | — |
| **Panna Cotta** | Fix display decimali (v505). Modifier Both mappati su Berry Coulis + Nutella Mix | — |
| **Parmesan Grated** | BOM: Parmesan Cheese 7000g. Gruppo A (scaglie): Bresaola/Tagliata/Tuscany/Mini Caesar → RECIPE Shaved Parmesan. Gruppo B (grattugiato): Penne Midnight/Artichoke/Butter Spinach/Meatball/Chicken Caesar → RECIPE Parmesan Grated. Cheese Wheel: avg_unit_weight_g=38102g (84lb). Wheel Pasta: 60g→100g | 6357c9f1 / cf887ce4 |
| **Pastry Cream** | Ricetta creata, BOM spostato da Italian Cream (Milk/EggYolk/Sugar/CornStarch/VanillaBean). Italian Cream BOM: RECIPE Pastry Cream 975g + Heavy Cream. Limoncello Cake: RECIPE Italian Cream + RECIPE GF Sponge Cake + bagna | dd313da9 |
| **Pears** | base_servings 4→3 (1 pera = 3 insalate), expected_duration_days 1→4 | 5128b128 |
| **Pecorino Fresh Wedge** | Ricetta creata, BOM: Pecorino Toscano 2000g (1 forma). Pear & Pecorino Salad: Pecorino Toscano ITEM 50g → RECIPE Pecorino Fresh Wedge 80g (4 fette×20g). Pecorino Toscano: avg_unit_weight_g=2000, measure_type=each | e1b42f3a |
| **Salmon Filets** | Ricetta creata, BOM: Salmon (baffa Frugé) 190g, shelf_life=60gg (congelato), prep_task 317 collegato. Amalfi Salmon BOM: Salmon ITEM 1pz → RECIPE Salmon Filets 1pz | 1e31334d |

### SALMON FLOW — architettura da costruire (PRIORITÀ PROSSIMA SESSIONE)

Flusso a 3 livelli identificato ma NON implementato nel motore:

```
Salmon baffa (Frugé, per lb)
    ↓ prep "Salmon Filets" (cura con Fish Salt + carta + wrap + congela)
Salmon Filets [FREEZER] — stock pezzi (prep_task id=317, Table Side)
    ↓ "Pull Salmon filets" (Oven Station, checklist scongelo)
    → scarica da Salmon Filets [freezer]
    → carica Salmon Filets [disponibili per servizio]
Salmon Filets [DISPONIBILI]
    ↓ vendita
    → Amalfi Salmon (1 filetto per piatto)
    → Add Salmon modifier (½ porzione su pasta)
```

Richiede meccanismo trasferimento stock freezer→linea nel motore. Stessa famiglia: Tenderloin Whole→Filets, Grilled Chicken→Diced Grilled Chicken.

**Pull Salmon filets (id=278):** oggi collegato erroneamente a ricetta "Salmon Whole" (che è il modifier pasta). Da correggere: è una checklist operativa di scongelo, non una prep di produzione.

### Prep items fixati — BOM ancora aperti

- **Bruschetta / Garlic Oil:** Max sistema manualmente (da sessione oggi)
- **Filets (tenderloin):** BOM placeholder con Beef Filet — modello futuro Tenderloin Whole → resa 4-5 filetti 8oz → food cost reale $20/filetto stimato
- **Grated Pecorino candidati non convertiti:** Cacio e Pepe (30g), Cacio e Pepe Half (15g), La N°4 (20g), La N.4 Half (10g), Maccheroni Arrabbiata (30g) — da convertire a RECIPE Grated Pecorino quando confermati
- **Salmon Cakes BOM:** deve consumare Salmon raw/sides separatamente dai filetti — non toccato oggi
- **Pull Salmon filets (id=278):** collegamento a Salmon Whole da correggere

### Note tecniche sessione

- **bom_id di questa sessione:** 1834→1859 (tutti legittimi, verificati)
- **Nessun file frontend toccato** tranne admin-prep.js (fix decimali v505)
- **Ingredienti nuovi creati:** Poultry Salt (998528ab), Marsala Wine già esisteva (da sessione precedente)
- **Prep tasks modificati ingredient_id:** Olives (id=355) → Kalamata Olive


---

## Sessione 5 luglio 2026 — Chef AI locale su Mac mini M4

### Completato
- **Ollama installato** su Mac mini M4 (brew) con modello `qwen3:8b` (qwen3.6:35b-a3b killato dal sistema — 23GB troppi per 16GB RAM)
- **Tailscale Funnel attivo** — URL stabile: `https://max-mini.taildf4122.ts.net`
- **Gateway Node.js** creato in `~/chef-ai-gateway.js` — porta 8080, protetto da `x-chef-ai-key`
- **LaunchAgent** registrato: `~/Library/LaunchAgents/com.zenos.chefai.gateway.plist` — si avvia automaticamente al boot
- **Supabase secrets** aggiornati: `LOCAL_AI_URL`, `CHEF_AI_KEY`, `OLLAMA_MODEL=qwen3:8b`
- **souschef-chat v53** deployato con:
  - Ollama locale via Tailscale come primario (15s timeout → fallback OpenRouter)
  - Logging completo: provider_attempted, provider_used, local_url_present, local_response_ok, fallback_reason
  - System prompt dinamico per ruolo: admin vede tutto ($), supervisor/staff mai dati economici
  - Zenos knowledge base integrata nel system prompt (gerarchia, regole operative, alias POS)
  - Fix deduplication sales aliases (Set per ID riga — no più doppio conteggio)
  - Fix item detection: chicken parmigiana/parmesan/parm/pollo parmigiana
  - `user_name`, `user_role`, `user_station` passati dal frontend (souschef-chat.js aggiornato)

### Chiave gateway (non perdere)
`CHEF_AI_KEY=ef2494d331d377a56bb6ab065402761844200c44a38f847572b0745cb060361b`

### Architettura Chef AI finale
```
Brigade (telefono) → souschef-chat Edge Function
  → POST https://max-mini.taildf4122.ts.net/chef-ai (header x-chef-ai-key)
    → chef-ai-gateway.js :8080 (LaunchAgent, sempre acceso)
      → Ollama localhost:11434 → qwen3:8b
  → fallback: OpenRouter LLaMA 70B
  → fallback: Groq LLaMA 70B
```

### Prossima sessione Chef AI — obiettivi
- Insegnare a Chef AI contesti più profondi per utente (personalizzazione per Anto, Cole, Samantha, ecc.)
- Testare risposta con utente staff — verificare che non veda dati economici
- Valutare se aggiungere memoria conversazionale persistente (tabella `chef_ai_memory` per utente)
- Testare voce in chat con Chef AI locale

### Note tecniche
- ngrok abbandonato — URL instabile, sostituito da Tailscale Funnel (gratuito, URL fisso permanente)
- qwen3:8b gira bene su 16GB M4, risposta ~3-5s cold start, poi fluido
- Gateway su 0.0.0.0 (non 127.0.0.1) necessario per Tailscale Funnel
- souschef-chat.js ora passa user_name/user_role/user_station al body della fetch


---

## SESSIONE 5 LUGLIO 2026 — bot-preplist-builder v40 + bot-tell-chef-reader v17 + Bot Center v3

**sw.js live:** boh-v505 (invariato questa sessione)
**Supabase project:** ydqmumpytgrlceuinoqt

---

### VERSIONI AGGIORNATE

- **bot-preplist-builder:** v40 → Supabase version 59 (era v39/v58)
- **bot-tell-chef-reader:** v17 → Supabase version 19 (era v5/v18)
- **Bot Center frontend:** v3 (office.js — aggiornato _botExplain e _botDefs per tutti e 7 i bot)

---

### bot-tell-chef-reader v17 (Supabase v19)

**Categorie ampliate da 5 a 11:**
PROBLEMA_OPERATIVO, GAP_CHECKLIST, CONTRIBUTO_RICETTA, QUALITA_STANDARD, FOOD_SAFETY, EQUIPMENT, INVENTORY_SHORTAGE, STAFF_COMMUNICATION, TRAINING_NEEDED, CATERING_EVENT_RISK, NOT_ACTIONABLE

**Priority da 3 a 4 livelli:** critical / high / normal / low + severity automatica (blocking/alert/insight)

**Entity detection:** station, recipe_name, ingredient_name, equipment_name, checklist_name, service_period estratti da ogni messaggio AI

**Deduplication:** issue_fingerprint nel JSON AI → match fuzzy sul titolo → merge in office_item esistente (times_seen++, priority escalation, body concatenato)

**ai_options strutturate:** 2-4 opzioni per categoria con action + params tipizzati

**Gossip mode:** prompt riscritto — summary in prima persona plurale, en, specifico, kitchen manager tone

**Fase 4 analytics:** produce/aggiorna "📊 Tell Chef — Brigade Summary (30 days)" con volume per persona, % actionati, avg response time, top category

**Migration DB applicata:**
```sql
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS source_report_ids uuid[] DEFAULT '{}';
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS station text;
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS service_date date;
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS service_period text;
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS recipe_name text;
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS equipment_name text;
ALTER TABLE office_items ADD COLUMN IF NOT EXISTS checklist_name text;
```

---

### bot-preplist-builder v40 (Supabase v59)

**PATCH ADDITIVE su v39 — nessuna logica di calcolo modificata.**

**Aggiunge: calendar awareness + sanity caps**

#### 1. openStatus — calcolato all'inizio di ogni run

```
NORMAL_SERVICE_PREP  → giorno normale di servizio
CLOSED_DAY_REVIEW    → oggi chiuso, domani aperto
REOPENING_PREP       → oggi chiuso + domani chiuso (es. sabato festa + domenica)
```

Logica: legge `closed_dates` + domenica hardcoded. Cerca il prossimo giorno aperto fino a 14 giorni avanti.

#### 2. In REOPENING_PREP (es. 4-5 luglio 2026)

- Mai "Prep today" o colore rosso aggressivo
- suggestedNote sempre yellow se confidence < high
- Testo: "Chiusi oggi/domani · controlla stock Lunedì · possibile [qty]"
- Se stock > 0 e confidence < high → forza yellow anche se pill originale era red
- Solo high confidence + stock = 0 → resta red con "Rischio riapertura · prepara Lunedì mattina"

#### 3. In CLOSED_DAY_REVIEW

- Stessa safety logic ma target = domani
- No "Prep today"

#### 4. Sanity cap globale (anche in NORMAL_SERVICE_PREP)

- `suggested_qty > average_qty × 3` → forza yellow con "Quantity looks high · verify before producing"
- `pill = red AND suggested_qty = 0 o null` → forza yellow con "verify quantity"
- Richiede colonna `average_qty` su `prep_tasks` (letta dalla query, null-safe)

#### 5. Formato note output

```
green:  "Chiusi oggi/domani · stock ok per Lunedì"
yellow: "Chiusi oggi/domani · controlla stock Lunedì · possibile 1 25#"
red:    "Rischio riapertura · prepara Lunedì mattina · stima 91 pieces · stock 0"
```

#### Risultati verificati live (4 luglio 2026, REOPENING_PREP)

| Task | v39 | v40 |
|---|---|---|
| Brussels Sprouts | 🔴 Prep today · 1 25# · hai 0 | 🟡 Chiusi oggi/domani · controlla stock Lunedì · possibile 1 25# |
| Chicken Parmesan | 🔴 Prep today · · out of stock | 🟡 Chiusi oggi/domani · controlla stock lunedì |
| Salmon cakes | 🔴 Prep today · 91 pieces · hai 0 | 🟡 Chiusi oggi/domani · controlla stock Lunedì · possibile 91 pieces |
| Tiramisu | 🔴 Prep today · 20 pieces · hai 0 | 🟡 Chiusi oggi/domani · controlla stock Lunedì · possibile 20 pieces |
| Berry coulis | 🟢 You have 3.5kg · good through Thursday | 🟢 Closed today/tomorrow · enough stock for Monday |
| Spaghetti fresh pasta | 🟢 You have 40 nests | 🟢 Closed today/tomorrow · enough stock for Monday |

#### Note importanti v40

- **Bot Debug (home):** è read-only, non scrive nel DB. Le pill reali vengono solo dal bot cron (4 AM) o da trigger manuale via `net.http_post`
- **Bot re-trigger manuale:** non rifalsa i numeri — lo scarico stock avviene una sola volta per giornata (vendite ieri), re-triggerare non lo ripete
- **closed_dates:** solo il 4 luglio era inserito. Il 5 luglio (domenica) è hardcoded come chiuso. Entrambi → REOPENING_PREP → lunedì target
- **average_qty:** campo letto da prep_tasks ma non ancora popolato per tutti i task → sanity cap non scatta senza dati storici (null-safe)

---

### Bot Center v3 (office.js)

Aggiornati `_botExplain` e `_botDefs` per tutti e 7 i bot con dati verificati dal codice live:

- **bot-preplist-builder:** aggiunto expected_duration_days, min_cover_days, closed_dates, linguaggio cucina, logica domenica
- **bot-tell-chef-reader:** riscritto con 11 categorie, 4 livelli priority, dedup, ai_options, analytics 30gg
- **bot-food-cost-guard:** v13 reale — noise protection pack mismatch, 3 livelli severity, calcolo impatto $ mensile, output limits
- **bot-recipe-guardian:** v13 — 4 check critical, 4 warning, 2 info, ordinamento per vendite, dedup per (ricetta × issue_type)
- **bot-price-guard, bot-chat-analyst, bot-prep-accuracy:** raffinati, orari corretti

---

### Prep items analizzate durante la sessione (foto Max alle 5:55 AM)

Problemi identificati dalla foto preplist:
1. `bot_preplist_log` non riceve più scritture dal v39 → Bot Center mostra "Nessun dato" per preplist-builder (da fixare in sessione dedicata)
2. Berry coulis: mostrava "3.5kg in casa" ma DB aveva 1061g — il testo mostrava stima elaborata, non stock grezzo
3. Spaghetti: mostrava "40 nests" ma DB aveva 487 nests — conversione stock in nests produceva numero sbagliato
4. Chicken Parmesan: `base_weight_g = NULL` → pill mostrava testo vuoto "·  ·" senza quantità
5. Domenica hardcoded come chiusa, 4 luglio in closed_dates → REOPENING_PREP attivo correttamente

---

### Sessione dedicata consigliata per bot-preplist-builder

**Prompt apertura sessione:**
> Bot-preplist-builder — Sessione verifica e debug
>
> Leggi tutti i .md e sw.js da brigade-main all'inizio. Obiettivo: (1) ripristinare scritture su bot_preplist_log da v40, (2) debuggare conversione stock Berry coulis e Spaghetti, (3) verificare Chicken Parmesan base_weight_g, (4) testare sanity cap con average_qty popolato su alcuni task campione. Non toccare logica di calcolo — solo patch chirurgiche.



---

## SESSIONE 5 LUGLIO 2026 — v496→v505 — Audit Guardian Mode: riscrittura completa + fix BOM editor

**Versione finale:** v505 frontend (boh-v505 in sw.js)
**File modificati:** `js/prep.js`, `js/recipes.js`, `js/admin-prep.js`, `index.html`, `sw.js`
**DB:** nessuna modifica (solo letture per audit)

---

### Contesto sessione

Max aveva ~35 prep item che il bot non scalava o scalava in modo sospetto. La sessione ha costruito un sistema di audit diagnostico embedded nelle card prep (Audit Guardian Mode), poi lo ha iterato attraverso diverse versioni per risolvere contraddizioni architetturali e bug tecnici.

---

### Cronologia versioni

**v496 — Audit Guardian Mode (prep.js)**
Prima implementazione del panel audit embedded nelle card prep. Pulsante `🔍 Audit` visibile solo per admin. Panel on-demand: tap → carica → mostra. Funzioni: `loadAuditData()`, `auditDiagnose()`, `toggleAuditPanel()`. Cache in `window._auditCache`.

**v497 — BOT CONFIG in admin-prep.js**
- Sezione "🤖 Campi usati dal Bot Preplist" nel modal edit prep task
- "Serving qty — unità per porzione venduta" e selettore "Serving unit"
- Campo si nasconde quando `unit=g` (non serve)
- Esempi contestuali: Butter Spinach=2cup, Fettuccine=2nests, Lobster=1filetto, Arrabbiata=200g
- Alert CRITICAL rosso se nessun link POS trovato

**v498 — BOM editor recipes.js: warning inline + audit globale**
- Blur listener nel BOM editor: quando l'utente digita un nome che matcha esattamente il titolo di una recipe esistente → banner arancione inline "⚠ Questo nome è una prep recipe — collegala come sub-recipe blu?"
- `_auditExistingBOMRows()`: al caricamento editor BOM, flagga righe ITEM esistenti che matchano recipe title
- `openBOMRecipeAudit()`: funzione globale, modal con tutti i casi DB, bottone "Converti → sub-recipe" (DELETE + INSERT con component_type='RECIPE')
- Bottone "🔍 BOM Audit — trova ingredienti che sono ricette" in fondo all'editor (solo admin, solo su ricette esistenti)

**v499 — Fix crash BOM audit + campo cerca prep**
- **Bug fix:** `const {data: rows, error} = await supa.rpc ? null : null` destructurava `null` → crash. Riga rimossa.
- **Campo cerca prep in index.html:** `<input id="prepSearch">` con icona 🔍, stile glass, posizionato tra stations bar e grid. `oninput` chiama `renderM()` con `window._prepSearchQuery`. `renderM()` in prep.js filtra per query su `i.name` combinato con il filtro stazione.

**v500 — Audit: PARTIAL LINK / ITEM sbagliato / mancanti sospette, vendite ieri+avg 90gg**
Riscrittura completa `loadAuditData`, `auditDiagnose`, `toggleAuditPanel`:
- `recipeLinks`: ricette che usano questa prep come RECIPE (link corretto) ✅
- `itemLinks`: ricette che usano l'ingrediente come ITEM (link sbagliato) ⚠
- `missingLinks`: ricette sospette senza link (Salads/Soups/Antipasti + keyword title)
- Vendite ieri + avg 90gg per ogni ricetta (query `pos_sales_by_item`)
- Badge: ✅ OK / ⚠️ PARTIAL LINK / 🔴 ITEM sbagliato / 📭 POS mancante / 🚫 Stock NULL / 📋 BOM vuoto / ⚙️ Motore: cup/buste

**v501 — [DECISIONE ARCHITETTURALE] Fonte dati unificata: computePrepBotDecision**
**Problema critico identificato:** `init()` carica `prep_tasks` con `select('*')` senza join → `task.recipes` è sempre `undefined`. L'audit leggeva `task.recipes?.pos_name` → undefined → "POS name mancante" anche su Cremino che il bot scalava correttamente via "Chocolate Cremino|Italian Marble Cake".

**Soluzione:** funzione `computePrepBotDecision(taskId)` — fonte di verità UNICA condivisa tra audit e bot:
- Fa la STESSA query del bot: `prep_tasks` con join `recipes:recipe_id(id,title,pos_name,base_weight_g,base_servings,shelf_life_days,serving_weight_g,serving_unit,serving_qty)`
- `pns` estratti dalla ricetta joinata (non dal task flat)
- Determina `consumoPath`: `direct_pos` | `sub_recipe` | `direct_pos+sub_recipe` | `ingredient_id` | `none`
- `loadAuditData` chiama `computePrepBotDecision`
- `auditDiagnose` legge dal risultato
- Zero query live a `pos_sales_by_item` dentro `computePrepBotDecision` (non serve — il bot ha già calcolato)

**v502 — [DECISIONE ARCHITETTURALE] Audit legge run reale del bot, non simulazione**
**Bug concettuale:** l'audit rifaceva il calcolo live ogni volta — ma "ieri alle 4AM" è diverso da "ieri alle 10AM". Risultato: valori divergenti tra bot e audit.

**Principio nuovo:** il bot ha già scritto tutto su `prep_tasks`. L'audit lo legge:
- `suggested_at` → timestamp esatto del run (convertito CDT: UTC-5)
- `suggested_by` → versione bot (`bot-preplist-builder-v40`)
- `suggested_note` → decisione completa (`color|it|en|es`)
- `suggested_qty` → quantità calcolata

**Run header** in cima al panel:
```
AUDIT BASATO SU RUN
2026-07-04 06:23 CDT
Sales window: 2026-07-03 · bot-preplist-builder-v40
"Closed today/tomorrow - enough stock for Monday"
→ Suggerisce: 8 pezzi
```

`salesDate` = `runAt - 1 giorno` (la finestra vendite del bot è "ieri rispetto al momento del run"). Nessuna query `pos_sales_by_item` dentro `computePrepBotDecision`.

**v503 — Fix crash 400 PostgREST**
**Bug:** `.select([...array...].join(','))` produceva `recipes:recipe_id(id,...base_servings  ,shelf_life_days,...)` con doppio spazio → PostgREST 400.
**Fix:** stringa singola compatta, identica a quella usata dall'Edge Function bot: `.select('id,name,...,recipes:recipe_id(id,title,pos_name,base_weight_g,base_servings,shelf_life_days,serving_weight_g,serving_unit,serving_qty)')`

**v504 — Audit: missingLinks keyword-filtered + badge OK quando bot scala**
Due fix:
1. **missingLinks troppo ampio** (24 ricette per Croutons): ora tokenizza il nome del task e cerca solo ricette il cui titolo contiene keyword semanticamente legate alla prep. Per Croutons → keyword set `{salad, caesar, house, mediterranean, tuscany, soup, tomato}` → da 24 a ~5-7 ricette veramente candidate.
2. **Badge arancione anche quando bot scala correttamente**: `PARTIAL LINK` ora si attiva SOLO se `consumoPath === 'none'` (bot non ha trovato vendite). Se il bot ha già scalato (`consumoPath !== 'none'`) → badge `✅ OK (link da completare)` verde con nota informativa sui link strutturali mancanti.

**v505 — [bump esterno da Max]**
Max ha pushato v505 in una sessione parallela. Versione confermata da sw.js live.

---

### Architettura audit finale — come funziona ora (v504/v505)

1. Tap `🔍 Audit` → `toggleAuditPanel(taskId)`
2. `loadAuditData(taskId)` → `computePrepBotDecision(taskId)` (cache `window._auditCache`)
3. `computePrepBotDecision` fetcha il task con join recipe, legge `suggested_at/note/qty/by` (già scritti dal bot), determina `consumoPath` dalla struttura BOM (no query POS live)
4. `auditDiagnose` legge dal risultato — mai tocca `task.recipes` dal tasks flat
5. Panel mostra in ordine:
   - **Run header**: timestamp CDT, sales window, versione bot, nota verbatim IT/EN, pill verde/gialla/rossa, `→ Suggerisce: X unità`
   - **Percorso usato dal bot**: direct_pos | sub_recipe | ingredient_id | none, con pns e "nel sales window del run"
   - **Diagnosi strutturale**: badge + causa + azione
   - **Tabella ricette**: ✅ RECIPE / ⚠ ITEM / ❓ mancanti (keyword-filtered) con POS name
   - **BOM trovati**: ingredienti del BOM della ricetta
   - **Tech info**: recipe_id, pos_name, path

---

### Regole architetturali stabilite (NON ridiscutere)

- **`computePrepBotDecision` è la fonte di verità unica** — audit e diagnosi leggono sempre da questa funzione. Non c'è modo che bot e audit divergano.
- **L'audit legge il run reale** — `suggested_at/note/qty/by` dal task, non una simulazione live
- **`pns` sempre dalla ricetta joinata** — mai da `task.recipes?.pos_name` (che è undefined nel task flat da `select('*')`)
- **PostgREST: `.select()` sempre stringa singola compatta** — mai array joinato a runtime
- **`recipe_bom.component_type` MAIUSCOLO**: `'ITEM'` / `'RECIPE'`
- **BOM mai toccato automaticamente** — solo su decisione esplicita di Max
- **Badge PARTIAL LINK** = solo se bot NON scala (`consumoPath === 'none'`). Se bot scala → badge ✅ con nota strutturale.
- **missingLinks keyword-filtered** — tokenizzazione nome task, mai query broad su tutte le categorie

---

### Bug noti risolti in questa sessione

| Bug | Versione fix | Causa | Fix |
|---|---|---|---|
| Cremino mostra "POS name mancante" mentre bot scala | v501 | `task.recipes?.pos_name` undefined (task flat senza join) | `computePrepBotDecision` con join recipe |
| Audit rifaceva calcolo live diverso dal bot | v502 | Query `pos_sales_by_item` live invece di leggere run esistente | Legge `suggested_at/note/qty/by` |
| 400 PostgREST al caricamento audit | v503 | `.select([array].join(','))` con spazi spurii | Stringa singola compatta |
| 24 ricette "mancanti" per Croutons | v504 | missingLinks prendeva TUTTE Salads/Soups/Antipasti | Keyword-filtering per nome task |
| Badge arancione anche con bot che scala | v504 | PARTIAL LINK senza check consumoPath | Badge ✅ se consumoPath !== 'none' |
| BOM Audit modal crash al caricamento | v499 | `const {data} = await supa.rpc ? null : null` destructura null | Riga rimossa |

---

### Stato prep item audit — da continuare

Nella sessione sono stati identificati item con struttura mancante. Sessione interrotta prima di correggere i singoli item. Da riprendere:

**Croutons (recipe_id `54f4527a`):**
- 1 link RECIPE corretto: Mini Caesar Salad (bom_id 1811, 15g) ✅
- 2 link ITEM sbagliati: Pear & Pecorino Salad (bom_id 1588, 15g) e Tomato And Basil Soup (bom_id 1199, 30g) → da convertire in RECIPE
- Ricette sospette: House Salad, Mediterranean Salad, Tuscany Road Trip → Max decide caso per caso

**Altri item con struttura mancante (15+):**
Non ancora corretti. Max deve decidere per ognuno usando il panel audit. Il panel ora mostra tutte le informazioni necessarie per ogni decisione.

---

### Pending per prossima sessione

1. **Croutons BOM**: convertire bom_id 1588 e 1199 da ITEM → RECIPE (Max decide)
2. **15+ item struttura mancante**: sessione dedicata, un item alla volta con panel audit
3. **Soffritto Livornese**: unit=buste, base_weight_g=null → suggested_qty assurda (fix: impostare base_weight_g)
4. **Spinach**: base_weight_g=1200g confuso con cup
5. **Watermelon Cubes**: base_weight_g=null su Med Salad
6. **Spring Mix**: 1 busta = 1 salad (sbagliato)
7. **Diced Grilled Chicken**: current_stock=NULL → bot lo salta



---

## SESSIONE 5 LUGLIO 2026 (continuazione pomeriggio) — Prep fix struttura dati parte 2 (DB only, boh-v505)

### Prep items fixati in questa parte di sessione

| Prep | Fix | Dettaglio |
|---|---|---|
| **Pastry Cream** | Ricetta creata `dd313da9`, BOM spostato da Italian Cream (Milk 500ml + Egg Yolk 200g + Sugar 250g + Corn Starch 25g + Vanilla Bean 0.5g). Italian Cream BOM: RECIPE Pastry Cream 975g + Heavy Cream 500ml. Limoncello Cake: RECIPE Italian Cream 1450g + RECIPE GF Sponge Cake 1pz + bagna (Limoncello/Sugar/Water). prep_task 384→Pastry Cream, prep_task 385→Italian Cream | Catena 3 livelli completa |
| **Pears** | base_servings 4→**3** (1 pera = 3 insalate), expected_duration_days 1→**4** | recipe `5128b128` |
| **Pecorino Fresh Wedge** | Ricetta creata `e1b42f3a`, BOM: Pecorino Toscano 2000g (1 forma). Pear & Pecorino Salad bom_id=1585: Pecorino Toscano ITEM 50g → RECIPE Pecorino Fresh Wedge 80g (4 fette×20g). Pecorino Toscano: avg_unit_weight_g=2000, measure_type=each. prep_task 358 collegato | — |
| **Ribeye Steaks** | I -4 venivano dall'Audit Panel: bot cercava ingrediente "Ribeye" per nome → trovava nel BOM Ribeye Prime → 4 vendite Costata = -4 pezzi. Ricetta creata `1ccd91e0`, BOM: Ribeye ITEM 1pz. prep_task 254 collegato. Ribeye Prime BOM bom_id=1214: Ribeye ITEM 1pz → RECIPE Ribeye Steaks 1pz | Stesso pattern Filets/Salmon |
| **Roasted Almonds** | Ingrediente `Sliced Almonds` creato `1a5c0304` (Dry Goods, weight). ingredient_link id=301 corretto: "ALMONDS SLICED BLANCHED" → Sliced Almonds (era Blanched Almonds). Vendor Hardie's spostato da Blanched Almonds a Sliced Almonds (pack 3#, $24.82, conv 1361g). Ricetta creata `6a9e8d48`, BOM: Sliced Almonds 1000g. prep_task 321 collegato. Mediterranean Salad bom_id=578: Roasted Almond ITEM 5g → RECIPE Roasted Almonds 5g | "ALMONDS WHOLE BLANCHED" → Blanched Almonds: intatto ✓ |
| **Salmon Aioli** | OPEN — prep_task 255, Sauté Station, unit=g, recipe_id=NULL, stock=1877g. BOM Salmon Cakes non ha Salmon Aioli. Manca: grammi per porzione Salmon Cakes da confermare con Max prima del fix | Prossima sessione |

### SALMON FLOW — architettura da costruire (PRIORITÀ CRITICA)

```
Salmon baffa (Frugé, per lb)
    ↓ prep "Salmon Filets" (cura con Fish Salt + carta + wrap + congela)
Salmon Filets [FREEZER] — stock pezzi (prep_task id=317, Table Side)
    ↓ "Pull Salmon filets" (Oven Station, checklist scongelo)
    → scarica da Salmon Filets [freezer]
    → carica Salmon Filets [disponibili per servizio]
Salmon Filets [DISPONIBILI]
    ↓ vendita
    → Amalfi Salmon (1 filetto per piatto)
    → Add Salmon modifier (½ porzione su pasta)
```

Richiede meccanismo trasferimento stock freezer→linea nel motore.
Stessa famiglia: Tenderloin Whole→Filets, Grilled Chicken→Diced Grilled Chicken.

**Pull Salmon filets (id=278):** collegato erroneamente a ricetta "Salmon Whole" (modifier pasta). Da correggere: è checklist operativa di scongelo, non prep di produzione.

### Pendenti aperti da questa sessione

1. **Salmon Aioli** — quanti grammi per porzione Salmon Cakes? → poi crea ricetta + collega prep_task 255 + aggiungi RECIPE Salmon Aioli Xg al BOM Salmon Cakes (bom_id nuovo)
2. **Salmon Cakes BOM** — bom_id=1425 usa `Cured Salmon` 1300g — verificare se è corretto o deve diventare RECIPE Salmon Filets
3. **Pull Salmon filets (id=278)** — scollegare da Salmon Whole, classificare come checklist scongelo
4. **Grated Pecorino** — candidati non ancora convertiti: Cacio e Pepe (30g), Cacio e Pepe Half (15g), La N°4 (20g), La N.4 Half (10g), Maccheroni Arrabbiata (30g)
5. **Bruschetta/Garlic Oil** — Max sistema manualmente

### Note tecniche
- **sw.js:** boh-v505 — nessun bump (DB only tutta la sessione)
- **bom_id sessione:** 1857→~1862
- **Ingredienti nuovi:** Sliced Almonds `1a5c0304`
- **ingredient_link id=301** corretto: "ALMONDS SLICED BLANCHED" → Sliced Almonds

---

## SESSIONE 5 LUGLIO 2026 (pomeriggio) — Mapping Control Room: source-of-truth fix + bug cascade (v518→v524)

**Versione finale:** boh-v524
**File modificati:** `js/mapping-control-room.js`, `js/recipes.js`, `sw.js`
**DB:** `recipes.ingredients` azzerato per Penne Midnight e Penne Midnight Half

---

### Problema originale
Il Mapping Control Room mostrava Penne Midnight come RED "sold item missing BOM" e "Parmigiano Reggiano 60g" nel piano di conversione — nonostante il BOM strutturato (`recipe_bom`) fosse completo e corretto con 5 componenti (incluso RECIPE Parmesan Grated 60g).

### Root cause chain (3 bug distinti)

**Bug 1 — Stale JSONB (pre-esistente):**
`recipes.ingredients` (JSONB legacy) conteneva ancora `{"name":"Parmigiano Reggiano","qty":"60","unit":"g"}` mentre `recipe_bom` aveva già RECIPE Parmesan Grated 60g. Il MCR leggeva il JSONB come "conversione da fare" mostrando dati falsi.

**Bug 2 — Query BOM troncata dal hard cap PostgREST (root cause principale):**
PostgREST impone un hard cap di **1000 righe** indipendentemente dal `limit()` impostato dal client. `recipe_bom` aveva 1284 righe → la query tornava esattamente 1000 righe, tagliando Penne Midnight (bom_id 1146-1150 cadevano oltre il 1000° posto). `bomByParent` era quindi incompleto → `hasStructured=false` → detection: RED "missing BOM".

**Bug 3 — Query `pos_modifiers` con colonne sbagliate (pre-esistente):**
`pos_modifiers` veniva interrogata con `modifier_name,quantity` ma le colonne reali sono `modifier,quantity_sold`. Il 400 silenzioso non causava crash ma contribuiva a confondere lo stato.

**Bug 4 — `prep_tasks.base_weight_g` inesistente:**
`prep_tasks` veniva interrogata con `base_weight_g` che non esiste in quella tabella (sta su `recipes`). Altro 400 silenzioso.

### Fix applicati (v518→v524)

| Versione | Fix |
|---|---|
| v518 | Step A: `recipes.ingredients = []` per Penne Midnight + Penne Midnight Half (DB). Step B: `saveRecipeBOM()` ora azzera JSONB dopo ogni BOM save. Step C: MCR detection — se `recipe_bom` rows > 0, `recipes.ingredients` ignorato completamente. |
| v519 | Fix `pos_modifiers` query: `modifier_name→modifier`, `quantity→quantity_sold` |
| v520 | MCR load: funzione `q()` wrapper — ogni query isolata, errore su una non azzera le altre |
| v521 | Fix `prep_tasks` query: rimosso `base_weight_g` (non esiste su quella tabella) |
| v522 | (interim: live BOM re-check nel drawer — rimosso in v523) |
| v523 | `mcrRefresh`: full state reset (data, problems, plan, drawer, selection). Debug logging temporaneo aggiunto. |
| v524 | **Fix principale**: split `recipe_bom` in due query parallele (<1000 righe ciascuna) per bypassare il hard cap PostgREST. `bomByParent` ora completo con tutti i 1284 row. Debug logging rimosso in v525. |
| v525 | Cleanup: debug logging rimosso da MCR. |

### Decisioni architetturali nuove

**PostgREST hard cap rule:** `SELECT` su tabelle con >1000 righe potenziali deve sempre usare filtri o essere spezzato in query multiple. Non fidarsi mai di `limit(N)` con N>1000 — PostgREST lo ignora. Tabelle a rischio: `recipe_bom` (1284 righe), `pos_sales_by_item`, `messages`.

**recipe_bom query pattern (MCR e futuri moduli):**
```js
// Split in due: pos-recipes (≈640 rows) + prep-recipes (≈644 rows)
const bomPos  = await supa.from('recipe_bom').select(...).in('parent_recipe_id', posRecipeIds).limit(1000);
const bomPrep = await supa.from('recipe_bom').select(...).in('parent_recipe_id', prepRecipeIds).limit(1000);
const bom = [...bomPos, ...bomPrep];
```

**Source-of-truth rule (recipe_bom vs recipes.ingredients):**
- `recipe_bom` = fonte autoritativa. Se ha righe → `recipes.ingredients` ignorato ovunque.
- `recipes.ingredients` JSONB = legacy fallback solo se `recipe_bom` è vuoto.
- `saveRecipeBOM()` ora azzera sempre `recipes.ingredients` dopo ogni write.

### Stato finale MCR (v524)
- Penne Midnight: scomparso dalla lista ✅
- Penne Midnight Half: scomparso dalla lista ✅
- `bom=1284` confermato dal debug logging ✅
- Problemi visibili sono tutti legittimi (Scallops missing BOM reale, subrecipe senza yield, prep no trusted mapping)


---

## SESSIONE 5 LUGLIO 2026 (sera) — Audit prep principali + bonifica BOM (DB only, boh-v530)

**Versione sw.js live:** boh-v530 (nessun bump questa sessione — solo DB)
**Supabase:** ydqmumpytgrlceuinoqt

---

### Fix eseguiti in questa sessione

**Nutella Mix**
- `base_weight_g = 550` (500g Nutella + 50g Sunflower Oil), `serving_weight_g = 40g` ✅
- Italian Marble Cake BOM aveva già bom_id=1852 RECIPE Nutella Mix 40g ✅

**Dati ricette corretti (base_weight_g mancanti)**
- Filets: `base_weight_g = 908` (4×227g) ✅
- Halved Tomatoes: `base_weight_g = 1000` ✅
- Shaved Parmesan: `base_weight_g = 3000` ✅
- Roasted Almonds: `base_weight_g = 1000` ✅
- Chop Romaine (cf6d1561): `base_weight_g = 1000` (era 700000 — errore enorme) ✅
- Thaw Salmon: `pos_name = NULL` (era stringa vuota '') ✅

**Nuove ricette create**
- Lemon Zest (`70518e0e`) — BOM: 2 Lemon pz, 2 steps, shelf_life=2gg. prep_task 436 collegato
- Orange Supreme (`f98c0842`) — BOM: 2 Orange pz, 3 steps, shelf_life=2gg. prep_task 250 collegato
- Onion Rings (`68e2947c`) — BOM: Red Onions 300g, 1 step, shelf_life=1gg. prep_task 273 collegato. Artichoke BOM: Red Onions ITEM → RECIPE Onion Rings 30g ✅
- Confit Tomatoes — ricetta esistente TOMATOES CONFIT (3c7b1350) collegata a prep_task 451. `base_weight_g=150`, `base_servings=1` ✅
- Bacon Crumbs (`f3775587`) — BOM: Bacon 500g, 4 steps (forno 9min, asciuga, trita, conserva), `base_weight_g=250` (50% resa), shelf_life=5gg. prep_task 234 collegato
- White Chocolate — nuovo ingrediente creato (`15452d89`)

**Ingredient link (prep senza ricetta)**
- Mint liquid (id=376, id=352) → ingredient_id: Mint Syrup
- Basil flowers (id=235) → ingredient_id: Basil
- Flowers (id=455) → ingredient_id: Edible Flower
- Shrimp (id=470) → ingredient_id: Shrimp
- Chopped dark choc (id=337) → ingredient_id: Dark Chocolate
- Chopped white choc (id=338) → ingredient_id: White Chocolate (nuovo)
- Cocoa powder (id=339) → ingredient_id: Cocoa Powder
- Choco logo (id=387) → ingredient_id: Dark Chocolate
- Powder sugar (id=359) → ingredient_id: Powdered Sugar

**Recipe link (prep collegate a ricette esistenti)**
- Porterhouse (id=461) → recipe_id: Ribeye Steaks (1ccd91e0)
- Confit tomatoes (id=451) → recipe_id: TOMATOES CONFIT (3c7b1350)

**Bonifica BOM — ITEM → RECIPE (sostituzione sistemica)**
- Grated Pecorino: tutti gli ITEM Pecorino Romano → RECIPE Grated Pecorino (9 ricette) ✅
- Diced Butter (≤20g): ITEM Butter → RECIPE Diced Butter (10 ricette) ✅
- Shredded Carrots: SOLO House Salad (bom_id=856) → RECIPE Shredded Carrots. Resto rollbackato ✅
- Halved Tomatoes: 9 ricette → RECIPE Halved Tomatoes (escluse Bresaola/Fettuccine Allo Scoglio rollbackate + self-reference rollbackata) ✅
- Roasted Almonds: ITEM Sliced Almonds → RECIPE Roasted Almonds (2 ricette) ✅
- Lemon Zest: ITEM Lemon Zest → RECIPE Lemon Zest (1 ricetta: PASTA FROLLA) ✅

**Correzioni BOM unità (g → kg)**
- FOCACCIA Flour: 8400g → 8.4kg
- Parmesan Grated Parmesan Cheese: 7000g → 7kg (poi corretta a 2kg — batch realistico)
- Grated Pecorino Pecorino Romano: 7000g → 7kg
- Ranch Dressing Buttermilk: 3900g → 3.9kg
- Ranch Dressing Mayo: 3785g → 3.8kg
- Shaved Parmesan Parmesan Cheese: 3000g → 3kg
- POMODORO SAUCE Canned Tomatoes: 3000g → 3kg
- Grilled Chicken Chicken Breast: 3000g → 3kg
- ARRABBIATA Canned Tomatoes: 2950g → 2.95kg
- BESCIAMELLA Flour: 1500g → 1.5kg
- BESCIAMELLA Butter: 1300g → 1.3kg

**Conversione unità BOM**
- Cacio e Pepe Sauce: Milk 128oz → 1 gallone ✅

**Stock NULL → 0 (bot non skippa domani)**
- Basil flowers (id=235), Thaw Salmon (id=413), Choco logo (id=387), Chopped dark choc (id=337), Chopped white choc (id=338), Cocoa powder (id=339), Mint liquid (id=376), Powder sugar (id=359), Lemon Zest (id=436), Orange supreme (id=250) → current_stock = 0 ✅

**Regole stabilite**
- Diced Butter: ≤20g → RECIPE, >20g → resta ITEM Butter
- Shredded Carrots: solo House Salad usa RECIPE, tutti gli altri usi sono carote raw in ricette diverse
- Parmesan Grated: batch realistico = 2kg (non 7kg), si gratta on-demand dalla ruota

---

### Pendenti aperti

1. **Salmon Aioli BOM** — ingredienti da aggiungere quando Max ha la ricetta
2. **Garlic Oil / Bruschetta** — Max sistema manualmente (BOM Bruschetta usa ITEM Garlic Oil come RECIPE da fare)
3. **GF Sponge Cake** — ricetta esiste, non collegata. Da fare in sessione futura
4. **Pastry Station NO_BASE_WEIGHT** (Creme brulee, Cremino, Mimosa, Mint bavarese, Panna cotta, Tiramisu) — nessun problema operativo: bot usa base_servings per pezzi, nessun bot flagga questi. Da lasciare
5. **Gnocchi prep_type = NULL** — da impostare a 'supporto'
6. **Chop Romaine id=364** — prep_task con recipe_id=NULL. La ricetta cf6d1561 esiste. Da collegare
7. **Thaw Salmon current_stock** — impostato a 0 stanotte. Verificare con Max la mattina
8. **NO_RECIPE rimanenti (da fare in prossima sessione):**
   - Salad: Cantaloupe, Caprese seasoning, Goat cheese, Honey, Olives (ingredient link), Sliced Mozzarella, Sliced Tomatoes, Walnuts
   - Sauté: Season Focaccia
   - Table Side: Branzino tableside, Ny strip
   - Pastry: GF sponge cake
9. **NO_BASE_WEIGHT rimanenti:** Chicken Parmesan, Diced Grilled Chicken, Pancetta (La N°4), Grilled Chicken, Bruschetta, Spring mix, Watermelon Cubes, Tomahawk, Wagyu ribeye
10. **BOM vuoti rimanenti:** Brisket, Soffritto Livornese, Brussels Sprouts Par Cook (solo ingrediente 1500g Brussel Sprouts da aggiungere — steps già presenti)
11. **Pomodori Caprese fette** (idea sessione 2 luglio) — Classic Caprese 5 fette, Tuscany Road Trip 3 fette — quante fette per pomodoro? Da chiedere a Max

---
## Sessione 2026-07-06 — Jarvis/Chef AI Engine

### Fatto
- Migration DB applicata: `chef_ai_memory`, `chef_ai_action_drafts`, `chef_ai_audit_log`, + colonne `reasoning_result` e `jarvis_status` su `office_items`
- Edge Function `jarvis-reason` v1 deployata (ReAct loop, 9 tool read-only, Mac mini primario / OpenRouter fallback)
- `office.js` aggiornato con UI Chef AI completa (card thinking, card ready, approval sheet, reasoning sheet, audit log, memoria)
- Bottone `🤖 Chef AI` su card `ai_scan` e `bot-recipe-guardian` (L666-L673 di office.js)
- Test reale su card Brussel Sprouts: `jarvis_status=ready`, `confidence=0.9`, `model_used=ollama/qwen3:8b`, 1 action_draft creata
- Versione live su GitHub: **boh-v536** ✅

### Problema irrisolto — Cache browser iPhone
Il deploy GitHub Pages è andato a buon fine (boh-v536 live) ma Max vede ancora i vecchi bottoni "Later/Solved".
Il codice su GitHub è CORRETTO (verificato L666-L673 office.js live).
**È un problema di cache service worker sul browser di Max.**
Soluzione al prossimo avvio: chiedere a Max di fare hard refresh o cancellare dati sito `1cos.github.io` da Impostazioni Safari.
Se persiste: bumpa sw.js di +1 (boh-v537) senza toccare office.js — questo forza il service worker a scaricare tutto da capo.

### Problema GitHub Actions workflow
`cancel-in-progress: true` nel workflow causa fallimenti quando i commit arrivano ravvicinati.
Il token GitHub non ha scope `workflow` — non è possibile modificare `.github/workflows/pages.yml` da Claude.
**Fix necessario da fare manualmente da Max su GitHub:** cambiare `cancel-in-progress: true` → `false` in `.github/workflows/pages.yml`.
Workaround funzionante: dopo commit falliti, triggerare `workflow_dispatch` via API con coda vuota.

### Prossima sessione
1. Verificare che Max veda boh-v536 con bottoni 🤖 Chef AI (se non li vede, bumpa a boh-v537)
2. Testare il flusso completo: tap 🤖 Chef AI → card thinking → card ready → Approva → esecuzione action_draft
3. Aggiungere trigger automatico `jarvis-reason` quando arriva una nuova card Tell Chef (nel bot-tell-chef-reader)
4. Fix `cancel-in-progress` nel workflow (richiede che Max lo faccia da GitHub web UI)

---

## SESSIONE 6 LUGLIO 2026 — Refactor UI /dev/ — Design System + Recipe Pages

**Versione sw.js live:** boh-v541 (root brigade-main invariata)
**Ambiente dev:** https://1cos.github.io/back-of-house/dev/ (branch brigade-main, cartella /dev/)

### Decisioni architetturali prese

**Ambiente /dev/ creato:**
- Cartella `/dev/` in brigade-main — URL separato per sviluppo UI
- `dev/index.html`: carica JS da `../js/` per default, da `dev/js/` quando modificati
- `dev/sw.js`: cache `boh-dev-v2`, scope `/back-of-house/dev/`
- `dev/manifest.json`: start_url e scope corretti per /dev/
- Root brigade-main invariata — i ragazzi non vedono nulla
- Regola: quando si modifica un JS per il refactor, va in `dev/js/` già modificato

**Design system definito (light theme, stile L'Ufficio):**
- Sfondo: `linear-gradient(160deg,#eff6ff 0%,#dbeafe 60%,#e0f2fe 100%)`
- Card glass: `rgba(255,255,255,0.65)` + `backdrop-filter:blur(14px)` + bordo `rgba(59,130,246,0.18)`
- Blu come accento SOLO su icone/tab/bordi — MAI come sfondo
- Testo primario: `#1e3a5f` (navy), secondario: `#60a5fa`
- Font: 16px titoli card, 15px testo normale, 13px label, 11px uppercase micro-label
- Zero emoji — rimpiazzate con SVG outline
- Badge DEV blu fisso in alto a destra su /dev/

**Navigation bar (implementata):**
- Home → top bar classica (avatar + greeting + campanella) — invariata
- Qualsiasi altra pagina → top bar SPARISCE, appare navigation bar con: ← indietro + titolo + azioni
- Implementato in `dev/js/app.js`: tab click handler nasconde `#mainTopBar` per tutti i tab tranne Home (id="mainTopBar" aggiunto al div top bar in dev/index.html)

**Recipes page (implementata in /dev/):**
- Lista ricette: stile lista verticale (non griglia 2 colonne) con bordo sinistro blu + chevron →
- Category chips: stile Ufficio (navy attivo, glass inattivo)
- Search bar: con icona lente SVG
- Nav bar: ← + "Recipes" + "+ New" (solo admin)

**Recipe Preview page (implementata):**
- Sezione `id="vRecipePreview"` — `position:fixed;top:0;left:0;right:0;bottom:0;z-index:50`
- Nav bar: ← + titolo ricetta + "Edit" (solo admin)
- Tab bar: Ingredients / Steps / Notes
- Ingredients: lista con bordo sinistro (viola=prep, blu=ingrediente), scaling +/- servings
- Steps: numerati con timer in minuti
- Notes: Equipment + Procedure separati
- Apertura da `openRecipeByData()` → `openRecipePreviewPage(rec)`

**Recipe Edit page (implementata):**
- Sezione `id="vRecipeEdit"` — `position:fixed;top:0;left:0;right:0;bottom:0;z-index:51`
- Nav bar: ← + "Edit Recipe" + "Save" (blu)
- Tutti i campi: Title, Menu Group, POS Name, Base Servings, Total Weight, Prep Time, Shelf Life, Price, Equipment, Procedure, Steps (read-only view), Delete Recipe
- Save: upsert su `recipes`, aggiorna SHOP_RECIPES cache, torna a preview
- Apertura da bottone "Edit" in preview → `openRecipeEditPage(rec)`

**iOS scroll lock (fix critico):**
- Problema: `position:fixed` su iOS non blocca scroll/touch della pagina sotto
- Soluzione: `body.classList.add('recipe-page-open')` che applica `position:fixed` al body
- CSS: `.recipe-page-open { position:fixed; top:0; left:0; right:0; bottom:0; overflow:hidden; background:#eff6ff; touch-action:none; }`
- JS: salva `window._recipePageScrollY = window.scrollY` e `body.style.top = '-Npx'` all'apertura, ripristina alla chiusura
- Applicato sia a Preview che a Edit

### File modificati in /dev/

| File | Cosa fa |
|---|---|
| `dev/index.html` | Sezioni vRecipePreview + vRecipeEdit, nav bar con id="mainTopBar", CSS design system + body lock |
| `dev/sw.js` | Cache boh-dev-v2 |
| `dev/manifest.json` | Scope /dev/ |
| `dev/js/app.js` | showSection + tab click handler: nasconde topbar su non-home |
| `dev/js/recipes.js` | renderRecipes (lista+chips), openRecipePreviewPage, openRecipeEditPage, closeRecipePreviewPage, saveRecipeEditPage, deleteRecipeFromPage, rpScaleServings |

### Workflow deploy /dev/

**Il workflow `pages.yml` ha `cancel-in-progress: true`** — causa fallimenti se si pusha troppo veloce.
Fix necessario (richiede scope `workflow` che il token non ha): Max deve cambiare manualmente su GitHub web UI `.github/workflows/pages.yml` riga `cancel-in-progress: true` → `false`.
Workaround attuale: dopo un push, triggera `workflow_dispatch` via API separata se il deploy fallisce.

### Prossima sessione — da fare

1. **Sistema tab stile Safari** — chips pagine aperte nella navigation bar, + per nuova tab
   - Ogni tab ha il suo stack indipendente
   - Puoi tenere aperta una ricetta in una tab, L'Ufficio in un'altra
   - Max ha confermato di volerlo

2. **Prep page** — navigation bar + card stile Ufficio (bordo urgenza, font 15px)

3. **Office page** — già buona, solo aggiustamenti minori (emoji→icone, font)

4. **BOM editor in Edit page** — oggi la pagina Edit non ha l'editor BOM (ingredienti)
   Il BOM editor è complesso (`ingList`, sub-recipe handling) — sessione dedicata

5. **Steps editor in Edit page** — oggi mostra gli steps read-only, manca il + per aggiungere step

6. **Aggiornare dev/js/app.js** — aggiungere tutte le sezioni alla lista nascosta/mostrata in showSection (attualmente mancano vRecipePreview e vRecipeEdit dalla lista)

7. **cancel-in-progress: false** nel workflow — da fare manualmente da Max su GitHub

### Nota importante per prossima sessione
Il sistema tab Safari va progettato PRIMA di toccare altre pagine — è l'infrastruttura di navigazione che le altre pagine useranno. Progettare prima, poi implementare su Recipes come pilota, poi estendere.


---

## SESSIONE 6 LUGLIO 2026 — boh-v541→v543 — Bot Debug v2 + bot-preplist-v2

**Versione finale sw.js:** boh-v543
**Supabase:** ydqmumpytgrlceuinoqt

---

### Discussione architetturale: disallineamento stock tra bot v1 e sim

**Problema discusso (non era un bug):** la sim v7 mostrava `current_stock=457 nests` per Spaghetti, il bot reale scriveva "40 nests" nella pill. La divergenza era intenzionale by design — il bot alle 4AM calcola `stockPresunto = currentStock - vendutoIeri` internamente e usa quello nel testo, senza scrivere il valore su DB. La sim leggeva il `current_stock` grezzo.

**Principio stabilito (fondamentale):**
> `current_stock` è la fonte di verità unica. Tutti devono leggere da quella colonna. Nessun bot deve calcolare stock "in testa" senza scrivere il risultato nel DB — altrimenti i numeri divergono tra chi li usa.

Questo ha portato alla decisione di creare `bot-preplist-v2` con logica trasparente.

---

### Bot Debug — tab v1/v2 (v542→v543)

**v542:** Bot Debug (`admin.js`) convertito da tabella a card expandable per Bot v1 (sim esistente). Card collapsed mostra pill + nome + stock + messaggio + barra copertura. Card expanded mostra "Perché il bot dice questo" con tutti i campi da `bot_debug_runs`.

**v543:** Aggiunta tab switcher nel Bot Debug:
- **Bot v1** — simulazione esistente (bot-preplist-sim), invariata
- **Bot v2** — nuova logica semplice, pulsante "Calcola Bot v2"

Funzioni aggiunte in `admin.js`: `bdSwitchTab()`, `runBotV2()`, `_bv2Toggle()`, `_bv2Row()`.

---

### bot-preplist-v2 — Edge Function nuova (4 versioni in sessione)

**Tabella creata:** `bot_v2_runs` — scrive SOLO qui, non tocca mai `prep_tasks`, `bot_debug_runs`, o `suggested_note/qty`.

**Colonne:** `id, run_at, run_by, sim_date, task_id, task_name, category, unit, current_stock, planning_window_days, planning_window_source, open_service_days, consumo_giornaliero, fabbisogno, delta, pill, suggested_qty, suggested_note, arrival_day, percorso`

**Logica:**
1. Legge `current_stock` grezzo dal DB — fonte di verità unica, mai modificato
2. Finestra di pianificazione con priorità: `expected_duration_days` → `shelf_life_days` → `prep_frequency_days` → default 3. Fonte sempre visibile nel percorso.
3. Consumo per DOW: media storica 60 giorni, **aggregata per data** prima di calcolare la media (fix bug alias multipli)
4. `fabbisogno = somma consumo per ogni giorno aperto nella finestra` (no divisione/rimoltiplicazione intermedia)
5. Giorni coperti: simulazione giorno per giorno con consumo reale per DOW
6. Pill: green/yellow/red da `giorniCoperti` vs `min_cover_days`
7. Suggested qty: arrotondato al batch (`base_weight_g`) se disponibile, altrimenti `free_quantity`
8. Percorso dettagliato giorno per giorno: `Mar: 8.25p x 150g = 1.2kg | ...`

**v1:** prima versione — bug doppia media
**v2:** fix doppia media (fabbisogno diretto, no divisione/moltiplicazione)
**v3:** aggiunto percorso giorno-per-giorno (`Mar: Np x Xg = Yg`)
**v4 (finale):** fix aggregazione per data — il problema principale

**Bug critico risolto in v4 — aggregazione per data:**
Il bot costruiva `salesByItem[alias][dow] = [qty per riga]`. Se lo stesso giorno aveva due righe (`Fried Calamari: 10` e `Calamari: 1`), le inseriva come due elementi separati → il denominatore della media era sbagliato.
Fix: aggregazione per data prima. `dateTotals[date] += qty` per tutti gli alias che matchano → poi `dowMap[dow].push(totaleDiQuellData)`. Martedì calamari: da 6.6p a **8.25p** corretto.

**Perché "Calamari" e "Fried Calamari" nel POS:**
Due bottoni distinti — `Fried Calamari` (Antipasti/appetizer, 199 porzioni) e `Calamari` (Happy hours, 5 porzioni). Stesso piatto fisico, prezzi/contesti diversi. Il bot li somma correttamente tramite `pos_name` con alias pipe-delimited.

**Metodi di calcolo media discussi (nessuna decisione presa, per ora rimane media semplice per DOW):**
1. Media semplice per DOW (attuale) — stabile, equanime
2. Media pesata per recency — reagisce ai trend recenti
3. Media su settimane complete incluse quelle a 0 — conservativa

---

### Stato versioni finale sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v543** |
| bot-preplist-builder | v41 (Supabase v60) — invariato |
| bot-preplist-sim | v6 (Supabase v6) — invariato |
| bot-preplist-v2 | **v4** (Supabase v4) — NUOVO |
| bot_v2_runs | tabella creata oggi |

---

### Pendenti aperti da questa sessione

1. **UI card prep** — rimandato. Spec definita (collapsed: stock DB + coverage + barra; expanded: "Perché il bot dice questo"). Da fare in sessione dedicata.
2. **bot-preplist-v2 — production_type** — per ora usa solo `free_quantity` (arrotonda al batch se `base_weight_g`) e `minimum_unit`. I tre tipi completi (`free_quantity`, `minimum_unit`, `portioned_unit`) non ancora implementati — campo da aggiungere alla ricetta.
3. **bot-preplist-v2 — media pesata per recency** — discussa, non implementata. Da valutare in sessione dedicata.
4. **bot-preplist-v2 cron** — nessun cron aggiunto, trigger solo manuale dal Bot Debug.
5. **Aggiornamento BOH_OS_BACKLOG.md** — da fare, versioni Edge Function non aggiornate (ferme a v428).



---

## Sessione 7 luglio 2026 — Brigata di Bot + La Dispensa

### Decisioni prese

- **La Dispensa** = nuova sezione in L'Ufficio (admin-only per ora, in futuro nel bottom bar)
- **Ordine di build corretto:** prima Brigata Bot → poi tabelle DB → poi UI La Dispensa
- **Motivazione:** le tabelle devono essere disegnate da chi le scrive (i bot), non prima

---

### Architettura Brigata di Bot — SPECIFICA COMPLETA

Pipeline notturna 04:00–06:00 CDT. Ogni bot scrive **solo la sua tabella**. Nessun bot tocca ciò che non è suo.

#### Regole costituzionali (inviolabili)
- Bot 1→3 non toccano mai `current_stock`
- Solo Bot 4 (Stock Consolidator) aggiorna `current_stock` su `prep_tasks`
- Solo Bot 5 aggiorna `suggested_qty` e `suggested_note`
- I Commis AI **osservano e scrivono in `commis_observations`** — non modificano mai dati
- Nessun bot deve partire se quello precedente ha fallito (pipeline con dependency check)
- Meglio un dato incompleto dichiarato che un dato sbagliato spacciato per vero

#### Scheduling

| Ora CDT | Bot | Descrizione |
|---|---|---|
| 04:00 | Bot 1 — POS Importer | Copia raw da POS |
| 04:05 | Commis 1 — POS Auditor | Controlla anomalie POS |
| 04:15 | Bot 2 — POS Cleaner | Canonicalizza nomi POS→ricette |
| 04:20 | Commis 2 — Name Matching Auditor | Controlla match dubbi |
| 04:30 | Bot 3A — Direct Deduction | Scarico ricette dirette |
| 04:35 | Commis 3A — Direct Deduction Auditor | Controlla scarichi diretti |
| 04:45 | Bot 3B — BOM Chain Deduction | Scarico catene BOM complesse |
| 04:55 | Commis 3B — BOM Auditor | Controlla BOM incomplete/anomale |
| 05:10 | Bot 4 — Stock Consolidator | Consolida snapshot finale |
| 05:15 | Commis 4 — Stock Auditor | Controlla discrepanze stock |
| 05:30 | Bot 5 — Prep Suggester | Genera suggerimenti prod. |
| 05:40 | Commis 5 — Prep Suggestion Auditor | Controlla suggerimenti anomali |
| 05:50 | Bot 6 — Chef Auditor | Briefing mattutino per Max |

---

#### Bot 1 — POS Importer
**Fa una cosa sola:** legge dati POS reali del giorno prima. Non ragiona, non prevede.

**Legge:** `pos_sales_by_item`, `pos_production_daily`, `pos_modifier_by_item`

**Scrive:** tabella `pos_daily_raw`
```
pos_daily_raw
- id
- date
- pos_item_name        (nome originale dal POS)
- canonical_name       (copia diretta, nessuna interpretazione)
- portions_sold
- revenue
- source              ('sales_by_item' | 'modifier' | 'production_daily')
- imported_at
```

---

#### Bot 2 — POS Cleaner / Canonicalizer
**Fa una cosa sola:** mappa nomi POS → recipe_id.

Esempio: "Chicken Parmesan", "Chicken Parm", "Chicken Parmigiana" → stesso `recipe_id`.

**Legge:** `pos_daily_raw`, `recipes.pos_name` (pipe-delimited aliases), `pos_item_aliases`

**Scrive:** tabella `pos_daily_clean`
```
pos_daily_clean
- id
- date
- pos_item_name        (originale)
- recipe_id            (UUID ricetta matchata, NULL se non trovata)
- canonical_name       (nome pulito)
- portions_sold
- match_type          ('exact' | 'alias' | 'fuzzy' | 'unmatched')
- confidence          (0.0–1.0)
- warning             (testo se match dubbio o non trovato)
- created_at
```

Se non è sicuro: non inventa. Scrive `match_type='unmatched'` e `warning`.

---

#### Bot 3A — Direct Recipe Deduction
**Fa una cosa sola:** scarico dalle ricette con POS diretto.

Ricette "dritte": hanno `pos_name` non nullo e BOM con prep_task collegata direttamente.

**Legge:** `pos_daily_clean`, `recipe_bom`, `prep_tasks`

**Scrive:** tabella `stock_deductions`
```
stock_deductions
- id
- date
- task_id             (FK prep_tasks)
- recipe_id           (ricetta che ha generato lo scarico)
- source              ('direct_recipe')
- portions_sold
- grams_per_portion
- quantity_deducted   (in unità del task)
- unit
- confidence          (1.0 per diretti)
- bom_path            (es. "Salmon Cakes → prep:salmon_cakes")
- warning
- created_at
```

---

#### Bot 3B — BOM Chain Deduction
**Fa una cosa sola:** scarico dalle catene BOM complesse (sub-ricette, ingredienti sparsi).

Questo è il bot più delicato — qui nascono gli errori. Va tenuto separato da 3A proprio per isolare i problemi.

**Legge:** `pos_daily_clean`, `recipe_bom` (ricorsivo), `prep_tasks`, `ingredients`

**Scrive:** stessa tabella `stock_deductions` con `source='bom_chain'`

Campi extra importanti:
```
- bom_path    (es. "Chicken Parm → Tomato Sauce → Arrabbiata Base")
- confidence  (< 1.0 se BOM incompleta o path ambiguo)
- warning     (es. "BOM missing mozzarella for Chicken Parm")
```

---

#### Bot 4 — Stock Consolidator
**È il capo magazziniere.** Non interpreta ricette, non legge POS.

Prende SOLO:
- Carichi: `prep_log` del giorno
- Scarichi: `stock_deductions` del giorno
- Waste/adjustment manuali (futura tabella `stock_adjustments`)
- Conteggi fisici manuali

**Scrive:** tabella `stock_daily_snapshot`
```
stock_daily_snapshot
- id
- date
- task_id             (FK prep_tasks)
- unit
- stock_start         (stock inizio giornata = stock_end del giorno prima)
- loaded_qty          (carico dai ragazzi — da prep_log)
- pos_deducted_qty    (scarico POS — da stock_deductions)
- waste_qty           (future waste entries)
- adjustment_qty      (correzioni manuali)
- stock_end           (stock_start + loaded - deducted - waste ± adjustment)
- is_partial          (true se Bot 3B ha fallito)
- created_at
```

**È l'unico bot che poi aggiorna `prep_tasks.current_stock`** con `stock_end`.

---

#### Bot 5 — Prep Suggester
Attuale `bot-preplist-builder` ma ripulito di tutto il codice di scarico stock.

**Legge SOLO:** `stock_daily_snapshot` (stock attuale), storico consumi per DOW, `prep_tasks` (batch_size, shelf_life, min_cover_days)

**Scrive:** `prep_tasks.suggested_qty`, `prep_tasks.suggested_note`, `bot_preplist_log`

---

#### Bot 6 — Chef Auditor
Non cambia dati. Legge tutto e scrive osservazioni.

**Legge:** `pos_daily_raw`, `pos_daily_clean`, `stock_deductions`, `stock_daily_snapshot`, `commis_observations`

**Scrive:** `commis_observations` con severity alta (solo anomalie vere, niente rumore)

**Output briefing alle 06:00:**
```
Good morning Chef.
Night run completed.
POS: 126 items processed, 3 unmatched.
Stock: 92 snapshots updated, 14 items below par.
Issues:
1. Spaghetti allo Scoglio sold 0 (avg Monday: 5.2) — check POS mapping
2. Chicken Parm BOM missing mozzarella — check recipe
3. Arrabbiata 5kg below expected — possible waste
Suggested focus: fix Scoglio mapping, make Arrabbiata + Salmon Cakes
```

---

#### Commis AI — regola generale
Ogni Commis affianca il proprio bot. Regole:

- **Non modifica mai dati**
- Scrive solo in `commis_observations`
- La maggior parte sono **regole deterministiche** (if venduto=0 AND media>3 → warning), non LLM
- LLM solo per generare la spiegazione umana leggibile
- Propone `proposed_fix` con `status: needs_chef_approval` — Max clicca Approve/Later/Ignore

**Tabella `commis_observations`** (già esiste come `ai_watch_items` — verificare se estendere quella o creare separata):
```
- id
- date
- bot_name
- commis_name
- severity           ('info' | 'warning' | 'critical')
- category           ('pos_anomaly' | 'bom_incomplete' | 'stock_discrepancy' | 'prep_suggestion' | 'name_mismatch')
- entity_type        ('recipe' | 'prep_task' | 'ingredient' | 'pos_item')
- entity_id
- title
- explanation
- suggested_action
- proposed_fix       (JSONB, opzionale)
- status             ('open' | 'approved' | 'ignored' | 'later')
- created_at
```

---

### Tabelle nuove da creare (in ordine)

1. `pos_daily_raw` — Bot 1
2. `pos_daily_clean` — Bot 2
3. `stock_deductions` — Bot 3A + 3B
4. `stock_daily_snapshot` — Bot 4 (**alimenta La Dispensa**)
5. `stock_adjustments` — future waste/correction manuali

Verificare se `commis_observations` è già `ai_watch_items` o va creata separata.

---

### La Dispensa — UI (da costruire DOPO brigata bot)

Posizione: L'Ufficio → card "La Dispensa" (admin-only)
Future: bottom bar

**Struttura tab:**
```
La Dispensa
├── 🥘 Cucina         → legge stock_daily_snapshot per prep_tasks
├── 📦 Magazzino      → legge stock_daily_snapshot per ingredients (futuro)
├── 📋 Movimenti      → legge stock_deductions drill-down
└── 🤖 Bot Debug      → legge bot_runs — esploso pipeline
```

**Vista Cucina — foglio scorrevole:**
- Colonne fisse: Nome · Stock oggi · Stazione
- Colonne scorrevoli (destra→sinistra, più recente prima): per ogni giorno → **+carico** (verde) e **−POS** (rosso)
- Click su una cella → drill-down (quali piatti hanno scaricato quella prep quel giorno)
- Colori: stock critico rosso, sotto soglia giallo, ok verde

---

### Fix pushato questa sessione

- **boh-v558** — `admin.js`: `_bv2Contributors` ora legge `prep_tasks.sources_json` invece di requeryare tutto il POS lato client. Elimina "Nessuna fonte trovata" per task con sources_json popolato.

---

### Note operative sessione

- `bot_preplist_log` contiene fabbisogno **futuro** (proiezione), NON scarico reale — chiarito definitivamente
- Lo scarico reale viene da `pos_production_daily` × BOM — dati certi, non stime
- `pos_production_daily` ha già 17 giorni di storia reale (dal 5 giugno)
- `prep_log` ha 17 giorni di storia carico (dal 5 giugno, 160 prep distinte)
- Backfill storico 17 giorni: possibile via SQL dopo che le tabelle sono create dalla brigata bot


---

## SESSIONE 7 LUGLIO 2026 (continuazione) — Sprint 2: bot-pos-cleaner v1

**Versione sw.js live:** boh-v562 (invariato — zero file frontend toccati)
**Supabase:** ydqmumpytgrlceuinoqt

---

### Checkpoint Sprint 1 — verificato prima di Sprint 2

Eseguito verification checkpoint su `pos_daily_raw` per `2026-07-06`:

- **197 righe totali:** 50 da `pos_sales_by_item` (191 porzioni), 96 da `pos_modifiers` (524 porzioni)
- **Il 6 luglio era lunedì** — il Commis aveva scritto "domenica/festività" per errore nel testo, ma i dati erano corretti. Cucina aperta, servizio regolare.
- **Top food:** Wheel Pasta 10, Meatball 9, Calamari 9, Lobster Fettucine 8, Mini Caesar 8, Beef Ravioli 8, Risotto Mushrooms 7...
- **58 missing_mapping** classificate manualmente in 5 categorie: SYSTEM (17), BAR (16), SERVER (16), KITCHEN_OPERATIONAL (12), MENU_ITEM_MANCANTE (3 food item senza ricetta Brigade).

**Decisione chiave:** non hardcodare la lista nel bot, ma creare una tabella configurabile `pos_item_class_rules`.

---

### Chiarimento architettura TouchBistro POS Bot

Il "TouchBistro POS Bot" è diviso in stazioni interne della Brigata:

```
TouchBistro POS Bot
├── Station 1 — bot-pos-importer    → pos_daily_raw       ✅ v6
├── Station 2 — bot-pos-cleaner     → pos_daily_clean     ✅ v1 (questa sessione)
└── Station 3 — bot-stock-drain     → stock_movements     (aggiornamento pendente)
```

**Nome corretto Edge Function:** `bot-pos-cleaner` (non `bot-recipe-matcher v2` — il Recipe Matcher è un bot separato già esistente).

---

### Sprint 2 — bot-pos-cleaner v1

**Edge Function:** `bot-pos-cleaner` v1 — deployata e ACTIVE
**bot_name:** `pos-cleaner`
**Commis:** `mapping-commis` (deterministico, zero LLM)
**Input:** `pos_daily_raw` | **Output:** `pos_daily_clean` + `commis_observations`

**Migration DB applicata:** `pos_cleaner_sprint2_foundation`
- Nuove colonne su `pos_daily_clean`: `item_class`, `class_source`, `rule_id`, `action`
- Nuova tabella `pos_item_class_rules` (configurazione dati, non hardcode)
- FK `pos_daily_clean.rule_id → pos_item_class_rules.id`
- Indice su `(active, source_table, priority)`

**Seed iniziale `pos_item_class_rules`:** 69 regole
- 20 SYSTEM_IGNORE (incluso `Fired at` starts_with per tutti i timestamp)
- 19 BAR_IGNORE (liquori, cocktail, mixer — tutti da `pos_modifiers`)
- 18 SERVER_INSTRUCTION (allergie, temperature, sostituzioni)
- 9 KITCHEN_OPERATIONAL (Caesar, Berry Coulis, Daily risotto, Mash potatoes, citronette, Burratta, Spaghetti Pomodoro, Ranch, Risotto)
- 2 MENU_ITEM noti senza ricetta (Risotto Mushrooms And Steak, Branzino Chef Style)
- 1 OPEN_ITEM_MANUAL (Open Food)

**Classi item_class:**
| Classe | action | Verso stock? |
|---|---|---|
| MENU_ITEM | map | ✅ Sprint 3+ |
| KITCHEN_OPERATIONAL | map | ✅ Sprint 3+ |
| SYSTEM_IGNORE | ignore | ❌ mai |
| BAR_IGNORE | ignore | ❌ mai |
| SERVER_INSTRUCTION | ignore | ❌ mai |
| OPEN_ITEM_MANUAL | manual_review | ❌ mai auto |
| UNKNOWN_REVIEW | manual_review | ❌ finché non classificato |

**Logica classificazione:**
1. Cerca match su `pos_item_class_rules` (exact → starts_with → contains → regex, priority ASC)
2. Default: `pos_sales_by_item` senza regola → MENU_ITEM; `pos_modifiers` senza regola → UNKNOWN_REVIEW
3. Per MENU_ITEM + KITCHEN_OPERATIONAL: cerca ricetta via `recipes.pos_name` (pipe-delimited) + `pos_item_aliases` + Kids menu logic
4. Commis Auditor: SYSTEM/BAR/SERVER → silenzio totale; altri → observations mirate

**Idempotenza:** DELETE pos_daily_clean + commis_observations per la data prima di reinserire.

**File MD creati su brigade-main:**
- `bots/pos-cleaner/POS_CLEANER_BOT.md`
- `bots/pos-cleaner/POS_CLEANER_COMMIS.md`
- `bots/pos-cleaner/POS_CLEANER_TEST.md`
- `bots/pos-cleaner/bot-pos-cleaner.js` (copia source)

---

### PRIMO TEST MANUALE — da fare

Max deve triggerare da Supabase Dashboard:

**Edge Functions → bot-pos-cleaner → Invoke:**
```json
{ "business_date": "2026-07-06" }
```

**Query di verifica post-run:**

```sql
-- 1. Distribuzione per item_class
SELECT item_class, action, COUNT(*), SUM(portions_sold)
FROM pos_daily_clean
WHERE business_date = '2026-07-06'
GROUP BY item_class, action
ORDER BY COUNT(*) DESC;

-- 2. Righe mappate a ricetta
SELECT pos_item_name, item_class, match_type, matched_recipe_name, portions_sold
FROM pos_daily_clean
WHERE business_date = '2026-07-06'
  AND action = 'map' AND recipe_id IS NOT NULL
ORDER BY portions_sold DESC;

-- 3. Review queue reale
SELECT pos_item_name, item_class, portions_sold, warning
FROM pos_daily_clean
WHERE business_date = '2026-07-06' AND needs_review = true
ORDER BY portions_sold DESC;

-- 4. Osservazioni Commis
SELECT severity, title, metadata->>'portions_sold' AS porzioni
FROM commis_observations
WHERE business_date = '2026-07-06' AND bot_name = 'pos-cleaner'
ORDER BY severity DESC, (metadata->>'portions_sold')::numeric DESC;

-- 5. Stock intatto
SELECT COUNT(*) FROM stock_movements WHERE business_date = '2026-07-06';
SELECT COUNT(*) FROM stock_daily_snapshot WHERE snapshot_date = '2026-07-06';

-- 6. bot_runs
SELECT bot_name, status, rows_read, rows_written, warnings_count, summary
FROM bot_runs WHERE bot_name = 'pos-cleaner' ORDER BY started_at DESC LIMIT 3;
```

**Atteso:** ~50-60 righe SYSTEM/BAR/SERVER ignorate, ~40-50 MENU_ITEM mappate, review queue di 5-10 item reali.

---

### Aggiornamento regole (future sessioni)

Per aggiungere nuove regole senza deploy:
```sql
-- Aggiungere un drink
INSERT INTO pos_item_class_rules (pattern, match_type, source_table, item_class, action, priority, notes)
VALUES ('Bellini', 'exact', 'pos_modifiers', 'BAR_IGNORE', 'ignore', 10, 'Cocktail — bar');

-- Disattivare una regola
UPDATE pos_item_class_rules SET active = false WHERE pattern = 'Balsamic';
```

---

### PROSSIMA SESSIONE — Sprint 3 update + test Sprint 2

1. **Triggerare bot-pos-cleaner su 2026-07-06** e verificare le 5 query sopra
2. **Decidere modifier operativi**: Caesar, Berry Coulis, Daily risotto, citronette, Mash potatoes — aggiungere a `pos_item_aliases` per enableare mapping
3. **Aggiornare bot-stock-drain** (v1 già esiste) per leggere `pos_daily_clean` con la nuova colonna `item_class` invece della vecchia logica `needs_review=false + match_type IN (...)` — la nuova condizione è `action='map' AND recipe_id IS NOT NULL`
4. **Ricette mancanti**: Risotto Mushrooms And Steak, Branzino Chef Style — Max le crea quando ha le ricette pronte

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v562** (invariato) |
| POS TouchBistro Bot (Importer) | v6 (invariato) |
| POS Cleaner Bot | **v1 (nuovo)** |
| Migration DB | `pos_cleaner_sprint2_foundation` |
| pos_item_class_rules | 69 regole seed |

---

## SESSIONE 7 LUGLIO 2026 (continuazione) — Sprint 3: bot-direct-deduction v1

**Versione sw.js live:** boh-v562 (invariato)
**Supabase:** ydqmumpytgrlceuinoqt

---

### Architettura aggiornata TouchBistro POS Bot

```
TouchBistro POS Bot
├── Station 1 — bot-pos-importer       → pos_daily_raw        ✅ v6
├── Station 2 — bot-pos-cleaner        → pos_daily_clean      ✅ v2
└── Station 3 — bot-direct-deduction   → stock_deductions     ✅ v1 (questa sessione)
```

Prossimi:
- Station 4 — bot-bom-chain-deduction  → stock_deductions (catene BOM complesse)
- Station 5 — bot-stock-consolidator   → current_stock
- Station 6 — La Dispensa UI

---

### Sprint 3 — bot-direct-deduction v1

**Edge Function:** `bot-direct-deduction` v1 — deployata e ACTIVE
**bot_name:** `bot-direct-deduction`
**Commis:** `direct-deduction-commis` (deterministico, zero LLM)
**Input:** `pos_daily_clean` (action='map', recipe_id IS NOT NULL, item_class IN MENU_ITEM/KITCHEN_OPERATIONAL)
**Output:** `stock_deductions` (source='direct_recipe') + `commis_observations`

**Logica:**
1. Per ogni riga mappata di pos_daily_clean → legge BOM della ricetta (solo `component_type='RECIPE'`)
2. Per ogni sub-recipe nel BOM → cerca prep_task attivo collegato
3. Calcola `quantity = bom_qty × portions_sold`
4. Scrive in `stock_deductions`

**Nota tecnica item_id:** `stock_deductions.item_id` è uuid NOT NULL; `prep_tasks.id` è bigint. Soluzione Sprint 3: `item_id = sub_recipe_id` (uuid della prep recipe). `prep_task_id` (bigint) in `metadata.prep_task_id`. Da rivedere in Sprint 5.

**Risultati verificati su 2026-07-06:**
- 58 righe clean lette → **99 deductions** scritte
- source=direct_recipe, item_type=prep
- total_qty = ~53.857g equivalenti di prep
- 13 info (ricette con solo ITEM raw → da fare in Bot 4)
- 3 warning (sub-recipe senza prep_task attivo)
- stock_movements: 335 (pre-esistenti, non toccate da Sprint 3)
- stock_daily_snapshot: 0 ✅

**Idempotente:** `DELETE ... WHERE source='direct_recipe'` prima di reinserire.

**Anomalie note nei dati (da verificare con Max):**
- `Meatball Appetizer → Parmesan Grated`: 340g/porzione — BOM per batch o per porzione?
- `Add chicken → Grilled Chicken`: 2550g/porzione — intentionale (batch pollo completo)
- `Lobster Fettucine → Fettucine`: qty=1 ma unit=g invece di each — disallineamento unità BOM

**File MD creati su brigade-main:**
- `bots/direct-deduction/DIRECT_DEDUCTION_BOT.md`
- `bots/direct-deduction/DIRECT_DEDUCTION_COMMIS.md`
- `bots/direct-deduction/DIRECT_DEDUCTION_TEST.md`
- `bots/direct-deduction/bot-direct-deduction.js`

---

### Cosa non fare in prossima sessione

- ❌ Non toccare current_stock
- ❌ Non costruire La Dispensa UI
- ❌ Non fare Bot 4 BOM Chain senza conferma di Max

### Prossima sessione possibile

Sprint 4 — Bot BOM Chain Deduction: segue catene BOM multi-livello (RECIPE dentro RECIPE) per scaricare anche le prep intermedie che Sprint 3 salta. Da fare solo dopo verifica Sprint 3 da parte di Max.

---

## SESSIONE 7 LUGLIO 2026 (Sprint 3.1, 4, 4v2, 3v2) — Pipeline POS Bot completata

**boh-v562** (sw.js invariato questa sessione)

---

### Stato finale pipeline dopo questa sessione

```
Station 1 — bot-pos-importer   v6   → pos_daily_raw       ✅
Station 2 — bot-pos-cleaner    v2   → pos_daily_clean      ✅
Station 3 — bot-direct-deduction v3 → stock_deductions (direct_recipe) ✅
Station 4 — bot-bom-chain-deduction v2 → stock_deductions (bom_chain)  ✅
Station 5 — bot-stock-consolidator  → current_stock        ⏳ PROSSIMO
Station 6 — La Dispensa UI          →                      ⏳ FUTURO
```

### Risultati verificati su 2026-07-06

| Source | Item type | Righe | Note |
|---|---|---|---|
| direct_recipe | prep | 91 | Aggregato: era 99, 8 eliminate da aggregazione |
| bom_chain | ingredient | 238 | Aggregato: era 253, 15 eliminate; 10 multi-percorso |
| **Totale** | | **329** | Zero duplicati |

**stock_movements:** 335 pre-esistenti, non toccati ✅
**stock_daily_snapshot:** 0 ✅

### Fix e correzioni eseguiti

**Sprint 3.1 — Schema + BOM fixes:**
- Migration `stock_deductions_explicit_targets`: +`target_recipe_id`, +`prep_task_id`, +`ingredient_id`, +`target_name`
- bot-direct-deduction v2: scrive colonne esplicite (non solo metadata)
- Fix BOM Fettuccine: tutte le unità → `nests` (bom_id: 122,346,1607,2094,1398,1396,515,2116,1603)
- Fix BOM Brussels → halved tomatoes: 200g → 20g per porzione (bom_id 1702)
- Add chicken: pos_name spostato su ricetta `add chicken` (259864df), rimosso da `Diced Grilled Chicken`
- Lobster Fettucine → Fettucine: qty 1g → 2 nests (bom_id 2116)
- Gnocco Dough prep_task 271: riattivato, unit=g (era archiviato con unit=batch)
- Siciliana ristrutturata a 3 livelli:
  - Creata ricetta `Siciliana cartoccio` (ad4a691c)
  - BOM cartoccio: Filet Branzino 1pz + SICILIAN MIX 50g + EVOO 10g + White Wine 10g
  - prep_task 282 → punta a Siciliana cartoccio, unit=pz
  - prep_task 281 (Sicilian mix) riattivato, unit=g
  - BOM Siciliana aggiornato: rimuovi componenti diretti, sostituiti con cartoccio 1pz + spinach + garlic oil
- Meatball Appetizer: ricetta cancellata, Meatballs pos_name='Meatball Appetizer|Meatballs|Add Meatballs'

**Sprint 3 v3 — Aggregazione direct_recipe:**
- bot-direct-deduction v3: aggrega porzioni per piatto prima del calcolo
- Chiave aggregazione: `(posItemName, prepTaskId, unit)`
- Da 99 → 91 righe (8 aggregate) → zero duplicati direct_recipe

**Sprint 4 v2 — bot-bom-chain-deduction:**
- Regola STOP: prep stockata = terminale, non scende dentro il BOM
- Siciliana: scarica solo cartoccio/spinach/garlic oil — NON figli del cartoccio
- Aggregazione per `(posItemName, ingredient_id, unit)` → da 253 a 238 righe
- Anti-double: legge direct_recipe esistenti prima di iniziare
- Waygu Tomahawk → Edible Flower: 2 righe bom_chain con unità diverse (pz e g) — è BOM sporco, non bug bot

### Architettura POS deduction — Regola STOP

```
POS sale → scarica prep terminali (direct_recipe)
Prep terminale con prep_task → STOP (non scendere nei figli)
Figli del cartoccio → scaricati solo quando la cucina PRODUCE il cartoccio (futuro Prep Production Bot)
```

### Prossimo step confermato: Stock Consolidator

`stock_deductions` ora è pulita e senza duplicati strutturali.
Il Consolidator legge:
- `stock_deductions` (direct_recipe + bom_chain)
- `prep_log` (produzione prep)
- Aggiorna `current_stock` in `prep_tasks` e `ingredients`

**Non fare ancora:** La Dispensa UI, Prep Production Bot, stock_movements logic.

### Duplicati noti accettati

- Waygu Tomahawk → Edible Flower: 2 righe bom_chain unità diverse (pz, g) — BOM da correggere
- Non portare al Consolidator finché BOM non è allineato

---

## SESSIONE 7 LUGLIO 2026 (chiusura) — BOM Fix Wagyu + Edible Flower

**boh-v563** (sw.js live a inizio sessione)

---

### Fix BOM eseguiti

**Edible Flower (ingrediente):**
- `base_unit` aggiornato: `g` → `pz`
- `measure_type` aggiornato: `weight` → `each`
- Si compra da Hardie's come **FLOWER MARIGOLD 50 CT** a $18.29/scatola
- Waygu Tomahawk: 2 pz (era 2 righe duplicate: 2g + 1pz → ora 1 riga: 2pz) ✅
- Wagyu Ribeye: 1 pz (era 2g → ora 1pz) ✅

**Wagyu Rack — struttura completa creata:**

```
RWPR 103 Rib (ingrediente, 28 lb/rack, $29.05/lb da Hardie's item code 13544)
    ↓
Process Wagyu Rack (ricetta id: b3b3c595) — BOM: 28 lb RWPR 103 Rib
    ↓ produce
Wagyu Tomahawk Portioned (ricetta id: e46a91a5) ← prep_task 477, unit=pz, Table Side
Wagyu Ribeye Portioned   (ricetta id: 1cd28254) ← prep_task 478, unit=pz, Table Side
```

**Wagyu Beef (ingrediente):** rinominato → **RWPR 103 Rib**, base_unit=lb

**BOM piatti POS aggiornati:**
- `Waygu Tomahawk`: rimosso ITEM Wagyu Beef 48oz → aggiunto RECIPE Wagyu Tomahawk Portioned 1pz
- `Wagyu Ribeye`: rimosso ITEM Wagyu Beef 20oz → aggiunto RECIPE Wagyu Ribeye Portioned 1pz

**Nota:** Process Wagyu Rack produce 7 Tomahawk + 7 Ribeye per rack. Il BOM "output" (7pz×2) sarà gestito dal futuro **Prep Production Consumption Bot** — non dal POS bot.

---

### Risultati pipeline finale 2026-07-06

| Source | Righe | Note |
|---|---|---|
| direct_recipe | 93 | +2 rispetto a prima (Wagyu Tomahawk 2pz + Wagyu Ribeye 1pz ora come prep dirette) |
| bom_chain | 235 | -3 rispetto a prima (RWPR 103 Rib raw sparito dai BOM POS) |
| **Totale** | **328** | Zero duplicati ✅ |

Edible Flower: Tomahawk 4pz (2×2), Ribeye 1pz — corretto ✅

---

### PROSSIMA SESSIONE — Sprint 5: Stock Consolidator Bot

**Obiettivo:** bot che legge `stock_deductions` e aggiorna `current_stock` su `prep_tasks` e `ingredients`.

**Logica:**
1. Legge `stock_deductions` per `business_date` (direct_recipe + bom_chain)
2. Legge `prep_log` per `business_date` (carichi della cucina)
3. Per ogni prep_task_id / ingredient_id:
   - `stock_end = stock_start + caricato - dedotto_POS`
4. Scrive `stock_daily_snapshot`
5. Aggiorna `current_stock` in `prep_tasks` (per item_type=prep)

**Attenzione:**
- `stock_deductions.prep_task_id` è ora colonna esplicita (bigint) — il Consolidator lo legge diretto
- `stock_deductions.ingredient_id` è colonna esplicita (uuid) — per gli ingredienti raw
- Waygu Tomahawk: prep_task_id=477, unit=pz
- Wagyu Ribeye: prep_task_id=478, unit=pz
- RWPR 103 Rib NON appare in stock_deductions POS (corretto — si scarica solo quando si processa il rack)

**Duplicato ancora presente:**
- Waygu Tomahawk → Edible Flower: ORA RISOLTO (era pz+g, ora solo 2pz) ✅

**Non fare ancora:**
- La Dispensa UI
- Prep Production Consumption Bot
- stock_movements logic


---

## SESSIONE 7 LUGLIO 2026 — Sprint 7.2: BOM Chain Safety Mode

**Versione sw.js live:** boh-v567 (invariato — zero file frontend toccati)
**Supabase:** ydqmumpytgrlceuinoqt
**Edge Function modificata:** bot-bom-chain-deduction → v6 (safety mode)

---

### SPRINT 7.2 — BOM Chain Safety Mode — PASS ✅

**Live version:** boh-v567 / bot-bom-chain-deduction v6 (Supabase Edge Function version 6)

#### Problema trovato

Bot 4 (bot-bom-chain-deduction) stava espandendo ricette batch e prep stockate, scaricando ingredienti raw batch-level come se fossero quantità per porzione POS.

Esempio critico: `Meatballs` (base_servings=162) aveva nel BOM Ground Beef 4536g, Pork Sausage 907g, Bread Crumbs 820g, ecc. Il bot scaricava queste quantità per ogni porzione venduta — trattando 4.5 kg di carne come fabbisogno per 1 porzione.

La stessa famiglia di problemi riguardava: Ranch Dressing (bs=106), Berry Coulis (bs=56), BUTTER SPINACH (bs=40), CITRONETTE (bs=30), Cheesecake (bs=24), ROSMARY POTATOES (bs=20), Crème Brûlée (bs=16), Italian Marble Cake (bs=12), Fried calamari (bs=12), GNOCCHI (bs=10), Texana Soup (bs=9) — tutte ricette con BOM da batch, non da porzione.

**Root cause — due bug distinti:**

**Bug #1 (principale):** le ricette POS dirette con `base_servings > 1` venivano sempre attraversate dal bot senza nessun controllo. Il bot apriva il loro BOM raw e scaricava gli ingredienti come se la porzione venduta consumasse l'intero batch.

**Bug #2 (cache miss):** il `prepTaskCache` non copriva le sub-ricette di livello 2+. Il check `prepTaskCache.get(subId)` ritornava `undefined` (non null) → il bot trattava quella ricetta come virtuale invece di fermarsi.

#### Fix applicato — Regole costituzionali v3

**bot-bom-chain-deduction** ora usa safety mode con 4 regole in cascata:

**Regola 0 — Entry-point (nuova, il fix principale):**
Se la ricetta POS diretta ha `prep_task` attivo **e** `base_servings > 1`:
- NON apre il BOM raw
- La tratta come prep terminale già gestita da `direct_recipe`
- bom_chain non entra negli ingredienti
- Silenzio: nessun warning (comportamento corretto, non anomalia)

Se ha `base_servings > 1` ma **nessun prep_task**:
- STOP + `commis_observation` (caso anomalo — Wheel Pasta è il solo caso trovato)

**Regola 1 — Sub-recipe con prep_task (rafforzata):**
STOP sempre. Fix: lookup live se cache miss (risolve Bug #2).

**Regola 2 — Sub-recipe senza prep_task ma base_servings > 1:**
STOP + `commis_observation` con `skipped_reason: 'batch_level_bom'`.
1 observation per `(pos_item_name, recipe_id)` — non per ingrediente (de-dup).

**Regola 3 — Recipe senza prep_task e base_servings = 1 (o NULL):**
Virtuale/per-portion → espandibile. Bot scende nel BOM.

**Regola 4 — Threshold safety:**
Anche sulle ricette virtuali, se la quantità per porzione supera le soglie (meat >500g, salse >500g, oli >100g, formaggi >200g, generic >1000g), scrive warning senza bloccare.

#### Regola fondamentale (da non dimenticare mai)

> POS vende prep finite.
> Produzione prep scarica ingredienti raw.
> Il POS non deve scaricare ingredienti batch-level.

#### Risultati verificati su 2026-07-06

| Metrica | Prima (v2) | Dopo (v3 safety) |
|---|---|---|
| bom_chain rows | 207 | **104** |
| bom_chain total qty | 146.848g | **11.810g** |
| ingredient snapshot | — | 54 righe, 11.810g |
| prep snapshot | — | 50 righe, 20.068g |
| stock_movements | 335 | **335** (invariato) |
| current_stock | non toccato | non toccato ✅ |
| La Dispensa | Beta read-only | Beta read-only ✅ |

**Meatballs — comportamento corretto dopo fix:**
```
Meatball Appetizer → Meatball Sauce: 9p × 100g = 900g   [direct_recipe]
Meatball Appetizer → Meatballs: 9p × 5pz = 45pz          [direct_recipe]
Meatballs → Meatball Sauce: 1p × 100g = 100g             [direct_recipe]
Meatballs → Meatballs: 1p × 5pz = 5pz                    [direct_recipe]
```
Nessun Ground Beef / Pork Sausage / Bread Crumbs scaricato dal POS ✅

**Ranch, Berry Coulis, Cheesecake, Crème Brûlée, Citronette:**
Zero righe bom_chain raw. Corretto: hanno prep_task, gestite come terminali da direct_recipe.

**Unico warning legittimo generato:**
Wheel Pasta — base_servings=130, nessun prep_task → observation scritta.

#### File modificati

| File | Modifica |
|---|---|
| `bots/bom-chain-deduction/bot-bom-chain-deduction.js` | v3 safety mode (645 righe) |
| `bots/bom-chain-deduction/BOM_CHAIN_BOT.md` | Regole costituzionali v3 documentate |

---

### NEXT STEPS

**1. Test iPhone La Dispensa Beta**
- Hard refresh su boh-v567 (cancella cache Safari per 1cos.github.io)
- Verificare card senza garbage text (quantità batch-level erano visibili prima del fix)
- Verificare scroll che non chiude il panel
- Testare bottone "Segnala errore" se presente
- Verificare che `dispensa_feedback` riceva le righe correttamente

**2. Sistemare Wheel Pasta**
- Audit ricetta Wheel Pasta (base_servings=130, nessun prep_task)
- Decidere: creare prep_task oppure correggere base_servings/scope
- Non lasciare base_servings=130 senza scope definito — il bot genera warning ogni run

**3. Continuare BOM Fix List**
- Controllare ricette batch rimaste (query: `base_servings > 1 AND no prep_task`)
- Tutte devono diventare una di:
  - a) prep stockate (creare prep_task)
  - b) per-portion approvate (verificare BOM e impostare base_servings=1)
  - c) virtuali approvate (base_servings=1 confermato)
  - d) bloccate con warning (nessuna azione immediata, warning in Dispensa)

**4. NON fare ancora**
- `current_stock` update automatico da POS
- `stock_movements` write da bot
- Apply automatico deductions su stock fisico
- Replacement del vecchio Guardian / Prep Builder
- La Dispensa resta Beta read-only finché i numeri non sono validati da Max per almeno 1 settimana

---

### Versioni finali sessione

| Componente | Versione |
|---|---|
| Brigade frontend | **boh-v567** (invariato) |
| bot-bom-chain-deduction | **v6** (Supabase Edge Function version 6) — safety mode |
| BOM_CHAIN_BOT.md | v3 — regole costituzionali aggiornate |
| Pipeline 2026-07-06 | pos-cleaner ✅ + direct-deduction ✅ + bom-chain v6 ✅ + consolidator ✅ |

---

## WHEEL PASTA FIX — Sessione 7 Luglio 2026

**Fix eseguito da Max:** Wheel Pasta portata a `base_servings = 1` (era batch-level con `base_servings = 130`).

**BOM verificata (per 1 porzione venduta):**
- RECIPE Diced Butter: 20g
- RECIPE SPAGHETTI FRESH PASTA: 2 each (nests)
- ITEM Rhum: 30g
- ITEM Cheese Wheel: 100g
- ITEM Butane Can: 3g

**Pipeline rilancita (18:15-18:16 CDT):**
| Bot | Status | Rows |
|---|---|---|
| bot-pos-cleaner | success | 146 classified, 58 mapped |
| bot-direct-deduction | success | 97 deductions |
| bot-bom-chain-deduction | success | 107 ing, 0 batch-blocked, 0 obs |
| bot-stock-consolidator | success | 107 snapshot rows |

**Verifica Wheel Pasta (10 porzioni vendute il 6 luglio):**
- `direct_recipe`: Spaghetti fresh pasta 20 each ✅ | Diced butter 200g ✅
- `bom_chain`: Cheese Wheel 1000g ✅ | Rhum 300g ✅ | Butane Can 30g ✅
- Nessun warning batch-level ✅
- Nessun blocco `base_servings > 1` ✅
- commis_observations Wheel: **0 righe** ✅
- current_stock: non toccato ✅
- stock_movements: non toccati ✅

**Nota bom_chain v6 (questa sessione):** ora produce 107 righe invece delle 233 del run precedente. Il calo è corretto — la Regola 0 del safety mode blocca le prep con `base_servings > 1` anche come ricette POS dirette, quindi ora Wheel Pasta non viene più trattata come batch ma espande correttamente il suo BOM per-porzione attraverso il bot.

