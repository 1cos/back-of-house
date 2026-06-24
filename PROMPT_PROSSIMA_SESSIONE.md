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

## STATO TECNICO (aggiornato 2026-06-24)
- Frontend: **v343** (sw.js boh-v343)
- **App in produzione dal 2026-06-24** — brigata attiva
- souschef-chat: **v25** — 6 azioni nuove aggiunte (add/remove/update_prep_task, add/remove_closing_check, send_brigade_message)
- bot-tell-chef-reader: **v5**

### Sessione 2026-06-24 — souschef-chat v25: azioni prep e closing
- Aggiunto `add_prep_task`: aggiunge voce a prep_tasks con need_tomorrow=true di default
- Aggiunto `remove_prep_task`: archivia prep task (archived=true, non cancella)
- Aggiunto `update_prep_task`: modifica qty/unit/note/need_tomorrow (campi safe list)
- Aggiunto `add_closing_check`: aggiunge voce in tabella `checks`
- Aggiunto `remove_closing_check`: cancella voce da `checks` (delete fisico)
- Aggiunto `send_brigade_message`: scrive in `messages` a nome di Max
- fetchContext() ora include PREP TASKS ATTIVE e CLOSING CHECKS con ID
- SYSTEM_PROMPT aggiornato: stazioni valide + 18 azioni documentate
- 100 scenari futuri catalogati in BOH_OS_BACKLOG.md

### DB modifiche sessione 2026-06-24 (mattina — L'Ufficio)
- `office_items`: +chef_action, +chef_action_at, +chef_action_by, +report_type, +updated_at
- `chef_reports`: +chef_action, +chef_action_at, +chef_action_by

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

## 🔴 PRIORITÀ #2 — Cleaning Checklist (nuovo modulo)

Flusso serale: Closing Prep → Operation Note → Cleaning Checklist → Chiudi Shift → notifica Max+David
- DB: nuove tabelle `cleaning_tasks` e `cleaning_log` (non ancora create)
- ⚠️ Prima: riallineare stazioni DB con realtà cucina

---

## 🔴 PRIORITÀ #3 — Riallineamento stazioni

Stazioni attuali in DB: Fresh Pasta Station, Manager Station, Oven Station, Pasta Station,
Pastry Station, Plating Station, Salad Station, Saucier Station, Sauté Station, Table Side, Dish Crew
Da allineare con Max. Manager → Coordinator. Expo Line e Grill da valutare.

---

## 🟠 PRIORITÀ #4 — Home dedicata Dish Crew (Fase 2)

Detect: `user.default_station === 'Dish Crew'`
Nascondere: Recipes, Closing, Sales, Ingredienti, Focus Mode, Operation Notes
Bottom bar: Home / Chat / Schedule / Tell Chef

---

## TODO BACKLOG ALTO PRIORITÀ

- Fix realtime TV — loadChat() troppo pesante, aggiungere solo payload.new
- Bug UI chat — long press copia non funziona
- office-ai cron orario (analisi automatica ogni ora)
- Spostare L'Ufficio nella bottom bar (ora nei tre puntini)
- Focus Mode test reale — importare CSV 7shifts
- Foto in chat (v335) — da testare su iPhone
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
