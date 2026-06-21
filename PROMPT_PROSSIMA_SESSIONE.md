# PROMPT PROSSIMA SESSIONE — Brigade v302

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi tutti i file MD da brigade-main (BACKLOG, DECISIONS, DB_SCHEMA, VISION, WARNINGS, SPEC)
3. Leggi SEMPRE i file da GitHub — mai da memoria o /mnt/project/

---

## STATO ATTUALE — 2026-06-21

### Versione frontend: v302
- sw.js: boh-v302
- gmail-touchbistro-import: v10
- bot-preplist-builder: v1 (da riscrivere — vedi sotto)

---

## SESSIONE ODIERNA — cosa abbiamo fatto

### 1. Pipeline POS — audit e fix completo

**Dati CSV TouchBistro che importiamo:**
- `SalesByMenuItem` → `pos_sales_by_item` (quantity, void_quantity, voids, gross_sales, ecc.)
- `Daily_HourlySales` → `pos_daily_summary` (bill_count, net_sales, ecc.)
- `TextModifier` → `pos_modifiers`
- `ModifierPreferenceByMenuItem` → `pos_modifier_by_item`
- `TakeoutTypes_Summary` → NON importato (solo totale aggregato, no dettaglio piatti)

**Cosa NON abbiamo:** coperti/guest count — TouchBistro non lo esporta in questi report. Max ha richiesto report separato a TB.

**DoorDash:** POS separato, non connesso a TouchBistro. Da affrontare in sessione dedicata dopo che il pipeline TB è stabile.

**Void:** già importate in `void_quantity` su `pos_sales_by_item`. Ora usate nel calcolo produzione.

### 2. pos_item_aliases — fix e audit

**Correzioni fatte:**
- `Cacio e Pepe` source=item: `portion_factor` corretto da 0.5 a 1.0
- `Wheel Pasta` aggiunto: canonical_name=`Spaghetti`, portion_factor=1.0, source=item

**Struttura aliases:**
- `portion_factor` = 1.0 (porzione intera), 0.5 (mezza), 4.0 (scallops interi), 3.0 (scallops add-on), 2.0 (spinach item), ecc.
- `source` = item / modifier / both

### 3. recalcProductionDaily — riscritta v3 (gmail-touchbistro-import v10)

**Nuova logica:**
- Legge `recipes.pos_name` (splittato per `|`) per il mapping POS → ricetta
- Legge `pos_item_aliases` SOLO per i `portion_factor` (mezze porzioni, add-on speciali)
- Calcola: `(quantity + void_quantity) × portion_factor × serving_qty` = unità fisiche
- Salva in `pos_production_daily` con `canonical_name = recipes.title`

**Colonne aggiunte a `recipes`:**
- `serving_unit` (text) — es. "nests", "pezzi", "grammi"
- `serving_qty` (numeric) — quante unità fisiche per porzione (es. 2 nests per spaghetti)

**Compilate finora:**
- SPAGHETTI FRESH PASTA, FETTUCCINE FRESH PASTA, CHEESE WHEEL PASTA, SPAGHETTI CACIO E PEPE, SPAGHETTI N°4, SPAGHETTI al POMODORO, SPAGHETTI ALLO SCOGLIO, SPAGHETTI MARCELLO, SHRIMP GNOCCHI, LOBSTER FETTUCINE → serving_unit=nests, serving_qty=2
- SPAGHETTI CACIO E PEPE HALF → serving_unit=nests, serving_qty=1
- SCALLOP CHEF WAY → serving_unit=pezzi, serving_qty=4

### 4. recipes.pos_name — cleanup doppi

**Problema risolto:** alcune ricette base (FETTUCCINE FRESH PASTA, SPAGHETTI FRESH PASTA, ecc.) avevano pos_name che causava doppio conteggio con le ricette piatto.

**Regola decisa:** `pos_name` sulle ricette base/prep = NULL. Solo le ricette piatto hanno pos_name identico al nome nel POS.

**Cleanup eseguito — pos_name rimosso da:**
- FETTUCCINE FRESH PASTA
- SPAGHETTI FRESH PASTA
- CACIO E PEPE SAUCE
- SAUTED ASPARAGUS
- SPAGHETTI ALLO SCOGLIO
- SPAGHETTI MARCELLO
- FETTUCCINE AL SAMONE
- TIMBERLAND FETTUCCINE

**SPAGHETTI CACIO E PEPE** → pos_name corretto a solo `"Cacio e Pepe"` (rimossi Half e Kids che appartengono a SPAGHETTI CACIO E PEPE HALF)

### 5. Staff View (pos.js v302) — fix Kids menu

**Problema:** la staff view mostrava Fettuccine Alla Vodka 7x invece di 13x perché il Kids menu era aggregato separatamente.

**Fix:** `STAFF_GROUP_LABELS` — Kids menu ora mappa a "Pasta" invece di "Kids". Tutti i piatti kids vengono sommati automaticamente al gruppo pasta.

