# Prompt Prossima Sessione — Brigade
*Carica sempre questo file per primo, poi gli altri MD.*

Carica sempre in questo ordine:
1. PROMPT_PROSSIMA_SESSIONE.md da brigade-main
2. BOH_OS_SPEC.md da brigade-main
3. BOH_OS_BACKLOG.md da brigade-main
4. BOH_OS_DECISIONS.md da brigade-main
5. BRIGADE_VISION.md da brigade-main

---

## Stato attuale — Brigade v153

Supabase project: ydqmumpytgrlceuinoqt
Deploy: https://1cos.github.io/back-of-house — branch brigade-main
souschef-chat: v15 | sc-nightly-brief: v5 | souschef-scan: v4
gmail-touchbistro-import: v3

---

## Completato in questa sessione (2026-06-15)

### TouchBistro pipeline completa
- 4 file CSV importati ogni notte (era 3 — mancava ModifierPreferenceByMenuItem)
- Nuova tabella `pos_modifier_by_item` — modifier collegato al piatto padre
- Nuova tabella `modifier_config` — 86 modifier classificati (22 cucina, 64 non-cucina)
- Edge Function gmail-touchbistro-import v2→v3

### Sales admin — Deep Analysis
- Bottone "Deep Analysis" in fondo alla tab Sales (solo admin)
- Modal con 9 categorie, 200+ domande, 25 query types implementate
- Categorie: Primi, Secondi, Antipasti, Contorni e Modifier, Riepilogo, Insalate e Zuppe, Dolci, Confronti Temporali, Performance e Record
- File: js/pos.js

### Sales staff view
- Staff vede view completamente separata dall'admin
- Zero prezzi, zero incassi, solo quantità e cibo
- Selettori: Ieri / Weekend (ven+sab) / Sett. (lun→sab settimana precedente)
- Livello 1: gruppi cucina con barre
- Livello 2: tap su gruppo → lista piatti
- Modifier cucina colorati per categoria
- Modal porzioni su tap con calcolo side + modifier + totale

### Fix date
- Weekend: venerdì + sabato (era sbagliato per entrambi admin e staff)
- Settimana staff: lunedì → sabato settimana precedente (era martedì sbagliato)

---

## DA FARE SUBITO — prossima sessione

### 1. PASSO 2 — Checklist sera → preplist mattina
Il ciclo fondamentale Brigade:
- Sera: brigata compila checklist per stazione
- Notte: AI genera preplist mattina basata su checklist + vendite
- Mattina: cuoco vede la sua preplist, segna fatto

### 2. Sales staff — modal porzioni (da completare)
Il modal su tap piatto/modifier è implementato ma va testato e rifinito.
Vedi file `PROMPT_SALES_STAFF_VIEW.md` per specifiche complete.

### 3. Warning Center fix
- "No peso" chiude senza fare niente — da fixare

---

## Pendenti

- Romaine: Max pesa una testa e inserisce peso nel DB
- FreshPoint articoli: conversion_to_base null, reimportare fattura
- Sysco: fattura da importare (Sun Dry Tomatoes, Canned Tomatoes, Tomato Paste, Tomato Puree)
- Label Gmail: bek-import e fruge-import da creare
- Ben E. Keith: forward iCloud→Gmail da fare
- FreshPoint: non manda ancora fatture (solo order confirmation)

---

## Regole operative

1. Leggi SEMPRE il file da GitHub prima di modificarlo
2. Usa API GitHub base64 decode — non raw CDN
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase project: ydqmumpytgrlceuinoqt
6. MAI usare template literals multiriga o emoji nei file JS — causano SyntaxError
7. Dichiara cosa cambi prima di farlo — aspetta conferma Max
8. File completi — zero patch parziali
9. La view admin Sales rimane intatta — modifiche solo additive

---

## Struttura file Sales (pos.js) — v153

- Righe 1-127: utility functions (toISO, addDays, getPeriod, posSelectors)
- Righe 128-320: loadPOS() — view admin (NON TOCCARE)
- Righe 321-324: posSetMode()
- Righe 325-1440: Deep Analysis (DA_CATEGORIES, openDeepAnalysis, daExecuteQuery)
- Righe 1441-1760: Staff view (staffGetPeriod, loadPOSStaff, staffOpenGroup, staffOpenDishModal)

**Redirect admin/staff: riga 129** — `if (!isAdmin()) { loadPOSStaff(); return; }`
