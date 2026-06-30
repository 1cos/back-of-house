# BRIGADE — DATABASE SCHEMA COMPLETO
*Supabase project: ydqmumpytgrlceuinoqt*
*Aggiornato: 2026-06-30 — v428 — verificato live via information_schema*
*Leggi questo file all'inizio di ogni sessione. Contiene le colonne reali del DB. In caso di dubbio, verifica comunque con `information_schema.columns` prima di modificare — questo file può avere drift.*

---

## REGOLA FERREA
**Dati finanziari (net_sales, gross_sales, food_cost, labor_cost, margin) → MAI mostrati a utenti staff (role='staff'). Solo admin (Max).**

---

## UTENTI E PRESENZA

### users (28 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK, identity |
| name | text | UNIQUE — Nome visualizzato |
| lang | text | 'it' / 'en' / 'es' — default 'en' |
| is_admin | boolean | default false — true solo per Max |
| role | text | default 'staff' |
| auth_id | uuid | FK → auth.users.id |
| password_hash | text | |
| default_station | text | Stazione di default — usata da Focus Mode e Closing |
| photo_url | text | Avatar |
| birth_date | date | Per modulo compleanni Home |
| first_login | boolean | default true |
| active | boolean | default true |
| pin | char | PIN accesso app |
| schedule_name | text | Nome esatto in shifts_schedule per match Focus Mode (7shifts) — popolato per tutto lo staff con alias esatti |

**Staff (vedi memoria sessione per elenco completo aggiornato):** Tela (Kitchen Operation Coordinator — non Manager), David/Colton (Sous Chef sera/mattina), Samantha (Pastry), Anto/Antonella (Chef Rover), Cole (Saucier), Zuu/Maria Rosa Razo + Rachel/Carolina Baquero (Salad, spagnolo), Dish Crew: Austin, Jaxon, Arianna, Kelly, Herminia, Jose, Luis, Ronaldo.

### user_presence (19 righe)
| Colonna | Tipo | Note |
|---|---|---|
| user_name | text | PK, FK logico → users.name |
| last_seen | timestamptz | Aggiornato periodicamente |
| role | text | |
| station | text | Stazione attuale |
| photo_url | text | |

### staff_profiles (16 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | integer | PK |
| name | text | UNIQUE |
| shift_preference | text | 'morning' / 'evening' / 'both' |
| max_days_per_week | integer | default 5 |
| off_days | text[] | |
| no_evening_days | text[] | |
| only_days | text[] | |
| is_double_shift | boolean | default false |
| notes | text | |
| active | boolean | default true |

**Usata da:** modulo Schedule per regole di scheduling/vincoli brigata.

### staff_stations (54 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | integer | PK |
| staff_name | text | FK → staff_profiles.name |
| station | text | |
| shift | text | 'morning' / 'evening' / 'both' |
| priority | integer | 1/2/3 |
| is_default | boolean | default false |
| notes | text | |

---

## PREP E PRODUZIONE

### prep_tasks (231 righe, 156 attivi non archiviati)
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| name | text | Nome item |
| category | text | Stazione — vedi conteggio sotto |
| done | boolean | Completato oggi |
| need_tomorrow | boolean | true = da fare / false = chiuso in closing |
| in_progress | boolean | In lavorazione |
| qty | text | Quantità target (testo libero) |
| unit | text | Unità misura — "batch" è sempre tradotto dal bot in unità native (kg/g da base_weight_g, o porzioni da base_servings) |
| container | text | Contenitore |
| recipe_id | uuid | FK → recipes.id |
| archived | boolean | Nascosto dalla lista attiva |
| note | text | Note operative |
| expected_duration_days | integer | Shelf life attesa |
| average_qty | numeric | Media storica produzione |
| current_stock | numeric | Stock attuale — bot SALTA il task se NULL |
| suggested_qty | numeric | Quantità suggerita da bot-preplist-builder |
| suggested_by | text | default 'bot-preplist-builder' |
| suggested_at | timestamptz | Timestamp ultimo aggiornamento |
| suggested_note | text | Formato `color|testo_it|testo_en|testo_es` — frontend legge indice lingua da user.lang |
| daily_reset | boolean | default false |
| prep_type | text | CHECK: 'finale' (collegato a POS) / 'supporto' (prep intermedia) / 'checklist' (promemoria operativo, ignorato dal bot) — 67 task ancora NULL |

