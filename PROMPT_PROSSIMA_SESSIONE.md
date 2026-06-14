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
souschef-scan: v3 (filtra falsi positivi server-side)
souschef-chat: v15

---

## PASSO 1 — COMPLETATO v111

- Warning Center OQR funzionante
- souschef-scan v3: filtra falsi positivi, opzioni con valori concreti
- Scan automatica Texas: 06:30 mattina + ogni ora 06:30-17:30
- Warning risolto non riappare

---

## Parser fornitori — completi v109

- Hardie's: qty x price vs extended
- FreshPoint: per_case, peso da pack size
- Fruge Seafood: per_lb esplicito
- Ben E. Keith: per_case, pack N/M UNIT

---

## Database ingredienti — pulito questa sessione

- Da 405 a 337 ingredienti attivi
- Tutti i nomi in inglese (eccetto ricette interne)
- Merge duplicati: Burrata Cheese, Demi varianti, Tarallo, grapes, Romana,
  Mandorle Pelate, Mutella, Vacum Bags, Salmone, Grounded Beef, Cured Salmon Filets
- Rinominati: Beef Shank, Carnaroli Rice, Bechamel, Rosemary,
  Carbonara Base, Carrots Puree, Beets Puree, Raspberries Puree,
  Chicken Bouillon, Sourdough Bread, Crumble Pistachio,
  Whole Peeled Almond, Powdered Sugar, Pasteurized Onions, Beef Filet,
  Mashed Potato Flakes, Sable
- Disattivati: note, errori, placeholder (Average Side, Fried, Sat, C57pst1 ecc.)
- Beef Steak Tomatoes: merge Tomato + vecchio BST, ora ha Hardie's + FreshPoint
- Cherry Tomatoes (Datterini): mergiato in Cherry Tomatoes

---

## 5 PASSI — stato

PASSO 1: COMPLETO
PASSO 2: DA FARE — checklist sera → preplist mattina (prossima sessione)
PASSO 3: DA FARE — TripleSeat (credenziali da Max)
PASSO 4: DA FARE — Display cucina TV
PASSO 5: DA FARE — SevenShift (verificare API)

---

## Pendenti

- Romaine: Max pesa una testa e inserisce peso nel DB
- Sun Dry Tomatoes, Canned Tomatoes, Tomato Paste, Tomato Puree: da Sysco, vendor da collegare quando arriva fattura
- FreshPoint articoli: conversion_to_base null, reimportare fattura

---

## Regole operative

1. Leggi SEMPRE il file da GitHub prima di modificarlo
2. Usa API GitHub base64 decode — non raw CDN
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase project: ydqmumpytgrlceuinoqt
