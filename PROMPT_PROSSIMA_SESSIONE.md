# PROMPT PROSSIMA SESSIONE — Brigade

## CARICA SUBITO
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Leggi TUTTI i file .md da brigade-main prima di fare qualsiasi cosa
3. Controlla versione live sw.js prima di qualsiasi push
4. Repo: `1cos/back-of-house`, branch `brigade-main` — MAI `brigade-dev`

---

## VERSIONE LIVE
- Brigade frontend: **v420**
- sw.js: `boh-v420`
- bot-preplist-builder: **v18** (version 36)
- Edge Function gmail-touchbistro-import: **v22**
- Supabase project: `ydqmumpytgrlceuinoqt`

---

## SESSIONE 29 GIUGNO 2026 (pomeriggio) — v412→v420 — Flusso prep card completo

### Completato in questa sessione

**Flusso card prep — completamente riscritto:**

- `laterBtn` eliminato — non esiste più
- `noNeedBtn` eliminato — non esiste più
- Tre stati card con bordatura colorata:
  - 🔴 **Rosso** — stock zero/urgente → solo **START**
  - 🟡 **Giallo** — quasi finito → solo **START**
  - 🔵 **Blu** — in progress, step intermedio → **SEE STEPS**
  - 🔵 **Blu** — in progress, ultimo step → **DONE**
  - ⚪ **Grigio** — stock ok → nessun bottone
- Pill bot human-readable: "hai 1.8 kg in casa" / "hai 0 in casa" / "quasi finito · hai 0.4 kg"
- Font card aumentati +2px: nome 17px, badge 12px, pill/tag 13px, bottoni 15px

**Wake Lock:**
- Timer START → `navigator.wakeLock.request('screen')` — schermo rimane acceso
- Timer stop / DONE → rilascia wake lock
- Supportato iOS 16.4+ e Android Chrome 84+

**Step tracking in memoria locale:**
- `window._taskStep[prepTaskId]` — ricorda a che step sei
- `window._taskStepTotal[prepTaskId]` — totale steps
- `window.prepOnStepChange(id, currentStep, total)` — callback da recipe-modal
- Reset al DONE

**Recipe modal adattivo (v4) — 4 modalità:**
1. Ha `recipe_id` + BOM o `recipe_steps` → modal completo (ingredienti scalabili + steps + note)
2. Ha solo `prep_steps` (senza ricetta) → modal leggero solo steps con timer
3. Ha solo nota → modal bare con testo + DONE
4. Niente → modal bare con solo DONE

**`prep_steps` — tabella esistente:**
- Campi: `id`, `prep_task_id`, `sort_order`, `title`, `note`, `timer_minutes`
- Usata per task operativi senza ricetta (salse semplici, check con steps)
- Timer in `timer_minutes` (non seconds) — convertito automaticamente nel modal

**Fix critici:**
- `prepStart()` apre modal anche senza `recipe_id` (fix: `recipeModal.open(null, id)`)
- `prepSeeSteps()` non blocca più su `recipe_id` mancante
- `openDoneSheet()` normalizza id int/stringa per lookup `tasks[key]`
- Modal bare DONE: usa event listener (non onclick inline — IIFE scope bug)
- Modal bare DONE: rimuove overlay PRIMA di aprire done sheet (timing fix)

**Pill bot troncata:**
- `suggested_note` tronca a 60 char per evitare pill lunghissime (bug bot temporaneo)

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. Bot-preplist-builder — riscrittura testo (PRIORITÀ 1)
Il bot deve scrivere testi da sous chef, non da foglio Excel.
Tre casi chiari:
- 🔴 "Prepara oggi · con 14 kg arrivi a venerdì"
- 🟡 "Hai 10 kg in casa · arrivi fino a sabato · non serve oggi"
- 🟢 "Prepara domani · controlla ingredienti"

Logica: `current_stock ÷ consumo_medio_giornaliero = giorni_coperti` → calcola data copertura

**Formato suggested_note nuovo:** `color|testo_it|testo_en|testo_es`
Frontend prep.js legge indice lingua da `user.lang` (1=IT, 2=EN, 3=ES)

**Bug da correggere nel bot:**
- Caprese seasoning: giorni ripetuti (Ven/Sab 10 volte) — calcolo finestra storica sbagliato
- Check Basil Oil: `suggested_qty=13315 buste` — confonde grammi con kg
- Generale: mostra percorso ragionamento invece del risultato

### 2. Stazioni ancora da completare
- **Finishing Oven** — categorizzazione prep_type non ancora toccata
- **Plating Station** — categorizzazione prep_type non ancora toccata

### 3. Manager Station — ancora aperti
- Basil flowers → BOM da collegare alle ricette
- Confit tomatoes → ricetta da creare + BOM
- Porterhouse task (id 461) → collegare a ricetta Porterhouse alla Fiorentina
- Spinach (id 318) → decidere: stessa ricetta di Butter Spinach o separata?

