# PROMPT PROSSIMA SESSIONE — Brigade

## CARICA SUBITO
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Repo `1cos/back-of-house`, branch `brigade-main` SEMPRE
3. Leggi i file da GitHub LIVE, mai da memoria, mai da `/mnt/project/`
4. Supabase project: ydqmumpytgrlceuinoqt

## ⚠️ ATTENZIONE — SESSIONI PARALLELE
Max lavora in più chat contemporanee. PRIMA di bumpare sw.js:
- Leggi live `boh-v???` da sw.js
- Verifica gli ultimi commit su `brigade-main` (`/commits?sha=brigade-main`)
- Incrementa SOLO di +1 rispetto alla versione live (non da memoria)

## ⚠️ REGOLA D'ORO
- Per Max si chiamano SEMPRE "ingredienti", MAI "BOM/JSON". Max è un cuoco.
- NON chiedere mai a Max di ricreare gli ingredienti — LI HA GIÀ. Leggi il DB prima.

---

## STATO TECNICO (aggiornato 2026-06-23)
- Frontend: **v332** (sw.js boh-v332)
- Ultime tre sessioni hanno toccato: focus-mode + schedule overlay + Dish Crew (questa chat), recipes foto + drag&drop BOM (altra chat)
- Bot 3: v4 (bot-preplist-builder)
- recipe_bom: ~1.125 righe, ~194 ricette con BOM
- `users.schedule_name` colonna creata e popolata (matching con `shifts_schedule.employee_name`)

---

## COSA È STATO FATTO IN QUESTA SESSIONE (2026-06-23)

### Focus Mode v330 — fix bypass Schedule + Schedule overlay
- BUG ORIGINARIO: bottone "📅 Schedule" dentro Focus Mode chiamava `hideFocusMode();showSchedule();` → spegneva la gabbia e dava accesso a tutta l'app utente.
- FIX: nuovo `focusOpenSchedule()` in `js/focus-mode.js` crea overlay z-index:70 sopra la Focus Mode (z-index:60). Riusa `schedLoadData`/`schedShowView` esistenti dentro un container dedicato. Niente bottone Sincronizza per lo staff. "← Back" rimuove l'overlay e la Focus Mode resta intatta sotto.
- Collisione ID con `#vsched` nascosta gestita: id originali rinominati `_hidden_*` mentre overlay aperto, ripristinati alla chiusura.

### Focus Mode v330 — regole turno definitive
- BUG: `loadFocusShiftWindow()` cercava `user.full_name` che è SEMPRE `undefined` (la tabella `public.users` ha solo `name`). Quindi la Focus Mode girava SEMPRE sul fallback 8–20 per chiunque staff, anche per chi non era schedulato (es. Cole).
- FIX: nuova colonna `users.schedule_name` con il nome esatto di `shifts_schedule.employee_name`. Match con `eq('employee_name', user.schedule_name)`.
- Finestra ESATTA: inizio = start_time del turno, fine = end_time del turno (precisione al minuto).
- Eccezione: `is_closing=true` → fine fissata a mezzanotte (24:00).
- NESSUN FALLBACK 8–20. Niente turno = niente Focus Mode.
- Admin esclusi sempre. Domenica esclusa sempre.

### Setaccio nomi schedule + users (2026-06-23)
Aggiunta colonna `users.schedule_name` e popolamento per tutti gli utenti. Allineato `users.name` con grafia inglese corretta (Sofia → Sophia, ecc).

**Utenti attivi (15): tutti con schedule_name**
- Anto = Antonella Aiello | Chance = Rogers Chance | Cole = Colton Stewart | David = David Davis | Genova = Kristel Dizon Genova | Haley = Haley Robbins | Max = Massimiliano Zubboli (admin) | Preston = Dunagan Preston | Rachael = Carolina Baquero | Samantha = Samantha Traweek | Sophia = Sophia Gutierrez | Tela = Otela Leveling | Todd = Todd Spangler | Zuu = Maria Rosa Razo | Maddie = Madison Ostendorf (rimpiazza "Maddison" eliminata)

**Nuovi utenti attivati (10): default_station assegnato, schedule_name impostato**
- Diana → Oven Station
- Chris → Pasta Station
- Austin, Jaxon, Arianna, Kelly, Herminia, Jose, Luis, Ronaldo → Dish Crew

⚠️ I 10 nuovi utenti NON HANNO PIN. Max deve aggiungere il PIN dal pannello team prima che possano fare login.

### Nuova stazione "Dish Crew" — Fase 1 (Foundation)
- Aggiunta come stazione di sistema in `js/init.js` v332
- Regole di visibilità:
  - **Admin**: vede tutte le stazioni inclusa Dish Crew
  - **Staff cucina**: vede solo stazioni cucina + Chiusura (Dish Crew nascosta)
  - **Staff Dish Crew**: vede SOLO Dish Crew (cucina nascosta, station forzata a 'Dish Crew')
