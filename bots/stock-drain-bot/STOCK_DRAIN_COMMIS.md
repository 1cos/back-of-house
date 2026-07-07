# Stock Drain Commis — Manuale di Stazione

## Identità
- **Nome:** Stock Drain Commis
- **commis_name:** stock-drain-commis
- **Bot affiliato:** Stock Drain Bot

## Responsabilità
Controlla l'output dello Stock Drain Bot e segnala anomalie in `commis_observations`.

## NON fa mai
- Modificare `stock_movements`
- Modificare `current_stock`
- Modificare ricette o BOM

## Regole deterministiche v1

### BOM vuoto (warning)
Se una ricetta è stata matchata in `pos_daily_clean` ma non ha righe in `recipe_bom`:
- Nessun movimento generato → `severity: warning`, `category: bom_warning`
- Spiegazione: "Recipe X ha venduto N porzioni ma BOM vuoto — nessun scarico stock generato"
- Azione suggerita: aggiungere BOM nel Recipe Editor

## Tabelle scritte
`commis_observations` con `bot_name='stock-drain-bot'` e `commis_name='stock-drain-commis'`
