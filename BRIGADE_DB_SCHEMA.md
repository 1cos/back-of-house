# BRIGADE — DATABASE SCHEMA COMPLETO
*Supabase project: ydqmumpytgrlceuinoqt*
*Aggiornato: 2026-06-24 — v335*
*Leggi questo file all'inizio di ogni sessione. Contiene le colonne reali del DB.*

---

## REGOLA FERREA
**Dati finanziari (net_sales, gross_sales, food_cost, labor_cost, margin) → MAI mostrati a utenti staff (role='staff'). Solo admin (Max).**

---

## UTENTI E PRESENZA

### users
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| name | text | Nome visualizzato — es. "Max", "Tela", "Anto" |
| lang | text | 'it' / 'en' / 'es' — lingua UI e risposte AI |
| is_admin | boolean | true solo per Max |
| role | text | 'admin' / 'staff' |
| default_station | text | Es. "Oven Station" — suggerita in Closing |
| photo_url | text | Avatar |
| pin | char | PIN accesso app |
| active | boolean | Utente attivo |
| first_login | boolean | |
| schedule_name | text | Nome esatto in shifts_schedule per match Focus Mode |

**Staff attivi cucina (15):** Max (admin), Anto, Cole, David, Genova, Haley, Maddie, Preston, Rachael, Samantha, Sophia, Tela, Todd, Zuu, Chance
**Nuovi utenti attivi con PIN (10):** Diana (Oven Station), Chris (Pasta Station), Austin/Jaxon/Arianna/Kelly/Herminia/Jose/Luis/Ronaldo (Dish Crew)
**Colonna aggiunta:**  — nome esatto in shifts_schedule per match Focus Mode
**MANCA:** colonna  — da aggiungere per Livello 5 Sous Chef

### user_presence
| Colonna | Tipo | Note |
|---|---|---|
| user_name | text | FK → users.name |
| last_seen | timestamptz | Aggiornato ogni minuto |
| role | text | |
| station | text | Stazione attuale |
| photo_url | text | |

---

## PREP E PRODUZIONE

### prep_tasks
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| name | text | Nome item — es. "Meatballs" |
| category | text | Stazione — es. "Oven Station", "Pasta Station", "Salad Station", "Plating Station", "Freezer" |
| done | boolean | Completato oggi |
| need_tomorrow | boolean | **true = da fare / false = chiuso in closing** |
| in_progress | boolean | In lavorazione |
| qty | text | Quantità target |
| unit | text | Unità misura |
| container | text | Contenitore |
| recipe_id | uuid | FK → recipes.id |
| archived | boolean | Nascosto dalla lista attiva |
| note | text | Note operative |
| expected_duration_days | integer | Shelf life attesa |
| average_qty | numeric | Media storica produzione |
| suggested_qty | numeric | Quantità suggerita da Bot 3 — NON sovrascrive qty reale |
| suggested_by | text | Fonte suggestion — default: bot-preplist-builder |
| suggested_at | timestamptz | Timestamp ultimo aggiornamento suggestion |

**Stazioni:** Oven Station (23 items), Pasta Station (32), Plating Station (28), Salad Station (53), Freezer (6) — totale 142
**NOTA:** need_tomorrow=true = da fare, need_tomorrow=false = segnato "c'è" in closing

### prep_log
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| created_at | timestamptz | Quando prodotto (UTC → converti CDT) |
| user_name | text | Chi ha prodotto |
| station | text | Stazione |
| item | text | Nome item |
| qty | numeric | Quantità prodotta |
| unit | text | Unità |
| container | text | Contenitore usato |
| started_at | timestamptz | Quando il cuoco ha premuto START (Focus Mode) |
| duration_minutes | integer | Durata calcolata al DONE: (created_at - started_at) / 60 |

**Stato:** 22 righe — tutti dati di test. App non ancora in uso reale.
**Timing:** started_at + duration_minutes aggiunti per Focus Mode — storico per persona per prep (Cole vs Antonella).