- 8 dishwasher assegnati: Austin, Jaxon, Arianna, Kelly, Herminia, Jose, Luis, Ronaldo

---

## 🔴 PRIORITÀ #1 PROSSIMA SESSIONE — Home dedicata Dish Crew (Fase 2)

I dishwasher non devono vedere la Home cucina. Serve una Home dedicata, semplice:

**Cosa vedono:**
- Top bar standard (avatar, news ticker, alerts banner)
- Alerts attivi
- La loro stazione "Dish Crew" con i task del giorno/settimana (Max popola i task dal pannello admin)
- Birthdays/shoutouts
- Bottom bar: Home / Chat / Schedule / Tell Chef

**Cosa NON vedono:**
- Recipes (nascondere tab)
- Closing (mai)
- Sales / Ingredienti / Fatture / L'Ufficio / Sous Chef AI
- Operation Notes prompt serale (no)
- Stazioni di cucina nei selettori (già fatto Fase 1)
- Focus Mode (decisione esplicita: niente Focus Mode per Dish Crew, sempre Home dedicata)

**Approccio implementativo proposto:**
- Detect dishwasher: `user.default_station === 'Dish Crew'` (no nuova colonna)
- In `app.js` doLogin: se isDishCrew → nascondere tab Recipes, Closing, ecc.
- Modificare la Home (renderHomeStations / renderHomeStationItems in init.js) per mostrare layout dedicato dishwasher
- Verificare che tab Schedule, Chat, Tell Chef restino accessibili
- Operation Notes prompt: `checkOperationNotePrompt()` deve uscire subito se isDishCrew

---

## 🟠 PRIORITÀ #2 — Lavoro Ricette/Foto (altra chat in parallelo)
La sessione parallela sta lavorando su:
- v331: upload foto libreria ricette + tasto elimina ricetta
- v330: drag & drop sort_order ingredienti BOM
Spazio aperto per continuare lì: smart UI preview prep con `suggested_qty`, scaler da quantità bot, ingredienti scalati, pillole Mon–Thu / Fri–Sat.
Vedi sezione "PROBLEMA APERTO PRIORITÀ #1 — UI PREP SMART" più sotto (rimasta valida dalla sessione 2026-06-21).

---

## TODO BACKLOG ALTO PRIORITÀ

### Da chiudere a breve
- PIN per i 10 nuovi utenti (Diana, Chris, e 8 dishwasher) → da assegnare dal pannello team
- Home dedicata Dish Crew (Fase 2 sopra)
- Smart UI prep con suggested_qty del Bot 3 (preview ricetta + prep card)
- Bot 3 fix unità: salvare suggested_qty in grammi con spiegazione in suggested_by

### Backlog focus-mode/schedule
- Verificare che il match `schedule_name` funzioni nei test reali con il prossimo CSV importato
- Eventuale rinomina "Manager" station → "Coordinator" (Tela = Kitchen Operation Coordinator)

---

## PROBLEMA APERTO PRIORITÀ #1 — UI PREP SMART (eredità sessione 2026-06-21)

### Il concetto
Nella preview di una ricetta prep (es. CACIO E PEPE SAUCE che fa 6kg base):
- Il bot calcola 10.500g per la settimana basandosi su vendite reali
- La ricetta base rimane 6kg (il cuoco sa già farla)
- La UI deve mostrare:
  - Pillole: Mon→Thu avg / Fri+Sat avg (porzioni vendute)
  - "Suggested quantity for 7 days: 10.5 kg" (calcolato dal bot)
  - Scaler modificabile che parte da suggested_qty invece che da base_servings
  - Ingredienti scalati di conseguenza

### Dove mostrarlo
1. **Preview ricetta** (showRecipeSheet in recipes.js) — pill suggested_qty se la ricetta ha prep_task collegata
2. **Prep task card** (prep.js) — pill verde "🤖 10.5 kg consigliati questa settimana"

### Problema bot — unità
Il bot salva suggested_qty in grammi (10500) ma la prep_task ha unit="batch". La ricetta ha base_weight_g=6000.
UI converte: 10500g / 6000g = 1.75 batch → mostra "10.5 kg (≈ 1.75 batch da 6kg)"
Salvare suggested_qty in grammi reali con spiegazione in suggested_by.

### Come collegare
recipes.id → prep_tasks.recipe_id, oppure recipe_bom.prep_task_id → prep_tasks.id

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
- SHA fresco prima di ogni PUT; bump boh-vN in sw.js ad ogni push (verifica live prima — sessioni parallele)
- node --check prima di push
- Commit: "vN file — descrizione"; solo brigade-main
- Leggi SEMPRE da GitHub live, mai da memoria o /mnt/project/
- Conferma piano prima di scrivere codice; una cosa alla volta
- Financial data mai allo staff
- Kitchen Display SOLO inglese
- Domenica chiuso (esclusa da calcoli Bot 3 e da Focus Mode)
