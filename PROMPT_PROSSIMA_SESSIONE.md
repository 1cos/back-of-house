# PROMPT PROSSIMA SESSIONE — Brigade

## PRIMA DI TUTTO

1. Leggi il file x_claude_GIthub.txt nel progetto — contiene il token GitHub
2. Leggi questi file da brigade-main:
   - BOH_OS_SPEC.md
   - BOH_OS_BACKLOG.md
   - BOH_OS_DECISIONS.md
   - BRIGADE_VISION.md
3. Per leggere file GitHub: GET https://api.github.com/repos/1cos/back-of-house/contents/{path}?ref=brigade-main
4. Prima di modificare qualsiasi file JS: scaricalo fresco da GitHub, modificalo, ricaricalo
5. Bumpa sempre sw.js nello stesso push

---

## STATO — Brigade v190

- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main

---

## COSA FARE IN QUESTA SESSIONE — UNA SOLA COSA

### Prep redesign — Swipe gestuale ("Il Tabellone Digitale")

File da modificare: js/prep.js
Leggilo fresco da GitHub prima di toccare qualsiasi cosa.

**Concept:**
Ispirazione al foglio plastificato con pennarello che usano i ragazzi in cucina.
Zero bottoni. Solo nomi grandi. Gesti naturali.

**Comportamento swipe:**
- Swipe destra (>60% larghezza riga) -> Fatta -> verde -> scende in fondo
- Swipe sinistra (>60%) -> In corso -> blu -> rimane in cima evidenziata
- Swipe sinistra su riga gia fatta -> riporta su (undo)
- Soglia 60% obbligatoria — evita falsi positivi con mani bagnate
- Feedback visivo durante swipe (la riga segue il dito, colore appare progressivamente)
- Tap sul nome -> apre ricetta (non swipe)

**Layout:**
- Font nome prep: 22px minimo, bold, leggibile a 1 metro
- Altezza riga: minimo 64px
- Zero bottoni visibili nella lista
- Sezione DA FARE in cima (bordo/sfondo rosso leggero)
- Sezione FATTE in fondo (opacita 40%, grigio)
- Pillole stazione in orizzontale scroll invece dei cerchi attuali

**Cosa NON toccare:**
- Logica di salvataggio DB (prepLog, updateTaskStatus)
- Sistema di notifiche
- Admin view
- Nessun altro file

---

## REGOLE OPERATIVE

1. Leggi sempre i file da GitHub prima di modificarli
2. Mai usare template literals multiriga o emoji nei file JS
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase: ydqmumpytgrlceuinoqt
6. Dichiara sempre cosa cambierai prima di scrivere codice
