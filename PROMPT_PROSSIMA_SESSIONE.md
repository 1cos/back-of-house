# PROMPT PROSSIMA SESSIONE — Brigade — PREP SMART + BOM COMPLETO

## CARICA SUBITO
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Repo `1cos/back-of-house`, branch `brigade-main` SEMPRE
3. Leggi i file da GitHub LIVE, mai da memoria
4. Supabase project: ydqmumpytgrlceuinoqt

---

## ⚠️ REGOLA D'ORO
- Per Max si chiamano SEMPRE "ingredienti", MAI "BOM/JSON". Max è un cuoco.
- NON chiedere mai a Max di ricreare gli ingredienti — LI HA GIÀ. Leggi il DB prima.

---

## STATO TECNICO (aggiornato 2026-06-21 sera)
- Frontend: **v306** (sw.js boh-v306)
- Bot 3: **v4** (bot-preplist-builder) — deployato stasera
- recipe_bom: 1.125+ righe, 194 ricette con BOM

---

## COSA ABBIAMO FATTO STASERA (2026-06-21)

### BOM completato
- Compilato BOM per: Spaghetti al Pomodoro, Spaghetti al Pomodoro Half, La N.4 Half
- Aggiunto sub-ricetta CACIO E PEPE SAUCE nel BOM di: Cacio e Pepe (150g), Cacio e Pepe Half (75g)
- Collegato prep_task_id nel BOM Caprese:
  - bom_id 603 (Sliced Mozzarella) → prep_task 367 (shelf life 2gg)
  - bom_id 1135 (Beef Steak Tomatoes) → prep_task 368 Sliced Tomatoes (shelf life 2gg)
  - bom_id 604 (Caprese Seasoning) → prep_task 334 (shelf life 30gg)
- Collegato prep_task 288 "Cacio e pepe" ai bom_id 1250 e 1251 (shelf life 7gg)
- Fix typo: prep_task 367 rinominata da "Sliced mozzovella" a "Sliced Mozzarella"

### recipes.js v306
- Form edit ora legge dal BOM invece che dal JSON (ogni riga verde con UUID reale)
- Aggiunto bottone "+ Create [nome]" in fondo all'autocomplete ingredienti:
  - Mini-modal con Nome (precompilato), Category (dropdown 12 categorie), Base Unit (g/ml/each)
  - Crea ingrediente nel DB e lo seleziona automaticamente con bordo verde

### Bot 3 v4 (bot-preplist-builder)
- Aggiunto Percorso C: prep_task = sub-ricetta → trova chi la usa → somma vendite POS
- Include anche modifier da pos_modifiers (keyword match, peso 0.5)
- Percorsi A e B invariati e funzionanti
- Testato: Cacio e pepe calcola 2434 "batch" = in realtà grammi totali (vedi sotto)

---

## PROBLEMA APERTO PRIORITÀ #1 — UI PREP SMART

### Il concetto (spiegato da Max)
Nella preview di una ricetta prep (es. CACIO E PEPE SAUCE che fa 6kg base):
- Il bot calcola 10.500g per la settimana basandosi su vendite reali
- La ricetta base rimane 6kg (il cuoco sa già farla)
- La UI deve mostrare come nella preview Lobster Fettucine:
  - Pillole: Mon→Thu avg / Fri+Sat avg (porzioni vendute)
  - "Suggested quantity for 7 days: 10.5 kg" (calcolato dal bot)
  - Scaler modificabile che parte da suggested_qty invece che da base_servings
  - Ingredienti scalati di conseguenza

### Dove mostrarlo
1. **Preview ricetta** (showRecipeSheet in recipes.js) — aggiungere pill suggested_qty se la ricetta ha una prep_task collegata con suggested_qty
2. **Prep task card** (prep.js) — pill verde "🤖 10.5 kg consigliati questa settimana"

### Problema bot — unità
Il bot salva suggested_qty in grammi (10500) ma la prep_task ha unit="batch".
La ricetta ha base_weight_g=6000 (6kg per batch).
Il bot deve salvare suggested_qty in grammi e suggested_by con spiegazione leggibile.
La UI converte: 10500g / 6000g = 1.75 batch → mostra "10.5 kg (≈ 1.75 batch da 6kg)"

### Come collegare ricetta → prep_task per mostrare suggested_qty nel preview
La catena: recipes.id → prep_tasks.recipe_id (già esiste per alcune)
O in alternativa: recipe_bom.prep_task_id → prep_tasks.id

---

## TODO URGENTI (da fare nella prossima sessione)

### 1. UI preview ricetta con suggested_qty (PRIORITÀ #1)
- Mostrare pillole vendite + suggested quantity in tutte le preview ricette prep
- Scaler che parte da suggested_qty del bot
- Ingredienti scalati di conseguenza
- Tocca: js/recipes.js (showRecipeSheet)

### 2. Prep task card mostra suggested_qty
- Pill verde "🤖 X kg consigliati" nella card prep
- Tocca: js/prep.js

### 3. Bot 3 — fix unità suggested_qty
- Salvare grammi reali con spiegazione in suggested_by
- Es: "Bot v4: 7gg × media 1.5pz/g × 150g/pz = 10.5kg (base 6kg)"

### 4. Da collegare nel BOM (annotato da Max)
- Artichoke Sauce → aggiungere prep_task_id dove usa CACIO E PEPE SAUCE (bom_id 1173)
- Modifier "Cacio e Pepe", "Half cacio", "Sub Cacio sauce" → già in pos_modifiers,
  già inclusi nel Percorso C del bot con peso 0.5. Da verificare che il match funzioni.

### 5. Ricette con più ingredienti nel JSON che nel BOM
- Bot Guardiano Ricette le flagga come task da controllare
- Non urgente — piano piano

---

## COME FUNZIONA IL FOOD COST (catena verificata)
```
recipe_bom.item_id → ingredients.id → ingredient_vendors.ingredient_id → price_per_100g
recipe_bom.sub_recipe_id → recipes (sub-ricetta, food cost ricorsivo)
recipe_bom.prep_task_id → prep_tasks (collegamento prep → bot suggerimenti)
```

## COME FUNZIONA BOT 3 v4
```
Percorso A: prep_task.id → recipe_bom.prep_task_id → parent_recipe_id → recipes.pos_name → pos_production_daily
Percorso C: prep_task.name → recipes.title (match) → recipe_bom.sub_recipe_id → chi la usa → pos_name → vendite
            + modifier da pos_modifiers (keyword match, peso 0.5)
Percorso B: fallback prep_log storico
Calcolo: media_giornaliera × shelf_life_giorni × quantità_BOM × 1.10
```

## REGOLE OPERATIVE INVIOLABILI
- SHA fresco prima di ogni PUT; bump boh-vN in sw.js ad ogni push; node --check prima di push
- Commit: "vN file — descrizione"; solo brigade-main
- Leggi SEMPRE da GitHub live, mai da memoria o /mnt/project/
- Conferma piano prima di scrivere codice; una cosa alla volta
- Financial data mai allo staff
- Kitchen Display SOLO inglese
- Domenica chiuso (esclusa da calcoli Bot 3)
