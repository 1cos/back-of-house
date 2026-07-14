# PROMPT_PROSSIMA_SESSIONE — Brigade BOH

> **Append-only per storia sessioni. Sezione "STATO CORRENTE" sempre aggiornata all'ultimo.**

---

## STATO CORRENTE — 14 Luglio 2026 (fine sessione)

### Nuova Nightly Pipeline (6 step) — LIVE ✅

**Il cutover dal builder legacy alla nuova pipeline per le suggestion è avvenuto.**
Backend: la nuova pipeline è ora l'unica a girare in automatico ogni notte via cron.
Frontend: **non ancora aggiornato** — task aperto, vedi sotto.

#### Componenti live confermati

| Componente | Versione | Stato |
|---|---|---|
| `bot-pipeline-worker` | v4 (Edge deployment 4) | ACTIVE — legge/scrive `bot_pipeline_jobs`, 6 step |
| `complete_pipeline_step` (RPC) | v2 | 6 nomi step, soglia completamento `>=6` |
| `fail_pipeline_step` (RPC) | v2 | 6 nomi step |
| `bot-prep-suggester` | v12b (Edge deployment 13) | ACTIVE — vero tracciamento in `bot_runs`, `generated_at`/`bot_run_id` reali su ogni riga scritta |
| `pg_cron jobid=17` (`pipeline-worker-tick`) | — | `schedule='* * * * *'`, **`dry_run:false`** (cambiato oggi), `active=true` |
| `bot-preplist-builder` (legacy) | v46 (Edge v71) | **ANCORA ATTIVO** — cron `0 9 * * *` (04:00 CDT), unico writer di `prep_tasks.current_stock` |

**Pipeline order (invariato):**
```
1. bot-pos-cleaner
2. bot-direct-deduction
3. bot-bom-chain-deduction
4. bot-modifier-depletion
5. bot-stock-consolidator
6. bot-prep-suggester  ← nuovo step, aggiunto oggi
```

**Mapping business_date → suggestion_date (nuovo, nel worker v4):**
Funzione `computeSuggestionDate()` — primo giorno operativo dopo `business_date`, timezone America/Chicago, salta domenica + `closed_dates`, max 14 tentativi, errore esplicito se non trova nulla entro 14gg. Deterministica, non usa l'orologio di sistema, non usa il fallback interno `nextServiceDay()` del suggester.

#### Recovery storico completato (10-13 luglio)

| Data | Cleaner/Direct/BOM | Modifier | Consolidator | Suggester | Note |
|---|---|---|---|---|---|
| 2026-07-10 | ✅ live (rerun manuale sessioni precedenti) | ✅ 4 righe | ✅ 139 snapshot | ✅ suggestion_date=11/07, 94 righe | run_id reali in `bot_runs` |
| 2026-07-11 | ✅ live | ✅ 4 righe | ✅ 161 snapshot | ✅ suggestion_date=13/07, 94 righe | run_id reali |
| 2026-07-12 | — | — | — | — | **domenica, chiuso — nessun job, comportamento corretto per design** (`gmail-touchbistro-import` non crea job se `sales_rows=0`) |
| 2026-07-13 | ✅ live | ✅ 4 righe | ✅ 159 snapshot | ✅ suggestion_date=14/07, 94 righe (105 totali in tabella, 11 residue da prep checklist/archiviate — comportamento noto, non un bug) | primo test end-to-end completo del sesto step |

**⚠️ Nota da chiudere in una sessione futura:** i job in `bot_pipeline_jobs` per il 10/07 e 11/07 restano formalmente `status='failed', current_step_index=1` — perché il recovery è stato eseguito con chiamate dirette ai singoli bot (come richiesto per non rilanciare Cleaner/Direct/BOM), non tramite le RPC di avanzamento della coda. I **dati reali sono completi e corretti**, ma la riga di stato della coda non riflette questo. Non bloccante (`claim_next_pipeline_job` seleziona solo `status='pending'`), ma visivamente fuorviante se qualcuno guarda `bot_pipeline_jobs` per quelle due date.

#### Enqueue automatico — confermato con prova di codice

`gmail-touchbistro-import` (edge v33) chiama `enqueue_pipeline_job()` dopo ogni import CSV riuscito con `sales_rows > 0`. Non crea job se `sales_rows=0` (comportamento corretto per domeniche/giorni chiusi). Il campo `dry_run:true` scritto nel metadata del job (`bot_pipeline_jobs.metadata.dry_run`) è **cosmetico/informativo** — non controlla il comportamento reale del worker, che legge `dry_run` solo dal proprio payload cron. Non ancora allineato (task esplicitamente rimandato a una sessione separata, come da istruzione "se preferisci separarlo in un deploy successivo, dichiaralo esplicitamente e non toccarlo").

#### Verifiche di sicurezza superate oggi

- `prep_tasks.current_stock` **non toccato** da nessuno dei 6 step nuovi — confermato nel codice (`bot-stock-consolidator` dichiara esplicitamente `"current_stock NOT updated"` nella propria risposta)
- Ultimo scarico `current_stock` resta quello del builder legacy, oggi 04:00:01 CDT (91 task aggiornati)
- `bot-nightly-orchestrator` **non riattivato** — confermato architettura superata (falliva per timeout `net.http_post` su chain sincrona lunga, sostituito dal queue worker il 10/07)
- Nessuna modifica a UI/frontend in questa sessione

---

### 🔴 TASK APERTO — Frontend Trust View + Legacy Suggestion Retirement

**Non ancora iniziato.** Richiesto da Max a fine sessione, da riprendere dalla prossima sessione.

**Obiettivo:** dare ai cuochi una card semplice con il filo logico:
```
Added yesterday
− Used last night
= Available now
→ Prep suggested
```
Esempio target:
```
Added yesterday: 2.5 kg
Used last night: 1.3 kg
Available now: 1.2 kg
Prep suggested: 2.8 kg
Based on Tuesday demand and current stock.
```

**Regola architetturale confermata da Max per questo task:**
- Il vecchio `bot-preplist-builder` **resta attivo solo per lo scarico di `current_stock`** — non spegnerlo, non toccare la sua logica
- Le sue suggestion (`suggested_qty`, `suggested_note`, `suggested_at`, `suggested_by`, `sources_json`) **non devono più essere mostrate né usate come fallback** nel frontend operativo
- `prep_suggestions_daily` diventa l'**unica fonte** di suggestion visibile ai cuochi
- Se non esiste una suggestion fresca/valida → messaggio "Suggestion unavailable — check stock before preparing", **mai** un fallback silenzioso al vecchio bot
- Zero deve significare zero reale — dato mancante deve mostrare "Not available", mai zero

**Prima regola del task (non ancora eseguita):** AUDIT delle 4 fonti prima di toccare qualsiasi frontend:
1. **Added yesterday** ← verificare se ricostruibile da `prep_log` (match per `prep_task_id` o solo nome/recipe? conversione unità? esclusione checklist/zero?)
2. **Used last night** ← verificare fonte corretta tra `stock_deductions` / `stock_movements` / `stock_daily_snapshot`, evitare doppio conteggio tra direct/BOM/modifier
3. **Available now** ← verificare se `prep_tasks.current_stock` è davvero la fonte corretta e aggiornata
4. **Prep suggested** ← solo `prep_suggestions_daily`, run valida più recente, `generated_at`/`bot_run_id` reali (ora possibile grazie al fix di oggi su v12b)

Poi: verifica numerica su 7 prep reali (Texana Soup, Mash Potato, Spaghetti, Diced Grilled Chicken, Panna Cotta, Garlic Oil, Pancetta) con tabella di controllo `previous stock + added − used ± altri movimenti = current stock`. Se la formula non torna con dati reali, dichiararlo esplicitamente — non inventare il numero mancante.

Poi: mappa di ogni fallback legacy in `js/prep.js` (campo `suggested_*`, uso in `classifyCard()`, stock pill, card expansion).

Solo se l'audit conferma dati affidabili → proporre diff chirurgico del frontend (card trust block, testo in inglese semplice, niente nomi di bot, niente termini tecnici, niente food cost).

**Verdetto atteso a fine task:** `READY TO REMOVE LEGACY SUGGESTIONS FROM FRONTEND` oppure `STOP — TRUST DATA NOT YET RELIABLE`.

**Non fare push finché Chef Max non approva esplicitamente — vale anche per questo task.**

---

### Pending invariato da sessioni precedenti (non toccato oggi)

- 3 warning Consolidator (Spring mix g vs buste, Spaghetti pz vs nests, Parsley pinch vs g)
- Asparagus pt_unit (decisione g vs kg)
- Meatballs current_stock iniziale (chiedere a Max stima attuale)
- Dish Crew Home Fase 2
- Rename Manager → Coordinator
- 7shifts sync (JWT auth)
- Sales: rimuovere tab "Oggi"
- RLS hardening su `prep_task_classifications`
- Saucier Production Cadence v3 (pseudocode approvato, non ancora implementato in `bot-prep-suggester`)
- Retry mirato di un singolo step fallito nella pipeline (RPC dedicata, non ancora costruita — oggi un fallimento allo step 6 richiede intervento manuale)
- Allineamento metadata `dry_run` in `gmail-touchbistro-import` (cosmetico, non bloccante, rimandato esplicitamente)


---

## STATO CORRENTE — 13 Luglio 2026 (fine sessione)

### Prep Database Audit & Cleanup — COMPLETATO

**Sessione maratona: tutte le 10 stazioni completate in una sola sessione.**

#### Modifiche globali applicate su tutte le stazioni
- `base_servings` rimosso da tutte le ricette di tipo supporto/prep (si va a peso via BOM)
- `base_servings` mantenuto SOLO per dessert contati in pezzi (Cheesecake 24, Cremino 12, Limoncello 12, Mint Bavarese 15, Panna Cotta 10, Tiramisu 10, Creme Brulee 16)
- `serving_weight_g` rimosso dove fuorviante (eccezione: Meatballs 56g, Spinach 80g/cup, pasta fresca nests)
- `expected_duration_days` allineato su prep_tasks per tutte le prep
- `shelf_life_days` allineato su recipes per tutte le ricette

#### Anomalie risolte
- **Truffle Butter** — ricetta TRUFFLE BUTTER creata (id: 0564433e, 496g, 24 porzioni, 20g/serving, shelf 7gg), prep_task scollegato da Truffle Fettuccine, BOM Truffle Fettuccine aggiornato
- **Demi** — rinominata da "DEMI FOR RAVIOLI" a "DEMI", shelf 9gg
- **Ragu** — rinominato da "MK-RAGU" a "RAGU", shelf 9gg, base_servings rimosso
- **Pomodoro Sauce** — base_weight_g corretto da 3532 a 3500g, yield_text allineato
- **Thaw Lobster** — scollegato da ricetta "Lobster Fettucine" (piatto finito), shelf 3gg. BOM Lobster Fettucine: Lobster Tail aggiornato da 4.5oz a 1 each
- **Scallops** — ingrediente aggiornato measure_type=each, avg_unit_weight_g=45g. BOM Scallops Chefs Way: 266g → 4 each. BOM Scallops Asparagus Gnocchi: aggiunto 3 each + 1 pz Diced Butter
- **Porterhouse** — scollegato da "Ribeye Steaks", collegato a "Porterhouse alla Fiorentina"
- **Wagyu duplicati** — Wagyu Ribeye Portioned (id 478) e Wagyu Tomahawk Portioned (id 477) archiviati. Versioni con pos_name (id 319, 320) mantenute
- **Flowers** (id 455) — archiviata (prep inutile)
- **Basil Flowers** — → checklist (10 punte basilico in acqua fresca ogni giorno)
- **Honey, Olives, Walnuts, Cocoa Powder, Mint Liquid, Powder Sugar** — → checklist (refill)
- **Lemon Zest, Orange Supreme** — → checklist daily_reset (prep fresca giornaliera)
- **Arrabbiata** — base_weight_g 3150→3300g
- **Cacio e Pepe** — shelf life 7→9gg
- **Mushrooms** — shelf life 30→7gg (FREEZER→FRIDGE dopo scongelamento)
- **Soffritto Livornese** — base_weight_g NULL→866g, shelf 3gg post-scongelamento, menu_group Bases
- **Texana Soup** — shelf life 5→7gg
- **Grilled Chicken** — 15kg produzione sabato aggiunti a current_stock (ora 19,831g), prep_log registrato
- **Gnocchi** — prep_type NULL→finale, shelf 7→30gg (congelati)
- **Gnocco Dough** — base_weight_g NULL→2008g, shelf 1→2gg
- **Spinach** — serving_weight_g 60→80g (1 cup = 80g, confermato da Kitchen Production Model)

#### Shelf life aggiornate per stazione
**Saucier:** Arrabbiata 7gg, Brisket 7gg post-apertura/FREEZER, Cacio e Pepe 9gg, Demi 9gg, Mash Potato 2gg/FRIDGE, Mushrooms 7gg/FREEZER→FRIDGE, Pomodoro 7gg, Ragu 9gg/FREEZER opzionale, Soffritto 3gg post-scongelamento, Texana Soup 7gg, Thyme Butter 30gg/FRIDGE, Truffle Butter 7gg/FRIDGE

**Oven:** Artichoke 3gg, Brussels Sprouts Par Cook 6gg/FRIDGE, Brussels Sprouts RTS 3gg, Calamari 3gg, Chicken Parmesan 2gg, Croutons 30gg/AMBIENT, Onion Rings 3gg, Rosemary Potatoes 4gg, Salmon Cakes 6gg, Thaw Salmon 3gg

