# PROMPT PROSSIMA SESSIONE — Brigade

## CARICA SUBITO
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Repo **`1cos/back-of-house`**, branch `brigade-main` SEMPRE — **NON usare `1cos/brigade-dev`** (fermo a v375, abbandonato)
3. Leggi i file da GitHub LIVE, mai da memoria, mai da `/mnt/project/`
4. Supabase project: ydqmumpytgrlceuinoqt

## ⚠️ ATTENZIONE — SESSIONI PARALLELE
Max lavora in più chat contemporanee. PRIMA di bumpare sw.js:
- Leggi live `boh-v???` da sw.js su `1cos/back-of-house`
- Verifica gli ultimi commit su `brigade-main` (`/commits?sha=brigade-main`)
- Incrementa SOLO di +1 rispetto alla versione live (non da memoria)

## ⚠️ REGOLA D'ORO
- Per Max si chiamano SEMPRE "ingredienti", MAI "BOM/JSON". Max è un cuoco.
- NON chiedere mai a Max di ricreare gli ingredienti — LI HA GIÀ. Leggi il DB prima.
- MAI assumere — confermare SEMPRE prima di scrivere codice

## 🟢 APP IN PRODUZIONE
**Brigade è live. I ragazzi stanno usando l'app.** Ogni modifica al codice deve essere
chirurgica — zero rischi di rompere funzionalità esistenti. Testare prima di pushare.

---

## STATO TECNICO (aggiornato 2026-06-27)
- Frontend: **v331** (sw.js boh-v331) — repo: `1cos/back-of-house`, branch `brigade-main`
- **App live** — `https://1cos.github.io/back-of-house/`
- **`1cos/brigade-dev` — ABBANDONATO, non usare più**

---

## Sessione 2026-06-27 — Prep List intelligente + fix vari (v327→v331)

### Fix completati

**v328 — Bot preplist v15 + fix prep card display**
- `bot-preplist-builder` deployato come v33 su Supabase (codice v15)
- Quando ricetta ha `base_servings` presente → calcola in **porzioni** (non grammi)
- Finestra dinamica da `expected_duration_days` della prep task (non hardcoded)
- Divide settimana lun-sab in finestre consecutive di N giorni (no domenica)
- Es. freq=3 → [Lun,Mar,Mer] [Gio,Ven,Sab]
- Nota formato: `"Mon→Wed usually 8 portions sold → prep 10 portions"`
- `prep.js`: badge 🤖 ora mostra `suggested_note` direttamente se contiene "portions sold"
  invece di dividere per 1000 (bug che mostrava "0.001 kg")
- Artichoke prep task: `recipe_id` collegato manualmente, `suggested_note` aggiornata nel DB

**v329 — Fix save ricette silenzioso (BUG CRITICO)**
- `recipes.js`: `ingredients` era nel payload `newRec` ma la colonna non esiste in `recipes`
- PostgREST silenziosamente ignorava l'intero update senza errore
- Fix: rimosso `ingredients` dal payload, aggiunto `{ error: updErr }` check con throw
- Ora ogni salvataggio ricetta funziona correttamente

**v330 — Fix "Good Night" modal appare ad ogni save ricetta**
- `init.js`: `checkOperationNotePrompt()` veniva chiamata ad ogni `init()` (anche dopo save ricette)
- Fix: flag `window._opNoteScheduled = true` — chiamata solo una volta per sessione
- `operation-notes.js`: logica oraria più robusta — finestra corretta 22:30-03:00 CDT

**v331 — Fix recipe detail sheet non si aggiornava dopo save**
- `recipes.js`: dopo save, la detail sheet rimaneva aperta con BOM vecchi (cache)
- Fix: aggiunto `id='_recipeDetailSheet'` alla sheet, dopo save la richiude e riapre con dati freschi da `SHOP_RECIPES`

### DB cleanup
- Ingrediente `Fettuccine` (secca) → sostituito con sub-recipe `FETTUCCINE FRESH PASTA` in 3 BOM, poi cancellato
- Ingrediente `Spaghetti` (secco) → sostituito con sub-recipe `SPAGHETTI FRESH PASTA` in 6 BOM, poi cancellato
- BOM unità aggiornate: tutte le fresh pasta ora `1 each` (porzione intera) o `0.5 each` (half)
- Fettuccine Arrabbiata Half → 0.5 each ✅
- La N.4 Half → 0.5 each ✅
- Spaghetti al Pomodoro Half → 0.5 each ✅
- SPAGHETTI MARCELLO → 10 each (base_servings=10) ✅
- Artichoke `recipe_id` collegato alla prep task (era NULL) ✅
- BOM Artichoke verificati: tutti 6 ingredienti matchano per item_id ✅

---

## 🔴 PRIORITÀ SESSIONE PROSSIMA — PREP CARD REDESIGN

### Contesto
La prep card di Artichoke funziona (bot v15 scrive la nota giusta nel DB) ma la UX
non è ancora quella definitiva. Max vuole:

### 1. Smart scale sulla recipe sheet (BUG APERTO)
Nella recipe detail sheet, tab "Smart" dovrebbe scalare tutti gli ingredienti
×N dove N = porzioni suggerite per oggi (dal bot).
- Oggi Artichoke: `suggested_qty = 18` porzioni → Smart deve moltiplicare tutto ×18
- Artichokes: 2 each × 18 = 36 each
- Red Onions: 30g × 18 = 540g
- ecc.
- **Attualmente**: Smart non cambia nulla (bug — non legge suggested_qty)
- File: `js/recipes.js` funzione `showRecipeSheet()` — blocco scale Smart