---

## RICETTE

### recipes
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| title | text | Nome ricetta |
| category | text | Antipasti / Primi / Secondi / Table Side / Catering / Finger Food |
| ingredients | jsonb | Array ingredienti — NON relazionale, testo libero |
| procedure | text | Istruzioni |
| prep_time_minutes | integer | Tempo prep — usato dal Prep Coach |
| shelf_life_days | integer | Conservazione |
| prep_frequency_days | integer | Ogni quanti giorni si prepara |
| base_servings | integer | Porzioni base |
| base_weight_g | numeric | Peso batch in grammi |
| serving_weight_g | numeric | Peso porzione in grammi |
| pos_name | text | Nome sul POS TouchBistro — per linkare vendite |
| menu_group | text | Gruppo menu POS |
| selling_price | numeric | Prezzo vendita |
| food_cost_pct | numeric | % food cost |
| serving_unit | text | Unità fisica per porzione — es. nests, pezzi, grammi (aggiunto 2026-06-21) |
| serving_qty | numeric | Quante unità fisiche per porzione — es. 2 nests per spaghetti (aggiunto 2026-06-21) |

**Stato:** 182 ricette — **ATTENZIONE: ingredients è JSONB non relazionale**, non è linkato a tabella ingredients. Usa recipe_bom per le dipendenze strutturate.

### recipes_with_cost (VIEW)
Stessa struttura di recipes + colonne calcolate:
- `total_cost` — costo totale batch
- `cost_per_kg` — costo per kg

### recipe_bom
| Colonna | Tipo | Note |
|---|---|---|
| bom_id | integer | PK |
| parent_recipe_id | uuid | FK → recipes.id — la ricetta "padre" |
| component_type | text | 'ingredient' / 'sub_recipe' |
| item_id | integer | FK → ingredients se component_type='ingredient' |
| sub_recipe_id | uuid | FK → recipes.id se component_type='sub_recipe' |
| quantity | numeric | Quantità necessaria |
| unit | text | Unità |
| notes | text | |

**Questo è il grafo di dipendenze.** Es: Lasagna → Ragù (sub_recipe) + Besciamella (sub_recipe) + Pasta (ingredient). Il Prep Coach usa questa tabella per calcolare cosa produrre prima.

---

## POS — TOUCHBISTRO SALES

### pos_daily_summary
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| sale_date | date | Data vendita |
| day_of_week | text | 'Monday' ecc. |
| bill_count | integer | **SCONTRINI CHIUSI** — non coperti, non tavoli |
| gross_sales | numeric | **ADMIN ONLY** |
| discounts | numeric | **ADMIN ONLY** |
| net_sales | numeric | **ADMIN ONLY** |
| voids | numeric | **ADMIN ONLY** |
| food_cost | numeric | **ADMIN ONLY** |
| labor_cost | numeric | **ADMIN ONLY** |
| margin | numeric | **ADMIN ONLY** |

**Stato:** 305 giorni di storia. Ultimo: 2026-06-15 (46 bills, $5,887 net).

### pos_sales_by_item
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| sale_date | date | |
| menu_item | text | Nome piatto — es. "Wheel Pasta" |
| menu_group | text | Categoria — es. "Pasta", "Secondi" |
| sales_category | text | |
| quantity | numeric | Porzioni vendute — **filtra quantity < 1000** (dati storici corrotti) |
| gross_sales | numeric | **ADMIN ONLY** |
| net_sales | numeric | **ADMIN ONLY** |
| void_quantity | numeric | Quantità voided — usata nel calcolo produzione (quantity + void_quantity = fired) |
| voids | numeric | Valore $ voidato — ADMIN ONLY |
| refund_quantity | numeric | Quantità rimborsata |
| refund_amount | numeric | Importo rimborso |
| total_tax | numeric | Tasse |
| sales_pct | numeric | % sul totale vendite |
| is_historical | boolean | Dati storici pre-import |

