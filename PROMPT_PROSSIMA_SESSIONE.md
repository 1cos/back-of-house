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
- Frontend: **v342** (sw.js boh-v342)
- **App in produzione dal 2026-06-24** — brigata attiva
- bot-tell-chef-reader: **v5**
- souschef-chat: **v24** (confirmation gate "Sì Chef")

### Sessione 2026-06-24 — L'Ufficio pulizia e riordino (v337→v342)
- v337: menu admin ripulito (5 voci dev rimosse), Invoice+Purchases rimossi dal menu (duplicati homepage)
- v337: Purchase History legge da entrambi: `purchases` + `vendor_documents`
- v337: mittente messaggi L'Ufficio in grassetto
- v337: Fix Focus Mode — noNeed aggiorna anche Focus Mode; DA FARE→TO DO; Riapri→Reopen
- v337: Fix bottone Report nel menu (era link morto, data-t=r non esisteva)
- v337: Fix Riapri in L'Ufficio (ricaricava lista sbagliata — ora ricarica folder corrente)
- v338: Tell Chef from_user usa window.currentUser (era sempre null → scriveva "Staff")
- v338: office.js — mittente in grassetto scuro
- v339: Tell Chef bottoni Working on it / Done / Ignore + salva chef_action nel DB
- v339: bot-tell-chef-reader v2 — Fase 2 sync chef_action→chef_reports + Fase 3 analisi pattern
- v340: office.js — ciclo vita messaggi: done >7gg sparisce dalla vista
- v340: bot-tell-chef-reader v3 — working_on_it >7gg → alert rosso in cima
- v341: office.js — fix opt.label undefined (bottoni AI options mostravano "undefined")
- v341: office.js — smistamento tell_chef per tipo in folder corrette (getFolderForItem)
- v341: DB migration — report_type e updated_at aggiunti a office_items
- v342: bot-tell-chef-reader v4 → scrive report_type in office_items
- v342: bot-tell-chef-reader v5 → from_user = 'Chef AI' per card elaborate dal bot

### DB modifiche sessione odierna
- `office_items`: +chef_action (text), +chef_action_at (timestamptz), +chef_action_by (text)
- `office_items`: +report_type (text), +updated_at (timestamptz)
- `chef_reports`: +chef_action (text), +chef_action_at (timestamptz), +chef_action_by (text)

---

## 🔴 PRIORITÀ #1 PROSSIMA SESSIONE — ai_options come azioni eseguibili

### Problema
Le ai_options nel sistema Tell Chef sono ora stringhe (es. "Aggiungi focaccia alla lista").
Quando Max le preme, usano `officeResolve` che archivia il messaggio come `resolved` —
ma non esegue nessuna azione reale nel DB.

### Visione di Max
Il bot deve generare opzioni strutturate con azione codificata. Esempio:
```json
[
  { "label": "Aggiungi focaccia alla lista Oven", "action": "add_prep_task", "params": {"name": "Focaccia", "station": "Oven Station"} },
  { "label": "Verifica lista preparazioni Oven", "action": "open_prep_station", "params": {"station": "Oven Station"} },
  { "label": "Ignora", "action": "ignore", "params": {} }
]
```
Quando Max preme "Aggiungi focaccia alla lista":
1. Bot la aggiunge fisicamente in `prep_tasks` per quella stazione
2. Card mostra "✓ Focaccia aggiunta — vai a controllare →" con link diretto
3. `chef_action = 'done'` salvato automaticamente

### Piano 3 sessioni
**Sessione 1:** Definire catalogo completo azioni possibili (add_prep_task, open_prep_station, mark_order, open_recipe, ignore, ecc.) con parametri esatti
**Sessione 2:** Aggiornare bot v6 per generare ai_options strutturate + frontend per eseguirle
**Sessione 3:** Test reale con messaggi brigata, correzioni

