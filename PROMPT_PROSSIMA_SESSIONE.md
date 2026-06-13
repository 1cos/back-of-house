# PROMPT PROSSIMA SESSIONE — BRIGADE / SOUS CHEF AI

Stai lavorando su Brigade, una PWA per cucina professionale costruita in HTML/JS vanilla + Supabase + OpenRouter AI, deployata su GitHub Pages (1cos/back-of-house, branch brigade-main, versione attuale v92).

Il ristorante è Zenos on the Square, Weatherford Texas. Chef/owner: Max (italiano, parla in italiano). Staff: Anto, Tela, Cole, Samantha, Sofia.

**REGOLA ASSOLUTA: leggi sempre i file da brigade-main su GitHub, MAI da /mnt/project/ che è uno snapshot vecchio.**

---

## CARICA QUESTI FILE PRIMA DI TUTTO

1. https://raw.githubusercontent.com/1cos/back-of-house/brigade-main/BOH_OS_SPEC.md
2. https://raw.githubusercontent.com/1cos/back-of-house/brigade-main/BOH_OS_BACKLOG.md
3. https://raw.githubusercontent.com/1cos/back-of-house/brigade-main/BOH_OS_DECISIONS.md

---

## STATO ATTUALE

- Frontend: v92 su brigade-main
- souschef-chat: v14 (Edge Function Supabase ydqmumpytgrlceuinoqt)
- OpenRouter: meta-llama/llama-3.3-70b-instruct (chiave in Supabase secrets OPENROUTER_API_KEY)
- Groq Whisper: voce→testo (funziona, limite separato)
- Supabase project: ydqmumpytgrlceuinoqt

---

## IL SOUS CHEF AI — cosa è diventato

Il Sous Chef non è un chatbot. È un agente operativo che:
- Legge TUTTO il DB ad ogni domanda (service role key diretta)
- Ragiona semanticamente: asparagi=asparagus, patate=potatoes, olio=oil
- Risponde in italiano anche se i dati sono in inglese
- Può aggiornare il DB e creare task a voce
- Tap breve microfono = apre chat testuale
- Tap lungo microfono = voce → Whisper → stessa chat
- Voce e testo identici, stesso Edge Function souschef-chat v14

---

## COSE ANNOTATE DA FARE (in ordine priorità)

### PRIORITA' ALTA

**1. Foto/scan → OpenRouter**
Oggi le foto di fatture vanno ancora su Google Vision OCR → Groq.
Da migrare: foto → process-invoice con autoProcess=true (stesso parser universale email).
File da modificare: js/invoice.js (la parte che gestisce Import Invoice → Photo)

**2. Edit Vendor semplificato**
La scheda Edit Vendor ha 10+ campi tecnici confusi.
Da fare: mostrare solo 5 campi — unit_price, price_type, pack_description, total_weight_g, notes.
Nascondere (non eliminare) gli altri campi tecnici.
File: js/ingredients.js

**3. Warning che riappaiono**
Dopo aver salvato un peso nella card OQR scan, il warning riappare al prossimo scan.
Motivo: price_per_100g non viene ricalcolato correttamente con price_type dopo il save dalla card.
File: js/souschef.js (scSaveWeight e scSaveWeightMW)

**4. Ben E. Keith email**
Le email BEK arrivano su iCloud non Gmail.
Max deve configurare forward iCloud→Gmail per benekeit.com
Label Gmail già creata: bek-import
Google Apps Script già configurato con checkBenEKeithEmails()
Da fare: solo il forward iCloud (Max lo fa manualmente)

### PRIORITA' MEDIA

**5. Sales — ricerca per data libera**
Oggi Sales ha solo Yesterday/Weekend/7 days/30 days.
Da aggiungere: campo data libera — es. "cosa ho venduto il 12 giugno?"
Da aggiungere: filtro categoria Food only (no bevande, no modifier separati)
Da tradurre: tab in inglese (Yesterday, Weekend, 7 days, 30 days)
Da rimuovere: tab "Oggi" (i dati arrivano la mattina dopo, oggi è sempre vuoto)

**6. Card OQR scan — design**
Le card della scan sono ancora troppo grandi su iPhone — escono dallo schermo.
La domanda OQR deve essere più concisa e mostrare più contesto (vendor, prezzo, pack).
I tasti Skip/Fine hanno ritardo e vengono premuti per sbaglio lanciando una nuova scan.

**7. Sous Chef proattivo**
Il Sous Chef dovrebbe fare la scan automaticamente ogni ora (Edge Function schedulata)
invece di aspettare che Max prema il bottone 🔍.
Scrive in invoice_warnings → banner home aggiornato quando Max apre l'app.

**8. Capito Chef non chiude**
Su alcuni dispositivi il bottone "✓ Capito, Chef" nella risposta vocale non chiude il modal.
Fix: verificare il selector in showScAnswer in souschef.js.

### BACKLOG STORICO

**9. TripleSeat Integration**
Quando Monica aggiunge evento → Sous Chef avvisa Max.
In attesa: credenziali API da Monica.

**10. Digital whiteboard**
Brigade-to-brigade prep handoffs, sostituisce lavagnette fisiche in cucina.
Non ancora iniziato.

**11. Good Job messages**
Il nightly brief deve includere messaggi celebrativi quando c'è un record.
Es: "Ieri record di Tomahawk negli ultimi 90 giorni 🥩 — cosa avete cambiato?"

**12. Sales anomaly detection**
Calo/picco >30% vs stesso giorno settimana scorsa → OQR immediata.
Es: giovedì $1,011 vs $7,000+ → "Chef, le vendite sono crollate. Chiusura anticipata?"
Risposta salvata → quel giorno escluso dalle medie future.

**13. Tabella pesi standard CT/DZ**
Uova=58g, lime=67g, lemon=100g, avocado=200g, tomato beefsteak=280g.
Da applicare automaticamente agli ingredienti CT senza peso.

**14. Yes Chef modal**
Il toast attuale per import completato è piccolo e brutto.
Da sostituire con un modal grande celebrativo stile "Yes Chef — all done".

---

## COSE DA NON TOCCARE

- souschef-chat Edge Function funziona — non ottimizzare senza testare prima
- Il principio "codice porta dati, LLM ragiona" — non tornare mai a filtrare i dati prima
- pos_sales_by_item: colonna si chiama menu_item (NON item_name), quantity (NON quantity_sold)
- pos_modifiers: colonne modifier, quantity_sold, sale_date
- Groq Whisper rimane per la voce — non migrare a OpenRouter

---

## CREDENZIALI

- Supabase project: ydqmumpytgrlceuinoqt
- GitHub repo: 1cos/back-of-house, branch: brigade-main
- Groq: via Supabase env GROQ_API_KEY
- OpenRouter: via Supabase env OPENROUTER_API_KEY
- GitHub token: chiedere a Max (non salvare nei file MD)
- App live: https://1cos.github.io/back-of-house
