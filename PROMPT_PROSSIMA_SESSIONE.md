## 🔴 DA FARE SUBITO (annotato sessione grafica)

### 1. Campanella → News/Alert (non Menu admin)
La campanella in alto a destra (id: `bellBtn`) ora apre `showAdminMenu()`.
**Deve tornare a fare quello che faceva la sirena 🚨** — inserire una news/alert nella barra scorrevole.
- Spostare `openNewsManager()` (o funzione equivalente) sulla campanella
- Il menu admin rimane accessibile solo dal tab ••• in basso
- `bellDot` si illumina quando ci sono news non lette

### 2. Sales — redesign selettori data
I bottoni attuali (Oggi/Ieri/Weekend/7gg/30gg) sono troppo piccoli su iPhone.
**Nuovo layout su due righe:**
- **Riga 1:** ultimi 7 giorni cliccabili singolarmente (da ieri a 7 giorni fa) — pillole con data
- **Riga 2:** Weekend | Settimana | 30 giorni | 📅 (date picker campo libero)
Mockup prima di implementare.

---

# Prompt Prossima Sessione — Brigade

Carica sempre in questo ordine:
1. PROMPT_PROSSIMA_SESSIONE.md da brigade-main
2. BOH_OS_SPEC.md da brigade-main
3. BOH_OS_BACKLOG.md da brigade-main
4. BOH_OS_DECISIONS.md da brigade-main
5. BRIGADE_VISION.md da brigade-main

---

## Stato attuale — Brigade v131

Supabase project: ydqmumpytgrlceuinoqt
Deploy: https://1cos.github.io/back-of-house — branch brigade-main
souschef-scan: v4, souschef-chat: v15, sc-nightly-brief: v5

---

## PASSO 1 — COMPLETATO v131

- Warning Center OQR funzionante
- Scan automatica Texas: 06:30 + oraria 06:30-17:30, solo Lun-Sab
- Domenica: zero scan, messaggio buona domenica alle 06:30
  - Recap settimana: coperti, giorno piu pieno, top piatti (no dollari)
  - Settimana prossima: eventi TripleSeat (pronto quando connesso)
- Prompt serale 22:30 Texas: push via alerts table, modal redesignato
- sc-nightly-brief v5: sintetizza commenti brigata in UNA frase, non lista
- Console pulita — SyntaxError risolti in souschef-core.js e souschef-chat.js

---

## Sales — completato v131

- Tab: 6 giorni settimana (Sab/Ven/Gio/Mer/Mar/Lun) + Weekend + 7gg + 30gg + Periodo
- Periodo: selettore Dal/Al con date picker
- Dati TouchBistro recuperati (sabato 13 giugno importato)

---

## Google Apps Script — Brigade hardies import

Struttura multi-file completata:
- Codice.gs: solo checkAllEmails() + setupTrigger()
- HardiesImport.gs, FreshpointImport.gs, TouchBistroImport.gs
- BEKImport.gs, FrugeImport.gs (placeholder — label Gmail da creare)
- TripleSeat.gs, SevenShift.gs (placeholder)
- Utils.gs: sendToEdge(), processLabelPDF(), processLabelCSV(), resetLabel()

checkAllEmails chiama ora anche processTouchBistroEmails — fix applicato.
Label Gmail da creare: bek-import, fruge-import

---

## Parser fornitori — completi

Hardie's, FreshPoint, Fruge Seafood, Ben E. Keith

---

## 5 PASSI — stato

PASSO 1: COMPLETO
PASSO 2: DA FARE — checklist sera → preplist mattina (PROSSIMA SESSIONE)
PASSO 3: DA FARE — TripleSeat (credenziali da Max)
PASSO 4: DA FARE — Display cucina TV
PASSO 5: DA FARE — SevenShift (verificare API)

---

## Pendenti

- Romaine: Max pesa una testa e inserisce peso nel DB
- FreshPoint articoli: conversion_to_base null, reimportare fattura
- Sysco: fattura da importare (Sun Dry Tomatoes, Canned Tomatoes, Tomato Paste, Tomato Puree)
- Label Gmail: bek-import e fruge-import da creare
- Icona Periodo in Sales: da aggiornare in sessione grafica
- Warning Center: No peso diverso chiude senza fare niente (da fixare)

---

## Regole operative

1. Leggi SEMPRE il file da GitHub prima di modificarlo
2. Usa API GitHub base64 decode — non raw CDN
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase project: ydqmumpytgrlceuinoqt
6. MAI usare template literals multiriga o emoji nei file JS — causano SyntaxError
