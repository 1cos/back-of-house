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
- Frontend: **v389** (sw.js boh-v389) — repo: `1cos/back-of-house`, branch `brigade-main`
- **App live** — `https://1cos.github.io/back-of-house/`
- **`1cos/brigade-dev` — ABBANDONATO, non usare più**

---

## Sessione 2026-06-26 — Fix per i ragazzi (v380→v389)

### Fix completati

**v380 — Traduzioni Zuu (spagnolo)**
- `app.js`: greeting "Good morning/afternoon/evening/night" → `tr()` (erano hardcoded inglese)
- `app.js`: "Your Station" → `tr('yourStation')`, "Stations" → `tr('stations')`
- `utils.js`: aggiunte chiavi `goodMorning/goodAfternoon/goodEvening/goodNight` IT/EN/ES
- Zuu (lang=`es`) ora vede tutto in spagnolo: "Buenos días", "Tu estación", "Otras estaciones", ecc.

**v381 — Fix Contorni: dati reali includono modifiers**
- `pos.js`: la card Contorni mostrava solo items diretti (17) — ignorava i modifiers ×½
- Fix: dopo build `groupMap`, aggiungi anche modifier Contorni da `modifier_config` (×0.5 porzione)
- Nel dettaglio sheet: label verde "+side ½" per distinguere modifier da items diretti
- Dati reali weekend 06-19/20: ~57 porzioni (vs 17 mostrate prima)

**v382 — Font +1px globale staff**
- `index.html`: `body { font-size: 15px }`, tutte le classi Tailwind scalano automaticamente
- Titolo app: 17→18px, username topbar: 14→15px, news bar: 13→14px, tab labels: 11→12px

**v383 — Font testo traduzione chat +2px**
- `chat.js`: testo traduzione 🌐 sotto i messaggi: 11px → 13px

**v384/v385 — Tell Chef: fix doppio invio + dedup history**
- `tell-chef.js`: guard `_tcSending = true` blocca qualsiasi doppio tap
- `tell-chef.js`: deduplicazione history (message+created_at) prima del render
- Anto vedeva 14+ messaggi identici perché toccava più volte il bottone su connessione lenta

**v386 — Tell Chef redesign come chat**
- `tell-chef.js`: completamente ridisegnato — non più textarea statica con history sotto
- Header fisso in cima, messaggi come bolle scorrevoli, input fisso in fondo
- Dopo invio: bolla aggiunta in chat, campo svuotato — modal non si chiude più

**v387 — Tell Chef colori app + traduzioni IT/EN/ES**
- `tell-chef.js`: via nero `#1a202c` — gradiente navy/blue `#1e3a5f → #2563eb` in linea con home
- `utils.js`: aggiunte chiavi `tcOnlyMax`, `tcWriteNote`, `tcTipMic`, `tcSendBtn`, `tcSent`, `tcNoMsg`
- IT: "Solo Chef Max vedrà questo" / "Scrivi la tua nota..." / "💡 Suggerimento: usa il microfono..."
- ES: "Solo Chef Max verá esto" / "Escribe tu nota..." / "💡 Tip: usa el micrófono..."
- EN: "Only Chef Max will see this" / "Write your note..." / "💡 Tip: use the mic..."

**v388 — Fix bottone fotocamera chat**
- `utils.js`: `applyLang()` prendeva il primo bottone `#f button` (= fotocamera) e ci scriveva "Send to team" / "Invia al team" sopra, sovrascrivendo l'SVG
- Fix: rimossa quella riga — bottone fotocamera mantiene SVG, bottone submit mantiene freccia blu

**v389 — (bump sw dopo push parallelo)**

### DB cleanup
- Cancellati **160 chef_reports** precedenti al 23-06-2026 (messaggi del demobot)
- Rimasti 5 record reali (dal 23 giugno in poi)
- Chat brigata (messages) lasciata intatta

### Fix Android keyboard (Visual Viewport API)
- `souschef-chat.js`: keyboard fix Android — `visualViewport.resize` listener ridimensiona modal
- `tell-chef.js`: stesso fix applicato al Tell Chef

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

### Schedule Generator — tab Genera in Schedule (v385→v386)
- Nuovo tab **✦ Genera** nella sezione Schedule
- Solo admin — genera schedule prossima settimana (lunedì → sabato)

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