### 4. Dati ricette mancanti
- **Brisket** — `base_weight_g` (verificare in cucina)
- **Truffle Butter** — `base_weight_g`
- **THYME BUTTER** — `base_weight_g = 5g` sembra placeholder
- Varie Pastry — `shelf_life_days` mancanti

### 5. Recipe steps — placeholder dinamici (backlog)
Steps devono usare `{item_id}` invece di quantità hardcoded.
Il modal risolve i placeholder dal BOM scalato in tempo reale.

### 6. Dish Crew Home (Fase 2) — backlog
Detect `user.default_station === 'Dish Crew'` → home semplificata.

---

## REGOLE CRITICHE DA NON DIMENTICARE
- **BOM mai toccato** — connesso a bot, POS, food cost
- **pos_name immutabile** — solo alias con pipe `|`
- **tasks lookup** — sempre normalizzare id con `Object.keys(tasks).find(k=>String(k)===String(id))`
- **Modal IIFE** — mai onclick inline dentro recipe-modal.js, sempre event listener
- **sw.js** — sempre leggere versione live prima di pushare, incrementare di +1

---

## SESSIONE v427 → v428 (30 giugno 2026)

**Nota:** il log si era fermato a v420 ma sw.js live era già a v427 — mancavano i riepiloghi di sessioni parallele (v421-v427: pill bot trilingue, fix tell-chef, step editor recipe_steps in openRecipeEditor). Da recuperare quando le altre sessioni chiudono.

**Bug fix — swipe-to-close che chiudeva le sheet durante lo scroll (v428):**

1. **Vendor Documents (`vendor-documents-review.js`)** — c'erano DUE listener di swipe-to-close attaccati allo stesso pannello: uno vecchio inline senza protezione scroll (chiudeva la sheet se il drag verticale superava 80px, ovunque partisse il touch) e uno nuovo condiviso (`addSwipeToClose` in utils.js, che ignora il drag se parte dentro un container scrollabile). Il primo interferiva sempre. Fix: rimosso il listener vecchio, lasciato solo `addSwipeToClose`.

2. **L'Ufficio (`office.js`, funzione `officeAddSwipeDown`)** — il check usava solo `list.scrollTop` letto in tempo reale al `touchmove`, senza considerare se il touch fosse partito dentro la lista. Quando l'utente era in cima alla lista (`scrollTop ≈ 0`) e provava a scrollare/guardare il contenuto, il gesto veniva letto come chiusura sheet. Fix: ora si traccia se il touch è partito dentro `#officeFolderList` (`touchInList`); se sì e la lista può ancora scrollare verso l'alto (`scrollTop > 0`), il drag-to-close è disattivato e priorità allo scroll nativo. Se l'utente è già in cima e continua a tirare giù, il drag-to-close si riattiva (gesto naturale iOS).

