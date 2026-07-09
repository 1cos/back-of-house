# BOH OS V2 — Workspace Architecture
*Documento architetturale — redatto 8 luglio 2026*
*Autore: Claude, con input Max Zubboli (Executive Chef, Zenos on the Square)*

> **Stato:** Planning document — nessun codice live, nessuna modifica all'app in produzione.
> **Scope:** Shell prototipo parallela in `/workspace/`. L'app Brigade in produzione rimane intatta.

---

## 1. Problema da risolvere

Brigade oggi è un insieme di moduli che si aprono uno sopra l'altro come modal.
Funziona, ma con l'espansione del sistema emergono limiti strutturali:

- File JS enormi (`office.js`, `recipes.js`) — tutto in un unico foglio
- Modal che scrollano male su mobile e perdono lo stato
- La pagina sottostante scrolla mentre una modal è aperta
- Passando da Recipe Editor → Bot Center → Inventory si perde il contesto
- Tema visivo inconsistente tra sezioni (colori random, card stilisticamente diverse)
- Stringhe hardcoded in italiano — l'app è multilingua ma non strutturalmente
- Nessun sistema di permessi granulare — la stessa UI per Max e per un line cook

La soluzione non è riscrivere tutta la logica.
È costruire una **shell di navigazione nuova** che ospiti le stesse pagine in un contenitore coerente.

---

## 2. Modello di navigazione: Workspace Tabs

### Il concetto

BOH OS v2 si comporta come Safari o Chrome — non come una serie di modal.

Ogni area di lavoro apre una **tab persistente** nell'interfaccia.
Le tab rimangono aperte, mantengono scroll position, filtri attivi, stato di ricerca.
Si chiudono con una X. Si può passare dall'una all'altra senza perdere niente.

### Struttura shell

```
┌─────────────────────────────────────────────────────┐
│  [≡] BOH OS          [🔔]  [Max ▾]                 │  ← Top bar (fisso)
├─────────────────────────────────────────────────────┤
│  [Bot Center ×]  [Recipe: Tiramisu ×]  [+ ]         │  ← Tab bar (persistente)
├─────────────────────────────────────────────────────┤
│                                                     │
│               CONTENUTO DELLA TAB ATTIVA            │  ← Workspace area (scrollabile)
│                                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Comportamento tab

- Ogni tab è una **istanza di pagina** con un titolo e un tipo
- Tipi di tab: `home`, `bot-center`, `recipe`, `prep-task`, `inventory-item`, `pos-dashboard`, `daily-journal`, `modifier-lab`, `dq-panel`, `invoice-review`
- Una tab di tipo `recipe` aperta su "Tiramisu" e un'altra su "Arrabbiata" possono coesistere
- Limite consigliato: 8-10 tab aperte contemporaneamente (oltre si nascondono in overflow)
- Stato tab serializzato in `sessionStorage` per sopravvivere a refresh (no DB, no localStorage)
- Al logout: tab chiuse, stato pulito

### Navigazione da dentro una pagina

Ogni link/bottone che in Brigade apriva una modal ora apre (o porta in primo piano) una tab:

| Azione | Oggi (Brigade) | In Workspace |
|---|---|---|
| Clicca su ricetta in lista | Apre modal ricetta | Apre tab `recipe:tiramisu-uuid` |
| Clicca su prep task | Apre modal prep | Apre tab `prep-task:balsamic-uuid` |
| Clicca su avviso Bot Center | Apre modal bot | Porta in primo piano tab `bot-center` |
| Clicca su ingrediente in DQ | Apre modal editor | Apre tab `inventory-item:uuid` |

---

## 3. Regola Modal vs Pagina (DEFINITIVA)

### Modal: SOLO per azioni piccole e rapide

- Conferma eliminazione (`"Sei sicuro?"`)
- Quick note / snooze su un avviso
- Date picker
- Yes Chef confirmation sheet (grande, celebrativa — già definita in decisioni)
- Selezione stazione / filtro rapido

**Regola pratica:** se una modal ha più di 2 scroll step su iPhone, deve diventare una pagina.

### Pagine/Tab: tutto il resto

- Recipe Editor (BOM, steps, resa, costing)
- Prep Task Editor
- Inventory Item (stock history, vendor, conversions)
- Bot Center (log, audit, dry run)
- POS Dashboard
- Modifier Depletion Lab
- Invoice Review
- Daily Journal
- Equipment Log

**Regola pratica:** se l'utente deve "lavorarci sopra" per più di 30 secondi, è una pagina.

---

## 4. Sistema Tema (Design Tokens)

### File centrale: `/workspace/css/tokens.css`

Un unico file con tutte le variabili CSS. Nessun colore hardcoded nelle pagine.

```css
:root {
  /* Background */
  --bg-base:        #eff6ff;   /* sky-50 */
  --bg-mid:         #dbeafe;   /* blue-100 */
  --bg-accent:      #e0f2fe;   /* sky-100 */

  /* Surfaces */
  --surface:        #ffffff;
  --surface-glass:  rgba(255, 255, 255, 0.72);
  --surface-raised: rgba(255, 255, 255, 0.90);

  /* Testo */
  --text-primary:   #1e3a5f;
  --text-secondary: #4a6fa5;
  --text-muted:     #7a9cc4;
  --text-on-dark:   #ffffff;

  /* Accento primario */
  --blue-primary:   #2563eb;   /* blue-600 */
  --blue-light:     #3b82f6;   /* blue-500 */
  --blue-pale:      #bfdbfe;   /* blue-200 */

  /* Status — soft, non al neon */
  --status-info:    #2563eb;   /* blue */
  --status-ok:      #16a34a;   /* green-600 */
  --status-warn:    #d97706;   /* amber-600 */
  --status-danger:  #dc2626;   /* red-600 */

  /* Status backgrounds (per badge/card) */
  --status-info-bg:   #eff6ff;
  --status-ok-bg:     #f0fdf4;
  --status-warn-bg:   #fffbeb;
  --status-danger-bg: #fef2f2;

  /* Border & Shadow */
  --border:         rgba(37, 99, 235, 0.15);
  --border-strong:  rgba(37, 99, 235, 0.30);
  --shadow-sm:      0 1px 3px rgba(30, 58, 95, 0.08);
  --shadow-md:      0 4px 16px rgba(30, 58, 95, 0.12);
  --shadow-glass:   0 8px 32px rgba(30, 58, 95, 0.10);

  /* Radius */
  --radius-sm:   6px;
  --radius-md:   12px;
  --radius-lg:   20px;
  --radius-pill: 999px;

  /* Typography */
  --font-base:    -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  --font-mono:    'SF Mono', 'Fira Code', monospace;
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-md: 15px;
  --font-size-lg: 17px;
  --font-size-xl: 22px;

  /* Tab bar */
  --tab-height:   40px;
  --topbar-height: 52px;
}
```

### Principio di utilizzo

Ogni componente usa variabili, mai colori diretti:

```css
/* ✅ corretto */
.card { background: var(--surface); border: 1px solid var(--border); }