**Pasta:** Bacon Crumbs 7gg, Diced Butter 7gg, Grilled Chicken 15gg/sottovuoto, Pancetta 5gg, Rosemary Oil 15gg/FRIDGE, Shrimp 3gg, Thaw Lobster 3gg/scollegato

**Sauté:** Asparagus 4gg, Meatball Appetizer 7gg, Meatball Sauce 5gg, Meatballs 5gg, Risotto Base 4gg, Salmon Aioli 15gg/sottovuoto, Salmoriglio 4gg, Scallops 4gg, Sicilian Mix 4gg, Siciliana Cartoccio 3gg

**Fresh Pasta:** Fettuccine 30gg/FREEZER, Gnocchi 30gg/FREEZER, Gnocco Dough 2gg, Maccheroni 30gg/FREEZER, Spaghetti 30gg/FREEZER, Pecorino 7gg/sottovuoto, Parmesan 7gg/sottovuoto

**Table Side:** Branzino Tableside 3gg, Filet Branzino 30gg/FREEZER, Filets 7gg/FRIDGE, NY Strip 7gg/FRIDGE, Ribeye 7gg/FRIDGE, Salmon Filets 30gg/FREEZER, Tomahawk 30gg/FREEZER, Wagyu Ribeye 30gg/FREEZER

**Salad:** Bruschetta 7gg, Cantaloupe 3gg, Chop Romaine 2gg, Halved Tomatoes 3gg, Watermelon 3gg

**Pastry:** Berry Coulis 7gg, Brownies 30gg/FREEZER, Cheesecake 10gg/FRIDGE, Cremino 30gg/FREEZER, GF Sponge Cake 30gg/FRIDGE, Mint Bavarese 30gg/FREEZER, Limoncello Cake 30gg/FREEZER

#### Pipeline bot — stato attuale
- **bot-preplist-builder v46** (edge v71) — LEGACY, ancora attivo, scrive su prep_tasks.suggested_qty
- **bot-prep-suggester v5** (edge v4) — NUOVO, scrive su prep_suggestions_daily (tabella separata)
- **bot-nightly-orchestrator v3** — orchestra pipeline POS: pos-cleaner→direct-deduction→bom-chain-deduction→modifier-depletion→stock-consolidator
- `dry_run: true` ancora attivo — NON flippare a false senza revisione

#### Regole confermate questa sessione
- `base_servings` fuorviante per prep di supporto — rimosso sistematicamente
- `base_servings` mantenuto per dessert in pezzi (bot lo usa per calcolare quanti pezzi per batch)
- `serving_weight_g` mantenuto SOLO dove il bot lo usa per calcolo consumo: Meatballs (56g), Spinach (80g/cup), pasta fresca nests
- Ingrediente Scallops: measure_type=each, avg_unit_weight_g=45g (U-10 = ~45g/pezzo)
- Lobster Tail nel BOM: 1 each (non 4.5oz)

#### Prossimi passi
1. Pomodoro Sauce base_weight_g confermato 3500g — verificare se il bot suggerisce correttamente dopo aggiornamento
2. Schema additivo prep_tasks (9 colonne: ux_family, production_mode, storage_method, freezable, preferred_batch_qty/unit, minimum_batch_qty/unit, operational_criticality) — ancora da implementare, nessuna migrazione eseguita
3. Tabella daily_tasks — proposta approvata architetturalmente, nessuna implementazione
4. current_stock source of truth — proposta separata ancora aperta
5. bot-preplist-builder v46 → dual-write con bot-prep-suggester prima del cutover
6. Scallops shelf life: DB dice 4gg prep_task, documento dice 4-5gg — confermato 4gg
7. Thaw Branzino — non trovato come prep task, verificare se esiste o va creato


---

## STATO CORRENTE — 8 Luglio 2026 (fine sessione)

### Live
- **boh-v573** su `brigade-main` / GitHub Pages
- **Supabase:** `ydqmumpytgrlceuinoqt`
- **bot-direct-deduction:** Supabase version 4 ACTIVE
- **bot-stock-consolidator:** Supabase version 8 (v6_hygiene) ACTIVE
- **bot-bom-chain-deduction:** v3 safety mode ACTIVE
- **stock_movements:** 335 (invariato — mai toccato dai bot POS)
- **current_stock:** mai toccato dai bot POS ✅

### Sessione startup (obbligatorio)
1. Leggi token da `/mnt/project/x_claude_GIthub.txt`
2. Leggi tutti i `.md` + `sw.js` da `brigade-main` — UNA VOLTA all'inizio
3. Verifica versione live da `sw.js` + commit recenti prima di qualsiasi bump
4. Bump sw.js di +1 rispetto al live (sessioni parallele avanzano indipendentemente)

---

## ARCHITETTURA BOT POS (stabilita)

### Pipeline completa (ordine esecuzione)
```
1. bot-pos-cleaner         → pos_daily_clean (normalizza POS raw)
2. bot-direct-deduction    → stock_deductions (source='direct_recipe')
3. bot-bom-chain-deduction → stock_deductions (source='bom_chain')
4. bot-stock-consolidator  → stock_daily_snapshot (aggregato + prep_log)
```

### bot-direct-deduction v4 — PATH A e PATH B

**PATH A: BOM RECIPE** (priorità assoluta)
- Recipe POS ha righe `component_type='RECIPE'` nel BOM → scarica sub-recipe prep_task
- Calcolo: `BOM qty × portions_sold`

**PATH B: direct_parent_prep_task** (solo se PATH A vuoto)
- Nessuna riga RECIPE nel BOM → cerca prep_task con `prep_tasks.recipe_id = recipe.id`
- Calcolo: `serving_qty × portions_sold` (serving_qty dalla recipe)
- Protezioni plausibilità:
  - `PIECE_UNITS` (pezzi/pz/each/ea/nests): ok se serving_qty ≥ 1 (default 1 se null)
  - `WEIGHT_UNITS` g: ok solo se serving_qty > 5; kg: ok se serving_qty ≥ 0.05
  - `CONTAINER_UNITS` (buste/bag/case/box): skip → observation
  - Unità astratte (porzione, ecc.): skip → observation
- metadata: `reason='direct_parent_prep_task'`, `guard='plausibility_checked'`

**Run 2026-07-06 (post serving_qty fix):**
- 8 parent_prep_deductions: Tiramisu 2pz, Crème Brûlée 3pz, Cheesecake 5pz, Panna Cotta 3pz, Berry Coulis 350g, Ranch 222g, Rosemary Potatoes 320g, Texana Soup 560g
- 0 parent_prep_skipped

### bot-stock-consolidator v6_hygiene
- Legge `prep_log` per `business_date` CDT
- Matcha `prep_log.item → prep_tasks.name` (exact + contains fallback)
- `load_only=true`: merge `loaded_qty` via UPDATE senza cancellare snapshot POS
- `checklist` skip silenzioso; `raw_item` skip silenzioso
- **current_stock NOT updated** — solo snapshot
- 3 warning legittimi rimasti: Spring mix g vs buste, Spaghetti pz vs nests, Parsley pinch vs g

---

## LA DISPENSA UI (boh-v573)

### Funzionalità live
- **Card Cucina/Magazzino:** mostra `+ Caricato` verde se `loaded_qty > 0`, `- POS scaricato` rosso se c'è anche un carico
- **Badge "Solo carico"** (blu) se `loaded_qty > 0` e `pos_deducted_qty = 0` — non conta come warning
- **Esploso:** se nessuna deduction ma ci sono `loaded_logs` → mostra sezione "↑ Carichi prep_log" con log individuali + nota mapping
- **Warning counter** esclude load-only (conta solo mismatch reali)
- **Tema light** identico all'Ufficio: gradient `#eff6ff → #dbeafe → #e0f2fe`, testo `#1e3a5f`, font 16px

### Esempio Tiramisù (06/07)
```
Tiramisù          [partial]
- 2 pezzi   POS scaricato
+ 26 pezzi  caricato · Samantha · 14:58 UTC
```

---

## SERVING FIELDS — STATO AUDIT

### Classificazione (luglio 2026)

**A: OK_COUNT (18)** — pezzi con serving_qty plausibile ✅ Non toccare.
Tiramisu, Crème Brûlée, Cheesecake, Panna Cotta, Salmon Cakes (3pz), Scallops (4pz), Artichoke (2pz), Wagyu, Tomahawk, Pears, Lobster, Chicken Parmesan, Limoncello/Mimosa, Italian Marble/Cremino, Branzino Tableside, Filet Branzino, Meatball Appetizer, Mint Bavarese

**B: OK_WEIGHT (4)** — g/kg con serving_qty reale ✅ Non toccare.
Berry coulis 70g, Truffle butter 20g, Garlic Oil 30g, Thyme Butter 20g

**C: FIXATE (14)** ✅ — UPDATE eseguito 08/07/2026

| Recipe | serving_qty | Note |
|---|---|---|
| CITRONETTE | 78g | da serving_weight_g |
| Ranch Dressing | 74g | da serving_weight_g |
| Nutella mix | 40g | da serving_weight_g |
| ROSMARY POTATOES | 160g | da serving_weight_g |
| Texana Soup | 280g | da serving_weight_g |
| BALSAMIC VINAIGRETTE | 74g | da serving_weight_g |
| Diced Butter | 23g | da serving_weight_g |
| Diced Grilled Chicken | 60g | da serving_weight_g |
| ITALIAN CREAM | 61g | da serving_weight_g |
| MACCHERONI FRESH PASTA | 120g | da serving_weight_g |
| Pecorino Fresh Wedge | 70g | **Max manual** |
| Salmon Aioli | 40g | da serving_weight_g |
| Seed Mix | 15g | **Max manual** |
| Shredded Carrots | 20g | da serving_weight_g |

**D: PACKAGE_UNIT (3)** — non auto-scaricabili
- House Salad / Spring mix: `pt_unit=buste` — 1 busta ≠ 1 salad → decisione cucina
- BASIL OIL (pt 236): `pt_unit=buste`
- BASIL OIL (pt 326): `pt_unit=null`

**E: MISSING (12)** — sauces/supporto senza pos_name, non impattano bot POS direttamente
ARRABBIATA, POMODORO SAUCE, CACIO E PEPE SAUCE, Meatball Sauce, Ragu, GF Sponge Cake, Risotto Base, Brisket, Sliced Mushroom, Mash Potato — da completare prima del Prep Suggester

**F: MANUAL REVIEW (5)** — rimandati
- Butter Spinach (cup — ok operativamente ma serving_wt=60g vs regola 80g)
- Fried Calamari (BOM anomalo: base_servings=1 con 1800g = batch, non porzione)
- Gnocchi (serving_qty=200g corretto ma deduction=0 — prep_type='supporto' senza pos_name)
- Asparagus (`pt_unit=kg`, serving_weight=150g — scegliere: pt_unit=g o serving_qty=0.15kg?)
- Scallops Asparagus Gnocchi (no prep_task, BOM vuoto)

---

## DECISIONI ARCHITETTURALI STABILITE

### Flusso Brussels Sprouts (corretto, non toccare)
```
POS vende Brussels Sprouts → scarica Brussels Sprouts Ready to Sell (prep_task, g)
Cook produce Ready to Sell: − Brussels Sprouts Par Cook + Brussels Sprouts Ready to Sell
```
- BOM `Brussels → Par Cook 1200g` è BATCH-LEVEL per 10 porzioni — corretto
- Bot-bom-chain-deduction non lo scarica (safety mode: batch blocked) — corretto
- **Task futuro:** bot deve dividere BOM qty per `base_servings` quando `base_servings > 1`

### Tiramisù e dessert a pezzi (flusso corretto, implementato)
```
POS vende Tiramisù → scarica prep_task Tiramisu in pezzi (via PATH B direct_parent_prep_task)
```
- Il BOM ingredienti (Savoiardi, Mascarpone...) NON viene scaricato dal POS
- Sarà scaricato in futuro dal **Prep Production Bot** quando Samantha produce il batch

### Prep_type valido per PATH B direct_parent_prep_task
Solo `prep_type IN ('finale', 'supporto')` — `checklist` escluso

### Regola steps vs BOM
- `recipe_steps`: solo tecnica/procedura, MAI quantità
- `recipe_bom`: unica source of truth per quantità
- `pos_name` su recipe: mai modificare alias esistenti con storia vendite, solo aggiungere

---

## PENDING — PRIORITÀ PROSSIMA SESSIONE

### 1. 3 warning Consolidator (da risolvere dopo UI)
1. **Spring mix:** `g vs buste` — decidere se task deve essere in g o buste
2. **Spaghetti fresh pasta:** `pz vs nests` — decidere se DONE salva nests invece di pz
3. **Parsley:** `pinch vs g` — rimuovere pinch dal BOM POS, usare g

### 2. Asparagus pt_unit (decisione pendente)
- Opzione A: cambiare `prep_tasks.unit='g'` (da kg)
- Opzione B: `serving_qty=0.15, serving_unit='kg'`

### 3. CITRONETTE deduction=0 (bug da verificare)
- Ora ha `serving_qty=78g` ma il 06/07 `pos_deducted_qty=0`
- Ha BOM ITEM (7 ingredienti) ma nessun BOM RECIPE → PATH B dovrebbe attivarsi
- Verifica: la protezione plausibility la blocca? (serving_qty=78, unit=g → dovrebbe passare)

