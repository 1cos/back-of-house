# PROMPT PROSSIMA SESSIONE — Brigade

## PRIMA DI TUTTO

1. Leggi il file x_claude_GIthub.txt nel progetto — contiene il token GitHub
2. Leggi questi file da brigade-main:
   - BOH_OS_BACKLOG.md
   - BOH_OS_DECISIONS.md
3. Per leggere file GitHub: GET https://api.github.com/repos/1cos/back-of-house/contents/{path}?ref=brigade-main
4. Prima di modificare qualsiasi file JS: scaricalo fresco da GitHub, modificalo, ricaricalo
5. Bumpa sempre sw.js nello stesso push

---

## STATO — Brigade v195

- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Kitchen Display: https://1cos.github.io/back-of-house/display.html (LIVE su Insignia Fire TV)

---

## COSA FARE IN QUESTA SESSIONE

### Focus Mode — "Il Tabellone Digitale"

Mockup già approvato da Max (2026-06-16). Ora si costruisce.

**Accesso:** swipe destra dalla home di Brigade → slide animation → Focus Mode
**Uscita:** swipe sinistra → torna Brigade normale

**Layout:**
- Header: nome cuoco + stazione + pallino online
- Hint bar: "← in progress · swipe · done →"
- 3 sezioni collassabili verticali con tap sul titolo:
  - 🔴 To Do — bordo rosso, in cima
  - 🟡 In Progress — bordo giallo
  - ✅ Done — collassata di default, opaca, in fondo
- Card swipe: destra = Done (verde), sinistra = In Progress (giallo)
- Soglia 60% larghezza per conferma (mani bagnate)
- Filtro automatico sulla stazione del cuoco loggato
- Realtime: si aggiorna quando altri completano prep

**Landscape mode:** da esplorare con Max — probabilmente 3 colonne side-by-side

**File da leggere prima:**
- js/prep.js (logica prep esistente)
- js/presence.js (per stazione utente loggato)

**Cosa NON toccare:**
- Logica salvataggio DB esistente
- Admin view prep
- Nessun altro modulo

---

## REGOLE OPERATIVE

1. Leggi sempre i file da GitHub prima di modificarli
2. Mai usare template literals multiriga o emoji nei file JS
3. Bumpa sw.js nello stesso push
4. Verifica via API dopo ogni push
5. Supabase: ydqmumpytgrlceuinoqt
6. Dichiara sempre cosa cambierai prima di scrivere codice
7. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
8. pos_item_aliases: 40 regole di produzione — usarla per tutte le stats