**Stazioni attive (156 task non archiviati, 30/06/2026):** Salad Station (34), Pastry Station (24), Sauté Station (18), Manager Station (17), Saucier Station (14), Oven Station (13), Pasta Station (12), Plating Station (12), Table Side (9), Fresh Pasta Station (3).
**NOTA:** queste stazioni sono diverse da quelle elencate in versioni precedenti di questo file (Freezer non più presente come categoria separata) — verificare sempre con `SELECT DISTINCT category FROM prep_tasks` se serve l'elenco esatto aggiornato.

### prep_steps (11 righe)
Tabella per task operativi SENZA ricetta collegata (salse semplici, check con step ma niente BOM).
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK, identity |
| prep_task_id | bigint | FK → prep_tasks.id |
| sort_order | integer | default 0 |
| title | text | |
| note | text | |
| timer_minutes | integer | **In MINUTI, non secondi** — convertito automaticamente nel modal |
| created_at | timestamptz | |

### prep_step_log (0 righe — tabella nuova, non ancora popolata)
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK, identity |
| prep_task_id | bigint | FK → prep_tasks.id |
| step_id | bigint | FK → prep_steps.id |
| log_date | date | default CURRENT_DATE |
| started_by | text | |
| started_at | timestamptz | |
| completed_by | text | |
| completed_at | timestamptz | |
| timer_fired | boolean | default false |

### prep_log (302 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| created_at | timestamptz | UTC → converti CDT |
| user_name | text | Chi ha prodotto |
| station | text | |
| item | text | |
| qty | numeric | |
| unit | text | |
| container | text | |
| started_at | timestamptz | Quando il cuoco ha premuto START |
| duration_minutes | integer | Durata calcolata al DONE |
| is_demo | boolean | default false |
| is_suggested_qty | boolean | default false — se la qty prodotta è quella suggerita dal bot |

**Stato:** dati reali — app in produzione dal lancio (giugno 2026). Tutti i dati pre-lancio sono test data.

### bot_preplist_log (181 righe)
Log delle esecuzioni del bot-preplist-builder, una riga per task processato per run.
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| run_date | date | |
| run_at | timestamptz | |
| bot_version | text | |
| task_id | integer | |
| task_name | text | |
| recipe_id | uuid | |
| percorso | text | Percorso di ragionamento del bot (debug) |
| covered_days | text | |
| piatti_considerati | text | |
| detail | jsonb | |
| total_raw_g | numeric | |
| suggested_qty | numeric | |
| suggested_note | text | |

### closing_checks (150 righe)
Tabella separata da prep_tasks: definisce CHI VERIFICA la sera (closing) vs chi PRODUCE la mattina (prep_tasks).
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| name | text | |
| station | text | |
| prep_task_id | bigint | FK → prep_tasks.id (opzionale, collega il check al task di produzione) |
| archived | boolean | default false |
| note | text | |
| daily_reset | boolean | default false |

### closing_log (328 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| check_id | bigint | FK → closing_checks.id |
| user_name | text | |
| answer | boolean | |
| log_date | date | default oggi in America/Chicago |

---

## RICETTE

