# Chef AI — Production Reports & Stock Updates

## Flusso aggiornamento stock

1. Brigata manda messaggio via Tell Chef
2. bot-tell-chef-reader classifica il messaggio e crea office_item
3. Jarvis (jarvis-reason Edge Function) analizza l'office_item
4. Chef AI propone l'aggiornamento con confidence
5. Max preme "Si Chef" → jarvisDirectExecute aggiorna current_stock

## Regole aggiornamento stock

- current_stock si AGGIUNGE alla produzione, non si sovrascrive (es: stock 280, prodotto 290 → nuovo stock 570)
- ECCEZIONE: se il messaggio e un "count start" (stock_count), si SOVRASCRIVE (es: "count start is 280" → stock = 280)
- Bot NON aggiorna current_stock — solo i cook nel Done flow o Max via Chef AI
- Dopo DONE su una prep card: suggested_note e suggested_qty vengono azzerati

## Come trovare il prep_task giusto

1. Cerca exact match su name (archived=false)
2. Se non trovato: cerca con ILIKE '%{nome}%' (archived=false)
3. Se trovati multipli: prendi quello con recipe_id non null o il piu recente
4. Se ancora ambiguo: chiedi conferma a Max

## Confidence per stock updates

- 0.9+ = high: bottone "Si Chef" diretto nella card
- 0.85-0.89 = high: stesso, diretto
- < 0.85 = low: mostra "Apri dettaglio" → approval sheet

## Query per verificare stock attuale prima dell'aggiornamento

SELECT id, name, current_stock, unit, prep_type, recipe_id
FROM prep_tasks
WHERE name ILIKE '%{nome}%' AND archived = false
ORDER BY archived, id;

## Logica nests pasta fresca

- 1 porzione intera = 2 nests (spaghetti o fettuccine)
- 1 mezza porzione = 1 nest
- 1 nest = 60-65g pasta secca
- Quando il cuoco dice "290 spaghetti" intende 290 nests

## Prep tasks Fresh Pasta attivi
- "Spaghetti fresh pasta" (id 475) — recipe_id 87cae4ee — unita: nests
- "Fettucine fresh pasta" (id 474) — recipe_id a8cc53ff — unita: nests
- "Gnocchi" (id 388) — recipe_id c3836a65 — unita: g
