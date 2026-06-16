# PROMPT PROSSIMA SESSIONE — Brigade

## PRIMA DI TUTTO

1. Leggi il file x_claude_GIthub.txt nel progetto — contiene il token GitHub
2. Leggi questi file da brigade-main:
   - BOH_OS_BACKLOG.md
   - BOH_OS_DECISIONS.md
3. Per leggere file GitHub: GET https://api.github.com/repos/1cos/back-of-house/contents/{path}?ref=brigade-main
4. Prima di modificare qualsiasi file JS: scaricalo fresco da GitHub, modificalo, ricaricalo
5. Bumpa sempre sw.js nello stesso push
6. Chiedi sempre a Max un aggiornamento su cosa ha fatto dall'ultima sessione

---

## STATO — Brigade v195

- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Kitchen Display: https://1cos.github.io/back-of-house/display.html (LIVE su Insignia Fire TV)
- App NON ancora distribuita alla brigata — tutti i dati nel DB sono di test

---

## BUG ATTIVI DA RISOLVERE

### 1. Closing — chiusura stazioni errata (PRIORITA' ALTA)
- Fix _closingStationLock applicata in v195 ma comportamento da verificare
- Il bug: goCheckStation() nel popup forgotten cambiava station2 globalmente
- Dopo il fix c'era ancora comportamento strano — test non completato
- Da fare: test pulito con una stazione sola, verificare DB dopo chiusura
- Da investigare: renderS() post-chiusura — possibile problema visivo

### 2. CORS error su send-push (PRIORITA' ALTA)
- Edge Function send-push blocca richieste da 1cos.github.io
- Errore: "blocked by CORS policy" in console (closing.js:137 e operation-notes.js)
- Non blocca la chiusura ma la push non arriva
- Da fare: aggiungere Access-Control-Allow-Origin header alla Edge Function send-push

---

## SOUS CHEF AI — PRIORITA' INGEGNERISTICA

In ordine di impatto / facilità:

### 1. Migliorare prompt sc-nightly-brief (ALTA)
- Problema: genera frasi vaghe ("La brigata ha lavorato in modo efficiente")
- Soluzione: iniettare dati strutturati reali da v_prep_daily, pos_daily_summary, v_item_alerts
- Tono richiesto: chef di linea, ultra-conciso, max 40 parole, zero convenevoli
- Zero nuova infrastruttura — solo migliorare il prompt nella Edge Function

### 2. AI parsing post-salvataggio su operation_notes (MEDIA)
- Dopo che un ragazzo salva la nota serale, chiamata Groq con prompt 3 righe
- Estrae: sentiment (positive/neutral/negative) + 2-3 tags operativi
- Fa UPDATE sulla riga appena inserita
- Costo: ~50 token per nota
- Sblocca: analisi storica del morale brigata, pattern servizio

### 3. skills JSONB su users (MEDIA)
- ALTER TABLE users ADD COLUMN skills JSONB DEFAULT '[]';
- Esempio: ["pasta fresca", "pastry", "oven"]
- Sblocca Livello 5 Sous Chef: "chi può coprire il grill stasera?"
- 10 minuti di lavoro

### 4. Connettere souschef-chat a recipe_bom e ingredient_monthly_spend (MEDIA)
- Le tabelle esistono ma souschef-chat v15 non le usa
- recipe_bom = grafo dipendenze (Lasagna → Ragù + Besciamella + Pasta)
- ingredient_monthly_spend = storico spesa per analisi food cost
- Richede lettura Edge Function souschef-chat per capire cosa inietta nel contesto

---

## FOCUS MODE — da costruire

Mockup approvato da Max (2026-06-16).

**Accesso:** swipe destra dalla home di Brigade → slide animation → Focus Mode
**Uscita:** swipe sinistra → torna Brigade normale

**Layout:**
- Header: nome cuoco + stazione + pallino online
- Hint bar: "← in progress · swipe · done →"
- 3 sezioni collassabili verticali con tap sul titolo:
  - To Do — bordo rosso, in cima
  - In Progress — bordo giallo
  - Done — collassata di default, opaca, in fondo
- Card swipe: destra = Done (verde), sinistra = In Progress (giallo)
- Soglia 60% larghezza per conferma (mani bagnate)
- Filtro automatico sulla stazione del cuoco loggato
- Realtime: si aggiorna quando altri completano prep

**Landscape mode:** da esplorare con Max — probabilmente 3 colonne side-by-side

**File da leggere prima:**
- js/prep.js (logica prep esistente)
- js/presence.js (per stazione utente loggato)

**Cosa NON toccare:**
- Logica salvataggio DB esistente
- Admin view prep
- Nessun altro modulo

---

## REGOLE OPERATIVE

1. Leggi sempre i file da GitHub prima di modificarli
2. Mai usare template literals multiriga o emoji nei file JS
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase: ydqmumpytgrlceuinoqt
6. Dichiara sempre cosa cambierai prima di scrivere codice
7. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
8. pos_item_aliases: 40 regole di produzione — usarla per tutte le stats
9. Tutti i dati DB sono test — non fare considerazioni su volumi o comportamenti utente