**Stato:** 3.924 righe. Escludi menu_group IN ('NA Beverages','Beverages','Mocktail') per stats cucina.

### pos_modifiers
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| sale_date | date | |
| modifier | text | Testo modifier — es. "Add chicken" |
| quantity_sold | integer | |
| gross_sales | numeric | **ADMIN ONLY** |
| is_historical | boolean | |

**Stato:** 712 righe.

### pos_item_aliases
| Colonna | Tipo | Note |
|---|---|---|
| id | integer | PK |
| alias_name | text | Nome nel POS — es. "Add chicken" |
| canonical_name | text | Nome canonico — es. "Chicken" |
| portion_factor | numeric | 1.0 = porzione intera, 0.5 = mezza |
| category | text | protein / side / pasta / appetizer |
| source | text | modifier / item / both |
| notes | text | |

**Stato:** 40 regole di produzione Zenos. Usata per mappare modifier ai piatti nelle statistiche.

---

## INGREDIENTI E FORNITORI

### ingredients
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| name | text | Nome canonico normalizzato |
| category | text | Produce / Dairy / Meat / Seafood / Dry Goods / Oil & Vinegar / Spices & Herbs / Beverages & Spirits / Prepared / Bakery / Frozen / Supply |
| base_unit | text | g / ml / each |
| measure_type | text | weight / volume / count |
| active | boolean | |

**Stato:** ~403 ingredienti. Tutti con categoria assegnata.

### ingredient_vendors
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| ingredient_id | uuid | FK → ingredients.id |
| vendor | text | Es. "Hardie's", "FreshPoint Dallas" |
| vendor_sku | text | Codice fornitore |
| purchase_unit | text | Es. "case", "lb" |
| pack_description | text | Es. "4x5lb", "12/3CT" |
| unit_price | numeric | Prezzo per unità acquisto |
| price_type | text | per_case / per_lb / per_kg / per_oz / per_each |
| price_per_100g | numeric | Normalizzato per confronto |
| conversion_to_base | numeric | Grammi totali per unità acquisto |
| last_invoice_date | date | |
| active | boolean | |
| do_not_order | boolean | DEFAULT false — blocco ordine per questo fornitore |
| do_not_order_reason | text | Motivo blocco (es. "Max: non voglio piu farina da Hardies") |
| do_not_order_set_at | timestamptz | Quando impostato il blocco |
| do_not_order_set_by | text | Chi ha impostato (sempre Max via Chef AI) |

**Formula $/100g:** per_case=(unit_price/conversion_to_base)*100 · per_lb=(unit_price/453.592)*100

### ingredient_links
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| invoice_description | text | Testo grezzo fattura |
| ingredient_name | text | Nome ingrediente mappato |
| ingredient_id | uuid | FK → ingredients.id |
| vendor | text | |
| unit_price | numeric | |
| confidence | numeric | 0-1 — affidabilità del match |
| conversion_g | numeric | Grammi per unità |

### ingredient_monthly_spend
| Colonna | Tipo | Note |
|---|---|---|
| ingredient_id | uuid | FK → ingredients.id |
| ingredient_name | text | |
| vendor | text | |
| month | timestamptz | Mese di riferimento |
| total_qty | numeric | Quantità totale ordinata |
| total_spend | numeric | **ADMIN ONLY** |
| avg_unit_price | numeric | **ADMIN ONLY** |
| order_count | bigint | Numero ordini |

**Usata per:** analisi trend prezzi Livello 2 Sous Chef. **Non ancora interrogata dall'AI.**

---

## FATTURE E DOCUMENTI

