# Brigade — Visione di Sistema
*Documento architetturale — sessione del 13 giugno 2026*

---

## Cos'è Brigade

Brigade è il sistema operativo centrale di Zenos on the Square, Weatherford Texas.
Non è un'app di cucina. È la memoria collettiva e il sistema nervoso di una brigata di 20 persone divisa in due turni, cinque stazioni, tre lingue.

---

## Il ciclo fondamentale

```
SERA — La brigata serale compila le checklist per stazione
  ↓
NOTTE — L'AI osserva tutto: checklist + vendite + prep + fatture
         Genera anomalie, prepara le domande, costruisce la preplist mattina
  ↓
MATTINA — Ogni cuoco vede la sua stazione, cosa fare, in che ordine
           Apre la ricetta, segna fatto, il log si costruisce da solo
  ↓
SERA — L'AI confronta log mattina con consumo serale
        Se non torna → warning intelligente con questionario già pronto
  ↓
  (ricomincia)
```

---

## Le cinque stazioni

Forno · Plating · Pasta · Salad · Sauté / Grill

Ogni cuoco ha la sua stazione. Ogni stazione ha la sua checklist serale, la sua preplist mattutina, le sue ricette, il suo log di produzione.

---

## I moduli del sistema

### Già esistenti in Brigade

