# PROMPT PROSSIMA SESSIONE — Brigade v265

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Versione: **v265**
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

## SESSIONE 2026-06-19 — Recipe BOM completo (v265)

### Cosa è stato fatto
- **Editor ricetta:** autocomplete ingredienti/sub-ricette nel campo nome
  - Verde = ingrediente da tabella `ingredients`
  - Blu = sub-ricetta da tabella `recipes`
  - Al salvataggio → scrive `recipe_bom` (DELETE + INSERT)
  - Retrocompatibile: righe vecchie senza autocomplete non perdono dati
- **recipe_bom.item_id** migrato da `integer` a `uuid` (FK → ingredients.id)
- **JSONB pulito:** sostituite ~170 varianti sporche con nomi canonici
  - Italiano → inglese: burro→Butter, farina→Flour, sale→Salt, ecc.
  - Typo: anchovie→Anchovy, gnocchi flower→Gnocchi Flour, ecc.
  - Varianti: vanilla essence/extract→Vanilla Bean, sage cutted→Sage, ecc.
- **14 ingredienti aggiunti** alla tabella `ingredients`:
  Parsley, Garlic, Black Pepper Whole, Black Pepper Ground, Sage,
  Bread Crumbs, Cornstarch, Bay Leaves, Sun Dried Tomatoes, Blackberries,
  Diced Tomato, Shallot, Vanilla Bean, Gelatine, Parmesan Cheese
- **recipe_bom popolata automaticamente:** 1.063 righe (1.050 ITEM + 13 RECIPE), 177 ricette
- **110 ingredienti irrecuperabili** rimasti fuori dal BOM (frasi, placeholder, SKU)

### Stato connessione POS → Ricette
- Campo `recipes.pos_name` → matcha `pos_production_daily.canonical_name`
- **8 ricette già collegate** al POS e funzionanti
- **15 canonical_name POS senza ricetta collegata:**

| canonical_name POS | category |
|---|---|
| Fried Calamari | appetizer |
| Fettuccine | pasta |
| Penne Midnight | pasta |
| Spaghetti | pasta |
| Spaghetti Al Ragu | pasta |
| Burrata | protein |
| Chicken | protein |
| Lobster tail | protein |
| Salmon fillet | protein |
| Scallops | protein |
| Shrimp | protein |
| Brussel Sprouts | side |
| Green Beans | side |
| Rosemary Potatoes | side |
| Sauteed Spinach | side |

---

## PROSSIMO TASK — Match pos_name

**Obiettivo:** collegare i 15 piatti POS alle ricette esistenti nel DB.

**Come fare:**
1. Per ogni canonical_name POS, trovare la ricetta corrispondente nel DB
2. Aggiornare `recipes.pos_name` con il canonical_name esatto del POS
3. Verificare che `pos_production_daily` abbia dati per quei piatti
4. Test: query che mostra porzioni vendute × BOM = ingredienti da produrre

**Poi:**
- Costruire la vista "cosa produrre domani" basata su vendite ieri × recipe_bom
- Collegare al Prep Coach / preplist

---

## PRIORITÀ SESSIONI FUTURE

### 1. 🔴 Match pos_name — PROSSIMA SESSIONE
- Collegare 15 piatti POS alle ricette DB
- Test calcolo produzione da vendite

### 2. 🔴 Bottoni L'Ufficio — sessione dedicata urgente
- Archivia / Risolto / Investiga non eseguono ancora

### 3. 🟠 Yesterday / Weekly Highlights
- Tab da costruire completamente

### 4. 🟠 Bot 4 Fase 2 — esecuzione automatica Tell Chef

### 5. 🔵 Bot 5 versione B — food cost %

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
