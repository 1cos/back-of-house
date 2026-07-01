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


## SESSIONE v396→v426 — Bug fixing sparsi (CORS, Schedule Oggi/Domenica, Prep Later, Recipe Pomodoro, Tell Chef crash)

Sessione separata in parallelo alle due sopra (steps editor + ricette contorni). Lavorato su file diversi, nessun conflitto noto.

**1. CORS fix Edge Function `notifications` (v33 Edge Function, no bump app):**
- `notifications` aveva `verify_jwt: true` → chiamate da `operation-notes.js` con ANON KEY fallivano il preflight CORS (niente header `Access-Control-Allow-Origin`), bloccate dal browser.
- Fix: rideploy con `verify_jwt: false` + handler esplicito per `OPTIONS` preflight + `CORS_HEADERS` su tutte le response (success ed errore).
- Risolto anche l'errore visibile in console `[OperationNote] Push failed: Failed to fetch`.

**2. Schedule — tab "Oggi" bloccato su data vecchia (v394→v397):**
- Bug: `schedCurrentDayIndex` inizializzava a `0`, usato sia come sentinella "non ancora selezionato" sia come index reale del primo giorno. Cliccando un giorno diverso da indice 0 il valore restava sporco; alla riapertura, se la data odierna non coincideva col giorno a index 0 della settimana, l'app restava bloccata sul vecchio giorno selezionato in sessioni precedenti.
- Fix v394: sentinella cambiata da `0` a `-1`; reset esplicito a `-1` ogni volta che si apre `showSchedule()`; auto-select cerca l'indice di oggi in `weekDates` solo quando `< 0`.
- Fix v397 (logica domenica, Zenos chiuso): `schedGetWeekDates()` ora filtra fuori le settimane passate (calcola il lunedì corrente — o il prossimo se oggi è domenica — e tiene solo `date >= cutoff`, con fallback a tutte le date se non ce ne sono future). `schedRenderOggi()` rileva `isSundayToday` e se vero salta direttamente al primo giorno disponibile (lunedì prossimo) invece di cercare la data odierna. Aggiunto banner "🌙 Zenos è chiuso oggi — Buon riposo a tutta la brigata. Prossimo turno: [data]" sopra le stats quando è domenica. Stessa logica si applica a colpo solo (week dates già filtrate) anche in view Settimana, che quindi si apre già sulla settimana prossima.
- File: `js/schedule.js`.