### recipes (218 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| title | text | UNIQUE — deve combaciare esattamente (case-sensitive) con pos_sales_by_item.menu_item per il match automatico |
| category | text | Es. "SECONDI\|contorni" — formato `Categoria\|sottocategoria` |
| yield_text | text | |
| ingredients | jsonb | Array libero NON relazionale — legacy, NON usare per dipendenze: usa recipe_bom |
| procedure | text | **Legacy** — testo libero IT. Contiene anche le "note di servizio" (piattaggio/finitura al pass) per le ricette che hanno anche recipe_steps — vedi regola sotto |
| procedure_en | text | Traduzione EN di procedure |
| procedure_es | text | Traduzione ES di procedure |
| equipment | text | |
| prep_time_minutes | integer | |
| base_weight | numeric | Legacy |
| weight_unit | text | default 'kg' |
| base_servings | integer | Porzioni base — usato per scalare BOM e steps |
| base_weight_g | numeric | Peso batch totale in grammi a base_servings |
| serving_weight_g | numeric | Calcolato: base_weight_g / base_servings |
| pos_name | text | Nome sul POS TouchBistro — supporta alias multipli pipe-delimited ('Name1\|Name2'). MAI modificare alias esistenti con storico POS, solo appendere |
| menu_group | text | Pasta/Entrees/Appetizers/Salads/Sides/Sauces/Bases/Desserts/Soups/Finger Food/Catering/Condiments |
| selling_price | numeric | **ADMIN ONLY** |
| food_cost_pct | numeric | **ADMIN ONLY** |
| serving_unit | text | Es. nests, pezzi, grammi |
| serving_qty | numeric | Quante unità fisiche per porzione (es. 2 nests) |
| prep_frequency_days | integer | |
| shelf_life_days | integer | |
| image_url / photo_url | text | |

**Stato 30/06/2026 (216-218 ricette):** 21 ricette hanno `recipe_steps` popolati (nuovo formato), 16 hanno solo il vecchio `procedure` testuale, alcune in doppio binario (sia procedure che recipe_steps — es. Amalfi Salmon, Arrabbiata, Artichoke, Chicken Parmesan, Fried Calamari, Salmon Cakes — rischio disallineamento se editate dal vecchio editor "Edit"). La maggioranza delle ricette non ha ancora alcun procedimento scritto da nessuna parte.

**Regola "Note di servizio" (stabilita da Max):** le istruzioni di piattaggio/finitura/servizio (cosa fare al pass quando arriva la comanda, diverso dalla prep mattutina) vanno nel campo `recipes.procedure` (letto dal tab "Notes" della recipe-modal), NON in `recipe_steps`. `recipe_steps` è riservato esclusivamente al procedimento di PRODUZIONE/PREP.

### recipe_translations (103 righe)
| Colonna | Tipo | Note |
|---|---|---|
| recipe_id | uuid | PK composita, FK → recipes.id |
| lang | text | PK composita — CHECK 'it'/'en'/'es' |
| title | text | |
| procedure | text | |
| equipment | text | |
| ingredients | jsonb | |
| updated_at | timestamptz | |

### recipe_steps (88 righe, 21 ricette coperte) — SISTEMA AUTORITATIVO ATTUALE
Sostituisce il vecchio `recipes.procedure` come fonte di verità per il procedimento di prep. Editabile dalla UI step editor dentro `openRecipeEditor` (recipes.js, da v427) e letto/eseguito dalla recipe-modal (recipe-modal.js) con progress bar e timer.
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| recipe_id | uuid | FK → recipes.id |
| step_number | integer | Ordine dello step |
| title | text | Titolo legacy — fallback se title_it/title_es mancanti |
| title_it | text | Aggiunta v425 |
| title_es | text | Aggiunta v425 |
| instruction_en | text | |
| instruction_it | text | |
| instruction_es | text | |
| timer_seconds | integer | **In SECONDI** (diverso da prep_steps.timer_minutes!) |
| created_at | timestamptz | |

**Lettura lingua:** recipe-modal.js sceglie title_it/title_es/title e instruction_it/en/es in base a `window.user?.lang`.
**Editing:** `js/recipes.js → openRecipeEditor` (async, carica gli step esistenti) + `saveRecipeSteps(recipeId, steps)` (pattern delete+reinsert, come saveRecipeBOM). Pulsante "Traduci EN/ES" per riga chiama `groqTranslate` (stessa Edge Function `ai-translate` usata per procedure_en/es).
**Backlog:** placeholder dinamici `{item_id}` negli step text, risolti dal BOM scalato in tempo reale invece di quantità hardcoded — non ancora implementato.

