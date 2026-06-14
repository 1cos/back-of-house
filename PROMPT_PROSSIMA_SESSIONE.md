# Prompt Prossima Sessione — Brigade

Carica sempre in questo ordine:
1. PROMPT_PROSSIMA_SESSIONE.md da brigade-main
2. BOH_OS_SPEC.md da brigade-main
3. BOH_OS_BACKLOG.md da brigade-main
4. BOH_OS_DECISIONS.md da brigade-main
5. BRIGADE_VISION.md da brigade-main

---

## Stato attuale — Brigade v111

Supabase project: ydqmumpytgrlceuinoqt
Deploy: https://1cos.github.io/back-of-house — branch brigade-main
AI: OpenRouter LLaMA 3.3 70B (fallback Groq)
Edge Functions: souschef-scan v2, souschef-chat v15

---

## PASSO 1 — COMPLETATO v111

Warning Center OQR funzionante al 100%:
- souschef-scan v2: AI calcola conversion_to_base dal pack, opzioni con valori concreti
- scApplyWarningOption: salva nel DB, ricalcola price_per_100g, segna resolved
- Warning risolto non riappare — scan controlla resolved per ingredient_id
- Scan automatica con orari Texas:
  - 06:30 Texas: scan mattina speciale (una volta al giorno)
  - 06:30-17:30: scan oraria in silenzio
  - 17:30-06:30: nessuna scan

---

## Parser fornitori — tutti e 4 completi (v109)

- Hardie's: qty x price vs extended → per_lb o per_case
- FreshPoint: sempre per_case, peso da pack size
- Fruge Seafood: sempre per_lb, LB esplicito nel prezzo
- Ben E. Keith: sempre per_case, peso da pack size N/M UNIT

---

## 5 PASSI — stato

PASSO 1 — Warning Center OQR: COMPLETO
PASSO 2 — Checklist sera → preplist mattina: DA FARE (prossima sessione)
PASSO 3 — TripleSeat: DA FARE (credenziali da Max)
PASSO 4 — Display cucina TV: DA FARE
PASSO 5 — SevenShift: DA FARE (verificare API)

---

## Prossima sessione — da dove iniziare

PASSO 2: Checklist sera → preplist mattina automatica
- Le checklist delle stazioni esistono gia nel DB
- Le preplist esistono gia nel DB
- Il collegamento automatico non esiste
- E il cuore del ciclo brigade: fine turno sera → lista lavori mattina

Pendenti minori:
- Scan 06:30 deve includere recap notturno (messaggi brigata + vendite + fatture)
- Romaine peso — Max pesa una testa e inserisce nel DB
- FreshPoint articoli: conversion_to_base e price_per_100g null (reimportare)

---

## Regole operative (SEMPRE)

1. Leggi SEMPRE il file da GitHub prima di modificarlo — mai dalla memoria
2. Usa API GitHub per leggere (base64 decode) — non raw CDN che ha cache
3. Bumpa sempre sw.js nello stesso push — mai separati
4. Verifica via API dopo ogni push — decodifica base64
5. Supabase project: ydqmumpytgrlceuinoqt
