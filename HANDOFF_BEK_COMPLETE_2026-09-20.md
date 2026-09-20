# HANDOFF — BEN E. KEITH, MIGRAZIONE COMPLETA

**Data:** 2026-09-20
**Micro-task che l'hanno prodotta:** MT85 → MT98A
**Stato:** chiusa per gli acquisti consegnati; un ordine in volo resta aperto per sua natura

---

## LE DUE DICHIARAZIONI, SEPARATE

> **ALL DELIVERED BEN E. KEITH PURCHASES FROM 2026-06-01 THROUGH 2026-09-20 ARE ACCOUNTED FOR.**

Ogni documento Ben E. Keith del flusso cucina che contiene merce effettivamente
consegnata ha le sue `invoice_lines`. Verificato per costruzione: 14 documenti
con contenuto d'acquisto, 14 con righe, **zero scoperti**.

> **0003272475 IS AN ACTIVE IN-FLIGHT ORDER WHOSE SOURCE EMAIL DOES NOT YET
> CONTAIN ITEM DETAIL.**

Non è contabilizzato e **non deve esserlo**: la merce non è ancora stata
consegnata e Ben E. Keith non ha ancora mandato il dettaglio articoli.

---

## 1. UNIVERSO GMAIL

Query di audit, deliberatamente **più larga** di quella del collector
(niente filtro sul subject, niente `-label:bek-processed`):

```
from:benekeith.com after:2026/05/31
```

| | |
|---|---|
| thread | **58** |
| messaggi | **59** (un thread ne ha due: 0002927278) |
| primo | 2026-06-27 19:35 UTC |
| ultimo | 2026-09-19 19:45 UTC |
| mittente | `CRP-SVCMBX-entree@benekeith.com`, su tutte e 58 |
| allegati | nessuno — il corpo HTML è l'unica fonte |
| Customer# | FDF770366 in tutti i subject |
| Sales Order distinti | **52** |

Dal 1 al 26 giugno non esiste nessuna email BEK: la finestra è stata cercata
tutta, semplicemente non ne sono arrivate.

### Zero missing intake

Riconciliazione dei 58 thread contro `vendor_documents`:

| categoria | doc |
|---|---|
| A. present + imported | 9 |
| A+E. imported, con gemello superseded | 4 |
| B. present + ignored correttamente | 28 |
| C. present + pending non-operational | 9 |
| D. present + error | 0 |
| E. solo superseded | 2 |
| **F. MISSING FROM vendor_documents** | **0** |
| G. ambiguous | 0 |

Un subject arrivato letteralmente con `;null` (30 agosto) ha comunque il suo
documento: **0003055973**, numero recuperato dal corpo del messaggio.

---

## 2. I DUE FLUSSI D'ORDINE — LA COSA DA NON DIMENTICARE

Ben E. Keith serve **due stream sullo stesso Customer# FDF770366**. Subject,
mittente, destinatario, Branch e Customer Name sono identici su entrambi.
L'unico campo che li distingue è la riga `Email:` nell'header:

| buyer_class | email | significato | destino |
|---|---|---|---|
| `kitchen` | `raven_wolf_1510@yahoo.com` | ordini della brigata | **diventano acquisti** |
| `excluded` | `zeno@zenosonthesquare.com` | ordini del front of house | mai in `invoice_lines` |
| `unknown` | qualsiasi altra | — | fail closed, si ferma e chiede |

È un'**allow-list che fallisce chiusa** (MT48): un buyer nuovo domani non viene
assunto essere una cosa o l'altra, blocca.

**Ripartizione degli operational_confirmation:**

| buyer | n | valore | stato |
|---|---|---|---|
| kitchen | 13 | $8 022,24 | imported |
| excluded (FOH) | 16 | $5 784,34 | ignored |

