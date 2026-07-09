# Brigade Workspace — Page Standard
*Regola permanente. Ogni nuova pagina /workspace deve rispettare questo standard.*
*Non è una linea guida — è un contratto di sviluppo.*

---

## La regola in una frase

**Ogni pagina nasce già in 3 lingue, responsive, con tema Brigade, senza testo hardcoded, senza modal grandi, come tab workspace.**

Non si finisce una pagina e poi si aggiunge la traduzione.
Non si fa la versione desktop e poi si adatta al mobile.
Nasce già così, oppure non è finita.

---

## Checklist obbligatoria (ogni nuova pagina)

Prima di considerare una pagina completa, risponde "sì" a tutti questi punti:

```
□ 1.  it/en/es translations complete — ogni chiave ha tutte e 3 le lingue
□ 2.  No hardcoded UI labels — ogni stringa visibile usa t('key')
□ 3.  Mobile responsive — una colonna, spazio sufficiente, leggibile su iPhone
□ 4.  Desktop responsive — usa lo spazio, layout più ampio, sidebar se serve
□ 5.  Brigade theme tokens — ogni colore e spazio via var(--variabile)
□ 6.  No hardcoded hex colors — mai #2563eb in componenti, solo var(--b6)
□ 7.  Works as workspace tab — non si apre come modal o pagina separata
□ 8.  No large modal workflows — form complessi → inline panel o tab, non modal
□ 9.  Chef AI context string — ogni pagina espone un contesto per il drawer
□ 10. Role/permission aware — mostra solo ciò che il ruolo può vedere
```

Se uno di questi è "no" → la pagina non è pronta per la workspace.

---

## Struttura i18n obbligatoria

### Formato chiavi

```js
// Namespace per pagina — evita collisioni
t('journal.title')          // ✅ con namespace
t('journalTitle')            // ⚠️  accettabile ma meno leggibile
t('Diario operativo')        // ❌ mai testo diretto come chiave

// Nesting per sezioni logiche
t('journal.filters.service')
t('journal.form.title')
t('journal.form.visibility')
t('journal.empty.title')
t('journal.empty.sub')
```

### Struttura dizionario

Ogni chiave DEVE avere tutte e 3 le lingue. Se manca una lingua → chiave incompleta → pagina non finita.

```js
// ✅ CORRETTO — chiave completa
{
  it: 'Diario operativo',
  en: 'Operations Journal',
  es: 'Diario de Operaciones'
}

// ❌ SBAGLIATO — chiave parziale (non deployare)
{
  it: 'Diario operativo',
  en: 'Operations Journal'
  // es mancante
}
```

### Come aggiungere chiavi per una nuova pagina

1. Apri il blocco `const TR={` in standalone.html
2. Aggiungi le chiavi in **tutti e 3 i blocchi** (`it:{}`, `en:{}`, `es:{}`) nella stessa modifica
3. Usa namespace della pagina: `journal.*`, `recipe.*`, `inventory.*`, `bots.*`
4. Non aggiungere mai una chiave a un solo blocco lingua

---

## Struttura responsive obbligatoria

### Breakpoint Brigade

```css
/* Mobile first */
.page-element { /* stile mobile */ }

/* Tablet */
@media(min-width:641px){
  .page-element { /* adattamenti tablet */ }
}

/* Desktop */
@media(min-width:901px){
  .page-element { /* layout desktop ampio */ }
}
```

### Layout per tipo di pagina

**Pagine lista (Journal, Ricette, Dispensa):**
```
mobile:  1 colonna, card full-width, filtri scrollabili
tablet:  1-2 colonne, filtri in riga
desktop: 2-3 colonne, sidebar filtri opzionale
```

**Pagine editor (Recipe Editor, Inventory Item):**
```
mobile:  1 colonna, sezioni stack
tablet:  2 colonne (info + BOM/steps affiancate)
desktop: 2-3 colonne con sidebar
```

