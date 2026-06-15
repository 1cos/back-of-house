# PROMPT PROSSIMA SESSIONE — Brigade

## PRIMA DI TUTTO

1. Leggi il file `x_claude_GIthub.txt` nel progetto — contiene il token GitHub
2. Leggi questi file da brigade-main:
   - BOH_OS_SPEC.md
   - BOH_OS_BACKLOG.md
   - BOH_OS_DECISIONS.md
   - BRIGADE_VISION.md
3. Per leggere file GitHub: GET https://api.github.com/repos/1cos/back-of-house/contents/{path}?ref=brigade-main
4. Prima di modificare qualsiasi file JS: scaricalo fresco da GitHub, modificalo, ricaricalo
5. Bumpa sempre sw.js nello stesso push

---

## STATO — Brigade v131

- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main

---

## COSA FARE IN QUESTA SESSIONE — UNA SOLA COSA

### Redesign schermata review fattura (vendor-documents-review.js)

La schermata attuale mostra gli articoli in colonna con vecchi warning OQR.
Max vuole vedere ogni articolo in UNA RIGA con 4 campi modificabili.

**Formato riga articolo (OBBLIGATORIO):**

Warning [Nome Articolo]
Qty [val] . Pack [val] . Unit Price [val] . Ext [val]
Sous Chef: [calcolo pack] . [risultato]

Tutti e 4 i campi sono modificabili inline.
Quando modifichi un campo, il $/100g si ricalcola in background automaticamente.
Nessun giudizio sul prezzo. Solo matematica.

**Esempio Burrata:**
Warning Burrata
Qty 1 . Pack 6-4/2oz . Unit $26.73 . Ext $26.73
Sous Chef: 6x4x2 = 48oz . $26.73

**Esempio Stew Meat (per lb):**
Warning Stew Meat (ABR Brochette in fattura)
Qty 1 . Pack 4 PC/12# . Unit $3.42/lb . Ext $44.90
DB: 4x12 = 48lb . $3.42/lb = $0.754/100g

**Logica pack ambiguo:**
Se il parser calcola due risultati diversi dallo stesso pack (es. 4 PC/12# = 4x12=48lb OPPURE 12lb)
mostrare ENTRAMBE le interpretazioni come opzioni cliccabili.
Max sceglie quale e giusta. Nessuna AI coinvolta — e pura matematica.

**Cosa NON fare:**
- Non mostrare warning SC-PRICE-001 (giudizio prezzi eliminato)
- Non mostrare colonne separate per ogni campo
- Non fare domande sul prezzo

---

## REGOLE WARNING — DEFINITIVO

Solo due warning validi durante importazione fattura:

1. SC-GHOST-001: ingrediente senza nessun vendor/prezzo nel DB
2. SC-NOLINK-001: ha vendor e prezzo ma manca conversion_to_base (per_case senza peso pack)

SC-PRICE-001 E ELIMINATO PER SEMPRE durante importazione.
Il giudizio sui prezzi e capitolo futuro (confronto storico) — non ora.

souschef-scan v5 e gia deployata con questa logica.

---

## FATTURE IN ATTESA

15 fatture Hardie's sono in Vendor Review con status pending:
06976333 (23 items), 06977530 (1), 06978984 (10), 06981903 (11),
06983333 (6), 06986639 (10), 06989667 (7), 06991299 (15),
06992511 (6), 06992515 (2), 06995651 (7), 06996814 (1),
06997941 (7), 07000322 (9), credit memo 00668419 (1)

Non approvare finche la nuova UI non e pronta.

---

## WARNING PROSSIMA SESSIONE DEDICATA (dopo UI)

Due nuovi tipi di warning da costruire:

1. PACK AMBIGUO: quando il parser trova due interpretazioni matematiche diverse
   Es: 4 PC/12# = 48lb OPPURE 12lb — mostrare entrambe, Max sceglie
   Non serve AI. E logica del parser.

2. PREZZO CAMBIATO: quando unit_price fattura attuale != ultima fattura importata
   Es: Stew Meat era $3.29/lb, ora e $3.42/lb
   Questo e il vero compito di Sous Chef AI — confronto storico prezzi

---

## 5 PASSI — stato

PASSO 1: COMPLETO
PASSO 2: DA FARE — checklist sera -> preplist mattina
PASSO 3: DA FARE — TripleSeat (credenziali da Max)
PASSO 4: DA FARE — Display cucina TV
PASSO 5: DA FARE — SevenShift (verificare API)

---

## Pendenti minori

- Romaine: Max pesa una testa e inserisce peso nel DB
- FreshPoint: reimportare fattura per conversion_to_base
- Sysco: fattura da importare
- Label Gmail: bek-import e fruge-import da creare
- invoice_date sempre null nei vendor_documents — il parser non estrae la data dal PDF

---

## Regole operative

1. Leggi sempre i file da GitHub prima di modificarli
2. Mai usare template literals multiriga o emoji nei file JS
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase: ydqmumpytgrlceuinoqt