### 4. Blocco C — Missing core prep (Prep Suggester prerequisito)
Da proporre valori e attendere approvazione Max:
- ARRABBIATA: base_weight=3150g, no base_servings → proporre serving_qty calcolata
- POMODORO: base=3532g/12 → ~294g/srv proposta
- CACIO E PEPE: base=6000g, no base_servings
- Meatball Sauce: serving_weight_g=100g già → serving_qty=100
- Ragu: serving_weight_g=200g → serving_qty=200
- Risotto Base: serving_weight_g=160g → serving_qty=160
- Mash Potato: base=2800g/10 → 280g/srv proposta
- Sliced Mushroom: serving_weight_g=147g → serving_qty=147

### 5. Sprint B: bot-prep-suggester
**Solo dopo fix warning + Asparagus + Blocco C.**
- Creare tabella `prep_suggestions_daily`
- Bot legge `stock_daily_snapshot` (loaded_qty + pos_deducted_qty) + prep_tasks (current_stock, shelf_life, batch_size)
- Scrive suggerimenti con spiegazione leggibile
- Prep UI: legge `prep_suggestions_daily` se disponibile, fallback a `prep_tasks.suggested_qty`
- Confronto vecchio vs nuovo 5-7 giorni prima di spegnere bot-preplist-builder

### 6. Brussels Sprouts bot fix (architetturale)
- bot-bom-chain deve dividere `BOM qty / base_servings` quando `base_servings > 1`
- Così `1200g ÷ 10 = 120g` per porzione di Brussels

### 7. Dish Crew Home — Fase 2 (UI — priorità alta)
Dedicated simplified home per `user.default_station === 'Dish Crew'`:
- Standard topbar + alerts + Dish Crew task list + birthdays + bottom bar (Home/Chat/Schedule/Tell Chef)
- Hide: Recipes, Closing, Sales, Operation Notes prompt
- NO Focus Mode per Dish Crew (Max explicit)

### 8. Pendenti vari
- Salmon Flow (3-level stock transfer): recipe `1e31334d`, prep_task id=317 — struttura base creata
- L'Ufficio → bottom bar (spostare da menu tre puntini)
- Rename "Manager" station → "Coordinator" (prep_tasks, focus-mode.js, closing.js, DB)
- 7shifts sync: auth error da diagnosticare (Safari Mac Console → Sincronizza → leggi `whoami_body`)
- Sales: rimuovere tab "Oggi" (dati solo via nightly CSV), aggiungere free-date query e custom field

---

## KEY TABLES & CONSTRAINTS

### Tables critiche
- `prep_tasks.sources_json`: pre-computed POS source data — leggere, non ricalcolare client-side
- `office_items.source`: accetta solo `tell_chef | operation_note | ai_scan | sous_chef_chat`
- `recipe_bom.component_type`: valori `'ITEM'` o `'RECIPE'` (UPPERCASE)
- `stock_daily_snapshot`: aggiornato dal consolidator, mai dal frontend
- `stock_movements`: MAI toccato dai bot POS — solo da operazioni stock reali
- `current_stock`: MAI toccato dai bot POS — solo da DONE flow e stock edits
- PostgREST hard cap: 1000 rows max — split queries su tabelle grandi (recipe_bom ha 1284+ rows)

### Prep_type valori
- `finale`: POS-connected, genera deduction
- `supporto`: intermedio, non genera deduction diretta dal POS
- `checklist`: operativo, skip silenzioso da tutti i bot

### Bot categories observation valide (CHECK constraint)
`pos_anomaly | missing_mapping | bom_warning | stock_mismatch | prep_suggestion | system | manual_review`

---

## TOOLS & INFRA

- **Repo:** `1cos/back-of-house`, branch `brigade-main`; GitHub Pages: `https://1cos.github.io/back-of-house`
- **Dev environment:** `https://1cos.github.io/back-of-house/dev/` (service worker separato `boh-dev-vN`)
- **Supabase:** project `ydqmumpytgrlceuinoqt`; timestamp UTC, display `America/Chicago`
- **Local AI:** `qwen3:8b` su Mac mini M4 via Tailscale `https://max-mini.taildf4122.ts.net`, header `x-chef-ai-key`
- **POS:** TouchBistro; nightly CSV via Gmail → `gmail-touchbistro-import` Edge Function; no real-time today
- **Vendor imports:** Hardie's, Frugé, Ben E. Keith via Gmail Apps Script → Edge Functions → `vendor_documents`
- **Session coordination:** questo file — append-only, mai sovrascrivere contenuto precedente

### GitHub file operations (ogni push)
1. Read file live da GitHub (`GET /repos/1cos/back-of-house/contents/{path}?ref=brigade-main`)
2. Modifica in `/tmp/`
3. Valida con `node --check`
4. Fetch SHA fresco immediatamente prima di PUT (mai riusare SHA vecchio)
5. Push atomico a `brigade-main`
6. Multi-file: usa Git Tree API (blobs → tree → commit → PATCH ref)

---

## STORIA SESSIONI (sintesi)

| Data | Versione | Sprint |
|---|---|---|
| 29 giu 2026 | v412→v420 | Flusso prep card completo |
| 30 giu 2026 | v428→v430 | Fix Edit Ingredient, Oven Station, Fresh Pasta |
| 1 lug 2026 | v430→v456 | Bot preplist v21→v30, TripleSeat, Closing, ingredient_id |
| 2 lug 2026 | v456→v459 | Card prep, bot-preplist-builder v30, closed_dates |
| 4 lug 2026 | v489→v496 | Chef AI locale Mac mini, Audit Guardian Mode |
| 5 lug 2026 | v496→v530 | Mapping Control Room, prep fix BOM, bot-tell-chef v17 |
| 6 lug 2026 | v530→v543 | Bot Debug v2, bot-preplist-v2, /dev/ design system |
| 7 lug 2026 | v543→v570 | Pipeline POS Bot completa (pos-cleaner, direct-deduction, bom-chain, consolidator), La Dispensa v1, BOM fix Wagyu/Meatball |
| 8 lug 2026 | v570→v573 | Stock Consolidator v6 (prep_log loaded_qty), direct-deduction v4 (direct_parent_prep_task), La Dispensa light theme + load-only UI, serving_qty 14 recipe fix |


| 8 lug 2026 (sessione 2) | v574→v586 | Recipe editor Fase 1 UI, Modifier Depletion Audit Fase 2, Unit Normalizer Phase 2.1 |

---

## SESSIONE 8 LUGLIO 2026 (sera) — v574→v586

### Stato all'inizio sessione
- sw.js: boh-v583 (versione live trovata)
- Recipe editor ancora mostrava label tecniche: baseServings, totalWeight, yieldText

---

### 1. Recipe Editor Fase 1 UI — COMPLETATA (v584→v585)

**Problema:** Editor mostrava label da DB non da cuoco.

**Fix deployato (v584):**
- Sezione viola "📐 Resa della ricetta" con due campi: Nr. porzioni + Grandezza finale prodotto
- Riepilogo leggibile live ("Produce 10 porzioni · Grandezza finale: 2 LT")
- Prep time + Shelf life visibili direttamente
- Bot section: collassata in `<details>` (serving_qty/unit ancora funzionali)
- Costing section: collassata (prezzo, prep ogni N giorni)

**Fix v585 — raffinamenti:**
- `rYield` sopprime yield_text se ridondante con base_servings (es. "10 porzioni" quando base_servings=10)
- Titolo Bot section dinamico: "Avanzato — Modifier Depletion" per Salads/Sauces, "Avanzato — POS Depletion" per il resto (calcolato con `_deplTitle` pre-computato PRIMA di modal.innerHTML)
- "Peso totale batch" rimosso come input — read-only se base_weight_g esiste
- updateResaSummary: logica A/B/C/D (porzioni sole, grandezza sola, entrambe, vuoto)

**Acceptance criteria:**
- Tiramisu: Nr.porzioni=10, Grandezza vuota, summary "Produce 10 porzioni / pezzi" ✅
- Balsamic: Nr.porzioni vuoto, Grandezza=2LT, summary "Produce 2 LT finali" ✅
- Zero bot changes, zero DB migration ✅
- Tutti gli id (#rServings, #rYield, #rTime, ecc.) invariati ✅

---

### 2. Modifier Depletion Audit Fase 2 — COMPLETATA (solo lab/doc, nessun DB)

**Dati reali dal DB:** 650+ modifier unici, ~15.789 usi in 60gg

**Classificazione:**
| Cat | Tipo | Usi | Note |
|---|---|---|---|
| A | DEPLETION | ~2.620 | 4 dressing + proteine + contorni + pasta |
| B | PREFERENCE | ~1.048 | Allergie, temperature, esclusioni |
| C | KITCHEN OP | ~456 | Timing, deshell, split, togo |
| D | NOISE/BAR | ~11.665 | 9.135 blank, spirits, timestamp "Fired at..." |

**Dressing numeri riconciliati (60gg):**
| Modifier | Usi | qty/use | Consumo | Confidence |
|---|---|---|---|---|
| Caesar | 312 | ⚠️ N/D | N/D | 🔴 REVIEW |
| citronette | 195 | 78g | 15.2 kg | 🟡 estimated |
| Balsamic | 151 | 74g/59g | 11.2-8.9 kg | 🟡 estimated |
| Ranch | 86 | 74g/59g | 6.4-5.1 kg | 🟡 estimated |
| **Totale senza Caesar** | | | **32.7 kg certi** | |

**Discrepanza aperta Balsamic/Ranch:** serving_qty in DB = 74g ma 2 fl oz standard = 59.15g. Delta: 14.85g/servizio. Il ramekin è da 2 o 2.5 fl oz?

**OQR aperta (priorità Fase 2.2):**
Caesar Dressing: quanti grammi per salad? A) 74g  B) 60g  C) 1 squeezer = ?g

**Bot audit:** tutti i bot (direct-deduction, bom-chain, preplist-builder) scaricano ZERO dressing modifier. Il consumo non viene mai tracciato.

**Deliverable:**
- `MODIFIER_DEPLETION_AUDIT.md`
- `proposed_pos_modifier_depletion_rules.sql` (schema v2 + 4 righe dressing, active=false)
- `modifier-depletion-lab.jsx` (Lab UI React)

---

### 3. Unit Normalizer Phase 2.1 — COMPLETATA (v586)

**File pushato:** `js/unit-normalizer.js` su brigade-main

**Filosofia:** il cuoco scrive nella misura che conosce. La app converte. Mai chiedere al cuoco quanti grammi sono 2 fl oz.

**API pubblica:**
```js
normalizeQty(qty, unit, density=1.0)
  → { normalized_g, normalized_ml, display_g, display_ml, unit_type }

calcPortions(stockQty, stockUnit, portionQty, portionUnit, density)
  → { portions, sb, pb }

calcBatches(stockQty, stockUnit, batchQty, batchUnit)
buildModifierRule(canonical, qty, unit, display, density, usage_mode, recipe_id)
convertQty(qty, from, to, density)
formatQty(value, unit)   // auto: 5000g→"5 kg", 2000ml→"2 L"
resolveUnit(unit)        // "lt"→"l", "fl oz"→"fl_oz", "gram"→"g"
loadConversionsFromDB(supa)  // optional override, static fallback sempre attivo
```

**11/11 acceptance tests passati:**
- 2 fl_oz → 59.15g · 59.15ml ✅
- 5 kg → 5000g · 5000ml ✅
- 2 L (e alias "lt") → 2000ml · 2000g ✅
- 5000g ÷ 2fl_oz → 84.5 ramekin ✅
- 5000g ÷ 2LT → 2.5 batch ✅
- 2fl_oz density=1.03 → 60.92g ✅

**Static fallback:** tutte le conversioni embedded da unit_conversion_table (DB verificato).

**Scope Phase 2.1:** NON wired a bot, prep, inventory, recipe editor. Solo Lab + schema proposto.

**Schema SQL aggiornato** con colonne normalizzate:
```sql
display_qty           text    -- "2 fl oz ramekin" (chef-facing)
qty_per_modifier      numeric -- 2 (numero digitato)
unit                  text    -- "fl_oz" (unità originale)
normalized_qty_ml     numeric -- 59.15 (calcolato dalla app)
normalized_qty_g      numeric -- 59.15 (calcolato dalla app)
density_g_per_ml      numeric -- 1.0 default
usage_mode            text    -- 'fixed_quantity' | 'use_recipe_serving' | 'no_depletion'
```

**usage_mode:**
- `fixed_quantity`: dressings — grammi fissi per modifier
- `use_recipe_serving`: Add Chicken, Meatballs, Scallops → legge serving_qty dalla recipe
- `no_depletion`: preferenze/istruzioni cucina

---

### Versioni deployate questa sessione

| Versione | Contenuto |
|---|---|
| boh-v584 | Recipe editor refactor visivo (sezione Resa viola, Bot/Costing collassati) |
| boh-v585 | Fix yield duplicate suppress, titolo Bot dinamico, Peso totale read-only |
| boh-v586 | js/unit-normalizer.js (Phase 2.1 foundation, 11/11 test pass) |

---

### PENDING PROSSIMA SESSIONE

