# PROMPT PROSSIMA SESSIONE — Brigade v304

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi tutti i file MD da brigade-main (BACKLOG, DECISIONS, DB_SCHEMA, VISION, WARNINGS, SPEC)
3. Leggi SEMPRE i file da GitHub — mai da memoria o /mnt/project/

---

## STATO ATTUALE — 2026-06-21 (fine sessione serale)

### Versione frontend: v304
### Bot 3: v3 deployato (bot-preplist-builder v3)

---

## LAVORO FATTO OGGI

### FASE 5 ✅ — tutti i prep_tasks hanno unit e expected_duration_days
### FASE 6 ✅ — recipe_bom.prep_task_id collegato (14 sub-ricette)
### FASE 7 ✅ — Bot 3 v3 deployato con logica shelf life

### Ricette sistemate oggi:
- Fettuccine Allo Scoglio — rinominata (era SPAGHETTI ALLO SCOGLIO), pos_name aggiunto, fettuccine nel BOM
- Mediterranean Salad — pos_name aggiunto (era SUMMER SALADE)
- Siciliana — pos_name aggiunto (era Orata Sicilian Way → "Siciliana"), SICILIAN MIX 50g aggiunto al BOM
- Ribeye Prime Green Peppers Corn — ricetta e BOM creati (340g Ribeye + 5g Ribeye Salt)
- Bresaola — ricetta e BOM creati (40g Bresaola + 50g Arugula + 10g Parmesan Flakes + 10g Balsamic Glaze + 10g Citronnette + 30g Bruschetta)
- Fried Calamari — pos_production_daily ricalcolata per 15-20 giugno (era mancante per alias sbagliato)
- Fettuccine Arrabbiata Half — nuova ricetta (side della Chicken Parmesan): 1 nest fettuccine + 100g Arrabbiata
- Chicken Parmesan BOM — aggiunta Fettuccine Arrabbiata Half come side (i 50g Arrabbiata sulla cotoletta restano)
- Calamari BOM — sostituito ITEM Arrabbiata Sauce 5000g con RECIPE ARRABBIATA 50g per porzione

### Fuori menu (da ignorare nel BOM):
- Chicken Lemon Piccata, Bruschetta Board, Shrimp Cocktail, Scallops Asparagus Gnocchi

---

## PRIMA COSA DA FARE NELLA PROSSIMA SESSIONE

### OBIETTIVO: verificare che Bot 3 v3 calcoli correttamente quanta Arrabbiata fare

**La domanda di Max:** "Quanta Arrabbiata devo fare domani?"
**La risposta attesa:** Bot 3 v3 guarda shelf life (7gg), calcola i prossimi 6 giorni di servizio (Lun-Sab), per ogni giorno prende la media storica dello stesso DOW, moltiplica per grammi BOM, somma tutto + 10%.

**Problema da verificare nella prossima sessione:**
Nella simulazione finale di questa sessione, lunedì/martedì/venerdì mostravano 0 dati storici in pos_production_daily. Questo è strano perché abbiamo già i dati della settimana 15-20 giugno completi. Il problema è probabilmente nella query del bot che usa day_of_week ma pos_production_daily ha il campo day_of_week con spazi (es. "Monday   " invece di "Monday") — VERIFICA questo prima di tutto.

**Passi da fare:**
1. Leggi i file MD da GitHub
2. Controlla pos_production_daily: `SELECT DISTINCT day_of_week, COUNT(*) FROM pos_production_daily WHERE sale_date >= '2026-06-15' GROUP BY day_of_week`
3. Se ci sono spazi nel campo day_of_week → il bot v3 non matcha → fixare con TRIM() nella query del bot
4. Redeploya bot-preplist-builder con TRIM(day_of_week) nel confronto
5. Simula il calcolo Arrabbiata manualmente per confermare il risultato
6. Poi chiedi a Max: "La risposta è X kg — ti torna?"

---

## LOGICA BOT 3 v3 (già deployato)

```
Per ogni prep_task:
  shelfLife = expected_duration_days (es. Arrabbiata = 7gg)
  serviceDays = prossimi shelfLife giorni esclusa domenica
  
  Per ogni giorno in serviceDays:
    dow = giorno della settimana
    Per ogni ricetta nel BOM di questo task:
      avg = media storica porzioni vendute stesso DOW (ultimi 90gg)
      dayTotal += avg × quantity_bom
  
  suggested = sum(dayTotal) × 1.1 (buffer)
  arrotonda al mezzo superiore
```

**Regole speciali già nel bot:**
- Pasta: tetto freezer (Spaghetti max 14 contenitori, Fettuccine max 9, min 7)
- Dressing: arrotonda al gallone intero superiore
- Domenica = giorno chiuso, non contare

---

## LINK BOM → PREP_TASK attivi (Fase 6)

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

---

## TASK APERTI

- Rinominare "Manager Station" → "Coordinator Station" in prep_tasks, focus-mode.js, closing.js, DB
- pos_production_daily: rigenerare dati storici per tutti i piatti (pipeline corretto ma dati vecchi mancanti)
- BOM da completare (zero vendite): Asparagus, Lasagna Meal, Maccheroni Arrabbiata/Ragu, Ravioli Limone, Pappardelle Wildboar, Branzino Table Side, Scaloppina Ai Funghi
- Dressing: ricette Make Citronnette/Ranch/Caesar/Balsamic da creare con BOM (base = 1 gallone)

---

## REGOLE OPERATIVE SESSIONE

1. Leggi SEMPRE i file da GitHub live prima di modificare
2. Fetch SHA fresco immediatamente prima di ogni PUT
3. Dichiara tutte le modifiche prima di scrivere codice — aspetta approvazione Max
4. Bumpa boh-vN in sw.js ad ogni push
5. node --check file.js prima di ogni push
6. Tocca solo i file esplicitamente discussi
7. Commit message: "vN filename — descrizione"
8. Tutto su brigade-main, MAI main
9. pos_production_daily.total_portions è colonna generata — non fare UPDATE manuale
10. Conflict target upsert: (sale_date, canonical_name)
11. Domenica niente Focus Mode (fix v303 già deployato)
12. day_of_week in pos_production_daily può avere spazi extra — usare TRIM() nei confronti
