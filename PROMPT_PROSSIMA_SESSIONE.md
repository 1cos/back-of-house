# Prompt Prossima Sessione — Brigade

Carica sempre in questo ordine:
1. PROMPT_PROSSIMA_SESSIONE.md da brigade-main
2. BOH_OS_SPEC.md da brigade-main
3. BOH_OS_BACKLOG.md da brigade-main
4. BOH_OS_DECISIONS.md da brigade-main
5. BRIGADE_VISION.md da brigade-main

---

## Stato attuale — Brigade v109

Supabase project: ydqmumpytgrlceuinoqt
Deploy: https://1cos.github.io/back-of-house — branch brigade-main
AI: OpenRouter LLaMA 3.3 70B (fallback Groq)

---

## Parser fornitori — tutti e 4 completi (v109)

| Fornitore | File | Logica prezzi |
|---|---|---|
| Hardie's | hardies-invoice.js | qty x price vs extended → per_lb o per_case |
| FreshPoint | freshpoint-invoice.js | Sempre per_case, peso da pack size |
| Fruge Seafood | fruge-invoice.js | Sempre per_lb, LB esplicito nel prezzo |
| Ben E. Keith | bek-invoice.js | Sempre per_case, peso da pack size N/M UNIT |

---

## Cosa manca — 5 passi

PASSO 1 — Warning Center OQR (PARZIALE)
- Banner funziona, modal apre, ma le opzioni sono ancora vaghe
- L'AI deve includere valori esatti nelle opzioni (es. conversion_to_base calcolato)
- La scan autonoma ogni 30 min non esiste ancora — solo manuale con pulsante

PASSO 2 — Checklist sera → preplist mattina (NON FATTO)
- Il passaggio di consegne automatico tra turni non esiste
- E' il cuore del ciclo brigade

PASSO 3 — TripleSeat (NON FATTO)
- Aspetta credenziali admin da Max

PASSO 4 — Display cucina TV (NON FATTO)
- Pagina fullscreen con preplist live, chat, alert

PASSO 5 — SevenShift (NON FATTO)
- Verificare se il piano ha le API

---

## Pendenti urgenti

- Romaine peso — Max deve pesare una testa di romana e inserirlo nel DB
- FreshPoint articoli approvati oggi hanno conversion_to_base e price_per_100g null
  (documento era gia parsato con codice vecchio — reimportare o aggiornare manualmente)
- Warning Center OQR — opzioni devono avere valori concreti

---

## Regole operative (SEMPRE)

1. Leggi SEMPRE il file da GitHub prima di modificarlo — mai dalla memoria
2. Usa API GitHub per leggere (base64 decode) — non raw CDN che ha cache
3. Bumpa sempre sw.js nello stesso push — mai file separati
4. Verifica via API dopo ogni push — decodifica base64
5. Supabase project: ydqmumpytgrlceuinoqt
