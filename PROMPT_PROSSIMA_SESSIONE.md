# PROMPT PROSSIMA SESSIONE — Brigade v255

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Versione: **v257**
- souschef-chat: v21
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

Flusso comando: Max → Rover (Anto) → Sous Chef → Chef de partie

---

## CHEF AI — REGOLE

- Si chiama **Chef AI** — mai "Sous Chef AI"
- È il segretario digitale di Max — legge tutto, non modifica mai
- Il sous chef umano è David (sera) e Colton (mattina)
- Output: Briefing AI (Max only, tutto), L'Ufficio (Max only, tutto), Highlights (brigata+Max, MAI soldi)

---

## SESSIONI COMPLETATE

### Sessione 2026-06-18 — Bot System + Fix + Gerarchia
- Bot 1-5 tutti attivi (bot-price-guard, bot-chat-analyst, bot-preplist-builder, bot-tell-chef-reader, bot-food-cost-guard)
- souschef-scan fixato v10 — zero timeout (SQL trova problemi, AI scrive solo testo)
- process-invoice v29 — chiama bot-price-guard + bot-food-cost-guard dopo ogni import
- Nuove colonne: prep_tasks.suggested_qty/suggested_by/suggested_at, chef_reports.report_type
- Gerarchia cucina definita e scritta nei MD
- Chef AI definito ufficialmente — ruolo, regole, tre canali output

### Stato connessioni verificato (18 giugno 2026)
- ✅ 5 cron job attivi
- ✅ Briefing AI funzionante (14 generati)
- ✅ L'Ufficio: 26 item presenti, realtime CONFERMATO FUNZIONANTE
- ✅ 107 messaggi chat → Bot 2 gira stanotte
- ✅ 21 Tell Chef → Bot 4 classifica ogni ora
- ⏳ suggested_qty → Bot 3 gira stanotte (prima volta)
- ⏳ Bot 1 e Bot 5 → aspettano prima fattura importata

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. 🔴 Bottoni L'Ufficio — sessione dedicata urgente
- Archivia / Risolto / Investiga non eseguono ancora
- "Investiga" → apre Chef AI con contesto precaricato
- Unico bug rimasto nell'Ufficio (realtime già fixato)

### 2. 🟠 Yesterday / Weekly Highlights — sessione dedicata
- Tab da costruire completamente (UI manca, dati ci sono)
- Contenuto: porzioni, piatti top, ratio pasta/secondi, analisi chat
- MAI soldi, MAI prezzi — regola assoluta per la brigata
- Decidere con Max cosa mostrare esattamente

### 3. 🟠 Bot 4 Fase 2 — esecuzione automatica Tell Chef
- Quando Max approva "Aggiungi alla ricetta" → bot esegue materialmente
- Sessione dedicata

### 4. 🔵 Bot 5 versione B — food cost %
- Prerequisito: inserire selling_price nelle ricette
- Upgrade bot-food-cost-guard per food cost % reale + margine $

### 5. 🔵 office-ai → cron orario
- Analisi automatica ogni ora

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