### 2. Testo "PREP TODAY 7 portions" — rendere leggibile la motivazione
Nella detail sheet, il box verde "PREP TODAY" mostra "last Fri+Sat you sold 11 — stay ready."
ma è troppo piccolo (font-size ~10px). Portare a 13px almeno.
- File: `js/recipes.js` funzione `loadRecipePrepStats()` — cerca il testo "stay ready"

### 3. Formato prep card nella Prep List (NUOVO)
Attualmente il badge verde mostra: `🤖 Thu→Sat usually 16 portions sold → prep 18 portions`
Max vuole un formato più operativo e diretto per il cuoco sulla prep card:
```
Prepara lunedì → 10 porzioni  (20 carciofi)
Prepara giovedì → 18 porzioni (36 carciofi)
```
Cioè: giorno di prep + porzioni da fare + traduzione in unità fisiche (es. N carciofi)
Questo richiede:
- Sapere quale giorno inizia ogni finestra (Lun per finestra 1, Gio per finestra 2)
- Moltiplicare per `base_servings` e unità principale del BOM
- Mostrare nella prep card (NON nella recipe sheet)
- File: `js/prep.js` — blocco badge 🤖 (riga ~204)
- File: `bot-preplist-builder` (Edge Function) — aggiornare `suggested_note` con nuovo formato

### 4. Done button → inventario prep (PROGETTO NUOVO — 3 sessioni)
Quando il cuoco preme "Done" sulla prep task, invece di segnare subito come fatto:
- Appare bottom sheet: "Hai preparato la dose consigliata?"
- Pillola YES → salva `suggested_qty` in `prep_log` come `qty`
- Pillola NO / ALTRO → input numerico → salva quantità reale
- Questo crea un **carico inventario prep** reale nel DB
- Il POS fa lo scarico (vendite → consumo ricetta via BOM)
- Risultato: inventario prep live senza conteggio manuale
- File: `js/prep.js` funzione `startDonePress()` / `openDoneSheet()`
- DB: `prep_log` (già esiste) — aggiungere colonna `is_suggested_qty boolean` se non esiste

---

## 🔴 PRIORITÀ #1 — ai_options come azioni eseguibili in L'Ufficio
Le ai_options sono ora stringhe — quando Max le preme, archiviano ma NON eseguono nel DB.
Visione: opzioni strutturate `{label, action, params}` che chiamano `officeExecuteOption()`.

## 🔴 PRIORITÀ #2 — Autocomplete ricette nel Calendar editor (BUG APERTO)
`<datalist>` nativo HTML non funziona su iOS nel modale editor eventi.
Soluzione: sheet separato fullscreen di ricerca ricette.

## 🔴 PRIORITÀ #3 — Home dedicata Dish Crew (Fase 2)
Detect: `user.default_station === 'Dish Crew'`
Nascondere: Recipes, Closing, Sales, Ingredienti, Focus Mode, Operation Notes
Bottom bar: Home / Chat / Schedule / Tell Chef

## 🔴 PRIORITÀ #4 — Cleaning Checklist (nuovo modulo)
Flusso serale: Closing Prep → Operation Note → Cleaning Checklist → Chiudi Shift → notifica Max+David
DB: nuove tabelle `cleaning_tasks` e `cleaning_log` (non ancora create)

## 🔴 PRIORITÀ #5 — souschef-scan
Manda 400+ ingredienti a OpenRouter → timeout 500 ogni ora
Fix: riscrivere con SQL diretto (GHOST e NOLINK si trovano con query SQL)
Scan automatica attualmente disabilitata in `souschef-core.js`

---

## TODO BACKLOG

- Fix realtime TV — loadChat() troppo pesante, aggiungere solo payload.new
- Spostare L'Ufficio nella bottom bar (ora nei tre puntini)
- Focus Mode — riabilitare quando orari 7shifts allineati (basta rimuovere `return false` in focus-mode.js)
- Rinominare "Manager Station" → "Coordinator Station" ovunque nel sistema
- TripleSeat — Monica deve fare Authorize
- Bot 5 versione B — food cost % quando selling_price popolato
- office-ai cron orario (analisi automatica ogni ora)
- Hardie's NULL conversions: fix manuale `conversion_to_base` per Eggs 15 DZ (SKU 01115) e Beefsteak Tomato 19/22 (SKU 15909)
- Foto in chat — upload da testare su iPhone reale
- BOM audit completo: verificare tutti i tipi di pasta fresca (Pappardelle, Rigatoni, Penne, ecc.) come fatto per Fettuccine e Spaghetti

---

## REGOLE OPERATIVE INVIOLABILI
- SHA fresco prima di ogni PUT; bump boh-vN in sw.js ad ogni push (verifica live prima)
- node --check prima di push
- Commit: "vN file — descrizione"; solo brigade-main su `1cos/back-of-house`
- Leggi SEMPRE da GitHub live, mai da memoria o /mnt/project/
- Conferma piano prima di scrivere codice; una cosa alla volta
- Financial data mai allo staff
- Kitchen Display SOLO inglese
- Domenica chiuso
- **App in produzione — modifiche chirurgiche, zero rischi**
- **MAI assumere — confermare SEMPRE con Max prima di agire**