| Modulo | Stato |
|---|---|
| Checklist per stazione | ✅ in DB |
| Preplist mattina | ✅ in DB |
| Ricette con batch scalabili | ✅ in DB |
| Prep log — chi ha fatto cosa, quando, quanto | ✅ in DB |
| Vendite TouchBistro via email notturna | ✅ in DB |
| Fatture vendor (Hardie's, BEK, Fruge, Freshpoint, Global Gourmet) | ✅ in DB |
| Chat brigata multilingua (IT / EN / ES) | ✅ in Brigade |
| Sous Chef AI — osservazione e chat | ✅ in Brigade |
| News / Alert banner scorrevole | ✅ in Brigade |
| Warning center | ⚠️ parziale — da rifare |
| TripleSeat catering / eventi | 🔜 quasi pronto |

### Da costruire

| Modulo | Priorità |
|---|---|
| Collegamento automatico checklist sera → preplist mattina | Alta |
| AI che incrocia vendite + prep log + checklist | Alta |
| Schermo cucina (TV display) — preplist live, chat, alert | Media |
| Apple Watch — tap per segnare prep fatta, task done | Media |
| SevenShift — schedule ragazzi + staffing eventi catering | Media |
| Skill progression per ogni membro brigata | Bassa |
| Scarico magazzino automatico da prep log | Futura |

---

## Il sistema di osservazione (Warning Center)

### Principio

Un osservatore unico — l'AI — legge tutto il DB ogni 30 minuti in silenzio.
Confronta quello che vede con quello che si aspetta in base alla storia.
Produce osservazioni quando qualcosa non torna.

### Tipi di osservazione

**Fatture**
- Articolo ricevuto senza essere ordinato
- Prezzo fuori dalla media storica
- Pack senza peso noto
- Doppia ricezione nella stessa mattina

**Vendite**
- Piatto venduto molto meno del solito (lobster fettuccine: media 12, ieri 1)
- Piatto mai venduto da N giorni
- Record settimanale / mensile superato o mancato

**Prep**
- Prep richiesta la sera ma fatta stamattina in quantità sufficiente
  → "Cole ha fatto arrabbiata alle 9:30, dodici quarti. Perché la richiedi già?"
- Stessa prep fatta più volte nella stessa mattina
- Prep mai segnata ma articolo esaurito la sera

**Task**
- Task spuntato due volte lo stesso giorno
- Task ripetuto per N giorni consecutivi — normale o problema strutturale?

**Catering / Eventi**
- Evento in agenda, staff non sufficiente in schedule
- Menu evento con allergeni non verificati
- Ordine fornitore non ancora fatto a 48h dall'evento

### Come funziona il questionario

L'AI non solo trova il problema — lo istruisce.
Per ogni osservazione, l'AI prepara già:
- La domanda principale (One Question Rule)
- Le opzioni di risposta sensate
- Il valore che salverebbe in DB se si sceglie quell'opzione
- Le domande di follow-up se servono

Il questionario viene salvato nel DB insieme al warning.
Quando Max lo apre, non c'è nessuna chiamata AI — è tutto già pronto.
Max risponde, il modal salva direttamente nel DB. Zero token consumati nella fase di risoluzione.

### Gravità

🔴 Urgente — food cost compromesso, allergene, evento imminente senza staff
🟡 Attenzione — anomalia che richiede verifica prima del servizio
🔵 Info — pattern interessante, record, osservazione storica

---

## Il display cucina (TV screen)

Uno schermo grande in cucina visibile a tutta la brigata.

Mostra in tempo reale:
- Preplist del giorno per stazione — verde = fatto, bianco = da fare, rosso = urgente
- Chi ha fatto cosa (motivazione, gamification leggera)
- Banner scorrevole per alert — "Forno rotto", "Max arriva tra 30 min"
- Chat brigata — tutti leggono, nessuno deve guardare il telefono
- Progresso totale della mattina — tipo checklist barbiere: quante prep mancano alla fine

---

## Apple Watch

Per chi è in produzione e non può tenere il telefono in mano.

- Tap per segnare prep fatta
- Tap per completare task
- Notifica alert urgenti
- Niente altro — semplice, veloce, una mano sola

---

## Multilingua

Anto legge in spagnolo. Cole in inglese. Max in italiano.
Brigade parla la lingua di chi lo usa — non traduce i messaggi, cambia lingua a livello di interfaccia.
Ricette, checklist, preplist, chat — tutto nella lingua del cuoco.
L'AI in chat risponde nella lingua in cui viene interpellata.

---

## SevenShift — Schedule brigata

*Da verificare disponibilità API con il piano attuale.*

Se disponibile, Brigade legge la schedule e:
- Sa chi è in servizio oggi e in quale stazione
- Avvisa se un evento catering non ha staff sufficiente
- Conosce le skill di ogni ragazzo — chi può coprire quale stazione
- Suggerisce chi chiamare se manca qualcuno

### Skill progression
Ogni membro della brigata ha un profilo di competenze.
Non tutti sanno fare tutto. Brigade sa chi sa fare cosa.
Con il tempo, traccia la crescita — chi ha imparato la pasta fresca, chi copre il grill.

---

## TripleSeat — Catering ed eventi

Quando c'è un evento:
- Brigade lo vede in calendario
- Legge menu, numero persone, allergeni, referente
- Genera automaticamente lista della spesa aggiuntiva
- Crea prep straordinaria nelle stazioni interessate
- Verifica staff necessario vs schedule SevenShift
- Gestisce preventivo e menu personalizzato

---

## Quello che Brigade NON è (ancora)

- **Scarico magazzino automatico** — il prep log costituisce una traccia di produzione, ma lo scarico inventario formale è complesso e rimandato
- **POS in tempo reale** — i dati vendite arrivano via email notturna (TouchBistro), non esiste una vista "oggi" in tempo reale
- **Sistema HR completo** — SevenShift rimane il sistema primario per paghe e scheduling; Brigade lo integra, non lo sostituisce

---

## La visione in una frase

Brigade è il sous chef digitale che non dorme mai —
ricorda tutto quello che è successo, avvisa quando qualcosa non torna,
parla la lingua di ogni membro della brigata,
e lascia sempre l'ultima parola a Max.


---

## Roadmap tecnologica — La visione a lungo termine

### Fase 1 — Ora (HTML/PWA)
Brigade vive come Progressive Web App su GitHub Pages.
Vanilla JavaScript, Supabase, AI esterna (OpenRouter / LLaMA 3.3).
Solida, funzionante, deployabile ovunque da un browser.

### Fase 2 — Flutter
Rebuild nativo in Flutter per iOS.
Performance migliore, Apple Watch nativo, supporto schermo cucina, notifiche push reali.
Stessa logica, stessa struttura DB — solo il guscio cambia.

### Fase 3 — Apple Intelligence
Integrazione con Apple Intelligence e Siri.
"Ehi Siri, segna arrabbiata fatta — dodici quarti."
L'AI esterna diventa progressivamente opzionale man mano che Apple Intelligence matura.
L'obiettivo finale è un sistema che gira il più possibile on-device — veloce, privato, senza costi per token.

*Questo è il sogno. Brigade HTML è il prototipo che lo rende reale.*

---

## La chat come fonte di intelligenza

La chat di brigata non è solo comunicazione — è dati in tempo reale.
Venti persone che parlano durante il servizio producono segnali che nessun sistema formale cattura.
L'AI legge in silenzio, senza interrompere, senza rispondere ai ragazzi.
Quando vede un pattern — non un singolo messaggio, ma una ripetizione — porta una osservazione a Max.

### Pattern che emergono dalla chat

**Comportamento brigata**
"Chance arriva tardi" — tre volte in una settimana
→ Warning a Max: "Chance ha comunicato ritardi 3 volte questa settimana. Vuoi parlarne?"

**Pattern operativi**
"È finita l'arrabbiata" — due volte in tre giorni
→ Suggerimento a Max: "L'arrabbiata finisce spesso prima del servizio. Vuoi aumentare il batch standard in preplist?"

**Urgenze in tempo reale**
"Forno rotto" in chat → diventa automaticamente alert banner sul display cucina

### Regola fondamentale
L'AI non risponde mai ai messaggi della brigata nella chat comune.
Osserva. Poi parla solo con Max — nel Warning Center o nella chat privata Sous Chef.

---

## Contributi della brigata — "Aiuta lo Chef"

I ragazzi sanno cose che Max non ha ancora scritto nel sistema.
Sanno come si impiatta il nuovo piatto. Sanno il procedimento del ragù come lo fanno loro.
Sanno che ogni mattina si tagliano i limoni a spicchi ma non è in nessuna preplist.

### Il flusso

**La brigata contribuisce** — form semplice, non una chat discorsiva.
Un messaggio, una foto, un commento. Basta.
- "Ho fatto la foto dell'insalata impiattata"
- "Ho scritto il procedimento del ragù"
- "Mancano i limoni a spicchi dalla preplist della mattina"

**Max approva** — tutto passa da Max prima di entrare nel DB ufficiale.
Ricette, foto, checklist — niente va in produzione senza la sua conferma.

**Il DB cresce** — ogni contributo approvato diventa parte permanente del sistema.
Ricetta più completa. Foto di impiattamento. Preplist più accurata.

### Perché funziona
Max è sovrapposto di task e non può scrivere tutto da solo.
La brigata ha la conoscenza operativa ma non accesso diretto al DB.
Questo flusso distribuisce il lavoro di documentazione su tutta la squadra
mantenendo Max come unico punto di approvazione.

---

## L'AI come osservatore di lacune di contenuto

Oltre alle anomalie di dati, l'AI osserva anche le lacune di contenuto nel DB.

Esempi:
- "Carbonara — manca il procedimento al passo 4"
- "Insalata nuova — nessuna foto di impiattamento"
- "Stazione pasta — checklist serale ha 3 voci, quella del grill ne ha 12, sembra incompleta"
- "Limoni a spicchi — operazione ricorrente non presente in nessuna preplist"

Questi appaiono come warning blu (informativi) nel Warning Center.
Max li risolve quando ha un minuto — da solo o approvando un contributo della brigata.