**Segnalato da Max ma NON ancora risolto — bottom bar fluttuante:**
- A volte durante lo scroll (Vendor Documents, sottomenu L'Ufficio) la bottom bar (`<nav class="fixed bottom-0...">` in index.html) si stacca e finisce "nel mezzo" dello schermo invece di restare ancorata in fondo.
- Causa probabile: nessuno scroll-lock sul `body` quando si apre una sheet/modal → il bounce/rubber-band di iOS Safari può spostare temporaneamente elementi `position:fixed`.
- Piano proposto (in attesa di conferma Max): al momento dell'apertura di una sheet/modal, bloccare lo scroll del body (`position:fixed` su body) e sbloccarlo alla chiusura. Max ha chiesto di aspettare e verificare prima se il fix dello swipe-to-close (sopra) risolve già il sintomo. Test in corso da parte di Max — risultato preliminare "va meglio" ma non ancora confermato del tutto risolto.
- Se riemerge: applicare lo scroll-lock, inizialmente solo su Vendor Documents + L'Ufficio (non a tutte le sheet/modal, su richiesta esplicita di Max in quella conversazione).

**File modificati:** `js/vendor-documents-review.js`, `js/office.js`, `sw.js` (v427→v428)

**Nota per sessioni parallele:** Max sta lavorando contemporaneamente su altre chat che devono ancora chiudere e scrivere i loro riepiloghi. I 6 file MD principali (BOH_OS_BACKLOG, BOH_OS_DECISIONS, BOH_OS_SPEC, BOH_OS_WARNINGS, BRIGADE_DB_SCHEMA, BRIGADE_VISION) sono risultati molto disallineati rispetto allo stato reale del DB/app (fermi tra il 12 e il 27 giugno, prima del lancio in produzione) — aggiornamento generale rimandato finché le sessioni parallele non chiudono, per non sovrascrivere lavoro in corso.

---

## SESSIONE v427 — Steps editor UI in openRecipeEditor (recipe-steps, sessione parallela "ricette contorni")

**Scoperta di partenza:** Max ha notato due sistemi di visualizzazione ricetta scollegati: la modal vecchia (`recipes.js`, colonna testo libero `recipes.procedure`, aperta da "Edit") e la modal nuova con tab Ingredients/Steps/Notes, progress bar e timer (`recipe-modal.js`, legge dalla tabella `recipe_steps`: `step_number`, `title`/`title_it`/`title_es`, `instruction_en`/`instruction_it`/`instruction_es`, `timer_seconds`). L'editor "Edit" scriveva solo sul vecchio `procedure`, quindi **non esisteva alcuna UI per editare `recipe_steps`** — Max aveva popolato 19 ricette a step manualmente via query dirette.

**Censimento sullo stato reale (216 ricette totali, 30/06):**
- 16 ricette con solo `procedure` vecchio testuale
- 19 ricette con solo `recipe_steps` (nuovo formato)
- 6 ricette in doppio binario (entrambi i sistemi popolati): Amalfi Salmon, Arrabbiata, Artichoke, Chicken Parmesan, Fried Calamari, Salmon Cakes — **rischio di disallineamento se editate dal vecchio editor**
- 187 ricette senza procedimento da nessuna parte

**Decisione Max:** il formato a step è quello corretto (più nuovo, più veritiero, dati freschi). Il vecchio `procedure`/`procedure_en`/`procedure_es` resta per ora intatto (non rimosso, non migrato) — migrazione delle 16+6 ricette vecchie rimandata a sessione futura, priorità era avere prima l'editor.

**Costruito (v427):**
- `js/recipes.js` — `openRecipeEditor` reso `async`, carica gli `recipe_steps` esistenti (se `rec.id`) prima di renderizzare la modal. Nuova sezione "👨‍🍳 Steps" sotto Ingredients: righe con titolo IT + istruzione IT + timer (minuti), pulsanti aggiungi/rimuovi/riordina (↑/↓), pulsante "🌐 Traduci EN/ES" per riga che chiama `groqTranslate` (stessa funzione/Edge Function `ai-translate` già usata per `procedure_en/es`) per popolare titolo+istruzione in EN/ES. Nuova funzione `saveRecipeSteps(recipeId, steps)` — pattern delete+reinsert identico a `saveRecipeBOM`, chiamata nel flusso di `saveR` dopo `saveRecipeBOM`.
- `js/utils.js` — chiavi i18n aggiunte in IT/EN/ES: `noSteps`, `translateStepsBtn`.
- Equipment/Procedure (vecchio editor) lasciati intatti e ancora presenti nella modal, sotto la nuova sezione Steps — nessuna rimozione per ora.

**Verifica richiesta a Max:** aprire Edit su "Brussel Sprouts" (che ha 4 step già popolati) e controllare che il nuovo editor li carichi e mostri correttamente prima di fidarsi per nuove ricette.

**File modificati:** `js/recipes.js`, `js/utils.js`, `sw.js` (v426→v427)

---

## SESSIONE v428+ — Nuove ricette contorni per La Griglia (sessione parallela "ricette contorni")

Mentre si attendeva conferma del test sull'editor Steps sopra, Max ha chiesto di procedere comunque a inserire ricette contorni via SQL diretto (stesso formato di Brussel Sprouts: `recipes` + `recipe_bom` + `recipe_steps`), così risultano già editabili/correggibili dal nuovo editor una volta confermato funzionante.

**Ricette create (categoria `SECONDI|contorni`, `base_servings=10`):**

1. **Roasted Cauliflower** (id `cffcebf1-a29e-4447-8544-9d7e250d1f26`) — 35 min prep, shelf life 2 giorni. BOM: Cauliflower 1500g, EVOO 80ml, Salt 8g, Black Pepper Whole 3g, Pecorino Romano 150g, Bread Crumbs 100g. 4 step: taglio+condimento → forno 22 min (1320s) → tostatura pangrattato 3 min (180s) → assemblaggio con pecorino e pangrattato.

2. **Marsala Onions** (id `51218cd3-34fe-4ebd-959e-3762aaa311fc`) — 45 min prep, shelf life 3 giorni. BOM: Red Onions 1800g, Butter 60g, EVOO 40ml, Marsala Wine 250ml, Brown Sugar 30g, Salt 6g, Black Pepper Whole 2g. 4 step: affettatura → caramellizzazione 25 min (1500s) → sfumatura Marsala e riduzione 10 min (600s) → raffreddamento/conservazione.

**Nuovo ingrediente creato:** Marsala Wine (id `04adaed2-e019-4671-bfa1-78a826da6a31`, categoria Beverages & Spirits, non esisteva nel DB).

**Nessuna modifica a file GitHub per questa parte** — solo inserimenti DB via Supabase MCP (`recipes`, `recipe_bom`, `recipe_steps`, `ingredients`).

**Prossimi contorni in coda (proposti da Max, non ancora confermati/costruiti):** Carote arrostite miele/timo/nocciole, Funghi misti burro nocciola, Polenta cremosa al parmigiano, Broccolini aglio/peperoncino/limone, Patate al forno con pancetta, Insalata rucola/parmigiano/balsamico, Crema di sedano rapa, Radicchio grigliato miele/gorgonzola, Fagioli cannellini rosmarino/aglio, Tortino patate gratinate. Max deve ancora scegliere quali tra queste procedere.

**File modificati:** nessuno (solo DB)