> I 16 `ignored` **non sono un buco e non sono duplicati**: sono ordini reali
> del front of house, deliberatamente fuori dal food cost della cucina.
> (Correzione rispetto a MT96/MT97, dove li avevo descritti come "flussi
> superati o duplicati": la ragione vera è il buyer, ed è più netta.)

---

## 3. RIPARAZIONE STORICA — 0002952908

L'unico acquisto consegnato che era rimasto fuori dal registro.

| | |
|---|---|
| documento | 0002952908, 2026-08-20 |
| origine | prima email BEK di prova (`BEK_TEST_SALES_ORDER` dell'Apps Script), ingerita il 2026-08-19 |
| perché era scoperto | percorso pre-MT42 che marcava `imported` senza scrivere le `invoice_lines` |
| buyer | **kitchen** — verificato nel `raw_text` |
| contenuto | SKU 116533 Pastry Bag 21in Clr Disposable, qty 2 @ $40.98 = **$81.96** |

Riparato con il percorso esistente `vdaiRepairMissingInvoiceLines`
(`repair_invoice_lines: true` + `document_id`), **una sola esecuzione**,
preceduta da un `dry_run` read-only che ha risposto `would_repair`.

```
BEK invoice_lines   117  →  118
BEK valore        8022.24 → 8104.20   (+81.96, delta atteso 0.00)
```

Il repair path **non tocca** né lo status del documento né la price
intelligence: `updated_at` di 0002952908 è rimasto al 2026-08-20, e il mapping
116533 è invariato (40.98, price_per_each 0.4098, conversion null,
last_invoice_date 2026-07-16).

**Idempotenza:** `writeInvoiceLines` apre con
`select id from invoice_lines where import_id = <doc> limit 1` e, se trova
qualcosa, esce con `already_has_lines, inserted: 0`. Oggi quella query
restituisce 1 riga: un secondo tentativo non può creare un duplicato.

---

## 4. STATO FINALE

### Operational migration

| voce | valore |
|---|---|
| operational_confirmation totali | 29 |
| imported (kitchen) | 13 |
| ignored (front of house) | 16 |
| **pending** | **0** |
| error | 0 |
| unmatched operational SKU | **0** |

### Registro BEK

| voce | valore |
|---|---|
| invoice_lines Ben E. Keith | **118** |
| valore totale | **$8 104,20** |
| SKU BEK mappati | **39** |
| documenti cucina con acquisti | 14 |
| di cui con righe | **14** |
| **scoperti** | **0** |

### Documenti non-operational

| gruppo | n | stato |
|---|---|---|
| acknowledgement ignored | 14 | terminale |
| acknowledgement pending | 9 | zero item purchasable: economicamente terminali, passeranno a `ignored` da soli |
| ambiguous ignored | 1 | terminale |
| legacy error `770366` | 2 | bug storico Customer#, da non toccare |
| gemelli superseded senza contenuto | 4 | 3 ignored, 1 pending; i canonici portano le righe |

---

## 5. ORDINE IN VOLO — 0003272475

**Non è un acquisto storico perso. Non modificarlo.**

| | |
|---|---|
| email | 2026-09-19 17:58 UTC |
| delivery date | **2026-09-21** |
| order total | **$1 042,17** — 17 items / 20 pieces |
| buyer | kitchen |
| stato DB | `pending`, `parsed_json = {"source":"email_html"}` |

L'email sorgente contiene header, totale e quantità complessiva ma **zero righe
articolo**: la tabella ha solo l'intestazione. È coerente con il disclaimer di
Ben E. Keith — *"Item confirmation will occur the morning before your selected
ship date"*. Non è un difetto del parser.

**Cosa aspettarsi:** BEK manda la versione con gli articoli la mattina prima
della consegna. Quando arriva, il documento entra dal percorso normale.
Da verificare dopo il 21 settembre.

---

## 6. PATCH DEPLOYATE IN QUESTA MIGRAZIONE

| task | cosa risolve |
|---|---|
| **MT88A + MT88A.1** | un'osservazione peggiore non degrada una price intelligence valida; in caso di pack materialmente diverso il sistema si ferma invece di indovinare |
| **MT89A** | `price_per_each` segue il prezzo della cassa |
| **MT93A** | `PR` significa paio e vale 2 pezzi |
| **MT94** | `LTR` è un litro |

Unità oggi supportate: **LB, OZ, GAL, ML, LTR, CT, DZ, PR**.

## 7. VERSIONI

Verificate in MT99, non assunte.

| | |
|---|---|
| edge `vendor-doc-auto-import` | **v22**, ACTIVE, `verify_jwt: true` |
| | live == worktree == HEAD, sha256 `9756c08f…`, 243 810 byte |
| edge `gmail-vendor-import` | **v34**, ACTIVE — non modificata in questo workstream |
| frontend cache | **boh-v856** |
| ultimo commit vendor-documents | `3c78f91` — *chore: bump frontend cache for MT94* |
| cron | job 19, `*/5 * * * *`, attivo |

> **Nota sulla cache.** Il workstream vendor-documents si era fermato a
> `boh-v855` (MT94). Il bump a **boh-v856** viene dal commit `3e08059`
> *"feat(crew-ux): Pablo sees a Home that answers one question (CREW-UX 05)"*,
> di un workstream parallelo che ha toccato `index.html`, `js/app.js`,
> `js/briefing.js`, il nuovo `js/crew-home.js` e `sw.js`. È un bump
> legittimo — quel codice frontend è cambiato davvero.
>
> Verificato in MT99 che **non tocca la pipeline vendor documents**:
> l'ordine di caricamento degli script è intatto
> (`utils.js` → `bek-post-parse-safety.js` → `price-intelligence-merge.js`
> → `vendor-documents-review.js`), nessun file `js/vendor-parsers/*` o
> `edge-functions/*` è stato modificato, e la suite non ha nuovi failure.

---

## 8. BACKLOG — NIENTE DI QUESTO BLOCCA BEK

### Igiene BEK (non bloccante)
- `0003243454` — gemello superseded ancora `pending`; il canonico è imported con 8 righe
- 9 acknowledgement `pending` con zero item purchasable
- 2 righe legacy `770366` in stato `error`

### Tecnico, non BEK
- **MT88B** — `vdrPackToGrams` (UI) non converte L, ML e il GAL semplice, mentre il worker sì
- **js/invoice.js** — fuori scope da MT88
- **MT83** — in attesa
- **Watermelon** — `price_per_each` non toccato per istruzione esplicita
- **alias LT** — Hardie's 27474 `"20 LT"` e Global Gourmet `"3/5lt"` con conversione null
- **"Demi Knoor"** — refuso nel nome dell'ingrediente; `name_it` e `name_es` sono già corretti
