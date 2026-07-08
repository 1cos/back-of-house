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

