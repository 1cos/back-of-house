# Prompt Prossima Sessione — Brigade

Carica sempre in questo ordine:
1. PROMPT_PROSSIMA_SESSIONE.md da brigade-main
2. BOH_OS_SPEC.md da brigade-main
3. BOH_OS_BACKLOG.md da brigade-main
4. BOH_OS_DECISIONS.md da brigade-main
5. BRIGADE_VISION.md da brigade-main

---

## Stato attuale — Brigade v114

Supabase project: ydqmumpytgrlceuinoqt
Deploy: https://1cos.github.io/back-of-house — branch brigade-main
AI: OpenRouter LLaMA 3.3 70B (fallback Groq)

---

## Struttura file admin (refactored v112)

admin.js è stato diviso in moduli separati:
- js/admin.js              ← shell: escHtml, escAttr, showAdminMenu/hideAdminMenu
- js/admin-prep.js         ← gestione prep tasks
- js/admin-ingredients.js  ← bootstrap, cleanup, similarity, vendor match
- js/admin-chef-ai.js      ← Chef AI settings
- js/auth.js               ← autenticazione PIN-only + gestione utenti

---

## Sistema autenticazione — PIN-only (v113)

Password e password_hash rimossi completamente.
Ogni cuoco accede con PIN 4 cifre.
- openChangePIN() — il cuoco cambia il proprio PIN dal profilo
- resetUserPIN() — l'admin imposta un nuovo PIN dal pannello Brigata
- hashPassword, checkFirstLogin, saveFirstLogin, openChangePassword — RIMOSSI

---

## Brigata attuale (15 utenti attivi)

| Nome | Stazione | Lingua |
|---|---|---|
| Anto | Fresh Pasta Station | IT |
| Chance | Oven Station | EN |
| Cole | Saucier Station | EN |
| David | Salad Station | EN |
| Genova | Oven Station | EN |
| Haley | Oven Station | EN |
| Maddison | Pasta Station | EN |
| Max | Admin — nessuna stazione | EN |
| Preston | Salad Station | EN |
| Rachael | Oven Station | ES |
| Samantha | Pastry Station | EN |
| Sofia | Plating Station | EN |
| Tela | Operations/Manager (ordini, inventario, scadenze) — nessuna stazione | EN |
| Todd | Fresh Pasta Station | EN |
| Zuu | Salad Station | ES |

---

## 10 stazioni attive

Oven Station · Fresh Pasta Station · Pasta Station · Sauté Station · Saucier Station · Plating Station · Salad Station · Pastry Station · Tableside · Freezer

---

## Parser fornitori — tutti e 4 completi (v109)

| Fornitore | File | Logica prezzi |
|---|---|---|
| Hardie's | hardies-invoice.js | qty x price vs extended → per_lb o per_case |
| FreshPoint | freshpoint-invoice.js | Sempre per_case, peso da pack size |
| Fruge Seafood | fruge-invoice.js | Sempre per_lb, LB esplicito nel prezzo |
| Ben E. Keith | bek-invoice.js | Sempre per_case, peso da pack size N/M UNIT |

---

## Prossimi task — priorità

### Immediati
1. **Checklist sera → preplist mattina** — il ciclo fondamentale Brigade
   - Checklist per stazione (già esiste need_tomorrow)
   - Preplist mattina filtrata per stazione del cuoco loggato
   - Ricetta riporzionabile inline dalla preplist
   - Messaggio chat automatico alla chiusura turno
2. **Bulk move prep** — spostare più prep da una stazione all'altra in blocco (oggi si fa una alla volta)
3. **Warning Center OQR** — opzioni con valori concreti, scan autonoma ogni 30 min

### Backlog
4. Home banner warning (severity colors, visibilità per ruolo)
5. ALT-MISS-001 — item mancante → assign ruolo → persona
6. TripleSeat — aspetta credenziali admin
7. Display cucina TV — pagina fullscreen preplist live
8. SevenShift — verificare API disponibili
9. Tela module — ordini fornitori, inventario, scadenze (da progettare)

---

## Pendenti urgenti

- Romaine peso — Max deve pesare una testa di romana e inserirlo nel DB
- FreshPoint articoli: conversion_to_base e price_per_100g null su doc già parsato
- Tela: ruolo operations non ha ancora una sezione nell'app

---

## Regole operative (SEMPRE)

1. Leggi SEMPRE il file da GitHub prima di modificarlo — mai dalla memoria
2. Usa API GitHub per leggere (base64 decode) — non raw CDN che ha cache
3. Bumpa sempre sw.js nello stesso push — mai file separati
4. Verifica via API dopo ogni push — decodifica base64
5. Supabase project: ydqmumpytgrlceuinoqt
6. Branch deploy: brigade-main (MAI main)
7. File completi — no patch parziali
8. Dichiara cosa cambia, aspetta conferma di Max prima di modificare
