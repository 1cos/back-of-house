-- ─────────────────────────────────────────────────────────────────────
-- INV08C — la chiave di idempotenza dei credit memo
--
-- vendor_credits esiste dal disegno originale con sedici colonne pensate
-- bene, ma NON ha nessun vincolo che impedisca di registrare due volte
-- lo stesso credito. Finche' la tabella e' vuota non si vede; dal
-- momento in cui un worker ci scrive, "select poi insert" non basta:
-- due tick del cron che si sovrappongono, o un retry dopo un timeout di
-- rete, produrrebbero due righe per lo stesso documento e il netto
-- risulterebbe sbagliato del doppio di quel credito.
--
-- La chiave giusta e' vendor_document_id: UN documento di credito e'
-- UNA registrazione contabile. Non credit_number, che e' testo e
-- potrebbe ripetersi fra fornitori diversi; non (vendor, numero), che
-- sarebbe una chiave composta piu' fragile dello stesso identificatore
-- che gia' abbiamo.
--
-- La colonna resta NULLABLE, e in Postgres un UNIQUE ammette piu' NULL:
-- una eventuale registrazione manuale senza documento collegato non
-- viene impedita, e questo e' voluto. Il vincolo protegge il percorso
-- automatico, che il documento ce l'ha sempre.
--
-- Migration incrementale: non modifica nulla di esistente, e la tabella
-- e' vuota, quindi non puo' fallire su dati gia' presenti.
-- ─────────────────────────────────────────────────────────────────────

create unique index if not exists vendor_credits_vendor_document_id_key
  on public.vendor_credits (vendor_document_id)
  where vendor_document_id is not null;

-- Serve al reporting: "tutti i crediti di questo fornitore in questo
-- periodo" e' la query che il netto per fornitore richiede, e oggi
-- esiste un indice su vendor ma non sulla data.
create index if not exists idx_vendor_credits_vendor_date
  on public.vendor_credits (vendor, credit_date);
