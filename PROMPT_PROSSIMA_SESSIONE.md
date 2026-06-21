# PROMPT PROSSIMA SESSIONE — Brigade v304

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi tutti i file MD da brigade-main (BACKLOG, DECISIONS, DB_SCHEMA, VISION, WARNINGS, SPEC)
3. Leggi SEMPRE i file da GitHub — mai da memoria o /mnt/project/

---

## STATO ATTUALE — 2026-06-21 (fine sessione)

### Versione frontend: v304
- sw.js: boh-v304
- Focus Mode disabilitato la domenica (fix v303)
- Bot Guardiano Ricette deployato (bot-recipe-guardian v1) — cron 6AM CDT
- office.js v304: bottone "Apri Ricetta" per avvisi bot-recipe-guardian

---

## LAVORO FATTO IN QUESTA SESSIONE

### BOM — completato per tutti i piatti attivi nel POS

**Ricette con BOM completato oggi:**
- Mini Caesar Salad (aggiunto 15g Croutons)
- Truffle Fettuccine (compilata da Max in Brigade — 2 nests, truffle butter, heavy cream, cacio e pepe sauce, fresh truffle)
- Coccoli Toscani (aggiunto 100g Gnocco Fritto Dough sub-ricetta)
- Caprese (aggiunto 2g Basil, 10g Basil Oil, 150g Beef Steak Tomatoes)
- Chicken Parmesan (300g chicken breast, 20g eggs, 30g breadcrumbs, 50g arrabbiata, 30g shredded mozzarella)
- Penne Midnight (120g penne, 200g arrabbiata, 6g calabrian chili oil, 60g parmigiano garnish, 4g calabrian chili garnish)
- Penne Midnight Half (creata — tutto dimezzato)
- Spaghetti Al Ragu (2 nests, 200g ragù, 50g pomodoro, 2g rosemary garnish)
- Chef Max Risotto (punta a Risotto Base sub-ricetta)
- Artichoke (2 artichoke, 30g red onion, 50g tempura batter, 20g artichoke sauce, 10g parmigiano garnish, 3g parsley garnish)
- Tuscany Road Trip (sliced mozzarella, beef steak tomatoes, french bread, basil oil, balsamic glaze, parma ham, cantaloupe, parmesan flakes garnish, grapes, kalamata olive, 90g tomato x bruschetta)
- Branzino Chef Style (900g whole branzino, 1000g sea salt, 30g egg whites, 5g parsley, 5g lemon, 5g garlic, 5g tarragon, 10g basil, 40g salmoriglio)
- Wagyu Tomahawk (aggiunto 2oz bourbon, 8g ribeye salt)
- Tomato And Basil Soup (250g pomodoro sauce, 50ml heavy cream garnish, 30g croutons garnish, 10g basil oil garnish, 1g black pepper)
- Spaghetti al Pomodoro Half (creata — tutto dimezzato tranne garnish: 10g basil oil, 2g basil)

**Nuove ricette base create:**
- Risotto Base (28 porzioni: 2L water, 70g chicken bouillon, 2000g carnaroli rice)
- Tempura Batter (12 porzioni: 500ml soda water, 300g flour, 3 ice cubes)
- Artichoke Sauce (300g cacio e pepe sauce, 30g heavy cream — procedura salvata)
- Penne Midnight Half

**Nuovi ingredienti creati:**
- Calabrian Chili Oil
- Soda Water
- Ice Cubes
- French Bread

**Ricette rinominate per allinearsi al POS:**
- SHRIMP GNOCCHI → Shrimp Gnocchi
- TAGLIATA CON RUCOLA E GRANA → Tagliata Alla Griglia Ny Strip
- MIMOSA CAKE → Limoncello Cake
- CREMINO PISTACIOS CAKE → Italian Marble Cake
- MM TOMATO AND BASIL SOUP → Tomato And Basil Soup
- Ribeye Salt rinominato da Concia-ribeye Salt

**Ricette vuote create (BOM da fare):**
- Chicken Parmesan, Truffle Fettuccine, Texana Soup (skip — no ricetta), Penne Midnight, Chef Max Risotto, Artichoke, Tuscany Road Trip, Spaghetti Al Ragu, Branzino Chef Style
- Scallops Asparagus Gnocchi (esce dal menu)
- Spaghetti al Pomodoro Half

**Cancellata:** BRUSCHETTA TOMATOES (duplicato — rimane TOMATO X BRUSCHETTA)

### BOM rimasti incompleti (non prioritari — zero vendite 30gg)
- Texana Soup (skip — no ricetta)
- Asparagus (6 fired — da fare)
- Lasagna Meal (1 fired — da fare)
- Maccheroni Arrabbiata, Maccheroni Al Ragu, Ravioli Limone, Pappardelle Wildboar, Branzino Table Side, Zeno's Spaghetti, Scaloppina Ai Funghi — tutti zero vendite 30gg, skip per ora

---

## PROSSIMA SESSIONE — FASE 5 e 6 (prerequisiti Bot 3)

### FASE 5 — prep_tasks: compilare unit e expected_duration_days
**Stato attuale:** 118 prep_tasks attivi, NESSUNO ha `unit` o `expected_duration_days`.
Senza questi il Bot 3 non può calcolare suggested_qty.

**Lavoro da fare:**
Per ogni prep_task attivo Max deve dire:
- `unit` — in cosa si misura (nests / kg / lt / porzioni / pezzi / batch)
- `expected_duration_days` — ogni quanti giorni si prepara (1=daily, 2=ogni 2 giorni, 7=weekly)

Stazioni da coprire: Oven Station (23 items), Pasta Station (32), Fresh Pasta Station, Plating Station (28), Salad Station (53), Saucier Station, Sauté Station, Pastry Station, Freezer (6), Table Side.

### FASE 6 — Aggiungere prep_task_id a recipe_bom
**Lavoro da fare:**
1. `ALTER TABLE recipe_bom ADD COLUMN prep_task_id bigint REFERENCES prep_tasks(id)`
2. Per ogni riga BOM che rappresenta un prep_task, collegare il link

### FASE 7 — Riscrivere Bot 3 (bot-preplist-builder)
Nuova logica:
```
pos_production_daily (piatti venduti × porzioni)
    ↓ via recipe.pos_name
recipe_bom (ingredienti × quantità)
    ↓ via prep_task_id
prep_tasks (suggested_qty per stazione)
```

---

## ARCHITETTURA DECISIONALE — punti fermi

### BOM
- `base_servings = 1` = 1 piatto venduto al POS
- Ingredienti nel BOM = quantità per 1 porzione
- Sub-ricette puntano alle ricette base (Risotto Base, Salmoriglio, Arrabbiata, ecc.)
- `notes = 'garnish'` per ingredienti decorativi

### serving_unit / serving_qty
- NON servono — decisione definitiva
- Il BOM con `2 each · Fettuccine nests` è già sufficiente per il Bot 3

### Chef AI — scrittura ricette (sessione futura)
- Dare a Chef AI accesso in scrittura SOLO per ricette
- Flusso: Max detta a voce → Chef AI mostra riepilogo → Max conferma → salva su DB
- Tocca souschef-chat Edge Function v23 e UI chat

### Risotto del giorno
- Risotto Base = ricetta fissa (water, bouillon, carnaroli)
- Chef Max Risotto = Risotto Base + garnish variabile (leftover: gamberi, lobster, pollo, salmone)
- Gestione garnish variabile = sessione dedicata futura

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
11. Nomi ricette = identici al POS — mai cambiare pos_name, cambiare il title della ricetta
12. domenica niente Focus Mode (fix v303 già deployato)