### recipe_bom (1257 righe) — GRAFO DI DIPENDENZE, FONTE AUTORITATIVA INGREDIENTI/BOM
| Colonna | Tipo | Note |
|---|---|---|
| bom_id | integer | PK |
| parent_recipe_id | uuid | FK → recipes.id — la ricetta "padre" (NOTA: non `recipe_id`) |
| component_type | text | CHECK — **'ITEM' / 'RECIPE' (MAIUSCOLO)** — non 'ingredient'/'sub_recipe' come riportato in vecchie versioni di questo file |
| item_id | uuid | FK → ingredients.id se component_type='ITEM' |
| sub_recipe_id | uuid | FK → recipes.id se component_type='RECIPE' |
| quantity | numeric | |
| unit | text | |
| notes | text | |
| prep_task_id | bigint | FK → prep_tasks.id (opzionale) |
| sort_order | integer | |

**REGOLA CRITICA: le righe di recipe_bom non vengono MAI modificate o cancellate liberamente** — sono connesse a bot-preplist-builder, dati POS, e calcolo food cost. Editing solo tramite editor ufficiale (delete+reinsert controllato).

---

## POS — TOUCHBISTRO SALES

### pos_sales_by_item (2106 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| sale_date | date | |
| is_historical | boolean | default false |
| period_end | date | |
| menu_item | text | Nome piatto — deve combaciare con recipes.title per match |
| sales_category | text | |
| menu_group | text | |
| quantity | numeric | Porzioni vendute |
| gross_sales | numeric | **ADMIN ONLY** |
| item_discounts | numeric | **ADMIN ONLY** |
| bill_discounts | numeric | **ADMIN ONLY** |
| net_sales | numeric | **ADMIN ONLY** |
| voids | numeric | **ADMIN ONLY** |
| void_quantity | numeric | |
| refund_quantity | numeric | |
| refund_amount | numeric | **ADMIN ONLY** |
| total_tax | numeric | |
| sales_pct | numeric | |

### pos_daily_summary (18 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| sale_date | date | UNIQUE |
| day_of_week | text | |
| bill_count | integer | Scontrini chiusi — MAI "coperti" o "tavoli" |
| voids | numeric | **ADMIN ONLY** |
| gross_sales | numeric | **ADMIN ONLY** |
| discounts | numeric | **ADMIN ONLY** |
| net_sales | numeric | **ADMIN ONLY** |
| food_cost | numeric | **ADMIN ONLY** |
| labor_cost | numeric | **ADMIN ONLY** |
| margin | numeric | **ADMIN ONLY** |

### pos_modifiers (2084 righe) / pos_modifier_by_item (4270 righe)
Modifier grezzi POS e relativa scomposizione per piatto padre (`parent_item`, `pct_of_parent`).

### pos_production_daily (594 righe)
Vista/tabella aggregata: `canonical_name`, `item_portions`, `modifier_portions`, `total_portions` (generated column) per giorno — usata per analisi produzione storica.

### pos_item_aliases (48 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | integer | PK |
| alias_name | text | |
| canonical_name | text | |
| portion_factor | numeric | default 1.0 — 0.5 per add-on (proteine extra su pasta) |
| category | text | CHECK protein/side/pasta/appetizer |
| source | text | CHECK modifier/item/both |
| notes | text | |

### pos_excluded_items (6 righe)
Item del POS intenzionalmente senza ricetta (fuori menu, servizi, voci di sistema). `menu_item` UNIQUE, `reason`, `excluded_by` default 'Max'.

### modifier_config (86 righe)
Configurazione modifier: `modifier` (PK), `is_kitchen`, `kitchen_cat` (CHECK Contorni/Proteine/Upgrade/Extra), `portion_note`.

---

## INGREDIENTI E FORNITORI

### ingredients (434 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| name | text | Nome canonico EN |
| name_it / name_es | text | Traduzioni |
| category | text | Produce/Dairy/Meat/Seafood/Dry Goods/Oil & Vinegar/Spices & Herbs/Beverages & Spirits/Prepared/Bakery/Frozen/Supply |
| base_unit | text | default 'g' |
| measure_type | text | CHECK 'weight'/'volume'/'each' — weight=venduto a peso, each=venduto a pezzo/count |
| avg_unit_weight_g | numeric | Peso medio per pezzo (per measure_type='each') |
| yield_factor | numeric | default 1.0, CHECK (0,1] — fattore di resa dopo pulizia/scarto |
| notes | text | |
| active | boolean | default true |