**3. Prep — bottone "Later" confuso/inutile, segnalato da Samantha (Pastry) via Tell Chef (v399→v411):**
- Bug riportato: "When I hit the do it later button it makes it say in progress" — tap veloce sul bottone Later in realtà chiamava `setWip()` diretto (impostava `in_progress: true`) invece di aprire il modal di scelta. Già un primo fix (v399) ha corretto `endWipPress` per chiamare `openWipNoteSheet` invece di `setWip` direttamente — ma poi si è scoperto che la vera causa di confusione era nel modal stesso: c'era **un solo bottone visibile** ("Mark In Progress"), quindi Samantha tappava quello pensando fosse il "conferma later" e il task finiva comunque in progress.
- Fix v411: modal con due bottoni affiancati e chiari — "Do it later" (grigio, chiude senza modificare il task) e "Mark In Progress" (blu, setta `in_progress: true`).
- **Nota importante per la prossima sessione (richiesta esplicita da Max, NON ancora implementata):** Max ha chiarito in chat che la UX di "Later" così com'è non ha senso e va ripensata da zero in una sessione dedicata. Logica voluta da Max, riassunta:
  - Bottone **"Later" va eliminato del tutto** da ogni card — se un task non interessa ora, si scorre oltre, non serve un'azione esplicita.
  - **Card "checklist"** (prep_type=`checklist`): solo pulsante Check, nessun concetto di Start/In Progress/Done.
  - **Card bordata di rosso (urgente/da fare)**: deve mostrare **Start**, non Done — non ha senso vedere "Done" su un task mai iniziato. Start apre la ricetta/steps con timer; si può navigare via e tornare dopo (più ricette aperte "in parallelo", es. avvii il soffritto dell'Arrabbiata, passi alla Cacio e Pepe a far bollire l'acqua, torni indietro sull'Arrabbiata per lo step successivo — ogni ricetta mantiene il proprio stato/step/timer in background). Una volta avviato → stato "In Progress", bordo cambia colore. **Done diventa disponibile solo dopo aver completato tutti gli step** della ricetta — non si può segnare Done saltando step.
  - **Card non bordata di rosso (non urgente)**: comportamento più semplice, Done diretto disponibile da subito senza dover passare da Start — fa solo da log/archivio con timestamp di quando è stata fatta, la card resta visibile con etichetta "Done".
  - Dopo che una card a step è stata completata (bordo tolto, va in fondo lista) e si volesse **rifarla**, va chiesta conferma esplicita ("Sei sicuro? L'hai appena completata") prima di farla ripartire da Start.
  - Max ha esplicitamente chiesto di **rimandare questo refactor a una sessione dedicata separata**, per non mischiarlo con fix minori. Prossima sessione: ripartire da qui, leggere `js/prep.js` live (versione corrente al momento dell'apertura, non fidarsi di questo riassunto per i numeri di riga) e implementare la logica sopra da zero, eliminando tutta la vecchia logica `startWipPress`/`endWipPress`/`openWipNoteSheet`/`saveWip` legata al concetto di "Later".
- File: `js/prep.js`.

**4. Recipe Pomodoro — can size sbagliato, segnalato da Cole (Saucier) via Tell Chef:**
- Bug: ricetta POMODORO SAUCE (id `498a2cf2-e425-4f08-8f5c-0edca4ca6f9e`) impostata per lattine piccole (5200g pomodoro, non multiplo di una lattina standard). Zenos usa lattine da 3kg.
- Fix: ricalcolata l'intera ricetta proporzionalmente su 1 lattina = 3000g pomodoro (fattore 0.5769). Aggiornati `base_servings` (20→12), `base_weight_g` (6122→3532) e tutti gli ingredienti nel BOM (Onions 800→461g, Carrots 200→115g, Celery 100→58g, EVOO 200→115g, Basil×2 50→29g e 100→58g, Water 1000→577ml, Salt 2→1g). Nessuna modifica a file GitHub — solo query dirette su `recipes`/`recipe_bom` via Supabase MCP.

**5. Tell Chef — crash JS su chiusura modal (v413):**
- Bug visto in console da Max: `Uncaught ReferenceError: tellChefStopVoice is not defined` su `closeTellChef()` (tell-chef.js:138). Funzione residua da un vecchio sistema di dettatura vocale custom, mai definita nel file attuale — l'app ora usa la dettatura nativa iOS dalla tastiera, non serve più.
- Fix: rimossa la chiamata a `tellChefStopVoice()` da `closeTellChef()`.
- File: `js/tell-chef.js`.

**File modificati in questa sessione:** `js/schedule.js`, `js/prep.js`, `js/tell-chef.js`, `sw.js` (v393→v396→v397→v398→v399→v411→v412→v413, poi riallineato a v425→v426 dopo essersi accorto che un'altra sessione parallela era già a v410+ — vedi nota sotto). Edge Function `notifications` (Supabase, v33, non versionata in sw.js).

**⚠️ Nota importante — collisione tra sessioni parallele rilevata e corretta in corsa:** durante questa sessione è stato inizialmente fatto un push su `js/prep.js` partendo da una versione letta a inizio sessione (corrispondente a v393), mentre nel frattempo un'altra sessione parallela aveva già riscritto sia `prep.js` che il modulo recipe-view fino a v410. Max ha bloccato in tempo ("siamo alla versione 410, non fare casino") prima che si creasse un conflitto serio. Il fix del bottone Later (punto 3 sopra) è stato poi rifatto correttamente leggendo dal vero stato live v410. **Lezione confermata per il futuro: rileggere sempre sw.js live immediatamente prima di ogni modifica, mai fidarsi di uno SHA letto a inizio sessione se la sessione è lunga o se si sa che Max lavora in parallelo altrove.**



---

## SESSIONE v425+ — Oven Station: tutti gli steps completati + fix struttura recipe_steps

**Contesto:** Sessione "RICETTE A STEPS" — Max ha chiesto di compilare `recipe_steps` per tutte le ricette ancora prive di steps, lavorando una stazione alla volta. Iniziata da Oven Station. Workflow stabilito da Max: Claude propone steps basati sul BOM reale → Max corregge a voce (spesso il processo reale è molto diverso da quanto dedotto dal solo BOM) → Claude salva nel DB → Claude riverifica con SELECT che sia tutto salvato correttamente.

**Fix struttura DB importante:** la tabella `recipe_steps` aveva solo `title` (singola colonna, niente i18n) mentre le istruzioni (`instruction_it/en/es`) erano già trilingue. Max ha notato nello screenshot dell'app che i titoli apparivano sempre in italiano anche con istruzioni in inglese. Aggiunta migration:
```sql
ALTER TABLE recipe_steps ADD COLUMN title_it text, ADD COLUMN title_es text;
```
Tutti i titoli esistenti (74 steps, incluse le ricette Saucier della sessione precedente) sono stati retrocompilati in IT/EN/ES. **`js/recipe-modal.js` aggiornato** (v425) per leggere `title_it`/`title_es`/`title` in base a `window.user?.lang` — stessa logica già usata per le istruzioni. File modificato: `js/recipe-modal.js`, `sw.js` (v424→v425).

**Regola "Note di servizio" stabilita da Max:** le istruzioni di piattaggio/finitura/servizio (cosa fare al pass durante il servizio, diverso dalla prep di produzione mattutina) NON vanno negli step di `recipe_steps`, ma nel campo `recipes.procedure` — che il tab "Notes" della recipe-modal già legge e mostra. Questo evita di mescolare "cosa preparo stamattina" con "cosa faccio quando arriva la comanda".

**Ricette Oven Station completate (9/9 — stazione conclusa al 100%):**

1. **Tempura Batter** (4 step) — soda water fredda + farina frustata + ghiaccio, si rifrusta se si rompe, si fa fresca ogni giorno, conserva in contenitore 1/6 profondo in frigo.
2. **Croutons** (4 step, timer 2400s) — pane a cubetti + condimento, **forno Rational programma "Croutons" 120°C per 40 min** (non 350°F/15min come da ipotesi iniziale), verificare croccantezza fino all'interno prima di togliere.
3. **Rosemary Potatoes** (4 step) — niente risciacquo delle patate (il forno le rende comunque croccanti), **forno Rational programma "Rosemary Potato Par Cook"**, si raffredda su teglia poi si trasferisce in **1/3 pan** (non hotel pan).
4. **Brussel Sprouts** (4 step, timer 540s) — processo completamente diverso dall'ipotesi forno: si **bollono interi 9 min in acqua salata**, si raffreddano in placca con acqua e ghiaccio, si taglia il culetto e si tagliano a metà, poi si mescolano con pomodorini a metà e basilico nelle proporzioni ricetta in un contenitore 1/3, condimento EVOO/sale/pepe, si conservano in frigo crudi (non si cuociono in forno per il prep — la cottura finale è al momento del servizio, non documentata in questa sessione).
5. **Fried Calamari** (3 step, timer 1200s — solo prep) — calamari congelati, **scongela 20 min in acqua fredda** (non nella confezione), pulisci/separa teste (contenitore 1/6 basso) e tubi tagliati a strisce 1cm (contenitore 1/6 profondo). Note di servizio in `procedure`: porzione 100g tubi + 50g teste, farina abbondante (si recupera l'eccesso), frittura 2-3 min, sale, servito con ramekin 2oz Arrabbiata.
6. **Artichoke** (3 step, timer 1800s) — carciofi congelati in confezioni da 20: **scongelano nella confezione chiusa 30 min** (non in acqua), poi si aprono e si dispongono a gruppi di 2 interfogliati con carta forno in contenitore 1/3; cipolle rondelle aperte in contenitore 1/6. Note di servizio in `procedure`: seasoning con Ribeye Salt, griglia 1.5-2 min, forno 2.5 min, 4 anelli cipolla fritti in tempura (tempura già pronta — non rifatta al momento), piatto con Artichoke Sauce + 2 carciofi + 3 anelli + parmigiano + prezzemolo.
7. **Salmon Cakes** (4 step) — processo diverso dall'ipotesi "soffritto in padella": **salmone cotto in forno** condito con EVOO+White Wine, raffreddato, poi mix con **verdure/erbe tritate a crudo** (non soffritte), formate e conservate in contenitore 1/6 a gruppi di 4 con carta forno. Note di servizio in `procedure`: teglia con olio staccante, **forno Rational programma "Salmon Cake" o "Patate Focaccia"**, piattino con insalatina + pomodori bruschetta, salmon cakes rivolte con parte arrostita verso l'alto, Salmon Aioli, zest di limone.
8. **Chicken Parmesan** (2 step, timer 3600s sul riposo) — petto pulito **~240-250g** (non 300g come da ipotesi BOM, lo scarto di pulizia è significativo), cura con **Poultry Salt 8g/kg**, marinato in EVOO min 1 ora, impanatura **pangrattato→uovo→pangrattato** (non uovo→pangrattato semplice), conservato in teglia mezza a 2 fette per strato con carta forno. Note di servizio in `procedure`: frittura 2.5 min in friggitrice, poi Arrabbiata+mozzarella in forno 2.5-3 min, **controllo temperatura interna col termometro prima di mandare**, impiattato su mezza porzione spaghetti Arrabbiata con rucola e fiore.
9. **Amalfi Salmon** (2 step) — solo prep mattina: controllo filetto + cura con Fish Salt, insalata finocchio/arancia/olive/citronette a parte. Note di servizio in `procedure`: **forno Rational programma "Salmon" 7 minuti** (non padella come da ipotesi iniziale — niente sear in padella), burro spray sulla teglia, impiattato su insalata con Salmoriglio abbondante e ciuffi di finocchio fresco.

**Pattern emerso (utile per le prossime stazioni):** il BOM da solo NON è sufficiente a dedurre il procedimento reale — più volte il metodo di cottura ipotizzato (padella, forno generico, acqua bollente) era sbagliato rispetto al metodo reale usato in cucina (programmi specifici del forno Rational, bollitura invece di forno, scongelamento in confezione invece che in acqua). Continuare a proporre come bozza di partenza ma aspettarsi correzioni sostanziali su ogni ricetta, specialmente su: metodo di cottura, temperature/programmi forno Rational, tempi, e step mancanti per scongelamento/prep di materie prime congelate.

**Prossima stazione:** Sauté Station (6 ricette individuate, non ancora iniziata): Asparagus, Artichoke Sauce, Butter Spinach, Risotto Base, SALMORIGLIO, Siciliana. (Lemon Cream esclusa — risulta archiviata/non più in uso, da confermare con Max).

**File modificati:** `js/recipe-modal.js`, `sw.js` (v424→v425). Tutto il resto solo DB (`recipe_steps`, `recipes.procedure`, migration `title_it`/`title_es`).

---

## SESSIONE 30 GIUGNO 2026 (sera) — Aggiornamento completo dei 6 file MD principali (v428, nessun bump frontend)

**Contesto:** sessione dedicata esclusivamente a rileggere e aggiornare BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md, BOH_OS_SPEC.md, BOH_OS_WARNINGS.md, BRIGADE_DB_SCHEMA.md, BRIGADE_VISION.md — erano rimasti disallineati dallo stato reale (alcuni fermi al 26-27 giugno, uno addirittura a uno stack Flutter mai esistito nello schema reale). Nessuna modifica a codice/DB in questa sessione, solo documentazione, verificata punto per punto contro `information_schema.columns`, `list_edge_functions`, `cron.job` live e contro il codice JS reale (non per sentito dire).

**Scoperte importanti emerse durante la verifica (non note prima):**
- 28 Edge Functions attive (non 14 come documentato) — incluse `bot-recipe-guardian` (nuovo bot, 7° del sistema, scansiona ricette vendute con BOM vuoto/parziale/dati mancanti, cron giornaliero 6AM CDT, scrive in office_items), `generate-briefing` (relazione con sc-nightly-brief da chiarire — girano entrambe sullo stesso cron 10:00 UTC), `pos-import`, `translate` (separata da ai-translate), `tripleseat-sync` v24, `sevenshift-sync`/`sevenshift-explore`, `rapid-worker`, `batch-translate-recipes`
- 8 cron job attivi (non documentati prima nella loro interezza): incluso `daily-reset-prep-tasks` (5:00 UTC)
- **50 tabelle hanno RLS disabilitato** — incluso `users` con `password_hash`/`pin` in chiaro, esposte a chiunque abbia la anon key. Segnalato a Max, NON risolto in questa sessione (rischio di bloccare l'app se applicato senza policy pronte) — da affrontare in sessione dedicata futura.
- `recipe_bom.component_type` è `'ITEM'`/`'RECIPE'` maiuscolo — confermato, vari file vecchi dicevano lowercase
- 7shifts: confermato da Max che resta un **workaround parziale** (CSV manuale), non un'integrazione risolta, nonostante `sevenshift-sync`/`sevenshift-explore` esistano — quelle funzioni sono solo script di diagnostica/test API (`whoami` ecc.), non importer automatici

**Correzioni importanti fatte su giudizio esplicito di Max (non solo verifica tecnica):**
- **Warning Center: va ricostruito da zero.** Il codice tecnicamente implementa quasi tutti i codici OQR del registro (verificato nel routing di vendor-documents-review.js), ma Max ha sentenziato che l'esperienza reale non funziona ("fa cagare"). BOH_OS_WARNINGS.md, BOH_OS_BACKLOG.md e BRIGADE_VISION.md sono stati corretti per non dare la falsa impressione che il modulo sia a posto solo perché il codice risponde ai codici. **Prossima sessione su questo: ripartire ascoltando da Max cosa esattamente non funziona, prima di toccare codice.**
- **Ciclo fondamentale di Brigade ridefinito:** non più sera→notte→mattina→sera con la checklist serale come motore della preplist. Il ciclo reale è **notte→mattina**: di notte bot-preplist-builder scarica il venduto POS, calcola current_stock, genera la preplist; la mattina la brigata produce. La checklist serale di chiusura esiste ancora ma è un controllo di verifica separato, non l'input della preplist. BRIGADE_VISION.md aggiornato di conseguenza — segnalata tensione concettuale sulla vecchia voce backlog "collegamento automatico checklist sera → preplist mattina", da chiarire con Max.
- **TripleSeat:** confermato fermo solo per attesa esterna (Authorize OAuth di Monica), non per lavoro mancante su Brigade — codice (tripleseat-sync v24) pronto.
- **TV Display:** confermato fatto e in produzione, non più "da costruire" — resta solo lo slideshow foto come discorso separato.
- **Fase 2 Flutter/BIOS:** confermato che è un'app gemella **in pausa, non abbandonata ma senza sviluppo attivo** — "resta un sogno" per ora, focus totale su Brigade.
- **Tela:** titolo corretto ovunque da "Kitchen Manager" a "Kitchen Operation Coordinator" nei file MD — il codice/DB usa ancora "Manager Station" come nome stazione finché il rename (già in backlog) non viene fatto.

**File modificati:** tutti e 6 i file MD principali, nessun file JS, nessun bump sw.js (nessuna modifica a codice in questa sessione).

**Lezione per sessioni future:** quando si verifica lo stato di un modulo per aggiornare la documentazione, non basta controllare che il codice "risponda" o sia "implementato nel routing" — va sempre chiesto a Max se l'esperienza reale lo soddisfa, prima di marcare qualcosa come ✅ fatto/risolto. La verifica tecnica e il giudizio di qualità sono due cose diverse.

---

## SESSIONE 30 GIUGNO 2026 (sera) — v428→v430 — Fix Edit Ingredient (measure_type / peso a pezzo)

**Contesto di partenza:** sessione dedicata al file Prep_Reference.xlsx (154 prep_tasks, logica POS↔prep, caso Calamari/Cantaloupe/Burrata — porzioni teoriche vs kg materia prima con resa/scarto). Prima di arrivare al file, Max ha segnalato un bug bloccante nell'editor ingredienti scoperto provando a editare "Lobster Tail" (screenshot allegato): il modal "Edit Ingredient" mostrava solo NAME/CATEGORY/BASE UNIT/YIELD%/NOTES — niente modo di impostare il peso del singolo pezzo per ingredienti a conteggio (`measure_type='each'`).

**Bug trovato in `js/ingredients.js` (funzione `openEditIngredient`/`saveEditIngredient`):**
- Le label HTML "AVG UNIT WEIGHT (g)" e "UNIT VOLUME (ml)" esistevano nel modal ma senza i relativi `<input>` — div vuoti, codice abbandonato a metà in una sessione precedente.
- `saveEditIngredient` leggeva `document.getElementById('editIngrWeight')` e `'editIngrVol'`, ID mai esistiti nell'HTML → sempre `NaN`.
- L'oggetto `updates` inviato al DB non includeva comunque `avg_unit_weight_g` — anche con gli input presenti, non si sarebbe salvato nulla.
- Verificato che `unit_volume_ml` **non esiste** come colonna in `ingredients` (confermato via `information_schema.columns`) — il campo "UNIT VOLUME" era morto due volte. Rimosso dal modal.

**Discussione concettuale con Max (voce, prima di scrivere codice):**
- Max ha chiarito che il peso del pezzo va scritto nell'unità che preferisce lui in quel momento (es. once, perché le code di lobster cambiano calibro) — non vuole convertire a mano in grammi. Il software deve convertire da solo.
- Max ha chiarito anche il flusso a 3 livelli che vuole arrivare a costruire (NON tutto fatto in questa sessione, solo l'ingrediente): 1) sull'ingrediente si fissa una volta "1 pezzo = X once/grammi", 2) nel BOM della ricetta si scrive "1 each" (non i grammi), 3) il prep_task/bot deve restituire un numero di pezzi interi ("scongela 2 code"), non grammi o porzioni teoriche. Verificato sul DB che oggi il BOM di "Lobster Fettucine" è già scritto come "4.5 oz" (probabilmente già corretto come quantità ma nella forma sbagliata, non "1 each") e che `prep_tasks` non ha alcun meccanismo di arrotondamento a pezzi interi. **Esplicitamente rimandato a sessione futura dedicata** — Max ha chiesto di non mescolare questo con il fix dell'editor.
- Punto importante chiarito con Max: lui voleva piena autonomia per modificare questi valori da solo in app, senza doverli dettare a voce in chat — il modal doveva essere completo e funzionante prima di chiudere la sessione su questo tema.
- Verificato (su richiesta indiretta di Max, dubbio su Frugé $27.50) che `ingredient_vendors.unit_price` per Lobster Tail è correttamente $27.50/lb (`price_type: per_lb`, `price_per_100g` calcolato giusto) — il dato DB era corretto, era solo il mockup di Claude ad aver presentato il prezzo in modo ambiguo (sembrava un totale invece che un prezzo unitario). Nessun fix DB necessario qui, solo attenzione alla presentazione nel modal.

**Fix implementato e pushato (`js/ingredients.js`, due push):**
1. Aggiunto campo "PESO DI UN PEZZO" funzionante: input numerico + selettore unità (oz/g/lb, default oz), mostra sempre il valore già salvato convertito nelle tre unità per riferimento. Se il campo viene lasciato vuoto al salvataggio, il valore esistente NON viene toccato (niente azzeramenti accidentali). Conversione riusa la costante esistente `UNIT_CONVERSIONS` già presente nel file (lb:453.592, oz:28.3495) invece di duplicarla.
2. Rimosso "BASE UNIT" dal modal (su richiesta esplicita di Max — "fai sparire quella cosa che non capisco") — il campo resta nel DB invariato, semplicemente non è più editabile/visibile da questo editor.
3. Aggiunto "MEASURE TYPE" (each/weight) al posto di BASE UNIT — è il campo che decide se l'ingrediente si conta a pezzo o a peso.
4. Aggiunto riquadro "VENDOR / PACK" in sola lettura (vendor, pack_description, prezzo per unità d'acquisto) per dare contesto senza permettere modifica da qui (i prezzi fornitore restano editabili solo dalla riga vendor dedicata).
5. **Bug trovato DOPO il primo push** (segnalato da Max): la lista ingredienti e la scheda dettaglio continuavano a mostrare "g" anche per Lobster Tail dopo il salvataggio corretto (verificato su DB: salvataggio era OK, `measure_type='each'`, `avg_unit_weight_g=127.57`). Causa: la UI di lista/dettaglio leggeva solo `base_unit` (che non viene più toccato, resta sempre "g") e ignorava `measure_type`. Fix: lista ora mostra "each" se `measure_type==='each'` altrimenti `base_unit`; scheda dettaglio mostra "each · [peso]g/pz" invece di "g · each" ridondante. Aggiunta `avg_unit_weight_g` alla query SELECT della scheda dettaglio (mancava, quindi non sarebbe mai apparso anche col fix di visualizzazione).

**Stato finale verificato su DB:** Lobster Tail → `measure_type: "each"`, `avg_unit_weight_g: 127.57` (= 4.5oz), `yield_factor: 1.0` (non toccato in questa sessione).

**Versioni:** v428 → v429 (fix editor) → v430 (fix visualizzazione lista/dettaglio). File modificato: solo `js/ingredients.js` + `sw.js`. Nessuna migration DB necessaria — tutte le colonne usate (`measure_type`, `avg_unit_weight_g`, `yield_factor`) esistevano già nello schema.

**Aperto per sessione futura dedicata (NON iniziare senza che Max lo chieda esplicitamente):**
- BOM delle ricette scritto in "each" invece che in once/grammi per ingredienti a conteggio (caso pilota: Lobster Tail su "Lobster Fettucine", oggi "4.5 oz" invece di "1 each").
- `prep_tasks` deve poter arrotondare a pezzi interi quando l'ingrediente collegato è `measure_type='each'` (oggi non esiste questo meccanismo — il bot/prep ragiona sempre in grammi o porzioni teoriche, mai in "code", "uova", ecc.).
- Stesso filo logico delle prep Calamari/Cantaloupe/Burrata discusse a inizio sessione (porzioni teoriche vs kg materia prima con resa/scarto) — sono la stessa famiglia di problema, da affrontare insieme quando Max avrà tempo di andarci con calma.

**Nota:** sessione svolta in parallelo con un'altra sessione di Max sul Kitchen Display/gestione foto — verificato live sw.js prima di ogni push (mai conflitti in questa sessione, nessuna sovrapposizione di file toccati).



---

## SESSIONE 30 GIUGNO 2026 (tarda sera) — Tentativo sync foto iCloud per Kitchen Display — ABBANDONATO su richiesta Max

**Contesto:** Max voleva mostrare le foto dei piatti su Kitchen Display (`display.html`), prendendole da un Album Condiviso iCloud (per non dover caricare foto manualmente). Esplorato in dettaglio.

**Cosa è stato provato:**
- Max ha creato un album condiviso e mandato il link nuovo formato Apple (giugno 2026): `https://photos.icloud.com/shared/album/<TOKEN>` — diverso dal vecchio formato `icloud.com/sharedalbum/#TOKEN` usato da tutte le librerie/script community esistenti.
- Creata tabella `kitchen_display_photos` (poi droppata) e Edge Function `icloud-photos-sync` (deployata, v1, mai schedulata su cron) che tentava di chiamare il vecchio endpoint reverse-engineered `p23-sharedstreams.icloud.com/<TOKEN>/sharedstreams/webstream`.
- **Test reale via `net.http_post` + log su `net._http_response`: risposta HTTP 404.** Confermato che il nuovo formato di link (`photos.icloud.com/shared/album/...`, introdotto nel redesign Apple di giugno 2026 per supporto Android/Windows — vedi MacRumors 8 giugno 2026) **non è compatibile con il vecchio endpoint `sharedstreams.icloud.com`**. Nessuna documentazione community trovata per il nuovo endpoint (troppo recente).
- Tentato di individuare il nuovo endpoint ispezionando il bundle JS della pagina via web_fetch — non praticabile (SPA, JS non eseguito da web_fetch, solo HTML/markdown estratto).
- Proposto a Max di usare Safari Web Inspector (da Mac, via cavo USB con iPhone) per intercettare la chiamata di rete reale e scoprire l'endpoint — Max non ha un Mac comodo a disposizione, non perseguito.

**Decisione di Max: ABBANDONATO il discorso iCloud per ora.** Non vuole occupare storage Supabase (avrebbe richiesto il piano B con upload manuale + Supabase Storage bucket, scartato per lo stesso motivo — voleva la foto "gratis" via iCloud, non un upload che consuma storage Supabase).

**Cleanup eseguito:**
- Tabella `kitchen_display_photos` → **droppata** (`DROP TABLE`)
- Edge Function `icloud-photos-sync` → resta deployata su Supabase ma **inerte**: nessun cron job creato, nessuna chiamata da `display.html` o altri file, non consuma risorse né causa effetti. Non rimossa solo perché lo strumento disponibile non permette delete di Edge Function, ma è sicura da ignorare. **Se in futuro si riprende questo discorso, ripartire da qui — non ricreare da zero.**
- **`display.html` non è stato toccato in nessun modo** — nessuna modifica, nessun bump sw.js. Resta identico a prima di questa sessione (slideshow foto NON presente, come da richiesta esplicita di Max: "non mettere niente, lascia tutto com'era prima").

**Se si riprende in futuro:** prossimo passo naturale sarebbe verificare l'endpoint reale del nuovo formato `photos.icloud.com/shared/album` via Safari Web Inspector (richiede Mac + cavo USB con iPhone, vedi istruzioni date a Max in questa sessione) prima di scrivere altro codice. In alternativa, riconsiderare il piano B (upload manuale + Supabase Storage) se Max cambia idea sul tema storage.

**File modificati:** nessuno. Solo Edge Function deployata (inerte) + tabella creata e poi droppata.

---

## SESSIONE 30 Giugno 2026 — Inventario completo prep_tasks

**Cosa è stato fatto:**
- Inventario fisico completo di tutte le stazioni — fogli compilati a mano da Max e fotografati
- `current_stock` aggiornato su ~90 prep_tasks da zero (era tutto NULL tranne pochi test)
- Unità corrette su vari item (vedi sotto)
- 2 nuovi prep_tasks creati: `Shrimp` (Pasta Station, g) e `Lamb` (Table Side, pezzi)
- Lista stampabile inventario generata come HTML (pagina bianca, scritte nere, divisa per stazione)

**Correzioni unità applicate:**
- Chicken Parmesan: `g` → `pezzi` (16 pz)
- Brownies: `pezzi` → `g` (568g)
- Mint bavarese: `g` → `pezzi` (60 pz)
- Grilled Chicken: `kg` → `g` (4838g)
- Ranch: `kg` → `g` (5398g)
- Honey: `squeezer` → `g` (398g)
- Cantaloupe: `porzioni` → `g` (1308g)
- Pancetta: `porzioni` → `g` (1307g)
- Gnocchi: `porzioni` → `g` (3982g)
- Tempura: `batch` → stock in g (695g) — unità ancora `batch`, da allineare
- Artichoke: rimane `pezzi` (29 pz) — 2 pz per porzione, conversione da fare nel bot

**Item trovati nel DB ma mancanti dal foglio stampato (prep_type = NULL):**
- Fettuccine (id 313): `nests`, recipe_id presente MA punta a `SPAGHETTI FRESH PASTA` — ERRORE
- Spaghetti (id 314): `nests`, stessa recipe_id di Fettuccine — probabile errore di collegamento
- Gnocchi (id 388): nessuna recipe collegata
- Tutti e tre con `prep_type = NULL` → bot li ignora, non apparivano sul foglio stampato

**DA FARE — PROSSIMA SESSIONE (priorità):**
1. Verificare e correggere recipe_id di Fettuccine (id 313) — trovare `FETTUCCINE FRESH PASTA` nel DB e collegare
2. Verificare recipe_id Spaghetti (id 314) — stesso problema
3. Impostare `prep_type = 'supporto'` su Fettuccine, Spaghetti, Gnocchi
4. Lasagne: struttura da definire (monoporzione vs teglia 6 porzioni) — SKIP per ora
5. Parm chunk: da classificare (grated o shaved) — SKIP per ora, non inserito nel DB
6. Lista stampabile: correggere filtro per includere item con `prep_type = NULL`
7. Correggere unità Tempura da `batch` a `g`
8. Discutere logica bot per Artichoke (pezzi vs porzioni, 2 pz = 1 porzione)

**Note operative:**
- Item barrati in verde sul foglio (Cook Focaccia, Lemon cream, Lemon sliced, Risotto Base, Season Focaccia) = non disponibili oggi, current_stock lasciato NULL — non eliminare dal DB
- Spinach (Manager Station) barrato = lasciato NULL
- Plating Station (Lemon Zest, Orange supreme) = non contati, NULL
- Max: "tutto in grammi, mai in chili tranne se è 1 punto qualcosa"

---

## SESSIONE 30 GIUGNO 2026 (sera) — Inventario reale + allineamento unità + ricette Saucier Station

**Versione:** v430 (nessun bump frontend — solo DB)
**Contesto:** prima sessione con inventario fisico reale inserito. Obiettivo: allineare unità di misura dei prep_tasks con quello che il cuoco vede fisicamente, e pulire i suggerimenti fittizi del bot.

---

### Principio fondamentale stabilito da Max (OQR Philosophy)

> "L'unità di inventario deve essere quello che il cuoco vede e conta fisicamente nel frigo/in cucina."

- **Grammi** → tutto quello che si pesa sulla bilancia
- **Pezzi** → tutto quello che si conta (salmon cakes, chicken parm, artichoke, lobster...)
- **Cup/porzioni** → solo quando il cuoco vede fisicamente quella unità (es. spinaci in cup da 80g)
- **Buste** → solo per item confezionati contabili (es. Soffritto Livornese)
- MAI "porzioni" come unità astratta — non è qualcosa che si pesa o conta fisicamente

**Il modello a 3 livelli definito con Max:**
1. **INVENTARIO** → grammi o pezzi (quello che il cuoco misura/conta)
2. **BOT NOTTURNO** → legge grammi/pezzi, calcola fabbisogno, dice **quanti batch fare** in linguaggio cucina (es. "2 latte di pelati", "3 batch interi") — sempre arrotondato **su**, mai frazioni
3. **PREP CARD** → il cuoco vede batch da fare, li fa, conferma i batch completati

---

### Operazioni DB eseguite

**1. Azzeramento suggerimenti bot fittizi**
- `suggested_qty`, `suggested_note`, `suggested_at`, `suggested_by` → NULL su tutti i 91 prep_tasks con suggerimenti
- `current_stock` intatto — è l'inventario reale inserito oggi
- Stanotte il bot ricalcola tutto da zero partendo dallo stock reale

**2. Oven Station — unità corrette**

| Item | Da | A | Note |
|---|---|---|---|
| Brussels sprouts | porzioni | g | già grammi nel current_stock |
| Calamari | porzioni | g | già grammi nel current_stock |
| Onion rings | porzioni | g | già grammi nel current_stock |
| Rosmary potatoes | porzioni | g | già grammi nel current_stock |
| Tempura | batch | checklist | prep_type=checklist, daily_reset=true, current_stock=NULL — si fa ogni mattina, si butta la sera |

**Decisioni Oven Station (da Max):**
- Artichoke → pezzi ✅ — ricetta scarica anche Artichoke Sauce (g)
- Brussels sprouts → g, no batch fisso (si può fare liberamente)
- Calamari → g — ricetta scarica anche Arrabbiata (g)
- Chicken Parmesan → pezzi ✅ — ricetta scarica: Arrabbiata + Mozzarella + 1 nest Spaghetti + Arrabbiata per spaghetti
- Pull Salmon filets → pezzi ✅ (annotato: appartiene a Oven Station, confermato)
- Tempura → checklist giornaliera automatica, niente stock

**3. Pasta Station**
- Diced butter → `porzioni` → `g` (current_stock 2238 era già grammi) ✅

**4. Saucier Station**
- Soffritto Livornese → `buste` ✅ (current_stock 2 buste confermato)

**5. Texana Soup — ricetta completa inserita**
- Ricetta esisteva nel DB vuota (solo pos_name). Completata:
  - `base_servings=9`, `base_weight_g=2520`, `serving_weight_g=280`, `menu_group=Soups`, `category=ZUPPE`, `shelf_life_days=5`, `prep_time_minutes=40`
  - Nuovo ingrediente creato: **Chicken Broth** (id `cb07f823-1661-4c60-8305-030cd649c98e`, categoria Prepared, fatto in casa)
  - BOM: Bacon 454g, Pork Sausage 454g, Chicken Broth 1200g, Heavy Cream 960g, Potatoes 680g, Gold Onion 150g, Garlic 10g, Spinach 250g
  - 6 recipe_steps IT/EN/ES con timer: Cuoci bacon/salsiccia (5min) → Prepara patate → Bolli in brodo (10min) → Soffriggi cipolla/aglio (7min) → Unisci e finisci (13min) → Porziona in buste 200g solidi + 80g liquido
  - Porzione = 280g (200g solidi + 80g liquido) — in buste

**6. Thyme Butter — base_weight_g corretto**
- Era `450000g` (errore inserimento). Corretto:
  - `base_servings=24`, `base_weight_g=484` (1 lb burro + 30g timo), `serving_weight_g=20`, `shelf_life_days=30`

**7. Brisket — ricetta dedicata creata**
- Creata ricetta "Brisket" (id `90e0ec76-f2c4-4fa8-ad85-d30bdd86f395`)
  - `base_servings=1`, `base_weight_g=2000`, `category=SECONDI|supporto`, `menu_group=Bases`, `shelf_life_days=5`
- prep_task Brisket (id 285) collegato alla nuova ricetta (era collegato a Beef Ravioli — sbagliato)
- BOM e steps da aggiungere in sessione futura quando Max ha la ricetta completa

**8. Truffle Butter — base_weight_g impostato**
- `base_weight_g=20`, `serving_weight_g=20` (20g per porzione di Truffle Fettuccine)
- Il bot ora scarica 20g per ogni Truffle Fettuccine venduta

---

### Priorità prossima sessione su questo tema

1. **Salad Station** — unità da verificare e correggere (molti item con "porzioni" o unità astratte)
2. **Pastry Station** — stessa cosa
3. **Sauté Station** — unità + ricette steps mancanti
4. **Manager Station** — Confit tomatoes (ricetta mancante), Flowers (BOM), Spinach (cup vs g)
5. **Spinaci** — chiarire unità: Max ha confermato che gli spinaci vanno a **cup** (ogni cup = 80g, dalla ricetta Butter Spinach). Il bot deve sapere che 1 cup = 80g e ragionare in cup nell'inventario
6. **Bot logic** — una volta che tutte le unità sono allineate, riscrivere la logica di conversione grammi→batch nel bot-preplist-builder (priorità già in backlog)
7. **Brisket** — BOM e recipe_steps da completare
8. **Fresh Pasta Station** — Grated Pecorino e Parmesan Grated hanno unità g ma il bot ragiona in batch astratti (no ricetta collegata)

---

### Note operative importanti
- Il bot gira stanotte alle 4AM CDT — primo calcolo su dati reali
- Tutti i current_stock inseriti oggi (30/06) sono dati reali, primo inventario fisico completo
- Dati pre-30/06 erano test/fittizi — ora tutto è reale
- sw.js NON bumpato in questa sessione (nessuna modifica a file frontend)


---

## SESSIONE 30 GIUGNO 2026 (tarda sera) — Fresh Pasta Station + Bot v20 + Arrabbiata ricalcolata

**Versione:** v430 frontend (nessun bump — solo DB + Edge Function)
**Bot:** bot-preplist-builder v20 (Supabase version 39)

---

### Fresh Pasta Station — completata ✅

**Fettuccine (prep_task id 313):**
- Collegato a `FETTUCCINE FRESH PASTA` (era erroneamente collegato a SPAGHETTI FRESH PASTA)
- `base_weight_g = 3500`, `base_servings = 25`, `serving_qty = 2`, `serving_unit = nests`
- `prep_type = supporto` impostato
- Spolvero (Semolina 500g, bom_id 1525) rimosso dal BOM

**Spaghetti (prep_task id 314):**
- Già collegato a `SPAGHETTI FRESH PASTA` ✅
- `base_weight_g = 3500`, `base_servings = 20`, `serving_qty = 2`, `serving_unit = nests`
- `prep_type = supporto` impostato
- Spolvero (Semolina 500g, bom_id 1720) rimosso dal BOM
- BOM pulito: Liquid Egg 1kg + Semolina 2.3kg + Caputo Flour 200g

**Gnocchi (prep_task id 388):**
- Collegato a `GNOCCHI` (id `c3836a65-d74d-47ac-8944-ad439f76200f`)
- `base_weight_g = 2000`, `base_servings = 10`, `serving_weight_g = 200`, `shelf_life_days = 30` (congelati)
- `pos_name = 'Shrimp Gnocchi|Gnocchi'` — scarica sia da piatto che da modifier
- `prep_type = supporto`, `unit = g`
- Spolvero (Flour 200g + Semolina 100g, bom_id 1728/1729) rimosso dal BOM
- BOM pulito: Water 1200g + Gnocchi Flour 800g + Nutmeg 4g

**Grated Pecorino (prep_task id 438):**
- Nuova ricetta creata: `Grated Pecorino` (id `27213a2e-e8fd-4100-9fb8-4ebf57cfab1e`)
- `base_weight_g = 7000`, `base_servings = 1`, `shelf_life_days = 7`
- Prep_task collegato ✅

**Parmesan Grated (prep_task id 439):**
- Nuova ricetta creata: `Parmesan Grated` (id `6357c9f1-f944-4153-8d7f-afb11336d91a`)
- `base_weight_g = 7000`, `base_servings = 1`, `shelf_life_days = 7`
- Prep_task collegato ✅

**Regola confermata da Max:** entrambi i formaggi si grattano in batch da 7kg per volta.

---

### Arrabbiata — ricalcolata su latta #10 Global Gourmet

- Fornitore vecchio: latte da 2550g → **nuovo: latte #10 da 2950g** (Global Gourmet Foods "La Carmela")
- Batch ricalcolato su **1 latta #10** (unità minima):
  - `base_weight_g = 3185`, `base_servings = 12`, `serving_weight_g = 265`
  - BOM aggiornato: Canned Tomatoes 2950g, Garlic 52g, EVOO 145g, Red Flakes 1g, Parsley 58g, Salt 38g, Sugar 12g, Water 1156g
- Vendor Global Gourmet inserito per Canned Tomatoes: `pack_description = '6/#10 cans "La Carmela"'`, `conversion_to_base = 17700`, `unit_price = 35.00`

**Fattura Global Gourmet Foods letta (invoice #20404, 5/26/2026, $1,859.07):**
Contiene anche: EVOO 3/5lt "Oleoestepa", Pecorino Toscano Fresco DOP, Pecorino Romano "Monti Trentini", Carnaroli Rice, Bresaola, Prosciutto Italiano, Sea Salt Coarse/Fine, Gnocchi C-Catering "Molino Pasini", GF Veal Rib Chops. Parser Global Gourmet ancora da costruire (vedi BOH_OS_BACKLOG.md).

---

### Bot-preplist-builder v20 — nuova logica linguaggio cucina

**Deployato come Supabase version 39.**

**Novità rispetto a v19b:**

1. **Linguaggio cucina reale per tipo:**
   - `unit = pezzi/pz/buste` → conta fisica (es. "22 pezzi", "3 buste")
   - `serving_unit = nests` → pasta fresca in nests (es. "50 nests"), arrotondato a batch interi
   - Salse con `pack_description` su vendor → usa il pack (es. "3 × 6/#10 cans La Carmela")
   - Tutto il resto → kg/g arrotondati a batch interi

2. **Guard anomalie:** salta task con `base_weight_g > 500000` (placeholder mostruosi) invece di produrre numeri assurdi. Logga `[SKIP-ANOMALY]` per debug.

3. **Carica vincoli acquisto:** per ogni ricetta legge il `pack_description` del primo ingrediente con vendor attivo — usato nel testo suggerimento.

4. **Arrotondamento sempre su** a batch interi (invariato da v19b).

**Fix dati anomali eseguiti contestualmente:**
- Brussels sprouts: `base_weight_g = 1500000` → corretto a `1500` (10 porzioni × 150g)
- Croutons: `base_weight_g = 15` (placeholder) → impostato a NULL (bot skippa, da correggere con valore reale)

---

### DA FARE — priorità prossima sessione

1. **Croutons** — `base_weight_g` da inserire (quanto pesa un batch reale di croutons?)
2. **Salad Station + Pastry Station** — unità da verificare (molti item ancora in "porzioni")
3. **Sauté Station** — unità + ricette steps mancanti
4. **Cacio e pepe sauce** — Milk non ha vendor/pack nel DB (1 gallone = 3785g) — da inserire
5. **EVOO** — nessun vendor nel DB (Global Gourmet: 3/5lt per case = 15lt = ~13800g) — da inserire
6. **Pomodoro sauce** — ingrediente driver è Onions (sbagliato per vincolo acquisto) — il vero driver è Canned Tomatoes, stessa latta dell'Arrabbiata — da correggere BOM sort_order
7. **Ground Beef** — pack aggiornato a 10lb = 4536g ✅ ma Ragu ha `base_weight_g = 13700` → bot dirà "fai 13.7kg" — verificare con Max se il testo ha senso o serve pack_description HEB
8. **Verifica bot domani mattina** — controllare log in L'Ufficio dopo run 4AM CDT, verificare che i testi siano leggibili dai cuochi

---

### Note tecniche
- sw.js NON bumpato (nessuna modifica frontend)
- Tutti i dati sono reali da oggi 30/06 — primo inventario fisico completo
- bot-preplist-builder gira alle 4AM CDT ogni notte (cron `0 9 * * *` UTC)


---

## SESSIONE 1 LUGLIO 2026 (mattina) — Bot v21 + audit + fix shelf life + Pears

**Versione:** v430 frontend (nessun bump)
**Bot:** bot-preplist-builder v21 (Supabase version 40)

---

### Bot v21 — fix fallback unità

Problema identificato in v20: item con `unit='g'` senza ricetta collegata mostravano "porz" nel testo invece di kg/g.

**Fix in v21:**
- Nuovo blocco in `smartQty`: se `unit='g'` e nessun `base_weight_g` → mostra direttamente in kg/g via `fmtGrams()`
- Fallback finale ora mostra `numero + unità raw` invece di "porz"
- Aggiunta `SKIP_PACK` set: ricette dove il primo ingrediente BOM non è il driver acquisto rilevante (Bechamel, Thyme Butter, Texana Soup, Rosemary Oil, Citronette, Salmoriglio, Mash Potato, Garlic Oil) → non usa pack_description per queste

**Risultati post-v21:**
- Calamari → "2.2kg" ✅
- Brussels sprouts → "4.5kg" ✅  
- Croutons → "789g" ✅
- Texana Soup → "fai 5kg" ✅
- Siciliana cartoccio → "fai 4 cartocci" ✅

**Fix dati contestuali:**
- `Spring mix` → unit cambiata da 'porzioni' a 'buste' (il cuoco conta le buste)
- `Confit tomatoes` → current_stock = NULL (stock 0 senza ricetta → bot skippa)

---

### Audit bot v21 — risultati 1 luglio

**🔴 Prepara oggi:**
- Chicken Parmesan: 9 in casa → fai 16 pezzi (Mer5+Gio6+Ven11.7=22.7 × 1.1 = 25, mancano 16) ✅ corretto
- Thaw Lobster: 0 in casa → fai 15 pezzi (dopo fix shelf_life=2gg: Mer6.7+Gio8.3=15) ✅
- Cheesecake: 0 in casa → fai 72 pezzi (7gg × vendite = 3 batch da 24) ✅
- Creme Brulee: 0 in casa → fai 48 pezzi (6gg × vendite = 3 batch da 16) ✅
- Pears: 2 in casa → fai 16 pezzi ✅
- Thyme Butter: 0 → fai 484g ✅

**🟡 Domani:**
- Texana Soup: 3.7kg → fai 5kg
- Siciliana cartoccio: 8 cartocci → fai 4 cartocci
- Garlic oil: 600g → stock basso

**🟢 OK:** 86 task restanti tutti in kg/g/pezzi leggibili

---

### Shelf life aggiornate

| Ricetta | Shelf life | Note |
|---|---|---|
| Lobster Fettucine | 2 gg | scongelata, deperibile rapido |
| Cheesecake | 7 gg | si fa una volta a settimana |
| Crème Brûlée | 6 gg | — |
| Pear & Pecorino Salad | 3 gg | — |

---

### Pears — logica corretta

- 1 pera = 4 porzioni di Pear & Pecorino Salad
- Aggiornato: `base_servings=4`, `serving_qty=1`, `serving_unit='pezzi'`
- `pos_name` corretto da 'Pere E Pecorino Salad' → 'Pear & Pecorino Salad' (allineato al POS)
- Il bot ora calcola: 1 salata venduta = 0.25 pere consumate

---

### DA FARE — priorità prossima sessione

1. **Salad Station** — molti item ancora in unità astratte (porzioni, wedge, 9pan) — completare allineamento
2. **Pastry Station** — Chopped dark/white choc, Mint liquid, Cocoa powder, Powder sugar → stock 1g = placeholder, da azzerare o misurare reali
3. **Cacio e pepe sauce** — Milk senza vendor/pack (1 gallone = 3785g) — da inserire
4. **EVOO** — nessun vendor (Global Gourmet: 3/5lt per case) — da inserire  
5. **Pomodoro sauce** — ingrediente driver è Onions (sbagliato), il vero driver è Canned Tomatoes — correggere sort_order BOM
6. **Chicken Parmesan shelf_life** — non impostato, usa default 3gg — verificare con Max
7. **Croutons** — base_weight_g ancora NULL (bot skippa) — chiedere a Max peso batch reale
8. **Brisket** — BOM e recipe_steps da completare
9. **Verifica vendite Pear & Pecorino** — pos_name era sbagliato, potrebbero esserci 0 dati storici — verificare dopo prossimo run bot

