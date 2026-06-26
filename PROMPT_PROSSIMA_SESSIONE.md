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

## STATO TECNICO (aggiornato 2026-06-26)
- Frontend: **v386** (sw.js boh-v386) — repo: `1cos/back-of-house`, branch `brigade-main`
- **App live** — `https://1cos.github.io/back-of-house/`
- **`1cos/brigade-dev` — ABBANDONATO, non usare più**

---

## Sessione 2026-06-26 — Schedule Generator + Staff & Stazioni (v384→v386)

### Nuove tabelle DB (Supabase)
- **`staff_profiles`** — profili brigata: name, shift_preference, max_days_per_week, off_days[], no_evening_days[], only_days[], is_double_shift, notes, active
- **`staff_stations`** — assegnazioni stazione per persona: staff_name, station, shift, priority (1=preferita/2=sa fare/3=emergenza), is_default, notes
- Popolate con tutti i 16 membri della brigata attiva e 55 assegnazioni stazione

### Staff & Stazioni — modulo admin (v384)
- Nuovo file `js/staff-manager.js`
- Accessibile dai tre puntini → bottone **Staff** (verde)
- Lista tutti i profili con turno, giorni off, stazioni e priorità
- Tap su nome → editor completo: turno, giorni off, no-sera, doppio turno, note
- Aggiungi/rimuovi stazioni con priorità e flag default
- Aggiungi nuovi membri, disattiva profili senza eliminarli
- Fix: usava `window.supabase` invece di `window.supa` — corretto in v384

### Schedule Generator — tab Genera in Schedule (v385→v386)
- Nuovo tab **✦ Genera** nella sezione Schedule (accanto a Oggi / Settimana)
- Solo admin
- **Pannello eccezioni**: dropdown nome → date da/a → + Aggiungi → lista eccezioni rimuovibili con ×
- **✦ Genera Schedule**: genera la schedula della **prossima settimana** (lunedì → sabato)
- Rispetta vincoli fissi DB (off_days, no_evening_days, only_days, is_double_shift)
- Rispetta eccezioni temporanee inserite (persona off da data a data)
- Anti-conflitto: ogni persona assegnata una sola volta per turno per giorno
- Risultato in due sub-tab: **Giornaliero** (day strip + stazioni) e **Settimanale** (griglia)
- Stazioni non coperte evidenziate in rosso con warning
- Rachel doppio turno (2x badge), Max fisso Mer→Pasta / Gio/Ven/Sab→Grill & Features
- Non salva nel DB, non tocca la schedula 7shifts — solo visualizzazione/pianificazione

### Dati brigata consolidati
**Stazioni per turno:**
- Mattina: Oven, Sauté, Pasta, Salad, Fresh Pasta, Saucier, Coordinator, Dish Crew + Pastry (solo Lun/Mer/Ven)
- Sera: Oven, Pasta, Salad, Sauté, Plating, Table Side, Grill & Features, Dish Crew

**Orari:** Mattina 8:00–14:00 / Sera 14:00–21:30 (22:30 Ven-Sab)

**Vincoli personale chiave:**
- Rachel: doppio turno Lun/Mar/Mer (Oven AM + Grill PM), Gio solo AM, off Ven/Sab
- Max: off Lun, 12:00→close, Mer→Pasta, Gio/Ven/Sab→Grill & Features
- David: off Martedì (Colton copre Table Side)
- Chance: off Martedì, default Sauté sera
- Todd: solo Lun/Mar/Mer, Fresh Pasta + Pastry (NON Pasta Station)
- Colton/Tela/Samantha/Chris: no mercoledì sera
- Genova: off Sabato, default Sauté mattina
- Zuu: solo Salad mattina, 6 giorni/sett

---

## 🔴 BACKLOG SCHEDULE GENERATOR — prossime aggiunte

### Vincoli di stazione (non ancora implementati)
Da aggiungere in una tabella `station_rules` con colonna `active_days`:
- **Pastry Station** — solo Lun / Mer / Ven (già parzialmente implementato nel generatore)
- **Pasta Station** (prep salse) — solo Lun / Mer / Ven / Sab
- **Saucier Station** — solo Lun / Mar / Mer / Gio
- Altri da definire con Max
- Il Bot deve conoscere questi vincoli per le produzioni

### Salvataggio schedule generata nel DB
- Tabella `schedule_assignments` da creare: week_start, day_of_week, shift, station, assigned_to, created_by
- Bottone "Salva schedule" nel generatore
- Visualizzazione schedule salvata vs generata

### Candidati da DB
- Il generatore ora usa candidati hardcodati in JS
- Futuro: leggerli da `staff_stations` in tempo reale

---

## 🔴 PRIORITÀ #1 — ai_options come azioni eseguibili in L'Ufficio

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

### Piano
- `office.js`: `officeExecuteOption(item, opt)` — se opt.action presente, chiama souschef-chat confirmed_action
- `bot-tell-chef-reader v6`: aggiorna prompt per generare ai_options strutturate {label, action, params}

### Azioni già eseguibili via souschef-chat (v25)
add_prep_task, remove_prep_task, update_prep_task, add_closing_check, remove_closing_check,
send_brigade_message, update_ingredient_vendor, block/unblock_*, create_office_item, resolve_warning

---

## 🔴 PRIORITÀ #2 — Autocomplete ricette nel Calendar editor (BUG APERTO v355)
- `<datalist>` nativo HTML non funziona su iOS nel modale editor eventi
- Valutare: sheet separato di ricerca ricette (tap → lista fullscreen → selezione → torna editor)

---

## 🔴 PRIORITÀ #3 — Home dedicata Dish Crew (Fase 2)
Detect: `user.default_station === 'Dish Crew'`
Nascondere: Recipes, Closing, Sales, Ingredienti, Focus Mode, Operation Notes
Bottom bar: Home / Chat / Schedule / Tell Chef

---

## 🔴 PRIORITÀ #4 — Cleaning Checklist (nuovo modulo)
Flusso serale: Closing Prep → Operation Note → Cleaning Checklist → Chiudi Shift → notifica Max+David
- DB: nuove tabelle `cleaning_tasks` e `cleaning_log` (non ancora create)

---

## 🔴 PRIORITÀ #5 — souschef-scan
- Manda 400+ ingredienti a OpenRouter → timeout 500 ogni ora
- Fix: riscrivere con SQL diretto (GHOST e NOLINK si trovano con query SQL, AI serve solo per testo)
- Scan automatica attualmente disabilitata in `souschef-core.js`

---

## TODO BACKLOG

- Fix realtime TV — loadChat() troppo pesante, aggiungere solo payload.new
- Spostare L'Ufficio nella bottom bar (ora nei tre puntini)
- Focus Mode — riabilitare quando orari 7shifts allineati (basta rimuovere `return false` in focus-mode.js)
- Rinominare "Manager Station" → "Coordinator Station" ovunque nel sistema
- TripleSeat — Monica deve fare Authorize
- Bot 5 versione B — food cost % quando selling_price popolato
- office-ai cron orario (analisi automatica ogni ora)
- Foto in chat — bottone camera presente ma upload da verificare su iPhone

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