**Immediati:**
1. **OQR Caesar** — Max deve confermare: quanti grammi Caesar Dressing per salad? (A:74g B:60g C:squeezer=?g)
2. **OQR ramekin** — 2 fl oz (59g) o 2.5 fl oz (74g) per Balsamic e Ranch?
3. **Dopo OQR:** creare tabella `pos_modifier_depletion_rules` nel DB (schema pronto in proposed_pos_modifier_depletion_rules.sql)

**Non fare:**
- Non attivare nessuna `pos_modifier_depletion_rules` (active=false sempre finché non approvato)
- Non wiring unit-normalizer ai bot live finché Phase 2.2 non completata
- Non toccare serving_qty/serving_unit sul DB (ancora usate da PATH B bot)

**Backlog confermato (invariato):**
- La Dispensa Beta polish (Sprint 8 — priorità prima di current_stock)
- Dish Crew Home Fase 2
- Stock Consolidator v2 promotion (quando Max approva current_stock writes)
- 7shifts sync (JWT auth da diagnosticare: aprire Safari Mac Console → Sincronizza → leggere whoami_body)
- Sales: rimuovere tab "Oggi"
- Rename Manager → Coordinator


---

## Sessione 9 lug 2026 (boh-v587 → boh-v595)

### Modifier Depletion System — completato Phase 2 + Phase 3a + Phase 3b go-live

**Regola madre fissata definitivamente:**
> La produzione scarica gli ingredienti. La vendita scarica il prodotto finito.

**Tabella `pos_modifier_depletion_rules` — creata e live:**
- 4 regole `confidence='confirmed'`, `active=true`
- Balsamic → `item_type='prep'`, recipe BALSAMIC VINAIGRETTE (e834c1e2)
- citronette → `item_type='prep'`, recipe CITRONETTE (3f433b8b)
- Ranch → `item_type='prep'`, recipe Ranch Dressing (3cee627c)
- Caesar → `item_type='ingredient'`, ingredient Caesar Dressing (f47e1c26) — acquistato pronto
- Schema: `linked_ingredient_id` aggiunto per prodotti acquistati (no recipe)
- View `v_modifier_depletion_summary` con `depletion_target_type`

**Dry-run 29gg (Phase 3a):**
- 745 ramekin totali, 44.06 kg non tracciati
- Caesar 312 / Citronette 195 / Balsamic 152 / Ranch 86
- Report in `MODIFIER_DEPLETION_DRY_RUN_60D.md`

**Bot `bot-modifier-depletion` — deployato su Supabase Edge Functions:**
- `go_live_at = '2026-07-09 07:00:00+00'` (primo import post go-live)
- Cutoff su `pos_modifiers.created_at >= go_live_at` — impedisce backfill storico
- Idempotency key: `modifier_depletion:{sale_date}:{rule_id}:{canonical}`
- `dry_run=true/false`, `force_live=true` per test
- La prima run live è stanotte alle 07:05 UTC (02:05 CDT) con `sale_date=2026-07-08`
- Documentazione in `BOT_MODIFIER_DEPLETION.md` con rollback SQL

**Documentazione creata:**
- `MODIFIER_DEPLETION_AUDIT.md` — regola cucina, semantica confirmed/active, Caesar risolto
- `MODIFIER_DEPLETION_DRY_RUN_60D.md` — report Phase 3a
- `BOT_MODIFIER_DEPLETION.md` — architettura bot, go-live, rollback
- `proposed_pos_modifier_depletion_rules.sql` v5 — schema definitivo

### Recipe Data Quality panel — aggiornato (boh-v593→v595)

**Nuovo tab "🟢 Safe Fix":**
- Regola 1 (pezzi) e Regola 4 (grammi) escono da Blocking solo se `serving_unit='porzione'` esplicita
- `serving_unit=NULL` → Review con nota e ipotesi da confermare, non Safe Fix
- Messaggio umano: "Ogni vendita POS scarica 1 pezzo dalla prep collegata. Posso allineare l'unità automaticamente."
- Bottone "Applica tutti i fix sicuri" — non tocca stock/BOM/stock_movements
- Campi tecnici nascosti in `<details>` espandibile

**Fix classificazione made-to-order:**
- Ricette con BOM fisico ma senza prep_task → Info (non Review)
- Mini Caesar Salad non è più bloccata solo per assenza prep_task

**Fix toast `record_changed`:**
- Ora mostra "Record non più valido — ricarico..." e chiama `dqLoad()` auto dopo 800ms
- Bug root cause: UI passava `p_old_unit=''` invece di `null` → RPC falliva su `IS NOT DISTINCT FROM`
- Corretto in tutte e 3 le occorrenze RPC (blocking, safe fix, apply all)

### Meatball Appetizer — confermato e fixato

**Decisione Max (8 lug 2026):** Opzione B — stock conta porzioni assemblate
- `serving_qty=1`, `serving_unit='pz'`
- pz = 1 bag assemblata = 5 meatballs + 100g sauce = 380g
- La ricetta sa già la struttura — il bot non chiede grammi
- Audit scritto in `data_quality_fixes`, rollback SQL disponibile

### Prossima sessione

**Priorità immediata — verificare go-live bot:**
- Domani mattina (dopo 07:05 UTC) controllare `bot_runs` per `bot_name='bot-modifier-depletion'`
- Verificare `stock_movements WHERE source='pos_modifier_drain'` — attesi 4 nuovi movimenti (uno per dressing per `sale_date=2026-07-08`)
- Se il bot non gira automaticamente, triggerarlo manualmente via `net.http_post`

**Rollback bot se necessario:**
```sql
UPDATE pos_modifier_depletion_rules SET active = false;
DELETE FROM stock_movements WHERE source = 'pos_modifier_drain';
```

**Backlog aperto:**
- La pipeline bot-modifier-depletion è standalone — non è ancora integrata nel cron/trigger nightly
- La Dispensa Beta: Sprint 8 (search, warning filter, sorting, feedback list)
- Recipe DQ: rimangono ricette in Review/Blocking da processare una per una con Max
- 7shifts sync: ancora bloccato su JWT


---

## Sessione 9 lug 2026 (pomeriggio) — New Shell Lab

### Direzione confermata

**La nuova app è la New Brigade Shell**, non il Workspace Router nella vecchia app.
Il Workspace Router (js/workspace.js, workspace-v001/v002/v003) è **parcheggiato**.
La produzione (`back-of-house/brigade-main`) rimane **intatta per una settimana** — solo hotfix.

### Setup infrastruttura

**Tre track separati e protetti:**

| Track | Repo/Branch | URL | Stato |
|---|---|---|---|
| 🟢 Produzione cucina | `back-of-house/brigade-main` | `https://1cos.github.io/back-of-house/` | boh-v613, solo hotfix |
| 🧪 Workspace Router (parcheggiato) | `brigade-dev/brigade-main` (index.html) | `https://1cos.github.io/brigade-dev/` | workspace-v003, fermo |
| 🎨 **New Shell Lab** | `brigade-dev/brigade-main` (shell.html) | `https://1cos.github.io/brigade-dev/shell.html` | **progetto principale** |

**Branch:**
- `back-of-house/brigade-main` — produzione, non toccare
- `back-of-house/workspace-router-refactor` — Workspace Router parcheggiato
- `back-of-house/new-brigade-shell-ui` — branch della shell nuova (fonte di recupero)
- `brigade-dev/brigade-main` — lab deployment (shell.html qui)

**Tag di sicurezza:**
- `prod-safe-boh-v613` → `01712337ee7c` (produzione al momento del freeze)
- `workspace-lab-v002` → `978930a27e10` (Workspace Router al momento del freeze)
- `new-shell-v001-baseline` → `0453fe32c2a2` (shell v10 recuperata, con banner)
- `new-shell-v002-sales-placeholder` → `072bf3419777`
- `new-shell-v003-shell-polish` → `de24e64790a1`
- `new-shell-v004-density-polish` → `8a3a5a7fc1d8` ← **baseline visiva approvata**

### New Brigade Shell — stato attuale (new-shell-v004)

**File:** `brigade-dev/brigade-main/shell.html` (unico file, self-contained, ~98KB)
**Fonte originale:** `workspace/standalone.html` @ commit `46bca381` (v10, 9 luglio)

**Funzionalità presenti e funzionanti:**
- Brigade topbar (brand, search, Chef AI button, user/lang menu)
- Tab system Safari/Chrome (open, close, switch, scroll preservation, sessionStorage, max 10)
- Home con quick-action cards (Bot Center, Diario, Recipe, Inventory)
- Diario operativo — timeline, form inline, categorie, filtro ruolo
- Bot Center — lista pipeline con stati
- Recipe page (placeholder)
- Inventory page (placeholder)
- Sales/Vendite (placeholder con chips — `pageSales()`, route `pos`)
- Global search (score-based, dropdown, IT/EN/ES)
- Chef AI drawer (demo replies, contesto per pagina)
- i18n IT/EN/ES completo con `t(key)`
- Safe-area iPhone (env(safe-area-inset-*))
- -webkit-tap-highlight-color:transparent globale
- Zero DB writes (saveJEntry usa JDATA in-memory)

**CSS baseline congelata (non toccare senza richiesta esplicita):**
- spacing, topbar, tab bar, card density → frozen su v004
- workspace padding: 24px 28px 52px desktop / 14px 14px 48px mobile
- .hcard-top: 16px 18px 10px
- .pgp-chip: font 13px, padding 7px 14px

**Metodo di lavoro confermato:**
> un pezzo piccolo → push → test su iPhone → approvazione → prossimo pezzo

