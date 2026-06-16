# PROMPT PROSSIMA SESSIONE — Brigade v202

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md e BOH_OS_DECISIONS.md da brigade-main
3. Leggi sempre i file da GitHub prima di modificarli
4. Bumpa sw.js ad ogni push

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Display: https://1cos.github.io/back-of-house/display.html (LIVE su Fire TV)
- Versione: v202

---

## OPZIONE A — Chef Inbox (priorità alta)

Inbox unificato admin stile chat. Accessibile da ••• → "Chef Inbox".

**Tabelle sorgente:**
- `chef_reports` — Tell Chef (arancio 📢)
- `operation_notes` — Feedback serale post-closing (viola 🌙)
- `briefing` — punti Chef AI (blu 🤖)

**Layout:**
- Messaggi in ordine cronologico inverso
- Colori: blu=Chef AI, arancio=Tell Chef, viola=Operation Note
- Nome sempre visibile (mai anonimo verso Max)
- Bottoni: Resolve / Keep open / Ask Chef AI
- Resolve = chiude ma resta in archivio
- Sezione "From your team" nel briefing admin mattutino

**Fix briefing admin:**
- Mostra 2-3 punti chiave invece di tutti
- Bottone "View all" → modal con tutto + chef_reports + operation_notes

**File da leggere:**
- js/briefing.js
- js/operation-notes.js  
- js/tell-chef.js
- js/admin.js

---

## OPZIONE B — Focus Mode (priorità alta)

Modalità lavagna digitale staff. Swipe destra dalla home.
Attiva 8:00 AM → 8:00 PM CDT automaticamente.
Solo staff (role != admin).

**Spec completa nel BACKLOG sezione FOCUS MODE.**

**File da leggere:**
- js/prep.js
- js/presence.js
- js/app.js (sezione doLogin/tab visibility)

---

## REGOLE OPERATIVE
1. Leggi sempre da GitHub prima di modificare
2. Mai template literals multiriga nei file JS
3. Bumpa sw.js nello stesso push
4. Dichiara sempre cosa cambierai prima di scrivere codice
5. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
6. pos_item_aliases: 40 regole produzione — usarla per tutte le stats
7. "Anonimo" in operation_notes = privato verso colleghi, non verso Max
