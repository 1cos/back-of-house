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

## STATO TECNICO (aggiornato 2026-06-24)
- Frontend: **v335** (sw.js boh-v335)
- Ultime sessioni hanno toccato:
  - v329: fix bypass Schedule in Focus Mode (overlay z-index:70)
  - v330: Focus Mode match esatto schedule_name + drag&drop BOM ingredienti
  - v331: upload foto libreria ricette + tasto elimina ricetta
  - v332: nuova stazione Dish Crew (Foundation) + traduzioni ricette TR()
  - v333: traduzioni ricette TR() IT/EN/ES (fix hardcoded strings)
  - v334: tab Schedule visibile a tutti (era nascosto)
  - v335: foto in chat (upload rullino, preview, fullscreen, image_url) + slideshow onboarding EN/ES (liquid glass, 13 slide)
- Bot 3: v4 (bot-preplist-builder)
- recipe_bom: ~1.125 righe, ~194 ricette con BOM
- `users.schedule_name` colonna creata e popolata (matching con `shifts_schedule.employee_name`)

---

## STATO UTENTI (aggiornato 2026-06-24)

**Utenti attivi cucina (15):**
- Anto = Antonella Aiello | Chance = Rogers Chance | Cole = Colton Stewart
- David = David Davis | Genova = Kristel Dizon Genova | Haley = Haley Robbins
- Max = Massimiliano Zubboli (admin) | Preston = Dunagan Preston
- Rachael = Carolina Baquero | Samantha = Samantha Traweek | Sophia = Sophia Gutierrez
- Tela = Otela Leveling | Todd = Todd Spangler | Zuu = Maria Rosa Razo
- Maddie = Madison Ostendorf

**Nuovi utenti attivati (10) — PIN ASSEGNATI ✅:**
- Diana → Oven Station
- Chris → Pasta Station
- Austin, Jaxon, Arianna, Kelly, Herminia, Jose, Luis, Ronaldo → Dish Crew

---

## 🔴 PRIORITÀ #1 PROSSIMA SESSIONE — Home dedicata Dish Crew (Fase 2)

I dishwasher non devono vedere la Home cucina. Serve una Home dedicata, semplice:

**Cosa vedono:**
- Top bar standard (avatar, news ticker, alerts banner)
- Alerts attivi
- La loro stazione "Dish Crew" con i task del giorno/settimana
- Birthdays/shoutouts
- Bottom bar: Home / Chat / Schedule / Tell Chef

**Cosa NON vedono:**
- Recipes (nascondere tab)
- Closing (mai)
- Sales / Ingredienti / Fatture / L'Ufficio / Sous Chef AI
- Operation Notes prompt serale (no)
- Stazioni di cucina nei selettori (già fatto Fase 1)
- Focus Mode (decisione esplicita: niente Focus Mode per Dish Crew, sempre Home dedicata)

**Approccio implementativo:**
- Detect dishwasher: `user.default_station === 'Dish Crew'` (no nuova colonna)
- In `app.js` doLogin: se isDishCrew → nascondere tab Recipes, Closing, ecc.
- Modificare la Home (renderHomeStations / renderHomeStationItems in init.js) per layout dedicato
- Verificare che tab Schedule, Chat, Tell Chef restino accessibili
- `checkOperationNotePrompt()` deve uscire subito se isDishCrew
- Focus Mode: `initFocusMode()` non si chiama se isDishCrew

---

## 🟠 PRIORITÀ #2 — Smart UI prep con suggested_qty
- Preview ricetta: pill suggested_qty se ricetta ha prep_task collegata
- Prep task card: pill verde "🤖 10.5 kg consigliati questa settimana"
- Bot 3 salva suggested_qty in grammi, UI converte: 10500g / 6000g = 1.75 batch
- Scaler modificabile parte da suggested_qty invece che da base_servings

---

## 🟠 PRIORITÀ #3 — Focus Mode test reale
- Nessun CSV 7shifts importato dopo sessione 2026-06-23
- Il match `schedule_name` → `shifts_schedule.employee_name` è solo teoria
- Importare CSV reale e verificare che Focus Mode si attivi/disattivi correttamente

---

## 🟠 PRIORITÀ #4 — Foto in chat (v335) da verificare
- Upload foto da rullino implementato ma non ancora testato da Max su iPhone
- Verificare: upload, preview, fullscreen, invio

---

## TODO BACKLOG ALTO PRIORITÀ

- Bottoni L'Ufficio — sessione dedicata urgente (non collegati ad azioni reali)
- Fix realtime TV — loadChat() troppo pesante, aggiungere solo payload.new
- Bug UI chat — long press copia non funziona
- office-ai cron orario (analisi automatica ogni ora)
- Bot 4 Fase 2 — esecuzione automatica Tell Chef
- Bot 5 versione B — food cost % quando selling_price popolato
- Spostare L'Ufficio nella bottom bar (ora nei tre puntini)
- Audit menu tre puntini — rimuovere voci obsolete (Parser Test, Similarity, Vendor Match, Ingredient Cleanup, Bootstrap)
- "Riapri" button in Focus Mode non funziona — fix pending
- TripleSeat — Monica deve fare Authorize (ancora in attesa)

---

## PROBLEMA APERTO — UI PREP SMART (eredità sessione 2026-06-21)

### Il concetto
Nella preview di una ricetta prep (es. CACIO E PEPE SAUCE che fa 6kg base):
- Il bot calcola 10.500g per la settimana basandosi su vendite reali
- La UI deve mostrare:
  - Pillole: Mon→Thu avg / Fri+Sat avg (porzioni vendute)
  - "Suggested quantity for 7 days: 10.5 kg" (calcolato dal bot)
  - Scaler modificabile che parte da suggested_qty invece che da base_servings
  - Ingredienti scalati di conseguenza

### Come collegare
recipes.id → prep_tasks.recipe_id, oppure recipe_bom.prep_task_id → prep_tasks.id

### Problema bot — unità
Il bot salva suggested_qty in grammi (10500) ma la prep_task ha unit="batch".
UI converte: 10500g / 6000g = 1.75 batch → mostra "10.5 kg (≈ 1.75 batch da 6kg)"

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