### 6. BOM — audit completo

**Stato attuale:**
- Ricette con BOM completo (6+ righe): ~32 ricette
- Ricette con BOM parziale (1-5 righe): ~25 ricette
- Ricette con BOM vuoto: LASAGNA MEAL, MACCHERONI AL RAGU, ASPARAGUS

**Piatti venduti ieri con BOM incompleto (priorità):**
| Ricetta | Venduti ieri | Problema |
|---|---|---|
| FETTUCCINE SALMON ALLA VODKA | 13 | BOM 3 righe — manca fettuccine, salmon, basil oil |
| LOBSTER FETTUCINE | 12 | BOM 4 righe — manca fettuccine (pasta) |
| BEEF TENDERLOIN RAVIOLI | 10 | BOM 4 righe — manca ravioli (pasta) |
| SPAGHETTI CACIO E PEPE | 8+kids | BOM 4 righe — quasi completo |
| CHEESE WHEEL PASTA | 23 | BOM 4 righe — manca spaghetti |

**Nota su LOBSTER FETTUCINE:** ha 130g Fettuccine-Fettuccine nel BOM in Brigade app (visto da screenshot) ma query DB restituiva 0. Da verificare — potrebbe essere campo `ingredients` JSONB non strutturato invece di `recipe_bom`.

### 7. Architettura Bot 3 — decisione presa

**Logica corretta (non ancora implementata):**
```
pos_production_daily (piatti venduti × porzioni)
    ↓ recipe_id su prep_tasks
recipes (pos_name → which recipe)
    ↓ recipe_bom
ingredienti/sub-ricette (quantity × unità)
    ↓ prep_task_id (DA AGGIUNGERE)
prep_tasks (suggested_qty per stazione)
```

**Campi esistenti già utili:**
- `prep_tasks.recipe_id` → già punta alla ricetta
- `prep_tasks.expected_duration_days` → frequenza prep (NULL su tutti — da compilare)
- `prep_tasks.unit` → unità misura (NULL su tutti — da compilare)

**Cosa manca:**
1. `expected_duration_days` e `unit` da compilare su ogni task
2. Collegamento `recipe_bom` → `prep_task` (non esiste — da aggiungere colonna `prep_task_id` a `recipe_bom`)
3. BOM da completare sulle ricette principali
4. Bot 3 da riscrivere con nuova logica

**Nuovi bot da creare:**
- **Bot Guardiano Ricette** — gira dopo ogni salvataggio ricetta; controlla BOM completo, ogni ingrediente ha prep task collegato; scrive in L'Ufficio cosa manca
- **Bot Guardiano Prep** — nightly; legge ricette con BOM completo, moltiplica per vendite, calcola suggested_qty; se BOM incompleto → segnala in L'Ufficio invece di saltare silenziosamente
- **Bot Guardiano Allineamento** — post-modifica ricette/ingredienti/prep; verifica catena ricetta→BOM→ingredienti→prep_tasks→stazioni; avviso in L'Ufficio se catena rotta

---

## ARGOMENTI LASCIATI A METÀ — da finire in sessioni dedicate

### A. BOM — completamento (PRIORITÀ ALTA)
Completare recipe_bom per i 5 piatti più venduti:
1. LOBSTER FETTUCINE — aggiungere fettuccine (2 nests / 130g), basil oil
2. FETTUCCINE SALMON ALLA VODKA — aggiungere fettuccine, salmon fillet, basil oil, parsley
3. BEEF TENDERLOIN RAVIOLI — aggiungere ravioli pasta
4. CHEESE WHEEL PASTA — aggiungere spaghetti (2 nests), parmigiano 100g
5. Tutte le ricette con BOM parziale — sessione dedicata

### B. prep_tasks — compilare campi mancanti (PRIORITÀ ALTA)
Per ogni task attivo compilare:
- `expected_duration_days` (1=daily, 7=weekly, ecc.)
- `unit` (nests, portions, kg, lt, ecc.)
Senza questi il Bot 3 non può calcolare correttamente.

### C. recipe_bom — aggiungere prep_task_id
Aggiungere colonna `prep_task_id` (FK → prep_tasks.id) a `recipe_bom`.
Così ogni riga BOM sa a quale prep task appartiene.
Poi compilare i link per le ricette principali.

### D. Bot 3 — riscrittura completa
Prerequisiti: A + B + C completati.
Nuova logica: recipe_id su prep_tasks → recipe_bom → ingredienti → suggested_qty.
Gestione frequenza: daily vs weekly (expected_duration_days).
Conversione unità: grammi → nests (65g = 1 nest).

### E. Nuovi Bot — Guardiano Ricette + Prep + Allineamento
Da costruire dopo Bot 3 riscritto. Sessione dedicata.