### vendor_documents
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| vendor | text | |
| document_type | text | invoice / credit / order |
| document_number | text | |
| document_date | date | |
| status | text | pending / processing / approved / pdf_received |
| parsed_json | jsonb | Dati estratti dall'OCR |
| raw_text | text | Testo grezzo OCR |
| warnings | jsonb | Warning attivi |
| uploaded_by | text | |
| source_email_subject | text | Se arrivato da Gmail |
| source_email_from | text | |

### invoice_lines
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| import_id | uuid | FK → vendor_documents.id |
| vendor | text | |
| invoice_date | date | |
| raw_description | text | Testo originale fattura |
| ingredient_id | uuid | FK → ingredients.id |
| match_status | text | matched / unmatched / manual |
| qty | numeric | Quantità ordinata |
| unit_price | numeric | Prezzo unitario |
| line_total | numeric | Totale riga |
| pack_description | text | Es. "4x5lb" |
| cost_per_100g | numeric | Calcolato |
| price_anomaly | boolean | Anomalia prezzo rilevata |

### invoice_warnings
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| document_id | uuid | FK → vendor_documents.id |
| code | text | SC-GHOST-001 / SC-NOLINK-001 |
| item_description | text | |
| status | text | open / resolved |
| severity | text | high / medium / low |
| question | text | Domanda OQR da mostrare a Max |
| options | jsonb | Opzioni risposta |
| ingredient_id | uuid | |

**Warning validi:** SC-GHOST-001 (no ingrediente in DB) · SC-NOLINK-001 (no conversion_to_base)
**ELIMINATO:** SC-PRICE-001 — non più usato

---

## AI E SOUS CHEF

### briefing
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| date | date | UNIQUE — una riga per giorno |
| points | jsonb | Array punti briefing per admin |
| points_staff | jsonb | Array punti briefing per staff |
| generated_at | timestamptz | Quando generato |

**Chi scrive:** sc-nightly-brief Edge Function (cron 5:00 AM CDT)
**Chi legge:** Home → "BRIEFING AI" — solo admin
**PROBLEMA:** prompt genera frasi vaghe — da migliorare urgente

### operation_notes
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| note_date | date | Data CDT |
| user_name | text | Chi ha scritto |
| note | text | Testo libero |
| lang | text | Lingua utente |
| service | text | 'dinner' / 'lunch' |
| sentiment | text | **SEMPRE NULL** — da popolare via AI |
| tags | text[] | **SEMPRE NULL** — da popolare via AI |

**Chi scrive:** brigata — bottom sheet serale (trigger dopo closing o push 22:30 CDT)
**Chi legge:** nessuno ancora — manca UI di lettura per Max
**MANCA:** parsing AI post-salvataggio per estrarre sentiment + tags

### service_updates
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| message | text | Testo del messaggio |
| level | text | 'info' / 'warning' / 'urgent' |
| created_by | text | 'system' / 'max' |
| created_at | timestamptz | |

**Chi scrive:** souschef-scan v4 (oraria) + Max manualmente
**Chi legge:** Home → "Yesterday's Highlights" — tutti
**Stato:** vuota — app non in uso reale

### events (NUOVA — v196)
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| name | text | Nome evento |
| event_date | date | |
| event_time | time | |
| guest_count | integer | Numero ospiti |
| menu_type | text | |
| location | text | |
| notes | text | |
| source | text | 'manual' / 'tripleseat' |
| tripleseat_id | text | UNIQUE — ID da TripleSeat |
| status | text | 'confirmed' / 'tentative' / 'cancelled' |

**Chi scrive:** TripleSeat (futuro) / Max manualmente
**Chi legge:** Home → "Upcoming Demand" — nascosta se vuota
**Stato:** vuota — TripleSeat non ancora connesso

### chef_attention
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| topic | text | Topic estratto dalla domanda |
| topic_en | text | Topic in inglese |
| query_type | text | Tipo domanda |
| raw_question | text | Domanda originale |
| ask_count | integer | Quante volte chiesto |
| last_asked | timestamptz | |
| last_answer | text | Ultima risposta data |

