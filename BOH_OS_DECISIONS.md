# BRIGADE — DECISIONS
*Perché abbiamo scelto certe cose. Non ridiscutere senza motivo.*

---

## Stack

| Decisione | Scelta | Motivo |
|---|---|---|
| OCR | Google Vision + Groq | Mindee scartato (pagamento), Groq Vision inaffidabile su fatture |
| Frontend attuale | HTML/JS vanilla | Prototipo funzionante in produzione |
| Frontend futuro | Flutter | Siri AI integration richiede app nativa |
| Database | Supabase | Auth, Realtime, Edge Functions, RLS tutto incluso |
| AI principale | Groq LLaMA 3.3 70B | Velocità, costo (~$0.001/scan), qualità |
| Deployment | GitHub Pages | Semplicità, zero costi, sufficiente per PWA |
| Cron | GitHub Actions | Supabase cron richiede Piano Pro — GitHub Actions gratis |

---

## Naming

| Cosa | Nome corretto |
|---|---|
| App HTML/PWA attuale | **BRIGADE** |
| App Flutter futura con Siri | **BOH OS** (separata, non ancora costruita) |
| Branch deploy | **brigade-main** (MAI main) |
| Versione attuale | **v77** |

---

## UX

| Decisione | Scelta | Motivo |
|---|---|---|
| Lingua UI | English only | Staff multilingue ma UI uniforme |
| OQR | Obbligatorio | Una decisione alla volta |
| Bottom decision zone | Obbligatorio | One thumb rule, iPhone first |
| Warning color | Amber default, rosso solo high severity | Evitare "app rotta" |
| Fake defaults | Vietati | Blank > placeholder > valore inventato |
| Unmatched vs wrong match | Unmatched è più sicuro | Wrong match avvelena food cost |
| Font size card OQR | Min 16px, titoli 18-19px | Max è in cucina, mani sporche, quasi cieco (sue parole) |
| Yes Chef modal | Grande, celebrativo, non un toast | "Non un toast — un momento" |
| Sous Chef stack | Card swipeable, swipe giù=skip, su=risolvi | Più naturale su iPhone |

---

## Sous Chef Engine

| Decisione | Scelta | Motivo |
|---|---|---|
| Scan ingredienti | Groq AI sui dati reali | Regole hardcodate non funzionano (mango ≠ lime ma stesso problema) |
| Sub-ricette escluse | Se nome ingrediente = titolo ricetta → skip | Bolognese, Béchamel sono produzioni interne non acquisti |
| Throttle scan | 30 minuti | Protegge Groq free tier |
| Note brigata | Tabella `operation_notes`, pop-up 22:30 | Memoria operativa umana collegata ai numeri POS |
| Nightly brief | Edge Function + GitHub Actions cron | Supabase cron richiede Pro plan |
| Frequenza scan | On demand (tap) + nightly automatico | On demand protegge quota, nightly garantisce continuità |
| Notifiche blocking | Push immediata | Solo per problemi critici — Max non vuole spam |

---

## Sviluppo

| Decisione | Scelta | Motivo |
|---|---|---|
| File completi | Obbligatorio | Patch incrementali hanno causato bug ripetuti |
| Scope discipline | Obbligatorio | Toccare solo il modulo richiesto |
| Base file per modifiche | Sempre da `brigade-main` su GitHub | `/mnt/project/` è snapshot iniziale, non aggiornato |
| Conferma prima di modificare | Obbligatorio | Dichiarare scope esatto prima di scrivere codice |
| Versione bump | Ogni commit | `boh-vNN` in `sw.js` — Max vede la versione nel topbar |

---

## Lezioni apprese

- `get_edge_function` Supabase MCP non restituisce body affidabilmente — chiedere codice a Max
- Safari iPhone richiede `maximum-scale=1,user-scalable=no` nel viewport meta
- Cache iPhone va svuotata per ricevere aggiornamenti (Settings → Safari → Clear)
- JSON.stringify inline in onclick crasha su nomi con apostrofi ("Hardie's") — usare `element._data`
- `.neq('category','Supply')` in PostgREST esclude anche righe con category=null — filtrare in JS
- `topCandidates.reduce()` crasha su array vuoto senza valore iniziale
- Groq AI è più flessibile di regole hardcodate per classificazione ingredienti
- Sub-ricette (Bolognese, Béchamel, Balsamic Glaze) non hanno vendor → non sono acquisti → skip da SC-NOLINK-001
- GitHub Actions cron può triggerare Edge Function Supabase gratis (alternativa a Supabase cron Pro)
- Token GitHub deve avere scope `workflow` per pushare GitHub Actions
- Max parla italiano e spesso usa termini italiani — Groq deve tradurre l'intento prima di cercare nel DB