### ingredient_vendors (80 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| ingredient_id | uuid | FK → ingredients.id |
| vendor | text | |
| vendor_sku | text | |
| purchase_unit | text | default 'lb' |
| pack_description | text | Es. "4x5lb" |
| unit_price | numeric | |
| price_type | text | CHECK per_case/per_lb/per_kg/per_oz/per_each |
| price_per_100g | numeric | Normalizzato |
| price_per_each | numeric | Per ingredienti venduti a pezzo (fiori, limoni) |
| conversion_to_base | numeric | Grammi totali per unità acquisto |
| last_invoice_date | date | |
| order_count | integer | default 0 |
| active | boolean | default true |
| do_not_order | boolean | default false |
| do_not_order_reason / do_not_order_set_at / do_not_order_set_by | | |

### ingredient_links (90 righe)
Mapping testo-libero-fattura → ingrediente, con `confidence` (default 0.75), `conversion_g`, `invoice_unit`, `base_unit`.

### unit_each_weights (0 righe)
Tabella peso medio per pezzo per ingredienti `each` — `ingredient_id` (PK), `avg_weight_g`, `source` (default 'ai_estimate').

### unit_conversion_table (24 righe)
Tabella conversioni generiche `from_unit` → `to_unit` con `factor`.

### vendor_item_aliases (15 righe)
Alias confermati fornitore→ingrediente: `vendor`, `vendor_sku`, `vendor_description`, `ingredient_id`, `confirmed_by`.

---

## FATTURE E DOCUMENTI