**Pagine dashboard (Bot Center, Sales):**
```
mobile:  card singola, tab scrollabili
tablet:  2 colonne cards
desktop: grid multi-colonna, sidebar log
```

### Regola mobile minima

Su mobile (≤640px) una pagina Brigade deve:
- Avere padding minimo 14px laterale
- Testo body ≥ 13px
- Bottoni ≥ 44px di altezza (Apple HIG)
- Nessun elemento che esce dallo schermo orizzontalmente
- Tab bar scrollabile orizzontalmente se >3 tab

---

## Tokens Brigade obbligatori

### Mai usare colori diretti nei componenti

```css
/* ❌ MAI così */
.card { background: #ffffff; border: 1px solid rgba(37,99,235,0.13); }
color: #1e3a5f;
background: #2563eb;

/* ✅ SEMPRE così */
.card { background: var(--surf); border: 1px solid var(--bd); }
color: var(--tx);
background: var(--b6);
```

### Token reference rapida

| Categoria | Token | Valore |
|---|---|---|
| Background base | `var(--bg)` | #eff6ff |
| Superficie glass | `var(--surf-g)` | rgba(255,255,255,.75) |
| Superficie solida | `var(--surf)` | #ffffff |
| Testo primario | `var(--tx)` | #1e3a5f |
| Testo secondario | `var(--tx2)` | #3b6ea8 |
| Testo muted | `var(--txm)` | #7a9cc4 |
| Blu primario | `var(--b6)` | #2563eb |
| Blu hover | `var(--b7)` | #1d4ed8 |
| Border base | `var(--bd)` | rgba(37,99,235,.11) |
| Border forte | `var(--bd2)` | rgba(37,99,235,.22) |
| OK verde | `var(--ok)` | #16a34a |
| Warning | `var(--wn)` | #d97706 |
| Danger | `var(--er)` | #dc2626 |
| Shadow piccola | `var(--sh1)` | ... |
| Shadow media | `var(--sh2)` | ... |
| Radius medio | `var(--r2)` | 14px |
| Radius grande | `var(--r3)` | 20px |

---

## Regola modal vs pagina

### Modal: SOLO per azioni piccole e rapide

✅ Conferma eliminazione (2 bottoni, max 3 righe)
✅ Quick note / snooze
✅ Date picker
✅ Yes Chef sheet (celebrazione)
✅ Selezione singola (stazione, categoria)

❌ Mai modal per: form lunghi, editor, liste, dashboard, workflow multi-step

### Come si riconosce una modal "troppo grande"

Se la modal ha:
- più di 3 campi form
- scroll interno
- più di 2 bottoni
- un titolo sezione
- un sub-workflow ("prima salva, poi vai")

→ Non è una modal, è una pagina. Apri una tab.

### Form inline vs modal

Per form di creazione (nuova voce diario, nuovo item, ecc.):
```
// ✅ Inline panel — si apre in cima alla lista
<div class="inline-form-panel" id="form-panel">
  <!-- form qui -->
</div>

// ✅ Bottom drawer su mobile (stesso del Chef AI)
// ✅ Side panel su desktop

// ❌ Mai position:fixed full-screen per form
```

---

## Chef AI context

Ogni pagina deve registrare il proprio contesto per Chef AI.

```js
// In caiContext() — aggiungere entry per ogni nuova pagina
var ctx = {
  home:          t('cai_ctx_home'),
  bot_center:    t('cai_ctx_bots'),
  recipe:        t('cai_ctx_recipe') + (tab.params?.name ? ' — ' + tab.params.name : ''),
  inventory:     t('cai_ctx_inv')    + (tab.params?.name ? ' — ' + tab.params.name : ''),
  daily_journal: t('cai_ctx_journal'),
  // AGGIUNGERE QUI ogni nuova pagina
  // new_page:   t('cai_ctx_newpage'),
};
```

Tradurre `cai_ctx_newpage` in it/en/es.