**Chi scrive:** souschef-chat — ad ogni domanda di Max
**Chi legge:** nessuno — non ancora collegata al briefing
**MANCA:** connessione al briefing per auto-calibrazione — se ask_count alto → appare nel briefing

### sous_chef_tasks
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| user_name | text | A chi assegnato |
| type | text | Tipo task |
| category | text | Categoria |
| urgency | text | high / medium / low |
| summary | text | Riepilogo breve |
| text | text | Testo completo |
| due_date | timestamptz | Scadenza |
| notify | boolean | Mandare notifica |
| done | boolean | Completato |

**Chi scrive:** souschef-classify v17 + scan automatica
**Chi legge:** Home → warnings banner

---

## COMUNICAZIONE

### messages
| Colonna | Tipo | Note |
|---|---|---|
| id | bigint | PK |
| created_at | timestamptz | UTC — converti CDT per display |
| user_name | text | |
| channel | text | 'general' / 'kitchen' ecc. |
| text | text | |
| image_url | text | |
| lang | text | |
| pinned | boolean | |

### alerts
| Colonna | Tipo | Note |
|---|---|---|
| id | uuid | PK |
| message | text | |
| created_by | text | |
| is_active | boolean | |
| priority | text | |
| source_lang | text | |

**Chi legge:** Home → ticker NEWS + Kitchen Display footer

---

## TABELLE MANCANTI (da creare)

| Tabella | Scopo | Priorità |
|---|---|---|
| chef_operational_memory | Regole non scritte — "Cole fa le salse", "Max preferisce conservativo" | Alta — sblocca Livello 10 |
| staff_shifts | Chi è in turno oggi — da SevenShift | Media — SevenShift non integrato |

---

## VISTE E FUNZIONI SQL

### Views
- `recipes_with_cost` — recipes + total_cost + cost_per_kg calcolati
- `v_prep_daily` — prep tasks aggregati per giorno
- `v_prep_weekly` — prep tasks aggregati per settimana
- `v_item_alerts` — alert attivi per item

### Funzioni
- `get_cost_per_gram(ingredient_id)` — ritorna costo per grammo
- `get_recipe_cost(recipe_id)` — ritorna costo totale ricetta
- `normalize_ingredient_name(text)` — normalizza nome ingrediente
- `execute_query(sql)` — esegue query dinamiche (usata dall'AI)

---

## NOTE CRITICHE PER OGNI SESSIONE

1. **Tutti i timestamp sono UTC** — convertire sempre a CDT (UTC-5 estate, UTC-6 inverno) per display
2. **prep_tasks.need_tomorrow:** true = da fare, false = chiuso in closing
3. **pos_sales_by_item.quantity:** filtrare `< 1000` per escludere dati storici corrotti
4. **bill_count** = scontrini chiusi, MAI chiamarli "coperti" o "tavoli"
5. **ingredients filtrare Supply:** usare `WHERE category != 'Supply'` ma attenzione — `.neq()` in PostgREST esclude anche i NULL. Meglio filtrare in JS
6. **recipes.ingredients** = JSONB non strutturato. Per dipendenze strutturate usare `recipe_bom`
7. **Dati finanziari** = mai allo staff: net_sales, gross_sales, food_cost, labor_cost, margin, total_spend, avg_unit_price
8. **App non in produzione** — tutti i dati nel DB sono test di Max. Non fare considerazioni su volumi o comportamenti utente


### events (aggiornata v217)
Colonne aggiunte per TripleSeat:
- contact_name, contact_email, contact_phone — contatto evento
- room_name — sala (The Scuderia ecc.)
- total_amount — importo totale
- documents JSONB — array PDF {type, name, url} (BEO, Kitchen Sheet, Menu, Contract)
- last_synced_at — ultimo sync TripleSeat

source='tripleseat' per eventi importati, source='manual' per eventi manuali
tripleseat_id UNIQUE — evita duplicati al sync

