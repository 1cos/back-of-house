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
- MAI assumere — confermare SEMPRE prima di scrivere codice

## 🟢 APP IN PRODUZIONE
**Brigade è live. I ragazzi stanno usando l'app.** Ogni modifica al codice deve essere
chirurgica — zero rischi di rompere funzionalità esistenti. Testare prima di pushare.

---

## STATO TECNICO (aggiornato 2026-06-25)
- Frontend: **v355** (sw.js boh-v355)
- **App in produzione** — brigata attiva

---

## Sessione 2026-06-25 — cosa è stato fatto

### Toggle Originale / Smart nella sheet ricetta (v351→v355)
- `recipes.js`: aggiunto toggle **Original / Smart** sopra gli ingredienti nella sheet ricetta
- In modalità **Smart**: legge `suggested_qty` dal DB (`prep_tasks.suggested_qty`), calcola fattore kg rispetto a `base_weight_g`, scala ingredienti via `scaleToKg()` — funziona anche per ricette senza `servingWeightG` (es. salse in kg)
- In modalità **Original**: ripristina `base_weight_g` originale e riscala
- Toggle visibile solo se esiste `suggested_qty` nel DB per quella ricetta
- Fix scroll iOS sheet ricetta: `overscroll-behavior:contain`, `-webkit-overflow-scrolling:touch`, `mb-6` su close button
- **BUG APERTO v355**: scroll iOS — una volta arrivati in fondo alla sheet, non si riesce a tornare in cima (non risolto definitivamente)

### Calendario eventi — nuovo modulo (v350→v355)
- DB: aggiunte colonne `service_style` (text) e `event_recipes` (jsonb []) alla tabella `events`
- `calendar.js` riscritta completa:
  - Pagina con **sticky header** `top:64px` (pattern vvdr) — titolo, ‹ back, + New Event, ↻ TripleSeat
  - Filtri Upcoming / Past / All fissi sotto l'header, lista che scrolla normalmente
  - **Editor eventi** stile recipe editor (modale rounded-3xl):
    - Campi: nome, data+ora, location (Zenos/La Scuderia/Private Home/+ Add New), ospiti, service style (Al Piatto/Buffet/Family Style/Cocktail), status, note
    - Sezione Ricette: nome (autocomplete DB) + Portions + Note per ogni ricetta
    - Food cost stimato solo per admin
    - Edit / Delete eventi manuali
    - Bottone ↻ TripleSeat pronto per quando Monica autorizza (source='manual' vs 'tripleseat')
  - Card evento: giorno + data, nome, status badge colorato, ora/ospiti/location/service style, menu ricette
- `briefing.js`: upcoming demand in home mostra ricette, cliccabile → apre calendario, "View all →"
- **BUG APERTO v355**: autocomplete ricette nell'editor usa `<datalist>` nativo ma non funziona correttamente su iOS — da rivedere nella prossima sessione

### Focus Mode — disabilitata globalmente (v350)
- `focus-mode.js`: `shouldShowFocusMode()` ritorna `false` immediatamente
- Motivo: orari 7shifts non allineati con la realtà — i ragazzi erano bloccati sulla prep list e non potevano fare la closing checklist
- Da riabilitare quando gli orari sono corretti (basta rimuovere `return false`)

### Closing checklist — voci aggiunte al DB
- **Pasta Station** (8 voci): Pomodoro sauce, Arrabbiata sauce, Preparato per Livornese, Texana soup, Pesto, Cacio e pepe sauce, Demi, Ragù
- **Salad Station** (2 voci): Shrimp for cocktail, Big bruschetta

### Vendor Documents — da modal a pagina (v351)
- Rimosso il modal `fixed inset-0 z-[65]` che copriva la topbar
- Aggiunta sezione `vvdr` nel flusso normale dell'app (topbar + bottom bar sempre visibili)
- `showVdrSection()` e `vdrBack()` in `app.js`
- `openVendorDocumentsReview()` ora chiama `showVdrSection()` invece di creare modal

### Chat — fix overlay Focus Mode (v352)
- `chat.js`: rimozione automatica `_focusChatOverlay` all'avvio e in `showChat()`
- Risolveva: "Send to team" + doppio bottone send visibili nella chat

### Chat — long press: Modifica + Reaction (v353-354)
- Long press 500ms su bubble messaggio → menu contestuale iOS-style
- Propri messaggi: ✏️ Modifica + 😊 Reaction
- Messaggi altrui: solo 😊 Reaction
- Modifica: sheet con textarea pre-popolata → UPDATE su `messages` dove `user_name = user.name`
- `user-select:none` + `webkit-touch-callout:none` sui bubble → no selettori iOS

