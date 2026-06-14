# Prompt Prossima Sessione — Brigade

Carica sempre in questo ordine:
1. PROMPT_PROSSIMA_SESSIONE.md da brigade-main
2. BOH_OS_SPEC.md da brigade-main
3. BOH_OS_BACKLOG.md da brigade-main
4. BOH_OS_DECISIONS.md da brigade-main
5. BRIGADE_VISION.md da brigade-main

---

## Stato attuale — Brigade v123

Supabase project: ydqmumpytgrlceuinoqt
Deploy: https://1cos.github.io/back-of-house — branch brigade-main
souschef-scan: v4, souschef-chat: v15

---

## PASSO 1 — COMPLETATO v123

- Warning Center OQR funzionante
- souschef-scan v4: soglie carne corrette, tagli economici non segnalati
- Scan automatica Texas: 06:30 + oraria 06:30-17:30, solo Lun-Sab
- Domenica: zero scan, solo messaggio buona domenica alle 06:30
  - Recap settimana: coperti, giorno più pieno, top piatti (no dollari per la crew)
  - Settimana prossima: eventi TripleSeat (pronto quando connesso)
- Prompt serale 22:30 Texas riparato
- DB ingredienti: 337 attivi, tutti in inglese, emoji 80+ pattern

---

## Parser fornitori — completi v109

Hardie's, FreshPoint, Fruge Seafood, Ben E. Keith

---

## 5 PASSI — stato

PASSO 1: COMPLETO
PASSO 2: DA FARE — checklist sera → preplist mattina (PROSSIMA SESSIONE)
PASSO 3: DA FARE — TripleSeat (credenziali da Max)
PASSO 4: DA FARE — Display cucina TV
PASSO 5: DA FARE — SevenShift (verificare API)

---

## Warning Center — problemi aperti da risolvere

- "No — peso diverso" chiude il modal senza fare niente — deve aprire input peso
- Campo libero nel modal non ha bottone salva diretto — solo "Chiedi al Sous Chef"
- Questi due fix sono rimandati alla prossima sessione

---

## Pendenti minori

- Romaine: Max pesa una testa e inserisce peso nel DB
- FreshPoint articoli: conversion_to_base null, reimportare fattura
- Sysco: Sun Dry Tomatoes, Canned Tomatoes, Tomato Paste, Tomato Puree
- SevenShift: verificare piano API
- TripleSeat: credenziali da Max

---

## Regole operative

1. Leggi SEMPRE il file da GitHub prima di modificarlo
2. Usa API GitHub base64 decode — non raw CDN
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase project: ydqmumpytgrlceuinoqt
