# SESSIONE BUG FIX — souschef-scan timeout + L'Ufficio stato attuale

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto (token GitHub)
2. Leggi BRIGADE_VISION.md da brigade-main — sezione "Brigade Communication & Decision System"
3. Leggi BOH_OS_BACKLOG.md da brigade-main
4. Leggi PROMPT_UFFICIO.md da brigade-main

Supabase: ydqmumpytgrlceuinoqt
Branch: brigade-main
Versione attuale: v219

---

## CONTESTO — cosa è successo

### Errore attivo
`souschef-scan` v9 crasha con 500 ogni volta che gira (ogni ora automaticamente).
Log Supabase: `POST | 500 | souschef-scan | execution_time_ms: 22462`
22 secondi = timeout OpenRouter. Il modello LLaMA riceve un contesto troppo grande.

### Causa
La funzione `fetchEverything()` manda all'AI:
- Tutti gli ingredienti attivi (343 ingredienti)
- Tutti i record ingredient_vendors
- Tutti i warning risolti

Risultato: contesto enorme → LLaMA va in timeout → 500.

### Cosa fa souschef-scan
Cerca dati mancanti nelle fatture:
- SC-GHOST-001: ingrediente senza nessun vendor nel DB
- SC-NOLINK-001: ingrediente per_case senza conversion_to_base
NON giudica mai i prezzi (SC-PRICE-001 è eliminato permanentemente).
Scrive i risultati in `invoice_warnings`.

---

## COSA ESISTE GIÀ — non ricostruire

### bot-tell-chef-reader v1 (già deployato, funziona)
Edge Function che gira ogni ora:
- Legge chef_reports nuovi (status=new, souschef_suggestion IS NULL)
- Classifica con AI: tipo (CONTRIBUTO_RICETTA, GAP_CHECKLIST, PROBLEMA_OPERATIVO, FEEDBACK_RICETTA, SEGNALE_PERSONALE) + priorità (red/orange/blue)
- Scrive in tabella `office_items` con titolo, body, ai_options JSON
- Aggiorna chef_reports con souschef_suggestion e report_type

### Tabella office_items (già creata)
Campi noti: source, source_id, from_user, priority, title, body, ai_options, status, notify_brigade
Questa è la tabella centrale de L'Ufficio.

### L'Ufficio (in costruzione — altra chat parallela)
UI admin/sous_chef che legge office_items e mostra problemi già classificati con opzioni.
Leggi PROMPT_UFFICIO.md per la spec completa.

---

## LAVORO DA FARE IN QUESTA SESSIONE

### Fix prioritario — souschef-scan timeout

**Approccio consigliato — bot dedicato:**
Invece di mandare tutto all'AI in una volta, creare `bot-invoice-scanner` che:
1. Fa le query SQL in modo mirato — solo ingredienti con problemi specifici
2. Manda all'AI contesti piccoli (max 20 ingredienti per chiamata)
3. Scrive i risultati in `invoice_warnings` come fa ora souschef-scan
4. Eventualmente scrive anche in `office_items` (sezione finanziaria de L'Ufficio)

**Alternativa più semplice:**
Modificare `fetchEverything()` in souschef-scan per mandare meno dati:
- GHOST: solo ingredienti senza nessun record in ingredient_vendors (query SQL diretta, no AI)
- NOLINK: solo ingredienti per_case con conversion_to_base IS NULL (query SQL diretta, no AI)
- L'AI serve solo per generare il messaggio/suggestion, non per trovare i problemi

**La seconda alternativa è più veloce e più affidabile** — i problemi li trova il SQL, l'AI scrive solo il testo human-readable. Contesto minimo → zero timeout.

### Verificare stato office_items
Controllare cosa c'è già nella tabella — quanti item, quali source, quali status.
Verificare se bot-tell-chef-reader sta scrivendo correttamente.

### Verificare colonne mancanti su chef_reports
bot-tell-chef-reader fa update su: souschef_suggestion, souschef_at, report_type
Verificare che queste colonne esistano nella tabella.

---

## REGOLE OPERATIVE — INVIOLABILI
1. Leggi SEMPRE i file da GitHub live prima di modificarli
2. Bumpa sw.js in ogni push che tocca file visibili all'utente
3. Dichiara ogni modifica prima di farla, aspetta conferma da Max
4. MAI pushare su main — sempre brigade-main
5. node --check su ogni JS prima di pushare
6. SC-PRICE-001 è ELIMINATO PERMANENTEMENTE — non reintrodurlo mai
7. Una cosa alla volta con Max — One Question Rule

---

## COME INIZIARE

1. Leggi i file MD su GitHub
2. Esegui questa query per vedere stato office_items:
   `SELECT source, priority, status, count(*) FROM office_items GROUP BY source, priority, status;`
3. Esegui questa per verificare colonne chef_reports:
   `SELECT column_name FROM information_schema.columns WHERE table_name = 'chef_reports';`
4. Proponi a Max quale approccio usare per il fix di souschef-scan — aspetta conferma prima di scrivere codice
