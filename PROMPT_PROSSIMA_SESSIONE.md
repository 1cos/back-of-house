# PROMPT PROSSIMA SESSIONE — Brigade v283

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md da brigade-main
3. Leggi SEMPRE i file da GitHub

## STATO ATTUALE — 2026-06-19

### 7shifts Schedule — IN CORSO (non completato)
- Tab Schedule aggiunto in Brigade (v280-283) — funziona, visibile come admin
- Tabella `shifts_schedule` creata in Supabase
- Edge Function `sevenshift-sync` deployata (v4 — versione diagnostica)
- Credenziali in `settings`: token `71b1fb45-a32d-4613-82ee-84368dfbe47c`, company_id `279092`, location_id `346664`
- **PROBLEMA APERTO**: la sync da 7shifts dà "Errore" in Brigade
- La funzione diagnostica risponde 200 ma il corpo contiene whoami_body e shifts_body da 7shifts — non ancora letti
- **PROSSIMO STEP**: aprire Safari Mac → Console → premere Sincronizza → leggere esattamente cosa risponde 7shifts (whoami_status, whoami_body)
- Poi sostituire la funzione diagnostica con quella di produzione finale

### Versione attuale: v283
- sw.js: boh-v283
- schedule.js: v1 con click handler DOMContentLoaded

## PRIORITA' SESSIONE PROSSIMA
1. Fix 7shifts sync — leggere console Safari per vedere risposta whoami
2. L'Ufficio action buttons (Archivia/Risolto/Investiga)
3. Yesterday/Weekly Highlights UI
