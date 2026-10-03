# cw-order-sender — worker Chef's Warehouse (Mac Mini)

XCF-CW · invia a Chef's Warehouse (Hardie's, codici `HRD_`) gli ordini che Max ha
**confermato** in Brigade → Compila Ordine. Nessun ordine parte da una richiesta
scritta o da una sessione Claude: solo dal pulsante "Invia a Chef's Warehouse
(ORDINE REALE)" premuto da un admin sul riepilogo confermato (hash).

## Flusso
1. Compila Ordine: bozza → riepilogo con hash → conferma di Max → **ORDINE REALE**.
2. `send-purchase-order` v2 → `po_send_begin`: con tutti gli interruttori accesi
   l'invio resta `pending` con le righe strutturate (SKU, quantità, unità, data). 202 `queued`.
3. Questo worker (launchd ogni 30 s) chiama `po_worker_claim`: prende UN invio, una sola
   volta; il DB ricontrolla hash, stato `confirmed` e che non sia in coda da > 20 minuti.
4. Chrome con il profilo del worker → order.chefswarehouse.com, chiamate JSON dalla pagina:
   carrello vuoto? → `cart/add` → `cart/update/deliveryDate` → `cart-validation` confrontato
   ESATTAMENTE col riepilogo (SKU, unità, quantità, data, esauriti, sostituzioni) → `cart/submit`.
5. `po_worker_finish`: `sent` + numero ordine CW (`TCW…`) · `failed` (certo che nulla è partito)
   · `uncertain` (submit senza risposta certa: resta `pending`, blocca nuovi invii, lo Chef verifica).
6. Push agli admin (funzione `notifications`, come Tell Chef) con l'esito.

Endpoint: solo quelli osservati da `~/cw-probe` (v4 23/08, v5 02/10 con l'ordine reale
TCW9995165226). Il submit non contiene righe: invia il carrello lato server, da qui
il controllo "carrello vuoto" all'inizio e il confronto esatto subito prima.

## Interruttori (tutti di Max, spenti di default)
- env `PO_REAL_SEND_ENABLED=true` sulla funzione `send-purchase-order`
- `po_settings.real_send_enabled = true`
- `po_vendor_channels` di Hardie's: `channel='portal'`, `transport='cw_portal'`, `real_send_allowed=true`
- `po_settings.cw_worker_token_sha256` = sha256 stampato da `scripts/install.sh`

## Sicurezza
- Sessione CW solo nel profilo locale `~/Library/Application Support/Brigade/cw-order-sender/profile`.
  Il codice non legge, non inserisce e non salva password o cookie.
- Token del worker solo nel Portachiavi (`brigade-cw-worker`); in DB solo lo sha256.
- Mai un secondo submit per lo stesso invio. Un esito incerto non viene ritentato da nessuno.

## Comandi
```
bash scripts/install.sh      # copia, config, token (stampa solo lo sha256), launchd
npm run login                # oppure doppio clic su cw-login.command: Max entra in CW
npm test                     # 15 test contro un portale CW finto, senza rete
```

## Limiti noti
- Endpoint di rimozione dal carrello e di storico ordini non ancora osservati: con un carrello
  CW non vuoto il worker si ferma (`CART_NOT_EMPTY`), e un esito incerto lo verifica lo Chef.
- `cart/add` usa la forma osservata (stockingType 'P', sellByMultiple 1): se CW la rifiuta per
  un articolo l'invio si ferma prima del submit (`ADD_REJECTED`/`CART_MISMATCH`).
- Unità accettate: case/cs → CS, each/ea → EA. Libbre e altro: fermo (`UNIT_NOT_CW`), niente conversioni.
- Eventuale header anti-CSRF del sito non osservato: se servisse, il primo invio si ferma su `cart/add`.
