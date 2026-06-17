# SESSIONE ARCHITETTONICA — L'Ufficio di Brigade

## Contesto obbligatorio prima di iniziare
Leggi nell'ordine:
1. `x_claude_GIthub.txt` dal progetto (token GitHub)
2. `BRIGADE_VISION.md` da brigade-main — specialmente la sezione "Brigade Communication & Decision System"
3. `BOH_OS_BACKLOG.md` da brigade-main
4. `BOH_OS_DECISIONS.md` da brigade-main

Supabase project: `ydqmumpytgrlceuinoqt`
Deploy: `https://1cos.github.io/back-of-house`
Branch: `brigade-main` — MAI main
Versione attuale: `v219`

---

## Il Brief

Stiamo progettando **L'Ufficio** — la sezione centrale di Brigade per Max (Admin) e il futuro Sous Chef umano (ruolo: `sous_chef`, attualmente non assegnato a nessuno).

L'Ufficio non è un inbox. Non è un warning center. È il posto dove Max apre Brigade la mattina e trova tutto quello che richiede una sua decisione — già analizzato, già classificato, già con una mezza soluzione pronta. Come un vero ufficio di un executive chef.

---

## Quello che sappiamo già — NON ridiscutere

### I ruoli
- `admin` — Max, executive chef/owner. Accesso totale.
- `sous_chef` — futuro ruolo per senior chef (nessuno assegnato ora). Stesso accesso a L'Ufficio.
- `cook` — brigata. Non vede L'Ufficio. Manda input, non riceve decisioni.
- Tabella `users` esiste già con colonna `role`.

### I livelli — su tutto, sempre
- 🔴 **RED** — Act Now. Intervento immediato. Blocca tutto.
- 🟠 **ORANGE** — Must Read. Decisione richiesta. Con conferma di lettura obbligatoria per la brigata.
- 🔵 **BLUE** — FYI. Informativo. Nessuna azione.

### La regola fondamentale
I cuochi portano problemi e idee. **Max decide sempre.** Chef AI propone, non decide mai.

### One Question Rule (OQR)
Una cosa alla volta. Un problema, una domanda, massimo 3 opzioni. Max tocca. Fatto. Avanti.

---

## L'Ufficio — architettura da progettare

### Due sezioni — nell'ordine

**1. OPERATIVO** — prima, sempre
Tutto ciò che riguarda la cucina, la brigata, la produzione, il servizio.
Fonti: Tell Chef (chef_reports), Operation Notes, prep_log, chat brigata, osservazioni Chef AI autonome.

**2. FINANZIARIO** — dopo
Food cost, fatture, vendite, menu engine, ingredient pricing.
Fonti: invoice_warnings, pos_daily_summary, ingredient_vendors, recipe_bom.
(Questo era il vecchio Warning Center fatture — si integra qui.)

### Come funziona
- I problemi sono già lì ad aspettare Max quando apre — non si preme "aggiorna"
- Chef AI ha già analizzato ogni problema e preparato 2-3 opzioni concrete
- Chef AI impara nel tempo come lavora Max — pattern di decisioni, preferenze, stile
- Max risponde velocemente: tocca un'opzione, o scrive una risposta libera
- Il sistema esegue: aggiorna DB, notifica brigata al livello giusto, aggiorna ricetta se serve

### Comportamento Chef AI nell'Ufficio
- Non aspetta che Max chieda — porta i problemi già pronti
- Classifica il livello (🔴🟠🔵) in autonomia, Max può cambiarlo
- Prepara le opzioni basandosi su: storico decisioni di Max, dati DB, contesto cucina Zenos
- Quando porta un problema dice anche perché è importante adesso
- Impara: se Max sceglie sempre l'opzione B su un certo tipo di problema, la porta in cima

---

## Canali esistenti che alimentano L'Ufficio

| Canale | Stato attuale | Ruolo in L'Ufficio |
|---|---|---|
| `chef_reports` | ✅ tabella esiste, Tell Chef funziona | Ingresso principale operativo |
| `operation_notes` | ✅ fix pushato v219, ora si salva | Feedback serale → operativo |
| `invoice_warnings` | ✅ esiste, warning fatture | Finanziario |
| `briefing` | ✅ esiste, generato alle 5 AM | Si integra o si unifica con L'Ufficio |
| `alerts` | ✅ esiste | 🔴 RED rimane separato — ticker ovunque |
| `prep_log` | ✅ esiste | Osservazioni AI → operativo |
| `pos_daily_summary` | ✅ esiste | Finanziario |

---

## Domande architetturali aperte — da risolvere in questa sessione

1. **Tabella DB:** serve una tabella `office_items` (o `chef_decisions`) che centralizza tutto? O si leggono le tabelle esistenti in tempo reale?
2. **Chef AI autonoma:** la scan oraria (`souschef-scan`) diventa il motore che popola L'Ufficio? O serve una Edge Function dedicata?
3. **Briefing AI:** si unifica con L'Ufficio (è la vista mattutina di L'Ufficio) o rimane separato?
4. **UI:** bottom sheet? Tab dedicata? Accessibile dai tre puntini?
5. **Persistenza decisioni:** le decisioni di Max vanno archiviate per far imparare Chef AI — dove e come?

---

## Stile di lavoro — OBBLIGATORIO

- **One Question Rule** con Max — una domanda alla volta, aspetta risposta
- Prima si disegna l'architettura completa e si fa approvare da Max
- Zero codice finché l'architettura non è approvata
- Quando si scrive codice: leggi sempre i file da GitHub live, mai da memoria
- Bumpa sw.js ad ogni push
- Dichiara ogni modifica prima di farla, aspetta conferma
- MAI pushare su `main` — sempre `brigade-main`

---

## Come iniziare questa sessione

1. Leggi i file MD su GitHub (istruzioni sopra)
2. Fai UNA domanda architettonica alla volta a Max
3. Costruisci la spec completa di L'Ufficio prima di toccare codice
4. Solo quando Max dice "ok costruiamo" — si parte

