# PROMPT PROSSIMA SESSIONE — Brigade v217

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md e BOH_OS_DECISIONS.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Display: https://1cos.github.io/back-of-house/display.html (LIVE su Fire TV)
- Versione: v217

---

## PRIORITÀ IMMEDIATA — TripleSeat Authorize

**Monica (admin TripleSeat) deve premere Authorize:**
1. Vai su `zottsllc.tripleseat.com/settings/api`
2. Trova app "MAX" sotto OAuth 2.0 Client Applications
3. Premi **Authorize**
4. Questo completa il flow e genera access_token + refresh_token

Dopo l'Authorize: aggiornare `tripleseat-sync` Edge Function per usare
authorization_code invece di client_credentials, salvare refresh_token in DB.

**Tabella da creare:**
```sql
CREATE TABLE tripleseat_tokens (
  id integer PRIMARY KEY DEFAULT 1,
  access_token text,
  refresh_token text,
  expires_at timestamptz
);
```

---

## OPZIONE A — Chef Inbox (priorità alta)
Inbox unificato admin: chef_reports + operation_notes + briefing AI
File da leggere: js/briefing.js, js/operation-notes.js, js/tell-chef.js, js/admin.js

## OPZIONE B — Focus Mode (priorità alta)
Lavagna digitale staff 8AM-8PM CDT, swipe destra dalla home
File da leggere: js/prep.js, js/presence.js, js/app.js

---

## REGOLE OPERATIVE — INVIOLABILI
1. Leggi SEMPRE i file da GitHub (mai da /mnt/project/ o memoria)
2. Bumpa sw.js in ogni push che tocca file visibili all'utente
3. Dichiara cosa cambierai prima di scrivere codice
4. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
5. Non lavorare mai su file in memoria — sempre online