---

## 🔴 PRIORITÀ #1 PROSSIMA SESSIONE — ai_options come azioni eseguibili in L'Ufficio

### Problema
Le ai_options nel sistema Tell Chef sono ora stringhe (es. "Aggiungi focaccia alla lista").
Quando Max le preme, chiamano `officeResolve` che archivia il messaggio ma NON esegue nulla nel DB.

### Visione
Il bot genera opzioni strutturate con azione codificata:
```json
[
  { "label": "Aggiungi focaccia alla lista Oven", "action": "add_prep_task", "params": {"name": "Focaccia", "station": "Oven Station"} },
  { "label": "Ignora", "action": "ignore", "params": {} }
]
```
Quando Max preme il bottone:
1. Frontend chiama `souschef-chat` con `confirmed_action` costruito da action+params
2. Chef AI esegue nel DB
3. Card mostra "✓ Focaccia aggiunta — Oven Station" e si chiude

### Piano
**Sessione 1 (prossima):**
- `office.js`: `officeExecuteOption(item, opt)` — se opt.action presente, chiama souschef-chat confirmed_action; altrimenti fallback officeResolve
- `bot-tell-chef-reader v6`: aggiorna prompt per generare ai_options strutturate {label, action, params}

### Azioni già eseguibili via souschef-chat (v25)
add_prep_task, remove_prep_task, update_prep_task, add_closing_check, remove_closing_check,
send_brigade_message, update_ingredient_vendor, block/unblock_*, create_office_item, resolve_warning

---

## 🔴 PRIORITÀ #2 — Autocomplete ricette nel Calendar editor (BUG APERTO v355)
- `<datalist>` nativo HTML non funziona correttamente su iOS nel modale editor eventi
- Tentativi fatti: dropdown body-attached position:fixed (coordinate sbagliate con tastiera), position:absolute (tagliato da overflow:auto), datalist nativo (non riconosce selezione)
- Prossima sessione: valutare approccio alternativo — es. sheet separato di ricerca ricette (tap su campo → apre lista ricette fullscreen, selezione → torna all'editor)
- Chat autocomplete: verificare separatamente

---

## 🔴 PRIORITÀ #3 — Cleaning Checklist (nuovo modulo)

Flusso serale: Closing Prep → Operation Note → Cleaning Checklist → Chiudi Shift → notifica Max+David
- DB: nuove tabelle `cleaning_tasks` e `cleaning_log` (non ancora create)
- ⚠️ Prima: riallineare stazioni DB con realtà cucina

---

## 🔴 PRIORITÀ #4 — Riallineamento stazioni

Stazioni attuali in DB: Fresh Pasta Station, Manager Station, Oven Station, Pasta Station,
Pastry Station, Plating Station, Salad Station, Saucier Station, Sauté Station, Table Side, Dish Crew
Da allineare con Max. Manager → Coordinator. Expo Line e Grill da valutare.

---

## 🟠 PRIORITÀ #5 — Home dedicata Dish Crew (Fase 2)

Detect: `user.default_station === 'Dish Crew'`
Nascondere: Recipes, Closing, Sales, Ingredienti, Focus Mode, Operation Notes
Bottom bar: Home / Chat / Schedule / Tell Chef

---

## TODO BACKLOG ALTO PRIORITÀ

- Fix realtime TV — loadChat() troppo pesante, aggiungere solo payload.new
- office-ai cron orario (analisi automatica ogni ora)
- Spostare L'Ufficio nella bottom bar (ora nei tre puntini)
- Focus Mode — riabilitare quando orari 7shifts allineati
- Foto in chat — bottone camera presente ma upload da verificare su iPhone
- TripleSeat — Monica deve fare Authorize
- Bot 5 versione B — food cost % quando selling_price popolato

---

## REGOLE OPERATIVE INVIOLABILI
- SHA fresco prima di ogni PUT; bump boh-vN in sw.js ad ogni push (verifica live prima)
- node --check prima di push
- Commit: "vN file — descrizione"; solo brigade-main
- Leggi SEMPRE da GitHub live, mai da memoria o /mnt/project/
- Conferma piano prima di scrivere codice; una cosa alla volta
- Financial data mai allo staff
- Kitchen Display SOLO inglese
- Domenica chiuso
- **App in produzione — modifiche chirurgiche, zero rischi**
- **MAI assumere — confermare SEMPRE con Max prima di agire**