/* ❌ mai così */
.card { background: #fff; border: 1px solid rgba(37,99,235,0.15); }
```

Questo permette in futuro di aggiungere un tema dark o un tema high-contrast con una sola riga:
```css
[data-theme="dark"] { --bg-base: #0f172a; --surface: #1e293b; /* ... */ }
```

---

## 5. Sistema i18n (Internazionalizzazione)

### Regola

**Ogni stringa UI visibile all'utente passa attraverso `t(key)`.**

Non si tratta di miglioramento opzionale — è una regola strutturale della nuova shell.
Nomi di ricette, ingredienti, voci POS: dati, non stringhe tradotte.
Label di pulsanti, titoli di sezione, messaggi di stato: sempre tramite chiave.

### File struttura

```
/workspace/i18n/
  translations.js   ← oggetto { it: {}, en: {}, es: {} } con tutte le chiavi
  i18n.js           ← funzione t(key, params) + rilevamento lingua attiva
```

### Funzione `t()`

```js
// i18n.js
export function t(key, params = {}) {
  const lang = getActiveLang(); // legge da user.lang o sessionStorage
  const str = translations[lang]?.[key] ?? translations['en']?.[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}

// Esempio
t('tab.recipe', { name: 'Tiramisu' })
// it → "Ricetta: Tiramisu"
// en → "Recipe: Tiramisu"
// es → "Receta: Tiramisu"
```

### Convenzione chiavi

```
sezione.componente.azione
```

Esempi:
```
nav.home           → "Home" / "Home" / "Inicio"
nav.bot_center     → "Bot Center" / "Bot Center" / "Centro Bot"
tab.recipe         → "Ricetta: {name}" / "Recipe: {name}" / "Receta: {name}"
btn.save           → "Salva" / "Save" / "Guardar"
btn.cancel         → "Annulla" / "Cancel" / "Cancelar"
journal.new_entry  → "Nuova voce" / "New entry" / "Nueva entrada"
status.ok          → "OK" / "OK" / "OK"
status.warning     → "Attenzione" / "Warning" / "Atención"
```

### Lingue supportate

- `it` — Italiano (Max, Anto)
- `en` — English (Cole, David, Colton, line cooks EN)
- `es` — Español (Zuu/Maria Rosa, Rachel/Carolina)

Kitchen Display (`display.html`) rimane solo inglese — regola permanente, non cambia.

---

## 6. Sistema Ruoli e Permessi

### Modello: role + permissions

Non si usa solo un "ruolo" generico — ogni azione è controllata da un **permesso specifico**.
Il ruolo è solo un preset di permessi di default.

### Ruoli predefiniti

| Ruolo | Utenti tipici |
|---|---|
| `executive` | Max |
| `lead` | David, Colton, Anto/Antonella |
| `coordinator` | Tela |
| `cook` | Cole, Samantha, Todd, Sofia, Rachel, Chance, Haley, Preston, Chris, Genova |
| `dish_crew` | Austin, Jaxon, Arianna, Kelly, Herminia, Jose, Luis, Ronaldo |
| `viewer` | GM, FOH managers, owners, admin ufficio |

### Permessi granulari

```js
const PERMISSIONS = {
  // Ricette
  can_view_recipes:       ['executive','lead','coordinator','cook','viewer'],
  can_edit_recipes:       ['executive'],
  can_view_bom:           ['executive','lead'],
  can_edit_bom:           ['executive'],

  // Prep
  can_view_prep:          ['executive','lead','coordinator','cook'],
  can_edit_prep_tasks:    ['executive','lead'],
  can_log_prep:           ['executive','lead','coordinator','cook'],

  // Inventory / Stock
  can_view_inventory:     ['executive','lead','coordinator'],
  can_edit_stock:         ['executive','lead'],
  can_view_dispensa:      ['executive','lead','coordinator','cook'],

  // POS / Vendite
  can_view_pos:           ['executive','lead'],
  can_view_food_cost:     ['executive'],      // MAI a cook/dish_crew
  can_view_modifiers:     ['executive','lead'],

  // Bot / Sistema
  can_view_bots:          ['executive','lead'],
  can_run_bots:           ['executive'],
  can_view_dq_panel:      ['executive','lead'],

  // Fatture / Fornitori
  can_view_invoices:      ['executive','lead','coordinator'],
  can_approve_invoices:   ['executive'],

  // Journal
  can_view_journal:       ['executive','lead','coordinator','viewer'],
  can_add_journal:        ['executive','lead','coordinator'],

  // Amministrazione
  can_manage_users:       ['executive'],
  can_view_audit_logs:    ['executive'],
};
```

### Funzione `can(permission)`

```js
// permissions.js
export function can(permission) {
  const user = getActiveUser();
  return PERMISSIONS[permission]?.includes(user.role) ?? false;
}

// Uso nei componenti
if (can('can_view_food_cost')) {
  renderFoodCostPanel();
}
```

### Principio

- Il menu di navigazione mostra solo le voci accessibili al ruolo attivo
- Le tab non accessibili non si aprono (redirect silenzioso a home)
- I dati finanziari (food cost, margini, prezzi fatture) non appaiono MAI per ruoli `cook`/`dish_crew`/`viewer`

---

## 7. Daily Journal

### Concept

Un log operativo condiviso dove manager, chef, owner e in prospettiva FOH possono registrare tutto quello che succede in giornata — al di là delle ricette, dei bot e del venduto.

Non è una chat. È un registro strutturato con categorie e visibilità per ruolo.

### Schema DB proposto

```sql
CREATE TABLE daily_journal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date   date NOT NULL,
  created_at      timestamptz DEFAULT now(),
  created_by      uuid REFERENCES users(id),
  category        text NOT NULL,        -- 'service'|'kitchen'|'maintenance'|...
  title           text NOT NULL,
  body            text,
  severity        text DEFAULT 'info',  -- 'info'|'warning'|'critical'
  visibility      text DEFAULT 'managers', -- 'all'|'kitchen'|'managers'|'executive'
  tags            text[],
  related_type    text,                 -- 'recipe'|'ingredient'|'equipment'|null
  related_id      uuid,
  attachments     jsonb DEFAULT '[]'
);
```

### Categorie

```
service      → eventi di servizio (86, menu change, special)
kitchen      → cucina (prep, temperatura, attrezzatura)
maintenance  → riparazioni, tecnici, ispezioni
equipment    → acquisti, rotture, manutenzione programmata
staff        → note personale (arrivi, uscite, turni straordinari)
purchase     → ordini ricevuti, resi, problemi fornitura
incident     → incidenti, allergeni, reclami
foh          → note sala (comunicazioni con FOH manager)
catering     → eventi catering (in futuro: link a TripleSeat)
admin        → note amministrative generali
```

### Visibilità

```
all       → tutta la brigata
kitchen   → solo cucina (non FOH)
managers  → lead + coordinator + executive
executive → solo Max
```

### Connessione al Workspace

Una voce journal può avere `related_type` e `related_id`.
Esempio: voce "Lavastoviglie riparata" → `related_type='equipment'`, `related_id=uuid_lavastoviglie`.

In futuro, aprire questa voce porterà in primo piano la tab `equipment:lavastoviglie-uuid`.
Questo è il foundation del collegamento tra journal e resto del sistema.

### UI base

```
[+ Nuova voce]   [Filtro categoria ▾]   [Date ▾]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 MAINTENANCE  — 8 luglio 2026 · Tela
Lavastoviglie riparata
Tecnico Hobart — revisione braccio superiore. Tutto OK.
[vedere storico attrezzatura →]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🍽️ SERVICE  — 8 luglio 2026 · David
52 bills. Record luglio. Brussels finiti alle 21:15.
[collegato: Brussels Sprouts prep task →]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 8. Struttura cartelle `/workspace/`

```
/workspace/
│
├── index.html                 ← Shell HTML unica (no frameworki)
├── manifest.json              ← PWA manifest workspace (separato da root)
├── sw-workspace.js            ← Service worker SEPARATO: 'boh-ws-v1'
│                                (non interferisce con boh-v* live)
│
├── css/
│   ├── tokens.css             ← Design tokens (unica fonte di verità per colori/spazi)
│   ├── shell.css              ← Layout shell, tab bar, top bar
│   ├── components.css         ← Card, button, badge, form fields
│   └── pages.css              ← Stili pagine specifiche
│
├── js/
│   ├── app.js                 ← Bootstrap: init auth, carica workspace, gestisce stato globale
│   ├── router.js              ← Mappa tipo-tab → componente pagina
│   ├── tabs.js                ← Gestione tab aperte, serializzazione sessionStorage
│   ├── state.js               ← Store globale leggero (no framework)
│   └── supabase-client.js     ← Client Supabase (stesso progetto: ydqmumpytgrlceuinoqt)
│
├── i18n/
│   ├── i18n.js                ← Funzione t(), rilevamento lingua
│   └── translations.js        ← { it: {}, en: {}, es: {} }
│
├── permissions/
│   └── permissions.js         ← Mappa role→permissions + funzione can()
│
├── components/
│   ├── top-bar.js             ← Barra superiore fissa
│   ├── tab-bar.js             ← Tab strip persistente
│   ├── sidebar.js             ← Navigazione laterale (desktop)
│   ├── card.js                ← Card componente riusabile
│   ├── button.js              ← Button componente (primary/secondary/danger)
│   ├── badge.js               ← Badge status (ok/warn/danger/info)
│   ├── modal-small.js         ← Modal piccola per azioni rapide (confirm, snooze)
│   ├── yes-chef-sheet.js      ← Sheet celebrativa "Yes Chef" (grande, emoji)
│   └── toast.js               ← Toast notifica non bloccante
│
└── pages/
    ├── home.js                ← Home: card grandi per area di lavoro
    ├── bot-center.js          ← (placeholder) Log bot, audit, trigger
    ├── recipe-page.js         ← (placeholder) Editor ricetta completo
    ├── prep-page.js           ← (placeholder) Prep task editor
    ├── daily-journal.js       ← (placeholder) Journal: lista + new entry
    └── pos-dashboard.js       ← (placeholder) (solo executive/lead)
```

### Service Worker: nome `boh-ws-v1`

Il service worker di `/workspace/` usa un cache name completamente separato:

```js
// sw-workspace.js
const CACHE_NAME = 'boh-ws-v1';
// Solo assets in /workspace/ — non tocca boh-v* o boh-dev-*
```

Questo garantisce che le cache del live (`boh-v596`) e di `/dev/` (`boh-dev-v2`) non vengano mai toccate.

Per il prototipo iniziale si può anche partire **senza service worker** — aggiungere `sw-workspace.js` solo quando il prototipo è sufficientemente stabile.

---

## 9. Piano di migrazione sicura (live app intatta)

### Principio: `/workspace/` è un universo separato

- Route separate: `https://1cos.github.io/back-of-house/workspace/`
- Service worker separato (cache name diverso)
- Nessun file condiviso con l'app live (no import cross-cartella)
- Stessa Supabase DB in lettura — nessuna scrittura dal prototipo finché non approvato
- Nessun link dall'app live al prototipo (accesso solo diretto all'URL)

### Fasi di migrazione (futura, non ora)

```
Fase 0 — Shell (ora)
  /workspace/ con navigazione tab, tema, i18n, permessi
  Pagine dummy: Home, Bot Center, Journal
  Zero logica reale, zero scrittura DB

Fase 1 — Prima pagina reale (quando Shell è approvata)
  Scegliere la pagina con meno side effects — es. Daily Journal (solo lettura/scrittura journal)
  Migrare la logica da Brigade → pagina workspace corrispondente
  Verificare con Max prima di ogni scrittura DB

Fase 2 — Pagine progressiva
  Recipe Editor (lettura solo prima, poi scrittura)
  Bot Center (solo lettura log)
  Prep Task Editor
  ...

Fase 3 — Promozione (solo se Max decide)
  Workspace diventa la root — vecchio app va in /legacy/
  O: workspace rimane parallelo ma diventa il default per Max
```

### Cosa non cambia durante la migrazione

- `sw.js` root — invariato
- `index.html`, `office.js`, `recipes.js`, `prep.js` — invariati
- Tutti i bot — invariati
- Supabase Edge Functions — invariate
- Kitchen Display (`display.html`) — invariato

---

## 10. Scope del primo prototipo

Il primo deliverable non è un'app funzionante.
È una **shell navigabile** che risponde a questa domanda:

> *"Questo modo di lavorare si sente giusto? Vale la pena migrare?"*

### Cosa include il prototipo

- `index.html` — shell unica con top bar + tab bar
- `tokens.css` + `shell.css` — tema light blue completo
- `i18n.js` + `translations.js` — `t()` funzionante, it/en/es su tutta la shell
- `permissions.js` — `can()` funzionante con role switcher (demo only, non collegato al DB)
- `tabs.js` — apertura/chiusura/navigazione tab con stato in sessionStorage
- **3 pagine dummy** (nessuna logica reale, solo UI):
  - `home.js` — card per Bot Center, Journal, Recipes
  - `bot-center.js` — pagina stub con titolo, tab attiva, placeholder contenuto
  - `daily-journal.js` — lista vuota + bottone "Nuova voce" (modal piccola di test)
- `yes-chef-sheet.js` — componente sheet celebrativa (testabile standalone)

### Cosa NON include il prototipo

- Nessuna query Supabase
- Nessuna scrittura DB
- Nessun bot
- Nessun Recipe Editor reale
- Nessun collegamento a Brigade live
- Nessun service worker (aggiunto dopo stabilizzazione)

### Criteri di approvazione prototipo

Prima di costruire la prima pagina reale, Max deve poter rispondere "sì" a:

1. La navigazione a tab si sente naturale su iPhone?
2. Il tema è quello giusto?
3. Il cambio lingua funziona e si sente giusto?
4. Aprire Bot Center / Journal / Home senza perdere contesto funziona come mi aspettavo?

Solo con 4 "sì" si passa alla Fase 1 (prima pagina reale).

---

## Appendice — Decisioni rapide già prese

| Decisione | Valore |
|---|---|
| Cartella | `/workspace/` |
| Cache SW | `boh-ws-v1` (separato da `boh-v*` e `boh-dev-*`) |
| Framework JS | Nessuno — Vanilla JS modulare (coerente con Brigade) |
| Framework CSS | Nessuno — CSS custom + variables |
| Lingue | it / en / es (Kitchen Display: solo en, permanente) |
| DB | Stessa Supabase (ydqmumpytgrlceuinoqt) — lettura only nel prototipo |
| Deploy | GitHub Pages, stessa repo `1cos/back-of-house`, branch `brigade-main` |
| Accesso al prototipo | Solo URL diretto — nessun link dall'app live |
| Live app | Intatta — zero tocchi durante tutto lo sviluppo del prototipo |

---

*Fine documento architetturale.*
*Prossimo passo: approvazione di Max → costruire il prototipo shell minimo.*
