# PROMPT PROSSIMA SESSIONE — Brigade v304

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi tutti i file MD da brigade-main (BACKLOG, DECISIONS, DB_SCHEMA, VISION, WARNINGS, SPEC)
3. Leggi SEMPRE i file da GitHub — mai da memoria o /mnt/project/

---

## STATO ATTUALE — 2026-06-21 (fine sessione pomeriggio)

### Versione frontend: v304
- sw.js: boh-v304
- Focus Mode disabilitato la domenica (fix v303)
- Bot Guardiano Ricette deployato (bot-recipe-guardian v1) — cron 6AM CDT
- office.js v304: bottone "Apri Ricetta" per avvisi bot-recipe-guardian

---

## LAVORO FATTO IN QUESTA SESSIONE (Fase 5)

### FASE 5 — COMPLETATA ✅
Tutti i 118+ prep_tasks attivi ora hanno `unit` e `expected_duration_days`.

### Modifiche strutturali ai prep_tasks:
- **Gnocco** → rinominato **Gnocco Dough** (pasta per Coccoli Toscani)
- **Gnocchi** → nuovo task aggiunto (Fresh Pasta Station, porzioni, 7gg)
- **Butter** → archiviato (sostituito da Diced Butter)
- **Chicken** → rinominato **Cube Grilled Chicken**
- **Diced Chicken** → archiviato (stesso di Cube Grilled Chicken)
- **Pistachio crumble** → archiviato
- **Avocado** → archiviato (salmon salad esce dal menu)
- **Dressing** → archiviato, sostituito da 8 task specifici:
  - Make Citronnette / Make Ranch / Make Caesar / Make Balsamic Dressing (batch, 7gg)
  - Check Citronnette / Check Ranch / Check Caesar / Check Balsamic Dressing (squeezer, 1gg)
- **Cacio cream (Sauté Station)** → archiviato, sostituito da Artichoke Sauce
- **Lobster sauce** → archiviata
- **Peppercorns Demi** → archiviato
- **Pesto** → archiviato
- **Lobster Prepared** → nuovo task (Saucier Station, buste, 30gg) — soffritto in busta congelata
- **Artichoke Sauce** → nuovo task (Sauté Station, batch, 3gg)
- **Blue cheese** → rinominato **Check Blue Cheese** (porzioni, 7gg)

### Note operative importanti per Fase 7 (Bot 3):
- **Fettuccine freezer:** max 9 contenitori (40 nests ciascuno). Consumo settimana scorsa: 278 nests = 7 contenitori. Produzione: 1 giornata intera = min 7 impasti = 7 contenitori. Frequenza: 1 volta/settimana.
- **Spaghetti freezer:** max 14 contenitori (40 nests ciascuno). Consumo settimana scorsa: 365 nests = 10 contenitori. Produzione: 1 giornata intera. Frequenza: 1 volta/settimana.
- **Regola produzione pasta:** Bot 3 deve considerare capacità freezer come tetto massimo, non solo consumo.
- **Dressing:** batch = 1 gallone (3.785 lt) — il contenitore è da 1 gallone. Bot 3 arrotonda sempre al gallone intero superiore (mai 1.5 galloni).
- **Spinach:** unità = porzioni (coppettine alluminio da 80g). Es: 22 coppettine = 22 porzioni.
- **Wheel Pasta** = 2 nests spaghetti. È il piatto con più consumo: 76 porzioni = 152 nests in una settimana (42% del totale spaghetti).

### Verifica nests settimana 15-20 giugno:
- Fettuccine totale: **278 nests** (~40/giorno)
- Spaghetti totale: **365 nests** (~61/giorno) — include Wheel Pasta, Cacio e Pepe, Ragù, Pomodoro, tutti i kids e half

---

## PROSSIMA SESSIONE — FASE 6

### FASE 6 — Aggiungere prep_task_id a recipe_bom
**Lavoro da fare:**
1. `ALTER TABLE recipe_bom ADD COLUMN prep_task_id bigint REFERENCES prep_tasks(id)`
2. Per ogni riga BOM che rappresenta un prep_task (es. Arrabbiata, Ragù, Pomodoro, Fettuccine nests, Spaghetti nests, ecc.), collegare il link

### FASE 7 — Riscrivere Bot 3 (bot-preplist-builder)
Nuova logica:
```
pos_production_daily (piatti venduti × porzioni)
    ↓ via recipe.pos_name
recipe_bom (ingredienti × quantità)
    ↓ via prep_task_id
prep_tasks (suggested_qty per stazione)
```

Regole speciali Bot 3 da implementare:
- Pasta fresca: tetto = capacità freezer (non solo consumo)
- Dressing: arrotonda al gallone superiore (mai frazioni)
- Spinach: calcola in porzioni (coppettine 80g), non in kg

---

## ALTRI TASK APERTI (da sessioni precedenti)

### Da fare ancora in Fase 5:
- Rinominare "Manager Station" → "Coordinator Station" in prep_tasks, focus-mode.js, closing.js, DB

### BOM rimasti incompleti (zero vendite 30gg — bassa priorità):
- Texana Soup (skip — no ricetta)
- Asparagus (6 fired — da fare)
- Lasagna Meal (1 fired — da fare)
- Maccheroni Arrabbiata, Maccheroni Al Ragu, Ravioli Limone, Pappardelle Wildboar, Branzino Table Side, Zeno's Spaghetti, Scaloppina Ai Funghi

---

## ARCHITETTURA DECISIONALE — punti fermi

### BOM
- `base_servings = 1` = 1 piatto venduto al POS
- Ingredienti nel BOM = quantità per 1 porzione
- Sub-ricette puntano alle ricette base (Risotto Base, Salmoriglio, Arrabbiata, ecc.)
- `notes = 'garnish'` per ingredienti decorativi

### Chef AI — scrittura ricette (sessione futura)
- Dare a Chef AI accesso in scrittura SOLO per ricette
- Flusso: Max detta a voce → Chef AI mostra riepilogo → Max conferma → salva su DB

---

## REGOLE OPERATIVE SESSIONE

1. Leggi SEMPRE i file da GitHub live prima di modificare
2. Fetch SHA fresco immediatamente prima di ogni PUT
3. Dichiara tutte le modifiche prima di scrivere codice — aspetta approvazione Max
4. Bumpa `boh-vN` in sw.js ad ogni push
5. `node --check file.js` prima di ogni push
6. Tocca solo i file esplicitamente discussi
7. Commit message: `"vN filename — descrizione"`
8. Tutto su brigade-main, MAI main
9. `pos_production_daily.total_portions` è colonna generata — non fare UPDATE manuale
10. Conflict target upsert: `(sale_date, canonical_name)`
11. Nomi ricette = identici al POS — mai cambiare pos_name, cambiare il title della ricetta
12. Domenica niente Focus Mode (fix v303 già deployato)