### vendor_documents (41 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| vendor | text | |
| document_type | text | CHECK order_confirmation/invoice/credit_memo |
| document_number | text | |
| document_date / delivery_date | date | |
| raw_text | text | |
| parsed_json | jsonb | |
| status | text | CHECK pending/imported/error/ignored/**pdf_received** |
| warnings | jsonb | default [] |
| uploaded_by | text | |
| source_email_subject / source_email_from | text | Popolati se arrivato da Gmail import |

**Pipeline Gmail→Hardie's:** Apps Script "Brigade hardies import" (controlla label `hardies-import` ogni ora) → Edge Function `gmail-hardies-import` → Storage bucket `app` path `invoices/gmail/` → crea record con status `pdf_received`. UI Vendor Documents mostra banner blu "X PDF ricevuti da Hardie's" con bottone "Processa tutti" (PDF.js + parser Hardie's esistente).

### invoice_lines (84 righe)
Righe fattura parsate: `import_id`, `vendor`, `raw_description`, `ingredient_id`, `match_status` (CHECK matched/unmatched/ambiguous/ignored), `qty`, `unit_price`, `line_total`, `pack_description`, `pack_qty`, `pack_unit`, `cost_per_100g`, `price_anomaly` (boolean), `anomaly_note`, più campi di chiarificazione (`needs_clarification`, `clarification_question`, `clarification_answer`).

### invoice_warnings (19 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| document_id | uuid | FK → vendor_documents.id |
| code | text | |
| item_description | text | |
| status | text | CHECK open/resolved/skipped |
| severity | text | CHECK blocking/alert/insight |
| question | text | Domanda OQR per Max |
| options | jsonb | |
| target_table / target_id / target_field | | Per applicare la risoluzione dinamicamente |
| suggested | jsonb | |
| ingredient_id | uuid | |
| category | text | default 'invoice' |

### incoming_orders (0 righe) / incoming_order_lines (0 righe)
Strutture per ordini in arrivo da fornitore — non ancora popolate/in uso attivo.

### vendor_credits (0 righe)
Note di credito fornitore — non ancora in uso attivo.

---

## AI E SOUS CHEF

### briefing (25 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| date | date | default oggi |
| points | jsonb | default [] — admin IT |
| points_en / points_es | jsonb | default [] |
| points_staff | jsonb | Staff IT |
| points_staff_en / points_staff_es | jsonb | default [] |
| generated_at | timestamptz | |

**Chi scrive:** sc-nightly-brief Edge Function.

### operation_notes (17 righe)
Commenti operativi della brigata dopo ogni servizio, alimentano il briefing mattutino.
`note_date` (default oggi), `user_name`, `note`, `lang` (default 'en'), `service` (default 'dinner'), `sentiment`, `tags` (text[]), `is_demo` (default false).

### chef_attention (12 righe)
Domande ricorrenti a Sous Chef AI: `topic`/`topic_en` (UNIQUE su topic), `query_type` (default 'price'), `raw_question`, `ask_count` (default 1), `first_asked`/`last_asked`, `last_answer`.

### chef_reports (13 righe) — Tell Chef
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| user_name | text | |
| station | text | |
| message | text | |
| status | text | CHECK new/read/in_progress/done/ignored |
| souschef_suggestion | text | |
| souschef_at | timestamptz | |
| report_type | text | Classificazione bot |
| chef_action | text | working_on_it/done/ignored — sincronizzato da bot-tell-chef-reader |
| chef_action_at / chef_action_by | | |
| is_demo | boolean | default false |

### office_items (71 righe) — L'Ufficio
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| source | text | CHECK tell_chef/operation_note/ai_scan/sous_chef_chat |
| source_id | text | |
| from_user | text | |
| priority | text | CHECK red/orange/blue — default blue |
| title / body | text | |
| ai_analysis | text | |
| ai_options | jsonb | default [] |
| status | text | CHECK open/resolved/snoozed — default open |
| resolved_by / resolved_at / resolution | | |
| notify_brigade | boolean | default false |
| priority_tier_final | text | |
| report_type | text | PROBLEMA_OPERATIVO/GAP_CHECKLIST/CONTRIBUTO_RICETTA/FEEDBACK_RICETTA/SEGNALE_PERSONALE |
| chef_action / chef_action_at / chef_action_by | | Azione di Max — sincronizzato da bot-chat-analyst |
| is_demo | boolean | default false |
| updated_at | timestamptz | Usato da bot analytics |

**Bug noto:** apertura/chiusura realtime chat updates rotta quando si apre/chiude L'Ufficio (display.html). Bottone "Riapri" in chat non funziona. Backlog: spostare L'Ufficio nella bottom bar.

### settings (4 righe)
Key-value config: `key` (PK), `value`, `updated_at`, `updated_by`.

---

## SCHEDULE (7shifts)

### shifts_schedule (199 righe)
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| sevenshift_id | bigint | UNIQUE |
| date | date | |
| employee_name | text | Deve combaciare con users.schedule_name |
| role_name | text | |
| start_time / end_time | timestamptz | |
| location_id | bigint | |
| department_name | text | |
| notes | text | |
| synced_at | timestamptz | |
| week_start | date | |
| payable_hours | numeric | |
| is_closing | boolean | default false |
| shift_type | text | |
| start_label / end_label | text | |
| start_hour | numeric | |

**Import:** CSV export 7shifts, anchor date ricavata dal filename. **API v2 JWT incompatibile con token UUID attuale** — pending supporto 7shifts o processo OAuth partnership.
**Focus Mode** legge gli orari turno esatti da questa tabella via `schedule_name`, nessun fallback 8-20.
**Zenos chiuso la domenica** — escludere sempre dalle visualizzazioni schedule e dai calcoli bot.

---

## COMUNICAZIONE

### messages (27 righe)
`channel` (default 'generale'), `text`, `image_url`, `lang` (default 'it'), `pinned` (default false).

### alerts (50 righe)
`message`, `created_by`, `is_active` (default true), `priority` (default 'high'), `source_lang`, `translations` (jsonb default {}).

### announcements (0 righe)
Banner programmati: `text`, `starts_at`/`ends_at` (time), `active` (default true), `created_by`.

---

## EVENTI / CATERING (TripleSeat)

### events (1 riga)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| name | text | |
| event_date | date | |
| event_time | time | |
| guest_count | integer | |
| menu_type / location / notes | text | |
| source | text | default 'manual' — 'tripleseat' per import |
| tripleseat_id | text | UNIQUE — evita duplicati |
| status | text | default 'confirmed' |
| contact_name / contact_email / contact_phone | text | |
| room_name | text | Es. "The Scuderia" |
| total_amount | numeric | **ADMIN ONLY** |
| last_synced_at | timestamptz | |
| documents | jsonb | default [] — array {type, name, url} (BEO, Kitchen Sheet, Menu, Contract) |
| service_style | text | |
| event_recipes | jsonb | default [] |

**Stato:** TripleSeat OAuth pending autorizzazione di Monica (collega di Max). Solo 1 evento manuale al momento.

---

## TABELLE DI BACKUP / LEGACY (non toccare, non usare per nuove feature)
- `recipes_backup_20250524` (182 righe)
- `vendor_documents_backup_20260612` (44 righe)
- `invoice_warnings_backup_20260612` (47 righe)
- `prep_items` (16 righe) / `prep_check` (0 righe) / `checks` (0 righe) — sembrano precursori di prep_tasks/closing_checks, verificare con Max se ancora in uso prima di toccarle
- `dropdown_options` (28 righe) — CHECK container/unit/qty

---

## ⚠️ SICUREZZA — Row Level Security DISABILITATA

**50 tabelle su public hanno RLS disabilitato** (rilevato 30/06/2026 via Supabase advisor) — sono esposte in lettura/scrittura a chiunque abbia la anon key, incluse `users` (con `password_hash` e `pin`!), `recipe_bom`, `pos_sales_by_item` (dati finanziari), `events` (dati contatto cliente), e altre 45 tabelle.

**NON abilitare RLS senza policy pronte** — bloccherebbe tutto l'accesso dell'app (che usa la anon key per tutto). Questo va affrontato in una sessione dedicata con Max: definire policy per ruolo (staff/admin) prima di attivare RLS, partendo dalle tabelle più sensibili (`users`, dati finanziari POS, `events`).

---

## VISTE E FUNZIONI SQL
Da riverificare — non confermate in questa sessione, riportate da versioni precedenti del file:
- `recipes_with_cost` — recipes + total_cost + cost_per_kg calcolati
- `get_cost_per_gram(ingredient_id)`, `get_recipe_cost(recipe_id)`, `normalize_ingredient_name(text)`

---

## NOTE CRITICHE PER OGNI SESSIONE

1. **Tutti i timestamp sono UTC** — convertire sempre a CDT (America/Chicago, DST-aware) per display
2. **prep_tasks.need_tomorrow:** true = da fare, false = chiuso in closing
3. **recipe_bom.component_type:** valori **'ITEM' / 'RECIPE' (MAIUSCOLO)** — non lowercase
4. **recipe_bom usa `parent_recipe_id`**, non `recipe_id`
5. **recipe_bom non si modifica/cancella mai liberamente** — collegata a bot, POS, food cost
6. **pos_name su recipes è immutabile** — solo append di alias con pipe `|`, mai sovrascrivere alias con storico POS
7. **bill_count** = scontrini chiusi, MAI "coperti" o "tavoli"
8. **Dati finanziari** = mai allo staff: net_sales, gross_sales, food_cost, labor_cost, margin, total_amount, selling_price, food_cost_pct
9. **recipes.ingredients (jsonb)** = legacy non strutturato — per dipendenze usa SEMPRE recipe_bom
10. **recipe_steps è il sistema autoritativo per il procedimento di prep** — recipes.procedure resta solo per le note di servizio/piattaggio
11. **App IN PRODUZIONE dal lancio (giugno 2026)** — dati reali, brigata attiva, modifiche chirurgiche obbligatorie
12. **RLS disabilitata su 50 tabelle** — vedi sezione sicurezza sopra, non è stato ancora affrontato
13. PostgREST ha limite hard di 1000 righe su SELECT senza filtri — usare WHERE per query estese
14. Apostrofi in SQL vanno raddoppiati (`Chef''s Feature`)