### Stato attuale tell_chef flow
- Raw Tell Chef → `office_items` con `source='tell_chef'`, `from_user=nome_reale`
- Elaborato dal bot → `office_items` con `source='tell_chef'`, `from_user='Chef AI'`, `report_type` popolato
- Smistamento per folder: PROBLEMA_OPERATIVO+GAP_CHECKLIST→prep, CONTRIBUTO_RICETTA+FEEDBACK_RICETTA→miglioramenti, SEGNALE_PERSONALE→brigata
- Ciclo vita: done >7gg sparisce dalla vista, working_on_it >7gg → alert rosso, ignored → sparisce subito
- Bot gira ogni ora (cron bot-tell-chef-reader-hourly)

---

## 🔴 PRIORITÀ #2 — Cleaning Checklist (nuovo modulo)

Modulo separato dalle closing prep tasks esistenti. Flusso serale:
```
Closing Prep Tasks → completate
        ↓
"Com'è andato il servizio?" (operation note)
        ↓
Cleaning Checklist della stazione  ← NUOVO
        ↓
✓ Ultima voce spuntata → "Buona serata [Nome]! Great job tonight 🙌"
        ↓
Notifica a Max + David (se schedulato)
```

**Regole:**
- Voci tutte obbligatorie — bottone "Chiudi Shift" grigio finché non sono tutte spuntate
- Se una voce manca → notifica a Max e David con cosa è stato saltato
- Gestione admin: stessa UI delle prep tasks (aggiungi/rimuovi/riordina voci per stazione)
- Stazioni da David: Expo Line, Salad, Pasta, Oven, Sautee, Grill
- DB: nuova tabella `cleaning_tasks` (id, station, task_text, sort_order, active)
- DB: nuova tabella `cleaning_log` (id, date, user_name, station, task_id, checked_at)

**⚠️ Prima di implementare:** riallineare stazioni DB con realtà cucina (vedi sotto)

---

## 🔴 PRIORITÀ #3 — Riallineamento stazioni

Stazioni attuali in DB (prep_tasks.category):
Fresh Pasta Station, Manager Station, Oven Station, Pasta Station, Pastry Station,
Plating Station, Salad Station, Saucier Station, Sauté Station, Table Side, Dish Crew

Stazioni reali cucina da allineare con Max prima di costruire Cleaning Checklist.
Expo Line e Grill non esistono nel DB. Manager → Coordinator rinominare.

---

## 🟠 PRIORITÀ #4 — Home dedicata Dish Crew (Fase 2)

I dishwasher non devono vedere la Home cucina. Serve una Home dedicata, semplice.
Detect: `user.default_station === 'Dish Crew'`
Nascondere: Recipes, Closing, Sales, Ingredienti, Focus Mode, Operation Notes prompt
Bottom bar: Home / Chat / Schedule / Tell Chef

---

## TODO BACKLOG ALTO PRIORITÀ

- Fix realtime TV — loadChat() troppo pesante, aggiungere solo payload.new
- Bug UI chat — long press copia non funziona
- office-ai cron orario (analisi automatica ogni ora)
- Bot 5 versione B — food cost % quando selling_price popolato
- Spostare L'Ufficio nella bottom bar (ora nei tre puntini)
- Focus Mode test reale — importare CSV 7shifts e verificare match schedule_name
- Foto in chat (v335) — da testare su iPhone (non ancora verificate da Max)
- TripleSeat — Monica deve fare Authorize (ancora in attesa)
- Cron job bot-tell-chef-reader verificare sia attivo
- Tell Chef button rimosso dai tre puntini? (valutare — ora tutto in L'Ufficio)

---

## REGOLE OPERATIVE INVIOLABILI
- SHA fresco prima di ogni PUT; bump boh-vN in sw.js ad ogni push (verifica live prima — sessioni parallele)
- node --check prima di push
- Commit: "vN file — descrizione"; solo brigade-main
- Leggi SEMPRE da GitHub live, mai da memoria o /mnt/project/
- Conferma piano prima di scrivere codice; una cosa alla volta
- Financial data mai allo staff
- Kitchen Display SOLO inglese
- Domenica chiuso (esclusa da calcoli Bot 3 e da Focus Mode)
- **App in produzione — modifiche chirurgiche, zero rischi**
- **MAI assumere — confermare SEMPRE con Max prima di agire**