### F. pos_name — ricette senza match (PRIORITÀ MEDIA)
Piatti venduti ieri senza ricetta corrispondente (pos_name mancante o diverso):
- Chicken Parmesan × 13
- Truffle Fettuccine × 11
- Chicken Lemon Piccata × 11
- Penne Midnight × 9
- Texana Soup × 9
- Chef Max Risotto × 8
- Artichoke × 7
- Shrimp Gnocchi × 7 (ricetta SHRIMP GNOCCHI ha pos_name "Gnocchi With Shrimp" — diverso)
- Tuscany Road Trip × 6
- Bruschetta Board × 5
- Italian Marble Cake × 5
- Limoncello Cake × 4
- Ribeye Prime Green Peppers Corn × 3
- Tagliata Alla Griglia Ny Strip × 4 (ricetta TAGLIATA CON RUCOLA E GRANA ha "Piemontese Alla Griglia Nystrip" — diverso)
- Branzino Chef Style × 2
- Siciliana × 2
Per ognuno: verificare se esiste ricetta con nome diverso (aggiornare pos_name) o creare ricetta nuova.

### G. serving_unit e serving_qty — completare su tutte le ricette
Finora solo pasta e scallops. Mancano: antipasti, secondi, dessert, sides, salad.
Necessario per Bot 3.

### H. DoorDash — integrazione POS
POS separato, dati non in TouchBistro.
Opzione A: API DoorDash Drive (automatica)
Opzione B: Export manuale CSV da Merchant Portal
Da affrontare dopo pipeline TouchBistro stabile.

### I. SALES tab — backlog
- Rimuovere tab "Oggi" (impossibile avere dati real-time da TB)
- Aggiungere campo query data arbitraria
- Aggiungere campo query manuale vendite
- Sous Chef DB querying (sessione dedicata)

### J. 7shifts — bloccato
UUID token incompatibile con API v2 (richiede JWT). API v1 è 410 Gone.
Email supporto già draft a support@7shifts.com. Attendere risposta.
Schedule tab nascosta (`tabSchedule.style.display = 'none'`).

### K. TripleSeat — bloccato
OAuth app "MAX" creata. Edge Function `tripleseat-sync` v4 deployata.
Bloccato: Monica deve autorizzare l'app e condividere redirect URL con `?code=`.

### L. L'Ufficio — bottoni azione
Bottoni Archivia/Risolto/Investiga non collegati ad azioni reali. Sessione dedicata urgente.

### M. Focus Mode Closing — stazioni
Stazioni da includere: Oven, Fresh Pasta, Pasta, Sauté, Saucier, Plating, Salad, Pastry, Freezer, Tableside.
NON includere Coordinator/Tela.
Rinominare "Manager" → "Coordinator" in tutta l'app (prep_tasks, focus-mode.js, closing.js, DB).

### N. L'Ufficio → bottom bar
Spostare da menu tre puntini a bottom bar.
Rimuovere voci obsolete dal menu admin: Parser Test, Similarity, Vendor Match, Ingredient Cleanup, Bootstrap.

### O. Sistema foto centralizzato
Album unico per ricette, TV, Kitchen Display con rotazione contenuti.
Kitchen Display multi-schermata con rotazione.

### P. Bug aperti
1. L'Ufficio "Riapri" button nella chat non funziona
2. Focus Mode ha alcune stringhe ancora in italiano (audit necessario)
3. Kitchen Display realtime si blocca quando L'Ufficio viene aperto/chiuso
4. Tell Chef salva "Staff" invece del nome utente reale per alcune submissions

---

## REGOLE PRODUZIONE PASTA ZENOS (aggiornate)

- Porzione completa = 2 nests (spaghetti O fettuccine) = 130g
- Mezza porzione = 1 nest = 65g
- Wheel Pasta = 2 nests spaghetti + 10g burro + 100g Parmigiano Reggiano per porzione
- Add-on proteine (chicken, shrimp, salmon, scallops, lobster) = HALF portions per produzione
- Scallops: piatto intero = 4 pz, add-on = 3 pz
- Sauteed Spinach: item = 2 porzioni, modifier = 1 porzione
- Kids menu → sommato a Pasta nella staff view (fix v302)
- Void quantity → inclusa nel calcolo produzione (fix v10 Edge Function)

---

## REGOLE OPERATIVE SESSIONE

1. Leggi SEMPRE i file da GitHub live prima di modificare
2. Fetch SHA fresco immediatamente prima di ogni PUT
3. Dichiara tutte le modifiche prima di scrivere codice — aspetta approvazione Max
4. Bumpa `boh-vN` in sw.js ad ogni push
5. `node --check file.js` prima di ogni push
6. Tocca solo i file esplicitamente discussi
7. Commit message: `"vN filename — descrizione"`
8. Tutto su brigade-main, MAI main
9. `pos_production_daily.total_portions` è colonna generata — non fare UPDATE manuale
10. Conflict target upsert: `(sale_date, canonical_name)`
