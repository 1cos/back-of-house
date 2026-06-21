# PROMPT PROSSIMA SESSIONE — Brigade v304

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi tutti i file MD da brigade-main (BACKLOG, DECISIONS, DB_SCHEMA, VISION, WARNINGS, SPEC)
3. Leggi SEMPRE i file da GitHub — mai da memoria o /mnt/project/

---

## STATO ATTUALE — 2026-06-21 (fine sessione)

### Versione frontend: v304
- sw.js: boh-v304
- Focus Mode disabilitato la domenica (fix v303)
- Bot Guardiano Ricette deployato (bot-recipe-guardian v1) — cron 6AM CDT
- office.js v304: bottone "Apri Ricetta" per avvisi bot-recipe-guardian

---

## LAVORO FATTO IN QUESTA SESSIONE

### FASE 5 — COMPLETATA ✅
Tutti i prep_tasks attivi hanno `unit` e `expected_duration_days`.

**Modifiche strutturali:**
- Gnocco → Gnocco Dough; Gnocchi aggiunto (Fresh Pasta)
- Butter archiviato → Diced Butter rimane
- Chicken → Cube Grilled Chicken; Diced Chicken archiviato
- Pistachio crumble, Avocado, Dressing, Cacio cream (Sauté), Lobster sauce, Peppercorns Demi, Pesto → archiviati
- Nuovi task: Gnocchi, Lobster Prepared, Artichoke Sauce, Risotto Base (Sauté, batch, 4gg), Bechamel (Saucier, batch, 3gg)
- 8 task dressing: Make + Check per Citronnette/Ranch/Caesar/Balsamic Dressing
- Check Blue Cheese (Salad)

**Note operative per Fase 7 (Bot 3):**
- Fettuccine freezer: max 9 contenitori (40 nests). Consumo settimana: 278 nests = 7 contenitori. 1 giornata produzione = min 7 contenitori.
- Spaghetti freezer: max 14 contenitori (40 nests). Consumo settimana: 365 nests = 10 contenitori.
- Pasta: Bot 3 usa capacità freezer come tetto, non solo consumo
- Dressing: batch = 1 gallone (3.785 lt). Arrotonda sempre al gallone intero superiore.
- Spinach: unità = porzioni (coppettine alluminio 80g)
- Wheel Pasta = 2 nests spaghetti (76 porzioni = 152 nests in una settimana)

### FASE 6 — COMPLETATA ✅
`recipe_bom.prep_task_id` aggiunto e collegato.

**Link attivi:**
| Sub-ricetta | prep_task_id | Task | Stazione |
|---|---|---|---|
| ARRABBIATA | 233 | Arrabbiata sauce | Saucier |
| Artichoke Sauce | 398 | Artichoke Sauce | Sauté |
| BASIL OIL | 236 | Basil oil | Fresh Pasta |
| Bechamel | 400 | Bechamel | Saucier |
| CACIO E PEPE SAUCE | 288 | Cacio e pepe | Saucier |
| GNOCCO FRITTO DOUGH | 271 | Gnocco Dough | Fresh Pasta |
| MK-RAGU | 305 | Ragu | Saucier |
| POMODORO SAUCE | 304 | Pomodoro | Saucier |
| Risotto Base | 399 | Risotto Base | Sauté |
| SALMORIGLIO | 256 | Salmoriglio | Sauté |
| SLICED MUSHROOM | 298 | Mushrooms | Pasta |
| SPAGHETTI FRESH PASTA | 314 | Spaghetti | Fresh Pasta |
| Tempura Batter | 283 | Tempura | Oven |
| TOMATO X BRUSCHETTA | 332 | Bruschetta | Salad |

**Senza link (fuori menu / zero vendite):**
- WILDBOAR RAGU — fuori menu, skip
- Zeno's Spaghetti — eliminata dal DB

**Basil Oil Salad Station (id 326)** = solo check operativo, NON nel BOM

---

## PROSSIMA SESSIONE — FASE 7

### FASE 7 — Riscrivere Bot 3 (bot-preplist-builder)

**Nuova logica:**
```
pos_production_daily (piatti venduti × porzioni fired)
    ↓ via recipes.pos_name
recipe_bom (componenti × quantità per porzione)
    ↓ via recipe_bom.prep_task_id
prep_tasks (suggested_qty per stazione)
```

**Regole speciali da implementare:**
- Pasta fresca: tetto = capacità freezer (non solo consumo)
  - Fettuccine: max 9 contenitori, 40 nests/contenitore
  - Spaghetti: max 14 contenitori, 40 nests/contenitore
  - 1 giornata produzione = min 7 contenitori
- Dressing: arrotonda al gallone intero superiore (mai frazioni di gallone)
- Spinach: calcola in porzioni (coppettine 80g)
- Buffer +10% come prima, arrotonda al mezzo superiore
- Non sovrascrivere mai qty reale — solo suggested_qty

---

## TASK APERTI

- Rinominare "Manager Station" → "Coordinator Station" in prep_tasks, focus-mode.js, closing.js, DB
- BOM da completare (zero vendite, bassa priorità): Asparagus, Lasagna Meal, Maccheroni Arrabbiata/Ragu, Ravioli Limone, Pappardelle Wildboar, Branzino Table Side, Scaloppina Ai Funghi

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
11. Domenica niente Focus Mode (fix v303 già deployato)
