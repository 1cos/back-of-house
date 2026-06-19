# PROMPT PROSSIMA SESSIONE — Brigade v273

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Versione: **v273**
- souschef-chat: v23
- process-invoice: v29
- souschef-scan: v10

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

## SESSIONE 2026-06-19 — Fruge Parser (v267-v273)

### Cosa e stato fatto
- **Fruge parser v5** in `vendor-parser-ui.js` — riscrittura completa da zero
- Logica: regex su riga singola, lookahead righe successive per peso lb
- 3 tipi di pack:
  - TIPO 1: LB dirette (catchweight) -> shipped_qty LB
  - TIPO 2: BG/GA -> cerca peso lb nella descrizione o righe successive
  - TIPO 3: CA -> moltiplicazione NxN nella descrizione o righe successive
- `pack_description` = peso totale in LB (es. "10 LB", "8 LB") — cosi la UI calcola $/100g identico a Hardies
- `_cost_per_100g` e `cost_per_lb` calcolati nel parser
- Fix UI `vendor-documents-review.js`: legge `_cost_per_100g`, `cost_per_lb`, `total_weight_lb` dal parser Fruge

### Problema aperto — Fruge parser
- **Parser funziona nel tester** (vendor-parser-ui.js) — tutti gli item corretti
- **Nel flusso reale** (email -> Gmail -> Supabase Storage -> Processa tutti) i calcoli $/100g non escono sempre corretti
- Causa probabile: PDF.js nel flusso reale produce raw_text con spaziatura diversa dal tester
- **Lunedi lancio beta** — parser Fruge non e priorita, si riprende dopo il lancio
- Il flusso email->Storage->pdf_received funziona correttamente
- Le fatture Fruge arrivano nell'app, vengono processate, ma i calcoli $/100g sono da verificare

### Fix UI applicate (NON toccare Hardies)
- `vendor-documents-review.js`: per100g usa `_cost_per_100g` se presente (solo Fruge lo produce)
- `vendor-documents-review.js`: totalG usa `total_weight_lb` se presente
- `vendor-documents-review.js`: price usa `cost_per_lb` se presente
- Hardies non e toccata — questi campi non esistono nel parser Hardies

---

## PRIORITA LANCIO BETA LUNEDI

### Cosa serve per il lancio
- App deve funzionare per la brigata: Chat, Prep, Closing, Tell Chef
- Kitchen Display (display.html) deve funzionare
- Bug UI noti da risolvere prima del lancio:
  - [x] BUG: ai-translate chiamato decine di volte per pagina — RISOLTO 2026-06-19
  - [x] BUG: L'Ufficio realtime non si aggiorna — RISOLTO 2026-06-19
  - [ ] BUG: Kitchen Display si blocca quando si apre/chiude L'Ufficio
  - [ ] BUG: send button sovrapposto al microfono in chat (iPhone)

### NON priorita per il lancio
- Fruge parser calcoli $/100g — riprende dopo lancio
- Bottoni L'Ufficio (Archivia/Risolto/Investiga)
- Yesterday/Weekly Highlights UI
- Bot 4 Fase 2
- Bot 5 versione B

---

## PRIORITA POST-LANCIO

### 1. Fruge parser — fix calcoli
- Riprocessare le fatture Fruge dopo fix
- Verificare $/100g su tutti i tipi di pack

### 2. Bottoni L'Ufficio — sessione dedicata urgente
- Archivia / Risolto / Investiga non eseguono ancora

### 3. Yesterday / Weekly Highlights
- Tab da costruire completamente

### 4. Bot 4 Fase 2 — esecuzione automatica Tell Chef

### 5. Bot 5 versione B — food cost %

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
