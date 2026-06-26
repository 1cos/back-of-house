# SESSIONE: Fix suggested_qty Bot 3

## Leggi prima
Tutti i file MD da brigade-main + questo prompt.
Supabase: ydqmumpytgrlceuinoqt — Branch: brigade-main — Versione: v349

## Problema
`bot-preplist-builder-v5` calcola `suggested_qty` in grammi
(porzioni vendute × grammi per porzione dal BOM) ma salva il valore
grezzo con l'unità della prep task (es. "batch", "buste").
Risultato: numeri assurdi → "6087 batch", "14262 batch", "3344 buste".

## Visione di Max
I ragazzi ragionano in unità di acquisto — non "6 kg" astratti
ma "quante latte apro". Es: Arrabbiata → latta di pelato = 3 kg
→ il bot deve dire "2 latte".

## Piano
1. Decidere con Max l'unità di output per categoria:
   - Salse con base_weight_g → kg come primo step semplice
   - Poi valutare unità di acquisto (latte, buste) — richiede
     ingrediente driver da ingredient_vendors
2. Nel bot: dopo aver calcolato total in grammi,
   dividere per base_weight_g della ricetta → numero reale
3. Pulire i suggested_qty assurdi già nel DB (v5, numeri enormi)

## Stato DB prep_tasks (campione)
- Arrabbiata: suggested_qty=6087, unit=batch (base_weight_g=5500g → 1.1 batch = corretto)
- Pomodoro: suggested_qty=14262, unit=batch (base_weight_g=6122g)
- Cacio e pepe: suggested_qty=9665, unit=batch (base_weight_g=6000g)
- Basil oil: suggested_qty=3344, unit=buste (base_weight_g=2000g)
- Ragu: suggested_qty=7242, unit=batch (base_weight_g=200g — sembra sbagliato il base_weight_g)

## Regole inviolabili
- SHA fresco prima di ogni PUT
- node --check prima di push
- Bump boh-vN in sw.js ad ogni push (verifica live prima)
- Solo brigade-main, mai main
- Conferma piano con Max prima di scrivere codice
