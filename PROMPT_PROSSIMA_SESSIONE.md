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
