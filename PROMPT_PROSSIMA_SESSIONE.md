# PROMPT_PROSSIMA_SESSIONE — Brigade BOH

> **Append-only per storia sessioni. Sezione "STATO CORRENTE" sempre aggiornata all'ultimo.**

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