---

## Role/permission awareness

Ogni pagina che mostra dati sensibili deve filtrare per ruolo.

```js
// Pattern standard
function canSee(permission){
  return (PERMS[permission]||[]).includes(ROLE);
}

// Uso nel renderer
if(canSee('see_bots')){
  /* mostra Bot Center */
}
if(canSee('view_bom')){
  /* mostra BOM ricetta */
}
```

### Dati mai visibili a cook/dish_crew/viewer

- Food cost, margini, prezzi ingredienti
- Fatture e importi
- Dati admin/bot tecnici
- Operazioni Supabase dirette

---

## Migrazione pagine dalla live app

Le pagine nuove nascono già conformi. Le pagine migrate dalla live app richiedono conversione:

### Step di conversione obbligatori

1. **Testi** → sostituire tutti i `tr()` e stringhe hardcoded con `t('chiave')`
2. **Colori** → sostituire tutti i `#hex` e `rgba()` inline con `var(--token)`
3. **Layout** → rimuovere classi Tailwind, usare CSS workspace
4. **Modal** → convertire modal grandi in inline panel o tab
5. **onClick** → rimuovere tutti gli `onclick="funzione('arg')"`, usare `addEventListener`
6. **Supabase** → mantenere le query ma adattare al pattern workspace

### Cosa NON portare dalla live app

- Tailwind utility classes
- `style="..."` inline con colori o layout
- `onclick="funzione()"` con stringhe interpolate
- `document.createElement()` con innerHTML e stili inline
- Modal `position:fixed` con `z-index:9999`
- `tr()` — sostituire con `t()`

---

## Template pagina nuova

Struttura minima di una nuova pagina workspace:

```js
/* ════ NOME_PAGINA — Page Standard v1 ══════════════════════════════════════
   Checklist:
   ✅ it/en/es translations in TR object
   ✅ no hardcoded labels
   ✅ responsive (mobile/tablet/desktop)
   ✅ Brigade theme tokens
   ✅ workspace tab (not modal)
   ✅ no large modal workflows
   ✅ Chef AI context registered in caiContext()
   ✅ role/permission aware
   ════════════════════════════════════════════════════════════════════════ */

function pageNomePagina(params){
  params = params || {};

  /* Role guard — opzionale se la pagina è per tutti */
  if(!can('see_nome_pagina')){
    return '<div class="pi"><p style="color:var(--txm);padding:40px">'+t('err_permission')+'</p></div>';
  }

  return '<div class="pi">'
    +'<div class="ph">'
    +'<div class="ph-row">'
    +'<h2 class="ptitle">'+t('nome_pagina.title')+'</h2>'
    /* bottone primario solo se ruolo può agire */
    +(can('add_nome_pagina') ? '<button class="btnp" id="np-add-btn">'+t('nome_pagina.add')+'</button>' : '')
    +'</div>'
    +'<p class="psub">'+t('nome_pagina.subtitle')+'</p>'
    +'</div>'
    /* contenuto */
    +'...'
    /* footer demo */
    +'<p class="note"><span class="nd"></span>'+t('demo')+'</p>'
    +'</div>';
}

function nomePaginaAfterRender(){
  var ws=document.getElementById('workspace');
  /* wire con addEventListener, mai onclick inline */
  var addBtn=ws.querySelector('#np-add-btn');
  if(addBtn) addBtn.addEventListener('click', function(){ /* ... */ });
}
```

---

## Regola di revisione

Prima di ogni push di una nuova pagina, verificare:

```
node --check (se applicabile al bundle)
grep 'hardcoded-pattern' (colori diretti nei componenti)
grep 'onclick=' (inline event handlers)
check TR it/en/es completeness
```

In workspace/standalone.html questo viene verificato da `validatePage()` in console (dev mode).

---

*Fine documento. Non modificare senza aggiornare la versione e la data in cima.*
*Versione: 1.0 — 9 luglio 2026*