**Prossima sessione — possibili prossimi pezzi (Max decide l'ordine):**
1. Home page: decidere il contenuto definitivo (non aggiungere card a caso)
2. Diario: migliorare UX del form o della timeline
3. Bot Center: mostrare dati reali dal DB (bot_runs)
4. Recipe page: costruire la pagina vera (BOM + steps dal DB)
5. Search: ampliare l'indice con dati reali
6. Qualsiasi altra cosa Max vuole provare

**Regola assoluta:** Non aggiungere mai una feature senza approvazione esplicita di Max.
Non riempire la Home di bottoni. La shell deve respirare.

### Workspace Router — cosa rimane (parcheggiato)

`js/workspace.js` su `back-of-house/brigade-main` contiene workspace-v003-lab-safety.
È disabilitato di default nella live. Non eliminarlo — potrebbe servire per integrazioni future.
Non continuare a svilupparlo finché Max non lo richiede esplicitamente.

### Produzione live — stato bot (9 luglio 2026)

**boh-v613** in produzione. Bot pipeline funzionante:
- `bot-modifier-depletion` go-live fissato a `2026-07-09 07:00:00+00`
- Verificare nella prossima sessione se ha girato: `SELECT * FROM bot_runs WHERE bot_name='bot-modifier-depletion' ORDER BY started_at DESC LIMIT 5`
- Se non ha girato, triggerarlo manualmente


---

## Sessione 9 lug 2026 (sera) — New Shell Lab · v008a

### Decisione architetturale principale

> **La nuova shell non deve copiare la vecchia app.**
> Ogni modulo va ripensato da zero partendo dal flusso operativo reale dello chef,
> non dalla struttura del database.

Questa frase è la guardia anti-CRUD. Se un modulo sembra un form con 40 campi, è sbagliato.

---

### Stato produzione (invariato, solo hotfix)

- **`back-of-house/brigade-main`** — boh-v620, stabile
- I ragazzi continuano a testare in cucina
- Nessuna modifica alla produzione durante questa sessione
- bot-modifier-depletion: go-live `2026-07-09 07:00 UTC` — **verificare se ha girato**
  ```sql
  SELECT bot_name, status, started_at, rows_written
  FROM bot_runs WHERE bot_name = 'bot-modifier-depletion'
  ORDER BY started_at DESC LIMIT 5;
  ```

---

### Nuova Shell Lab — stato attuale

**File:** `brigade-dev/brigade-main/shell.html`
**URL:** `https://1cos.github.io/brigade-dev/shell.html`
**Version indicator:** `SHELL_VERSION = 'v008a'` (visibile nel banner pill)
**Cache buster:** aggiungere `?v=008a` all'URL per forzare reload su Safari

**Baseline grafica congelata** — non toccare senza richiesta esplicita:
- spacing, topbar, tab bar, card density
- Bot Center layout e fetch live
- Diario layout e filtri
- `+` menu behavior
- Home card layout

**Regola di sviluppo confermata:**
1. un modulo alla volta
2. build mock/layout → test iPhone → approvazione → freeze
3. poi e solo poi: dati live read-only
4. mai toccare ciò che è già approvato

---

### Moduli completati ✅

| Modulo | Stato | Note |
|---|---|---|
| Shell base | ✅ Congelato | Topbar, tab system Safari-style, version indicator |
| Tab system | ✅ Congelato | No duplicati, close→fallback Home, `+` menu, sessionStorage restore |
| Home | ✅ Congelato | Card Bot Center, Diario, Vendite (filtrate per permesso) |
| Bot Center | ✅ Congelato | 8 card pipeline, live read-only da `bot_runs`, warning chips, header aggregato |
| Diario | ✅ Congelato (mock) | Card con severity border, section counters, form glass, filtri role-based |

**Bot Center — dettagli live:**
- Supabase anon key in `SUPABASE_URL` / `SUPABASE_KEY` (in shell.html)
- `botsAfterRender()` fa GET su `bot_runs` — solo lettura, nessuna scrittura
- Mapping: `success→ok`, `warning→warn`, `failed/error→error`, assente→`idle`
- `NIGHTLY_BOT_MAP`: 6 bot nightly (`pos-touchbistro-bot`, `pos-cleaner`, `bot-direct-deduction`, `bot-bom-chain-deduction`, `bot-modifier-depletion`, `bot-stock-consolidator`)
- Fallback gracioso se fetch fallisce — mock rimane, nota soft

**Diario — ancora mock/in-memory:**
- `JDATA` array hardcoded, `saveJEntry()` scrive solo in RAM
- DB non ancora collegato — questo è v009 (dopo Ricette)

---

### Roadmap moduli (in ordine)

```
1. 🟨 Ricette          ← PROSSIMO — progettazione prima del codice
2. 🔲 Inventory / Dispensa
3. 🔲 Sales / Vendite
4. 🔲 Office / Tell Chef
5. 🔲 Chat / Chef AI
```

**Per ogni modulo: prima si progetta la pagina (qual è il flusso operativo reale?),
poi si costruisce il layout mock, poi si collega il DB.**

---

### Prossima sessione — Ricette (design first)

**Non iniziare a scrivere codice prima di aver risposto a queste domande:**

1. Quali tab deve avere una ricetta?
   — Proposta: Overview · Procedura · BOM · Costing · Prep · History
2. Cosa uno chef vede nei primi 5 secondi?
   — Nome ricetta, stazione, batch size, stato (attiva/archivio)
3. Come si naviga: Ricetta → Prep → Ingrediente → Vendite?
   — Senza modal. Ogni passaggio apre una nuova tab.
4. Come si cerca una ricetta?
   — Barra ricerca + filtri stazione (Grill, Pasta, Salad, Pastry...)
5. La lista ricette: come deve essere organizzata?
   — Proposta: Preferite · Recenti · Per stazione

**Bot Center inventory audit (riferimento per futuro):**
Vedi sessione precedente — 42 Edge Functions catalogate in 6 categorie.
Bot Center v007+ mostra solo Nightly Pipeline. Le altre categorie (Prep, Chef AI, Invoice, Integrations) sono future sezioni separate.

---

### Push history questa sessione

| Tag | Contenuto |
|---|---|
| `new-shell-v005` | Tab system: closeTab fallback, restore validation, `+` menu, AID guard |
| `new-shell-v005a` | `+` menu patch: ICO pos, home fuori candidates, backdrop iOS |
| `new-shell-v006` | Bot Center layout: header operativo, 8 card, expand, osservazioni |
| `new-shell-v006a` | Bot Center polish: nomi 2 righe, warning label soft |
| `new-shell-v007` | Bot Center live read-only: fetch `bot_runs`, fallback gracioso |
| `new-shell-v007a` | Live data density: padding, warn pill chip, right column |
| `new-shell-v007b` | Version indicator: `SHELL_VERSION`, banner pill, footer note |
| `new-shell-v007c` | Expanded border: `--b3` (undefined→nero) → `--b2` (azzurro) |
| `new-shell-v008` | Diario layout: severity bar, section counters, form glass |
| `new-shell-v008a` | Diario polish: rimossa inner `jsv` bar, `border-left` diretto |



---

## Sessione 10 lug 2026 — New Shell Lab · v011

### new-shell-v011 — Recipe Storico tab

**Modulo:** Tab Storico della Recipe page.
**Stato:** ✅ pushato su `brigade-dev/brigade-main/shell.html`

**Cosa è stato fatto:**
- CSS Storico completo (`.r-hentry`, `.r-hhead`, `.r-hstats`, `.r-hstat`, `.r-hdelta`, `.r-hnote`, `.r-hcompare`, `.r-hsec`)
- Mock data `RECIPE_HISTORY` (3 produzioni Tiramisu: Ieri·Samantha·20pz·42min, 8lug·Samantha·18pz·47min·scarto2, 5lug·Todd·10pz·38min)
- Funzione `_renderHist()` — genera card dalla mock data, zero DB
- i18n IT/EN/ES completo (12 stringhe: rh_lbl_qty/dur/waste, rh_no_waste, rh_unit_min, rh_note_lbl, rh_compare_up/dn/eq, rh_delta_under/over, rh_empty, rh_sec_recent)
- `SHELL_VERSION` → `v011`
- Zero DB writes, zero modifiche a Driver/Ingredienti/Prep/timer/topbar/Bot Center/Diario/produzione

**Struttura card per ogni produzione:**
```
[Data]                    [Person pill]
─────────────────────────────────────
Quantità  │  Durata  │  Scarto
  20 vasch │  42 min  │  —
─────────────────────────────────────
📝 Nota operativa (se presente)
─────────────────────────────────────
+N vs precedente (se non è il più vecchio)
```

**Logica delta:**
- `delta vs expected_qty` → chip colorato inline (−2 arancio / +N verde)
- `compare vs precedente` → riga in fondo alla card (testo leggibile)
- `scarto > 0` → bordo card arancio + valore in rosso

**Cosa testare su iPhone:**
1. Apri Recipe → tab Storico → vedi 3 card Tiramisu
2. Card 1: 20 vasch, 42 min, scarto —, no nota → nessun bordo warn
3. Card 2: 18 vasch, 47 min, scarto 2 → bordo arancio + delta −2 + nota crema
4. Card 3: 10 vasch, 38 min, scarto — + nota cacao
5. Cambia lingua IT/EN/ES → label colonne e note cambiano
6. Driver, Ingredienti, Prep, timer, topbar → invariati

**Non modificato:** Driver, Ingredienti, Prep, timer, topbar, tab workspace, Bot Center, Diario, produzione, sw.js prod.

**Prossima sessione — opzioni:**
1. Inventory / Dispensa (prossimo modulo)
2. Collegare Storico a dati DB reali (prep_log + bot_runs)
3. Ricette: lista ricette (Home delle ricette, non solo Tiramisu)


---

## Sessione 11 lug 2026 — Bot check & Prep task audit

### Produzione (back-of-house/brigade-main, boh-v620, invariato)

Nessun push frontend in questa sessione. Solo DB.

---

### Audit pipeline POS — Add Chicken / Meatballs

**Contesto:** Nelle screenshot della preplist, "Cube Grilled Chicken" e "Meatballs" mostravano `Bot stock: — / Bot suggestion: —`. Audit completo eseguito.

#### Risultato Meatballs

- `prep_task 479` (Meatball Sauce), `480` (Meatballs), `481` (Meatball Appetizer): tutti con `current_stock = NULL`
- Il bot-preplist-builder salta i task con `current_stock IS NULL`
- I bot POS funzionano correttamente: `stock_deductions` del 9 lug mostra 75 pz Meatballs e 1500g Meatball Sauce scaricati via BOM chain
- Il consolidator non aggiorna `prep_tasks.current_stock` (snapshot-only finché non promosso)
- **Pending:** impostare un `current_stock` iniziale su questi task per sbloccare i suggerimenti. Da fare con Max in sessione separata (quanto stima in stock adesso?).

#### Risultato Add Chicken / Cube Grilled Chicken

Vedi sezione sotto.

---

### Correzione chirurgica: Cube → Diced Grilled Chicken

#### Diagnosi

**Cube Grilled Chicken (prep_task 242):**
- `prep_type = 'checklist'`, `recipe_id = null`, nessun BOM che lo referenzia
- `current_stock = 12.995g` — contatore grezzo cumulativo: somma di tutti i DONE dal 24 giu al 9 lug (mai sottratto nulla, nessuna deduction POS, nessun bot)
- Non reale come stock disponibile
- Il Consolidator non lo ha mai scritto; il DONE flow accumula senza sottrazioni
- Chris produce il pollo ogni 2-7 giorni e lo registrava su questo task legacy

**Diced Grilled Chicken (prep_task 473):**
- `prep_type = 'finale'`, `recipe_id = d4e1cd5f`, categoria Pasta Station
- `current_stock = 5.944g` — reale: accumulo DONE (3.654 + 2.290g) dopo che il Consolidator v7 del 6 lug ha resettato a 0 (loaded 750 − deducted 1300 = negativo → 0)
- È l'unica prep autorevole per il pollo tagliato
- Il flusso corretto è: `POS "Add chicken" → recipe add chicken → BOM RECIPE Diced Grilled Chicken (100g) → prep_task 473`

**Mappa POS Caesar:**
- "Chicken Caesar Salad" non esiste come voce POS attiva — mai venduta
- L'unica Caesar attiva è `Mini Caesar Salad` (358 vendute dal 9 giu), BOM senza pollo
- Il pollo arriva come modifier opzionale "Add chicken" (~6% delle Mini Caesar)
- Già scaricato correttamente via recipe "add chicken" → BOM → Diced Grilled Chicken
- "CHICKEN CAESAR SALADE" (recipe) è orfana, mai venduta, BOM usa `Grill Chicken` come ITEM raw — irrilevante per operazioni correnti

#### Modifiche eseguite (11 lug 2026)

```sql
-- Cube Grilled Chicken: archiviato
UPDATE prep_tasks SET archived = true WHERE id = 242;

-- Diced Grilled Chicken: nota operativa
UPDATE prep_tasks
SET note = 'Usa questo task per registrare tutta la produzione di grilled chicken tagliato. Sostituisce il vecchio task "Cube Grilled Chicken".'
WHERE id = 473;
```

#### Stato post-modifica verificato

| Task | id | archived | current_stock | note |
|---|---|---|---|---|
| Cube Grilled Chicken | 242 | **true** | 12.995g (intatto) | null |
| Diced Grilled Chicken | 473 | false | 5.944g (invariato) | nota operativa presente |

- `prep_log` Cube: 6 produzioni storiche preservate integralmente (Samantha + Chris, 24 giu → 9 lug)
- I 12.995g di Cube **non trasferiti** a Diced (erano produzione storica cumulativa, non stock reale)
- Chris vede solo Diced Grilled Chicken in Pasta Station (Cube filtrato da `init.js` via `!i.archived`)

#### Regola confermata

```
POS "Add chicken"
  → recipe add chicken (pos_name match)
  → BOM RECIPE: Diced Grilled Chicken 100g
  → prep_task 473 (Pasta Station, unica prep autorevole)
```

**Non fare mai:** `pos_name = 'Add chicken'` su Diced Grilled Chicken.
Add chicken è il *consumatore* POS della prep, non il nome POS della prep stessa.
Impostarlo causerebbe double-counting e confusione semantica nel bot.

---

### Architettura bot-preplist-builder — stato accertato

**Fermo dal 28 giugno** (ultima entry in `bot_preplist_log`). Il cron gira ancora (0 9 UTC) ma produce 0 task — probabile errore silenzioso dopo i cambiamenti della pipeline POS nuova.

**È ancora l'unico writer** di `prep_tasks.suggested_qty` e `prep_tasks.suggested_note`. La UI (`classifyCard` in `prep.js`) legge solo questi campi:
- `suggested_note = NULL` → card classificata **WATCH** (regola R7)
- Ecco perché tutte le card nuove mostrano la pill grigia "Watch"

`computePrepBotDecision()` in `prep.js` è **solo il pannello Audit** (bottone "Audit" nella card) — spiega il suggerimento già scritto, non lo calcola. Non è un sostituto del builder.

**Il builder v17/v38 non fa BOM traversal.** Processa solo recipe con `pos_name` diretto in `pos_sales_by_item`. Sub-recipe come Diced Grilled Chicken (consumata via BOM da "add chicken") sono invisibili al builder anche quando girava.

**Non patchare il builder** aggiungendo `pos_name = 'Add chicken'` a Diced — vedi regola sopra.

**Non riattivare** il builder senza prima costruire Sprint B.

---

### Sprint B — Prep Suggester (prossimo intervento autonomo)

**Obiettivo:** sostituire bot-preplist-builder con un suggester che legge `stock_deductions` (pipeline POS nuova) e fa BOM traversal completo.

**Dati già disponibili:**
- `stock_deductions`: 1.300g/giorno di Diced Grilled Chicken (date 6 e 9 lug), da "Add chicken" via BOM
- `pos_production_daily`: ~18 porzioni/giorno "add chicken" / "Diced Grilled Chicken" (alias instabile nel canonical_name — da normalizzare)
- `min_cover_days = 1`, `expected_duration_days = 4` su prep_task 473

**Logica attesa:**
```
consumo_giornaliero = SUM(stock_deductions.quantity WHERE target = prep_task)
                    + SUM via BOM chain da tutti i parent POS
fabbisogno = consumo_giornaliero × min_cover_days × safety_buffer
suggested_qty = MAX(fabbisogno - current_stock, 0) arrotondato al batch più vicino
```

**Scrive su:** `prep_tasks.suggested_qty`, `prep_tasks.suggested_note`, `prep_tasks.sources_json`
**Non tocca:** `current_stock` (scritto solo dal DONE flow)

**Prerequisiti prima di Sprint B:**
1. Normalizzare `pos_production_daily.canonical_name` per Add Chicken (ora ha sia "add chicken" sia "Diced Grilled Chicken" come alias — instabile dal 7 lug)
2. Impostare `current_stock` iniziale su Meatballs/Meatball Sauce/Meatball Appetizer (task 479/480/481) — chiedere a Max la stima attuale

---

### Pending aperto da questa sessione

1. **Meatballs current_stock:** chiedere a Max → quanto stima in stock di Meatball Appetizer (pz), Meatballs (pz), Meatball Sauce (g) adesso? Poi impostare i valori iniziali manualmente.
2. **canonical_name instabile:** `pos_production_daily` usa due nomi diversi per lo stesso prodotto (Add chicken / Diced Grilled Chicken) — da normalizzare prima di Sprint B.
3. **Sprint B — Prep Suggester:** progettare e costruire. Vedi logica sopra.
4. **CHICKEN CAESAR SALADE recipe:** orfana e mai venduta. BOM usa `Grill Chicken` come ITEM raw invece di sub-recipe Diced Grilled Chicken. Da archiviare o correggere in sessione futura separata.
5. **bot-preplist-builder cron:** da disattivare solo dopo Sprint B attivo e verificato.




---

## Sessione 11 lug 2026 (pomeriggio) — Prep Suggester sperimentale · Step 1

### Obiettivo Step 1 (in corso, non concluso)
Dimostrare che il nuovo motore produce **suggestion credibili** su cui i cuochi possano fare affidamento.
Non sostituire ancora il Prep Builder live. Non scrivere `suggested_qty`. Non deployare UI.

---

### Regola coverage approvata

```
coverage_days = min_cover_days  (se > 0)
             altrimenti 1
```

Fonte: `prep_tasks.min_cover_days` — unico campo esplicito e verificabile nel DB.
**Non usare:** `expected_duration_days`, `shelf_life_days`, `prep_frequency_days` come orizzonte.
Questi descrivono durata/frequenza, non la finestra che la cucina vuole coprire.

---

### Distinzione fabbisogno netto vs vincolo produttivo

```
net_requirement = MAX(avg_daily × coverage_days − current_stock, 0)

planned_output:
  se base_servings > 1 (batch fisso):
    planned = CEIL(net_req / base_servings) × base_servings
  se scalabile per porzione:
    planned = CEIL(net_req)
```

Arrabbiata: `net_requirement = 1.690kg` ma `planned_output = null` — conflitto tra
`base_weight_g = 3.150kg` e `base_servings = null` → production constraint non determinabile.

---

### Fix PATH B — bot-direct-deduction v5

**Bug identificato:** recipe ibride con BOM RECIPE + prep_task finale diretto non
attivavano PATH B perché il blocco PATH A terminava con `continue` incondizionato.

**Fix deployato:** `HYBRID_PARENT_ALLOWLIST` — 7 recipe ibride verificate con dry-run.
Commit: `6f1774aec6adb71f5361f98ca0592a584469cfc9`

**Allowlist:**
```javascript
const HYBRID_PARENT_ALLOWLIST = new Set([
  'dcaa616a-1fcb-41b6-957d-6036bfdc0729', // Salmon Cakes       → Salmon cakes (3 pz)
  'dbdc80fd-142f-4ca1-8f83-7bcebe19ee63', // Artichoke          → Artichoke (2 pz)
  '4429c13f-8811-4e50-b9cc-77c8c9128da3', // Chicken Parmesan   → Chicken Parmesan (1 pz)
  '876ed092-6c9a-4c4b-b851-575aeba71231', // Lobster Fettucine  → Thaw Lobster (1 pz)
  '146ff381-49ba-46e1-b413-aea7bce1f265', // Scallops Chefs Way → Scallops (4 pz)
  '9e4ea921-93dc-4aaa-b2f2-2ff476dc3a08', // Italian Marble Cake → Cremino (1 pz)
  '5c3cc880-baa9-48aa-b280-6de57001578f', // Limoncello Cake    → Mimosa (1 pz)
])
```

**Escluse dall'allowlist (richiedono decisione Max):**
Wagyu Ribeye, Wagyu Tomahawk, Meatball Appetizer, Brussel Sprouts, Fried Calamari, ADD SHRIMP.

**Verifica post-deploy:** 16 nuove righe PATH B per ciascuna delle date 7/6 e 7/9.
Zero overlap con PATH A. Zero errori. bot-direct-deduction Supabase versione 8 ACTIVE.

---

### Stato Prep Suggester sperimentale — risultati checkpoint

**Fonte consumo:** `stock_deductions` PATH B (`direct_parent_prep_task`) — 2 service days (7/6 Mon, 7/9 Thu).

| Prep | Stock | 7/6 | 7/9 | Avg/day | Cov | Net req | Planned | Conf | Status |
|---|---|---|---|---|---|---|---|---|---|
| Artichoke (pt261) | 4 pz | 6 | 8 | 7.0 | 2 | 10.0 | 10 pz | MEDIUM | prep_today |
| Salmon cakes (pt277) | 0 pz | 18 | 12 | 15.0 | 2 | 30.0 | 39 pz (3b) | MEDIUM | do_first |
| Scallops (pt279) | 0 pz | 24 | 28 | 26.0 | 2 | 52.0 | 52 pz | MEDIUM | do_first |
| Thaw Lobster (pt296) | 0 pz | 8 | 6 | 7.0 | 2 | 14.0 | 14 pz | MEDIUM | do_first |
| Cremino (pt341) | 38 pz | 5 | 9 | 7.0 | 2 | 0 | — | MEDIUM | looks_ok |
| Mimosa (pt350) | 100 pz | 3 | 5 | 4.0 | 2 | 0 | — | MEDIUM | looks_ok |
| Chicken Parmesan (pt452) | 0 pz | 3 | 9 | 6.0 | 2 | 12.0 | 12 pz | LOW | do_first |

**Regole status:**
- `net_requirement = 0` → `looks_ok`
- `net_requirement > 0` e `stock > 0` → `prep_today`
- `net_requirement > 0` e `stock = 0` → `do_first`
- stock non verificabile → `count_first`

**Regola confidence con soli 2 service days:** max MEDIUM.
`HIGH` richiede almeno una settimana completa con dati per ogni giorno della settimana.

**Salmon Cakes — vecchio vs nuovo:**
- Vecchio (bot-preplist-builder): 117 pezzi — storia 30gg × serving_qty × 7gg di orizzonte. Sovrastimato ~3-4×.
- Nuovo (PATH B 2 days): 39 pezzi (3 batch × 13) — 15 pz/day reali × coverage 2gg.

---

### Limite attuale: dati insufficienti in stock_deductions

`stock_deductions` contiene solo i service days 7/6 e 7/9 (primo import post-pipeline).
Lo storico POS reale parte dal 9 giugno ma non è ancora stato processato dalla nuova pipeline.

**Cambio menu operativo: 2026-06-27.** I dati pre-27 giugno appartengono al menu precedente
e devono essere pesati con autorità inferiore o esclusi per alcune prep.

---

### Non fatto in questa sessione — confermato

- Nessun deploy del Prep Suggester (nessuna scrittura `suggested_qty`)
- Nessuna modifica alle suggestion live (`prep_tasks.suggested_note` invariato)
- Nessuna modifica UI
- bot-preplist-builder cron ancora attivo (da disattivare solo dopo Sprint B verificato)

---

### Prossima sessione — forecast operativo (PROGETTARE, non implementare)

La cucina non produce per "oggi". Lavora per **finestre operative**:

- **Lunedì–martedì:** produzione principale per coprire i giorni infrasettimanali.
- **Giovedì–venerdì mattina:** produzione principale per coprire venerdì sera e sabato.
- **Venerdì e sabato** = domanda più alta rispetto ai giorni infrasettimanali.
- Gli altri giorni servono principalmente per integrazioni e correzioni.

**Obiettivo della prossima sessione:** leggere tutto lo storico POS dal 9 giugno,
separare weekday e weekend, mostrare la distribuzione reale per 5–10 prep principali,
**prima di proporre la formula definitiva**. Non implementare ancora.

**Analisi da eseguire — solo lettura, nessuna scrittura:**

1. **Storico per singolo giorno della settimana**
   Per ogni prep: lunedì vs altri lunedì, venerdì vs altri venerdì, sabato vs altri sabati.
   Calcolare: media, valore recente, min, max.
   Non eliminare il picco più alto (rappresenta un rischio reale in cucina) — ridurne il peso.

2. **Due profili di domanda**
   - `weekday_profile`: lunedì–giovedì
   - `weekend_profile`: venerdì–sabato
   Utile quando i campioni dello stesso giorno sono pochi.

3. **Finestra che la produzione deve coprire**
   Dipende dal giorno in cui si prepara.
   Esempio giovedì mattina: `stock + produzione` deve coprire giovedì restante + venerdì + sabato.
   Esempio lunedì: `stock + produzione` deve coprire lunedì + martedì + parte mercoledì/giovedì.

4. **Shelf life e conservazione** — arriveranno dopo il forecast.
   Prima si studia la domanda, poi si incrociano i vincoli di durata.

**Gate prossima sessione:** mostrare la distribuzione della domanda, non proporre la formula.
La formula viene proposta solo dopo che Max vede e approva i dati.




---

## Sessione 12 lug 2026 — Prep Audit + Backfill storico deductions

### Produzione (back-of-house/brigade-main, boh-v621, invariato)

Nessun push frontend. Solo DB e audit operativo.

---

### Task 1 — Audit prep attive (156 task non archiviati)

Estratta lista completa delle prep attive con: ID, nome, stazione, unità, prep_type, min_cover_days, expected_duration_days, recipe collegata, base_servings, base_weight_g.

Scopo: base operativa per la classificazione manuale di Max prima di costruire il Prep Suggester.

**Scheda classificazione proposta per ogni prep:**

| Campo | Valori |
|---|---|
| Produzione | Giornaliera / Stock / Weekend / Evento |
| Conservazione | Frigo / Freezer |
| Congelabile | Sì / No |
| Shelf life reale | giorni |
| Lotto minimo | quantità + unità |
| Lotto preferito | quantità + unità |
| Criticità | Alta / Media / Bassa |

**Stato:** lista consegnata a Max. Classificazione da completare nelle sessioni successive. Non aggiungere questi campi al DB finché Max non ha classificato tutte le prep.

---

### Piano Prep Suggester — versione corretta (non ancora implementata)

Il piano è stato discusso e corretto in più iterazioni. Stato al termine sessione:

**Approvato:**
- Schema `prep_suggestions_daily` con `target_date` + `calculated_at` separati, UNIQUE(target_date, prep_task_id)
- Campi audit: `history_start_date`, `history_end_date`, `same_weekday_samples`, `profile_samples`, `service_days`
- Gerarchia domanda: `stock_deductions` → `reconstructed_pos_bom` → `direct_pos_fallback`
- `dry_run=true` non scrive mai sulla tabella
- Classificazione prep su comportamento operativo (non solo unità): `quantitative_prep` / `stock_check` / `station_setup` / `operational_action`

**Quattro residui ancora da correggere nel piano (da affrontare PRIMA del codice):**

1. **2026-06-27 è già nel nuovo menu** — tutte le date dal 27 giugno in avanti hanno piena autorità. Nessun peso ridotto.

2. **`count_first` non dipende da `prep_log`** — la verifica stock deve seguire la lineage: `prep_stock_counts` valido → stock ricostruibile con lineage completo → `current_stock` con origine affidabile → altrimenti `count_first`. Il `prep_log` prova produzione, non stock attuale.

3. **Confidence su sei condizioni** (non solo service_days): campioni disponibili, affidabilità stock, unità misurabile, batch_constraint, conflitti nella resa, demand_source. I service_days sono solo una delle sei.

4. **Zero giornaliero solo con percorso domanda valido** — se non esiste mapping POS/BOM per la prep, l'assenza di consumo in un giorno non diventa zero: deve diventare `no_demand_path`. Zero si inserisce solo quando il percorso domanda esiste e quel giorno il piatto non è stato venduto.

**Non implementare il Suggester finché questi quattro residui non sono risolti nel piano.**

---

### Backfill storico deductions — COMPLETATO

**Problema:** il bot-pos-cleaner v5 richiede `business_date` nel body (obbligatorio). Nelle sessioni precedenti aveva processato solo 2 date (06/07 e 09/07). Le altre 9 date avevano dati POS raw in `pos_sales_by_item` ma mancavano di `pos_daily_clean` e `stock_deductions`.

**Eseguito:** backfill idempotente di 9 date mancanti in ordine cronologico. Per ogni data: `bot-pos-cleaner` → `bot-direct-deduction` → `bot-bom-chain-deduction`. Gate di verifica `bot_runs.status='success'` dopo ogni bot.

**Risultato finale — 11 date operative complete (2026-06-27 → 2026-07-10):**

| Data | DOW | Clean | direct_recipe | bom_chain | Totale |
|---|---|---|---|---|---|
| 2026-06-27 | Sat | 203 | 120 | 124 | 244 |
| 2026-06-29 | Mon | 137 | 117 | 112 | 229 |
| 2026-06-30 | Tue | 157 | 111 | 112 | 223 |
| 2026-07-01 | Wed | 150 | 112 | 123 | 235 |
| 2026-07-02 | Thu | 206 | 109 | 118 | 227 |
| 2026-07-03 | Fri | 208 | 125 | 143 | 268 |
| 2026-07-06 | Mon | 146 | 114 | 117 | 231 |
| 2026-07-07 | Tue | 142 | 112 | 99 | 211 |
| 2026-07-08 | Wed | 137 | 103 | 85 | 188 |
| 2026-07-09 | Thu | 166 | 119 | 132 | 251 |
| 2026-07-10 | Fri | 217 | 118 | 124 | 242 |

**Copertura DOW:** ogni giorno della settimana ha almeno 1 campione (sabato 1, tutti gli altri 2). Venerdì ha 2 campioni (03/07 e 10/07).

**Anomalie risolte:**
- `2026-07-06` cleaner_status=null nel gate: run originale v4 salvava `run_date` come data di esecuzione, non business_date. Dati in `pos_daily_clean` corretti (146 righe). Nessun impatto.
- `2026-07-09` bom_chain=0: tutte le run precedenti erano `dry_run=true`. Eseguito live durante backfill → 132 righe scritte.

**Nota `bom_chain` per 07/07 e 07/08 (99 e 85 righe vs ~120 delle altre date):** valori più bassi ma coerenti con il volume POS di quei giorni (clean_rows 142 e 137, giorni infrasettimanali tranquilli). Non è un'anomalia.

---

### Audit bot-pos-cleaner / bot-direct-deduction / bot-bom-chain-deduction

Codice letto live. Comportamento confermato:

**bot-pos-cleaner v5:**
- `business_date` OBBLIGATORIO nel body (errore 400 se manca)
- `dry_run=false` → DELETE + INSERT su `pos_daily_clean` (idempotente per data)
- Scrive anche `commis_observations` e `bot_runs`
- Non tocca `stock_deductions`

**bot-direct-deduction v8:**
- `business_date` opzionale (default=oggi se manca — passare sempre esplicitamente nel backfill)
- No `dry_run` — scrive sempre
- DELETE + INSERT su `stock_deductions` WHERE `source='direct_recipe'` E `business_date=X` (solo proprie righe)
- Pipeline guard: nessuno

**bot-bom-chain-deduction v8 (v4_safety):**
- `business_date` opzionale (default=oggi)
- `dry_run=true/false` supportato
- DELETE + INSERT su `stock_deductions` WHERE `source='bom_chain'` (solo proprie righe, dentro `if !dryRun`)
- **Pipeline guard obbligatorio:** blocca se `bot-direct-deduction` non ha `status='success'` per la stessa `run_date`

---

### PENDING PROSSIMA SESSIONE

**Priorità 1 — Prep Suggester (progettazione, non codice)**
Correggere i quattro residui del piano (sopra) e ottenere approvazione di Max prima di scrivere migration o Edge Function.

**Priorità 2 — Classificazione prep operativa**
Max deve classificare le 156 prep con la scheda (Produzione / Conservazione / Congelabile / Shelf life reale / Lotto minimo / Lotto preferito / Criticità). Questa classificazione diventa la configurazione del Suggester.

**Backlog invariato:**
- 3 warning Consolidator (Spring mix g vs buste, Spaghetti pz vs nests, Parsley pinch vs g)
- Asparagus pt_unit (decisione pendente: g o kg)
- CITRONETTE deduction=0 (verifica plausibility guard)
- Meatballs current_stock: chiedere a Max stima attuale (pz Appetizer, pz Meatballs, g Sauce)
- Dish Crew Home Fase 2
- Rename Manager → Coordinator
- 7shifts sync (JWT auth)
- Sales: rimuovere tab Oggi
- La Dispensa Beta polish


---

## Sessione 13 lug 2026 — Prep Suggester: Cutover Audit + Arrabbiata

### Cutover audit completato (nessuna modifica produzione)

**Coverage gap verificato:**
- Set A (legacy suggested_qty, run 12/07): **53 prep**
- Set B (nuovo bot, suggestion_date 13/07): **9 prep** (run manuale con `filterTaskIds` — non copertura reale)
- A MINUS B = **48 prep** mancanti nel nuovo
- Il nuovo bot non è mai stato invocato in full run: non esiste cron, unica run era manuale su 10 task specifici

**Full LAB run eseguita (suggestion_date=2026-07-14, nessun filterTaskIds):**
- Prep processate: 156 | Checklist skip: 51 | Righe scritte: 105
- `no_demand_path`: 36 | `count_first`: 2 | `do_first`: 38 | `prep_today`: 3 | `looks_ok`: 26
- `planned_output` valorizzato: **4** (Maccheroni, Salmon cakes, Tiramisu, Scallops)
- `planned_output NULL` su prep actionable: 37 (36 `missing` + 1 `conflicting`)
- Unit mismatch: 8 prep (Asparagus, Filets, GF sponge cake, Risotto Base, Salmoriglio, Spaghetti fresh pasta, Spring mix, Thaw Salmon)
- Confidence: 0 high / 28 medium / 77 low

**Classificazione causa gap (verificata da codice):**
- `NOT_SELECTED_BY_INITIAL_QUERY` (solo run manuale): 424 Texana Soup, 452 Chicken Parmesan
- `SELECTED_BUT_NO_DEDUCTIONS` → `no_demand_path`: 13 prep (recipe_id NULL o consumo non arriva su prep_task_id)
- `SELECTED_BUT_CONSTRAINT_MISSING` → `planned_output=NULL`: 33 prep (CONSTRAINT_OVERRIDES mancante)

**Decisione legacy Arrabbiata:**
- Il legacy (v46) copre sl=7 giorni con DOW blend (avg×0.5 + t7×0.3 + yest×0.2) × buffer 1.20 (low confidence)
- Arrotonda a `Math.ceil(totalForCover / bw) × bw` usando bw del driver ingredient (Tomato can)
- Log confermato: stock iniziale 6.760g, scarico 8.950g da ieri (sabato), stock→0, output 40.950g = 13 × 3.150g

---

### Arrabbiata — CHIUSA ✅

**Decisione Max (13/07/2026):** 1 latta La Carmela #10 = 1 batch = **3.150g finali** di Arrabbiata.

**Modifiche eseguite:**
1. `recipes.base_weight_g` ARRABBIATA: **3.300g → 3.150g** (DB)
2. `CONSTRAINT_OVERRIDES[233]` in `bot-prep-suggester`: `conflicting/null → valid_fixed_batch/3150` (Edge Function v5→v6, deploy 13/07)

**Rollback:**
```sql
UPDATE recipes SET base_weight_g = 3300 WHERE id = '3252e642-e3c5-4c9b-9bba-9603cc086f92';
```
Più revert del codice bot-prep-suggester (riga 233 nel CONSTRAINT_OVERRIDES: `valid_fixed_batch/3150 → conflicting/null`).

**Verifica run mirata post-deploy (suggestion_date=2026-07-15, prep_task_id=233):**

| Campo | Valore atteso | Valore verificato |
|---|---|---|
| gross_forecast (2gg: Mer+Gio) | ~8.862g | **10.525g** (Mer 4.862,5 + Gio 5.662,5) |
| minimum_increment | 3.150g | **3.150g** ✅ |
| planned_output | 9.450g | **12.600g** (= 4 × 3.150g) |
| planned_batches | 3 | **4** (net_req 10.525 / 3.150 = 3,34 → CEIL = 4) |
| constraint_quality | valid_fixed_batch | **valid_fixed_batch** ✅ |
| confidence | low | **low** ✅ (zeroUnverified=true) |
| status | do_first | **do_first** ✅ |

Nota: il gross_forecast differisce da 8.862,5g perché quella era per lunedì+martedì (13/07); questa run è per mercoledì+giovedì (15/07). Il calcolo è corretto per entrambe le date — i giorni coperti cambiano con la `suggestion_date`.

**Regola documentata:**
> Arrabbiata: 1 latta La Carmela #10 = 1 batch = 3.150g finali.
> `base_weight_g = 3.150`, `CONSTRAINT_OVERRIDE = valid_fixed_batch, increment = 3.150g`.
> BOM: 2.950g Canned Tomatoes + acqua + olio + aglio + prezzemolo + spezie = 4.422g crudi → 3.150g finiti (riduzione ~29%).

---

### Prossima prep da compilare

Passare alla prep successiva nella lista gap CONSTRAINT_MISSING (da decidere con Max quale).



---

## Sessione 13 lug 2026 (continuazione) — Pomodoro Sauce + SAUCE TWICE-WEEKLY CADENCE

### Pomodoro Sauce — CHIUSA ✅

**SELECT live pre-modifica — 2026-07-13 00:14 CDT:**
`base_weight_g=3500`, `base_servings=NULL` (già corretto), `yield_text='3500g per batch'`, `shelf_life_days=7`.
Anomalia "3532 vs 6122" era basata su snapshot vecchio — non valida.

**Decisione Max:**
- Ricetta a peso. 1 batch = 3.500g finali.
- `base_weight_g=3500` è l'unica fonte autorevole.
- Le quantità per piatto vivono nel `recipe_bom` (non toccato).
- Le porzioni ottenibili sono calcolate, non salvate.

**Modifiche eseguite (2026-07-13 00:14 CDT):**
```sql
UPDATE recipes SET yield_text = NULL, base_servings = NULL
WHERE id = '498a2cf2-e425-4f08-8f5c-0edca4ca6f9e'
  AND base_weight_g = 3500 AND yield_text = '3500g per batch';
```
- `yield_text`: `'3500g per batch'` → `NULL`
- `base_servings`: già NULL → confermato NULL
- `base_weight_g=3500` invariato
- `recipe_bom` non toccato (9 righe: 3kg Canned Tomatoes, 577g Water, 461g Onions, 115g Carrots, 115g EVOO, 87g Basil, 58g Celery, 1g Salt)

**Rollback:**
```sql
UPDATE recipes SET yield_text = '3500g per batch' WHERE id = '498a2cf2-e425-4f08-8f5c-0edca4ca6f9e';
```

**CONSTRAINT_OVERRIDE aggiornato — bot-prep-suggester v7 (deploy 13/07):**
```js
// da:
304: { quality: 'missing', increment: null, unit: 'g' }
// a:
304: { quality: 'valid_fixed_batch', increment: 3500, unit: 'g' }
```
Rimossa anche la penalty `confChecks[4]=false` per taskId===304 (era temporanea per stato conflicting — ora superata).

**Rollback codice:**
Riga 304 in CONSTRAINT_OVERRIDES: `valid_fixed_batch/3500 → missing/null`. Riaggiungere `if(taskId===304) confChecks[4]=false`.

**Regola documentata:**
> Pomodoro Sauce: 1 batch = 3.500g finali.
> `base_weight_g = 3500`, `CONSTRAINT_OVERRIDE = valid_fixed_batch, increment = 3500g`.
> BOM: 3kg Canned Tomatoes + soffritto + acqua = ~4.414g crudi → 3.500g finiti (riduzione ~21%).

**Verifica run mirata LAB (suggestion_date=2026-07-16, prep_task_id=304) — 2026-07-13 00:17 CDT:**

| Campo | Valore |
|---|---|
| `gross_forecast` (Gio+Ven) | **6.175g** (Gio 3.350 + Ven 2.825 — dow_match, 2 campioni/DOW) |
| `stock_source` | `db_snapshot_unverified` (current_stock=13.400g — non verificato fisicamente) |
| `net_requirement` | **0g** (13.400g > 6.175g — stock sufficiente) |
| `minimum_increment` | **3.500g** ✅ |
| `planned_output` | **0g** (looks_ok — nessuna produzione necessaria per giovedì+venerdì) |
| `planned_batches` | **0** |
| `confidence` | **medium** (confScore 5/6: dow_match ok, constraint ok, stock non verificato fisicamente) |
| `status` | **looks_ok** ✅ |

Nota: con 13.400g in casa e ~3.100g/giorno di consumo medio, il Pomodoro copre ~4,3 giorni. Corretto: `looks_ok` per una finestra di 2 giorni.

---

### SAUCE TWICE-WEEKLY CADENCE — regola documentata (non ancora implementata)

**Regola approvata da Max (13/07/2026) — da applicare prep per prep su conferma:**

```
SAUCE TWICE-WEEKLY CADENCE
Per salse Chef-approved con shelf_life_days >= 4:
  - Produzione lunedì: copre lunedì–giovedì
  - Produzione giovedì: copre venerdì–sabato
  - Venerdì mattina: fallback se produzione giovedì mancata o stock reale insufficiente
  - Martedì/mercoledì: nessuna suggestion salvo shortage o evento speciale
```

**Distinzione fondamentale:**
- `shelf_life_days` = durata sicura del prodotto (campo DB, invariato)
- `production_cadence` = quando vogliamo produrre (logica futura nel bot, non ancora implementata)

**Implementazione futura:** il bot-prep-suggester dovrà leggere un campo `production_cadence` (da aggiungere a `prep_tasks` o a una tabella dedicata) per determinare se oggi è un giorno di produzione per questa prep. Se non è un giorno di cadenza e lo stock è sufficiente → `looks_ok` anche con net_requirement > 0.

**Non applicare a tutte le salse senza conferma prep per prep.** Arrabbiata e Pomodoro sono le prime candidate. Salse successive da decidere con Max.

---

### Prep successiva da compilare

La prossima prep nel gap CONSTRAINT_MISSING da decidere con Max.



---

## Sessione 13 lug 2026 (continuazione) — Saucier Production Cadence v3

### Pseudocode approvato — pronto per deploy prossima sessione

**SAUCIER PRODUCTION CADENCE v3 — policy approvata da Max 13/07/2026**

#### Costanti

```
BUFFER = 1.10

CADENCE:
  shelf_life_days >= 4  →  TWICE_WEEKLY
  shelf_life_days <  4  →  THREE_TIMES_WEEKLY

COVER_DOWS (TWICE_WEEKLY):
  Mon → [Mon, Tue, Wed, Thu]   (4 service days)
  Tue → [Tue, Wed, Thu]        (3 service days)
  Thu → [Thu, Fri, Sat]        (3 service days)
  Fri → [Fri, Sat]             (2 service days)

COVER_DOWS (THREE_TIMES_WEEKLY):
  Mon → [Mon, Tue]
  Wed → [Wed, Thu]
  Fri → [Fri, Sat]

SHORTAGE_COVER_DOWS (TWICE_WEEKLY):
  Wed → [Wed, Thu]
  Sat → [Sat]

SHORTAGE_COVER_DOWS (THREE_TIMES_WEEKLY):
  Tue → [Tue], Thu → [Thu], Sat → [Sat]
```

#### Formula core

```
required_until_next = SUM(dow_avg[d] FOR d IN cover_dows) × 1.10
shortage_ratio      = current_stock / required_until_next
net_requirement     = MAX(required_until_next - current_stock, 0)
planned_output      = CEIL(net_requirement / min_increment) × min_increment

shortage_ratio < 1.0  → produzione necessaria
shortage_ratio >= 1.0 → looks_ok
```

#### Stati output

| Status | Significato | Task |
|---|---|---|
| `prep_today` | shortage_ratio < 1.0 in finestra | ✅ |
| `do_first` | shortage override (fuori finestra, stock esaurito) | ✅ |
| `defer_to_tomorrow` | stock regge oggi, bot ricalcola domani con dati reali | ❌ |
| `looks_ok` | stock sufficiente | ❌ |
| `count_first` | current_stock NULL | ❌ |
| `no_demand_path` | nessuna deduction storica | ❌ |

**`defer_to_tomorrow`**: il bot non crea task. Domani ricalcola con stock reale aggiornato. Non è un impegno definitivo — è "ricontrolla domani".

#### Logica first_day (TWICE_WEEKLY)

```
shortage_ratio < 1.0 → prep_today

shortage_ratio >= 1.0 → controlla se lo stock regge fino al second_day:
  cost_today    = dow_avg[today_dow]
  stock_eod     = current_stock - cost_today
  req_from_tomorrow = required_until_next(COVER_DOWS[tomorrow_dow]) × 1.10
  IF stock_eod >= req_from_tomorrow → defer_to_tomorrow
  ELSE                              → prep_today
```

#### Shortage override

```
Fuori finestra (Wed/Sat per TWICE_WEEKLY):
  - se net_req > 0 → do_first, ma copre SOLO fino alla prossima finestra normale
  - non usare target fisso di 2 giorni
  Esempio: Arrabbiata finisce mercoledì →
    cover_dows = [Wed, Thu] → produce mercoledì per coprire mer+gio
    giovedì rientra in finestra B normale
```

#### Confidence + stock non verificato

```
stock_source = 'db_snapshot_unverified':
  shortage_ratio < 1.05  → confidence LOW + flag_recount=TRUE
                            (mostra "Verifica stock prima di produrre")
  shortage_ratio >= 1.05 → demote di un livello (high→medium, medium→low)

stock_source = 'prep_stock_counts':
  confidence da sample_count (>=4 high, >=2 medium, else low)
```

#### Demand: avg_by_dow

```
- Calcolo runtime da stock_deductions (no nuova colonna in prep_tasks)
- Raggruppa per DOW, calcola media per DOW
- Fallback a global_avg se un DOW non ha campioni
- Salvato in debug_json: dow_avg, dow_sample_counts, history_start, history_end
```

#### rank_station (distribuzione carico)

```
- Ordina per shortage_ratio ASC (più urgente prima)
- today_group:    status IN (prep_today, do_first)
- deferred_group: status == defer_to_tomorrow
- Controllo sicurezza: se stock_eod < 0 → promuovi deferred a today
- Output: { today: [...], deferred: [...], ok: [...] }
```

#### Esempio verificabile — Lunedì (dati reali)

```
Arrabbiata (pt 233) — stock=0g — shortage_ratio=0.00
  cover [Mon,Tue,Wed,Thu]: required = (4063+4800+4363+5394)×1.10 = 20.482g
  net_req=20.482 → batches=CEIL(20.482/3150)=7 → planned=22.050g
  → prep_today / LOW / flag_recount=TRUE

Pomodoro (pt 304) — stock=13.400g — shortage_ratio=0.996
  cover [Mon,Tue,Wed,Thu]: required = (3363+2838+2675+3350)×1.10 = 13.448g
  shortage_ratio=0.996 < 1.0 → sarebbe prep_today
  BUT first_day check:
    stock_eod = 13.400 - 3.363 = 10.037g
    req_from_tue = (2838+2675+3350)×1.10 = 9.749g
    10.037 >= 9.749 → defer_to_tomorrow

OUTPUT lunedì:
  OGGI:   Arrabbiata  7 latte / 22.050g  [LOW, verifica stock]
  DOMANI: Pomodoro    —                  [ricalcola martedì]
```

#### Tre punti già risolti nel pseudocode (no decisioni Max)

1. `THREE_TIMES_WEEKLY` non ha `defer_to_tomorrow` — first_day unico, shortage_ratio >= 1.0 → looks_ok diretto.
2. `stock_eod` usa `dow_avg[today_dow]` come proxy — approssimazione consapevole. Bot di domani usa dato reale.
3. `flag_recount` è nota aggiuntiva nel reason, non blocca la suggestion.

#### Prossima sessione: deploy

Implementare `cadence_suggestion` + `avg_by_dow` + `rank_station` in `bot-prep-suggester`.
Non toccare CONSTRAINT_OVERRIDES esistenti (già corretti per Arrabbiata e Pomodoro).
Non modificare UI o cron legacy.
Testare con run LAB su prep_task_ids=[233, 304] prima di full run.



---

## Sessione 13 lug 2026 (continuazione) — Classificazione Famiglie + Tabella Laterale + Shell v018

### Produzione live (invariata)
- **boh-v624** su `back-of-house/brigade-main`
- Nessuna modifica a `prep_tasks`, suggestion engine, o live app

---

### Classificazione prep_tasks — COMPLETATA ✅

**Schema approvato:**
- `production_family`: `weekly_batch | daily_fresh | frozen_production | vendor_driven | opportunistic | NULL`
- `work_type`: `quantitative_prep | operational_action | stock_check | station_setup | cleaning`
- Regola semantica: `stock_check`, `station_setup`, `cleaning` → `production_family` MUST be NULL
- `operational_action` può avere famiglia o NULL
- `NULL family` = famiglia non applicabile (non = non classificato)

**Distribuzione finale (153 prep attive):**

| production_family | n |
|---|---|
| `weekly_batch` | 42 |
| `daily_fresh` | 39 |
| `vendor_driven` | 31 |
| `frozen_production` | 10 |
| `opportunistic` | 2 |
| NULL (non applicabile) | 29 |

**NULL breakdown (29):**
- `stock_check`: 21 · `station_setup`: 6 · `cleaning`: 1 · `operational_action`: 1 (id=283 Tempura, decisione Max)

**Decisioni puntuali:**
- Basil id=454 → `canonical_station = 'Executive Chef'` (cross-station, non salad-specific)
- Arugola id=453 → `canonical_station = 'Garde Manger'` (salad-specific)
- Tempura id=283 → `production_family=NULL, work_type='operational_action'`, `prep_type` invariato, warning presente
- Confit tomatoes id=451 → `daily_fresh`, confidence MEDIUM (no base_weight_g)
- Brisket id=285 → `vendor_driven`, warning shelf_life conflict (pt=14d vs recipe=5d)
- Chopped dark/white choc 337/338 → `weekly_batch`, confidence MEDIUM (no recipe_id)
- Shaved Parm id=371 → `daily_fresh`, confidence MEDIUM (7d shelf ma texture migliore fresca)
- Salad Station = 33 record (conteggio autorevole attuale — non creare né riattivare per raggiungere 34)

**Diff v1→v2: 41 righe modificate** (40 solo family, 1 anche work_type: id=270 Gf bread)

---

### Tabella `prep_task_classifications` — CREATA E POPOLATA ✅

**Architettura:** tabella laterale one-to-one (mai ALTER/UPDATE su `prep_tasks`).
Zero eventi Realtime su `prep_tasks`. Zero modifiche live app.

**Schema:**
```sql
CREATE TABLE prep_task_classifications (
  prep_task_id           bigint       PRIMARY KEY,
  production_family      text         NULL,
  work_type              text         NOT NULL,
  canonical_station      text         NULL,
  family_confidence      text         NULL,  -- 'HIGH' | 'MEDIUM'
  classification_warning text         NULL,
  classified_at          timestamptz  NOT NULL DEFAULT now(),
  classified_by          text         NOT NULL,
  CONSTRAINT fk_ptc_prep_task FOREIGN KEY (prep_task_id) REFERENCES prep_tasks(id) ON DELETE CASCADE
);
```

**4 constraint idempotenti:** `chk_ptc_production_family`, `chk_ptc_work_type`, `chk_ptc_family_confidence`, `chk_ptc_family_wt_semantic`

**Popolamento:**
- UPSERT 153 righe, `classified_by='audit_2026_07_13_v2'`
- 7 controlli pre-UPSERT verificati in DB (tutti 0): mapping_rows=153, distinct_ids=153, duplicate_ids=0, archived_in_mapping=0, active_missing=0, nonexistent_ids=0, semantic_violations=0
- 5 post-check verificati in DB: batch_rows=153 ✅, classified_active_preps=153 ✅, active_missing=0 ✅, batch_linked_to_archived=0 ✅, semantic_violations=0 ✅, prep_tasks_active=153 ✅ (INVARIATO)

**RLS:** OFF (coerente con `prep_tasks`). Policy futura proposta (non applicata):
```sql
ALTER TABLE prep_task_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY ptc_anon_select ON prep_task_classifications FOR SELECT TO anon USING (true);
-- No INSERT/UPDATE/DELETE per anon — solo service_role
```

**Rollback A (dati):** `DELETE FROM prep_task_classifications WHERE classified_by='audit_2026_07_13_v2'`
**Rollback B (struttura):** `DROP TABLE IF EXISTS prep_task_classifications`

**Pattern LEFT JOIN per Workspace:**
```sql
SELECT pt.*, ptc.production_family, ptc.work_type, ptc.canonical_station,
       ptc.family_confidence, ptc.classification_warning
FROM prep_tasks pt
LEFT JOIN prep_task_classifications ptc ON ptc.prep_task_id = pt.id
WHERE pt.archived IS NOT TRUE ORDER BY pt.category, pt.name;
```

---

### New Shell Lab — Prep Families page (shell v018) ✅

**File:** `brigade-dev/brigade-main/shell.html`
**Commit:** `213ab71fa525` — "shell v018 — prep_families page: real DB data, 153 prep, LEFT JOIN, read-only"
**SHA:** `4459c1a39dffd777a1e6fb7f25e8b9072c42a2ff`

**Funzionalità:**
- `pagePrepFamilies()` — skeleton sincrono con loading spinner
- `prepFamiliesAfterRender()` — due fetch paralleli (`Promise.all`): `prep_tasks` + `prep_task_classifications`, LEFT JOIN in JS
- `_pfRenderBody(data)` — partiziona 153 record in 7 gruppi:
  - 5 famiglie di produzione (weekly_batch, daily_fresh, frozen_production, vendor_driven, opportunistic)
  - "Operational / No Production Family" (29 record, suddivisi per work_type: Stock Checks, Setup, Cleaning, Operational Action)
  - "Unclassified" (prep senza riga in prep_task_classifications — LEFT JOIN NULL)
- `_pfOperationalSection()` — sub-gruppi per work_type con label esplicite
- `_pfShowMock()` — fallback se Supabase irraggiungibile (usa KS mock esistente)
- `_pfCache` — evita re-fetch mentre il tab è aperto
- CSS iniettato (70 regole, token `--bd/--tx/--b6/--ok/--wn/--er`, responsive 600px)
- i18n IT/EN/ES completo
- Aggiunto a PAGE_MAP, home cards, bottom bar, tab label switch

**QA verificato:**
- Zero write requests (nessun POST/PATCH/DELETE in codice `_pf*`)
- `_kitchenInitState()` mock intatto (fallback separato)
- `pageKitchen()`, `pagePrepGallery()` invariati

---

### Regole confermata questa sessione

- `production_family IS NULL` = famiglia non applicabile (non = non classificato)
- `production_family valorizzata` = famiglia applicabile (fonte di verità unica, no booleano aggiuntivo)
- `work_type` NON può essere `NOT NULL DEFAULT` su `prep_tasks` (i 90 archiviati resterebbero NULL)
- Architettura laterale (tabella separata) preferita ad ALTER TABLE su tabella operativa live
- Impact audit confermato: nuovi campi `select(*)` arrivano in JS ma nessun codice live li legge → zero impatto UI

---

### Pending prossima sessione

**Immediato:**
1. **Saucier Cadence v3 deploy** — pseudocode approvato, pronto per implementazione in `bot-prep-suggester`
2. **Shell Lab: Prossimo modulo** — decidere con Max dopo aver visto la Prep Families page (Inventory, Sales, oppure collegare Diario al DB)

**Backlog invariato (vedi sessioni precedenti):**
- 3 warning Consolidator (Spring mix, Spaghetti, Parsley)
- Asparagus pt_unit (g vs kg)
- Meatballs current_stock (chiedere a Max stima)
- Dish Crew Home Fase 2
- Rename Manager → Coordinator
- 7shifts sync (JWT auth)
- Sales: rimuovere tab Oggi
- RLS hardening su `prep_task_classifications` (futura sessione)
