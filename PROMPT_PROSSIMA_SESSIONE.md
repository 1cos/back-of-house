# PROMPT PROSSIMA SESSIONE — Brigade v274

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Versione: **v274** (sw.js attuale)
- souschef-chat: v23
- sc-nightly-brief: v12
- process-invoice: v29
- souschef-scan: v10
- ai-translate: v28

---

## GERARCHIA CUCINA — INVIOLABILE

| Ruolo | Nome |
|---|---|
| Executive Chef (NON owner) | Max |
| Chef Rover | Anto |
| Sous Chef sera | David |
| Sous Chef mattina | Colton |
| Pastry Chef | Samantha |
| Kitchen Manager (NON sous chef) | Tela |
| Chef de partie | Cole, Rachel, Sofia, altri |

---


## SESSIONE 2026-06-19 (d) — L'Ufficio Cassetti (v253-v258)

### Fatto
- v253 — Bottoni L'Ufficio differenziati per fonte (tell_chef/operation_note/ai_scan/sous_chef_chat)
- v254-v255 — Fix realtime L'Ufficio: office_items aggiunta a supabase_realtime publication (era la causa root)
- v255 — Demo Bot: frequenza dinamica (cambio freq mentre bot in corsa riavvia timer)
- v256-v258 — L'Ufficio redesign: home con cassetti colorati + folder navigation fullscreen + swipe down to close
  - 7 cassetti: Da leggere / La Brigata / Chef AI / Prep & Check / Incongruenze / Miglioramenti / Fornitori / Dati
  - Routing fonte→cassetto: tell_chef+operation_note→brigata, ai_scan+sous_chef_chat→chefai, ecc.
  - Fix apostrofi: card costruite via DOM per evitare SyntaxError con testi contenenti apostrofi

### Bug aperti emersi
- BUG: Kitchen Display realtime si blocca aprendo/chiudendo L'Ufficio
- BUG: Bottone "Gest" news bar — dopo primo "Chiudi" item, modal sparisce invece di aggiornarsi

### Backlog annotato
- Sistema foto centralizzato: album unico per ricette + TV + Kitchen Display
- Kitchen Display multi-schermata con rotazione contenuti
- L'Ufficio → spostare in bottom bar
- Pulizia menu admin: verificare se Parser Test, Similarity, Vendor Match, Ingredient Cleanup, Bootstrap sono ancora usati

## SESSIONE 2026-06-19 (c) — Fix ai-translate storm (v269-v271)

### Problema risolto
ai-translate veniva chiamato decine di volte per pagina — esauriva i limiti API.

### Causa
- `news.js loadNews()`: per ogni alert attivo chiamava detect + translate ad ogni refresh (ogni 60s)
- `briefing.js loadBriefing()`: traduceva i punti del briefing ad ogni apertura home

### Fix applicati

**news.js (v269)**
- Nuova colonna DB: `alerts.translations JSONB` — { "it": "...", "en": "...", "es": "..." }
- `sendNews()`: al momento della creazione chiama ai-translate una volta sola per ogni lingua, salva in `translations`
- `loadNews()`: legge `n.translations[viewerLang]` dal DB — ZERO chiamate AI in lettura
- Realtime preservato intatto

**sc-nightly-brief v12 + briefing.js (v270-v271)**
- Nuove colonne DB: `briefing.points_en`, `points_es`, `points_staff_en`, `points_staff_es`
- `sc-nightly-brief` genera i punti in italiano, poi li traduce in EN+ES in parallelo, salva tutto
- `loadBriefing()` legge la colonna giusta in base a `user.lang` e ruolo — ZERO chiamate AI in lettura

### Risultato
| Chiamante | Prima | Dopo |
|---|---|---|
| news.js loadNews | ~360 chiamate/ora | 0 in lettura |
| briefing.js | 5 chiamate per apertura home | 0 |
| chat.js detect invio | 1 per messaggio | invariato (corretto) |
| chat.js traduzione ricezione | 1 per messaggio ricevuto | invariato (corretto) |
| recipes.js | 1 per apertura ricetta | invariato (on-demand) |

---

## SESSIONE 2026-06-19 — Fruge Parser (v267-v273)

### Cosa e stato fatto
- **Fruge parser v5** in `vendor-parser-ui.js` — riscrittura completa da zero
- 3 tipi di pack: LB catchweight, BG/GA peso da descrizione, CA moltiplicazione NxN
- Fix `vendor-documents-review.js`: legge `_cost_per_100g`, `cost_per_lb`, `total_weight_lb`

### Problema aperto — Fruge parser
- Parser funziona nel tester — nel flusso reale i calcoli $/100g non sempre corretti
- Causa: PDF.js nel flusso reale produce raw_text con spaziatura diversa dal tester
- Priorita: DOPO lancio beta

---

## PRIORITA LANCIO BETA

### Bug da risolvere prima del lancio
- [x] BUG: ai-translate chiamato decine di volte — RISOLTO 2026-06-19
- [x] BUG: L'Ufficio realtime non si aggiorna — RISOLTO 2026-06-19
- [ ] BUG: Kitchen Display si blocca quando si apre/chiude L'Ufficio
- [x] BUG: send button sovrapposto al microfono in chat (iPhone) — RISOLTO v274

### NON priorita per il lancio
- Fruge parser calcoli $/100g
- Bottoni L'Ufficio (Archivia/Risolto/Investiga)
- Yesterday/Weekly Highlights UI
- Bot 4 Fase 2
- Bot 5 versione B

---

## PRIORITA POST-LANCIO

### 1. BUG: Kitchen Display realtime si blocca
- Aprire/chiudere L'Ufficio interrompe il realtime del Kitchen Display
- Causa probabile: rimozione channel condiviso o conflitto subscription

### 2. BUG: send button sovrapposto al mic (iPhone)
- Bottone invio chat sovrapposto al microfono Chef AI — impossibile toccare

### 3. Bottoni L'Ufficio — sessione dedicata urgente
- Archivia / Risolto / Investiga non eseguono ancora

### 4. Yesterday / Weekly Highlights
- Tab da costruire completamente

### 5. Fruge parser — fix calcoli flusso reale
- Verificare formato raw_text da PDF.js nel flusso email->Storage
- Riprocessare fatture Fruge dopo fix

### 6. Bot 4 Fase 2 — esecuzione automatica Tell Chef

### 7. Bot 5 versione B — food cost %

---

## REGOLE OPERATIVE — INVIOLABILI
1. Leggi SEMPRE i file da GitHub (mai da memoria)
2. Bumpa sw.js in ogni push che tocca file visibili
3. Dichiara cosa cambierai prima di scrivere — aspetta conferma
4. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
5. MAI pushare su main — sempre brigade-main
6. node --check su ogni file JS prima di pushare
7. Chef AI non si chiama mai "Sous Chef" nell'interfaccia pubblica
8. MAI mostrare soldi/prezzi negli Highlights della brigata
9. Max = Executive Chef, MAI owner/proprietario
10. Tela = Kitchen Manager, MAI sous chef
11. NON toccare Hardies parser — funziona, non si tocca
