# Chef AI & User Presence — Workspace Architecture
*Aggiunto: 9 luglio 2026 — sessione workspace v6*

---

## Chef AI nella shell Brigade

### Concetto

Chef AI non è una funzione nascosta. È un membro della brigata — sempre presente, sempre in ascolto, visibile nella topbar come gli altri utenti online.

**Posizione nella topbar (desktop):**
```
[B] Brigade     Search...     🤖 Chef AI    ● Tela  ● David    MZ▾
```
**Posizione mobile:**
```
[B] Brigade     Search...     🤖     MZ▾
```

### Comportamento del pannello Chef AI

Chef AI si apre come **side panel / assistant drawer** — NON una modal, NON una pagina separata.

Regole:
- Non sostituisce la tab attiva
- Non rompe la navigazione workspace
- Si apre a destra (desktop) o da sotto (mobile)
- Mantiene contesto: sa su quale pagina/tab sei
- Si chiude con X — la tab precedente è intatta
- Persiste mentre navighi le tab (opzionale nella v1)

**Contesto pagina** (per ora simulato, in futuro reale):
- Bot Center → "Sto guardando il log pipeline"
- Diario → "Sto leggendo il diario di oggi"
- Ricetta → "Sto guardando Tiramisu — Pastry"
- Dispensa → "Sto guardando Caesar Dressing"

### Chef AI come stato online

Chef AI compare tra gli utenti online con stati:
```
🤖 Chef AI · on duty          (default)
🤖 Chef AI · watching bots    (dopo run pipeline)
🤖 Chef AI · reading POS      (dopo import CSV)
🤖 Chef AI · needs review     (ci sono avvisi in L'Ufficio)
🤖 Chef AI · quiet hours      (22:00–07:00 CDT)
```

In workspace demo: stato fisso "on duty".

### Audit: cosa esiste nella live app

| Componente | File | Stato | Note |
|---|---|---|---|
| `openSousChefChat()` | `js/souschef-chat.js` | ✅ Live | Sheet bottom-up, chat con Edge Function. Non riusabile direttamente — inline style, Tailwind, no tokens workspace |
| `openChefAISettings()` | `js/admin-chef-ai.js` | ✅ Live | Settings regole scan. Modal inline, no tokens workspace |
| `runSousChefScan()` | `js/souschef-scan.js` | ✅ Live | Scan automatica ogni ora |
| Chef AI icon in topbar | `dev/index.html` | ❌ No | Non esiste ancora nella topbar |

### Cosa importare in /workspace

✅ **Il concetto** del drawer persistente
✅ **Il prompt system** (non il codice — riusato via Edge Function `souschef-chat`)
❌ **Non il codice** — inline styles, Tailwind, `onclick=` strings, no tokens, no i18n

Per /workspace: Chef AI panel è costruito da zero, rispettando:
- theme tokens (var(--b6), var(--surf-g), ecc.)
- i18n t() per ogni label
- event delegation, no inline onclick
- drawer laterale, non modal fissa

---

## User Presence — Online Users

### Audit: cosa esiste nella live app

| Componente | File | Stato | Note |
|---|---|---|---|
| `loadPresence()` | `js/presence.js` | ✅ Live | Legge `user_presence` table, avatar colorati con photo_url support |
| `updatePresence()` | `js/presence.js` | ✅ Live | Upsert ogni 60s, Supabase realtime channel |
| `showPresenceTooltip()` | `js/presence.js` | ✅ Live | Tooltip click su avatar online |
| `startPresence()` | `js/presence.js` | ✅ Live | Init + realtime subscribe |
| `#online` div in topbar | `dev/index.html` | ✅ Live | Container avatar online, flex row |

### Cosa importare in /workspace

**Concetto**: avatar online con colore deterministico da initials, photo_url se disponibile, tooltip nome+stazione.

**Differenze workspace:**
- In demo: array statico di 3-4 colleghi (Tela, David, Cole + Chef AI)
- In produzione futura: stessa `user_presence` table, stesso pattern realtime
- Tooltip via CSS hover (no JS click) — più semplice e mobile-friendly
- Chef AI tra i "online" con stato testuale

---

## User Profile / Preferences — Migration Audit
*Sezione separata — vedi BOH_OS_V2_WORKSPACE_ARCHITECTURE.md per contesto*

### Audit: cosa esiste nella live app

| Feature | Dove esiste | Stato | Qualità | Workspace-ready? |
|---|---|---|---|---|
| PIN login (4 cifre) | `dev/js/app.js` + `dev/index.html` | ✅ Live | Funziona, Supabase `users.pin` | No — inline onclick, no tokens |
| Avatar / foto profilo | `dev/index.html` `#topbarAvatar` + `users.photo_url` | ✅ Live | photo_url da Supabase Storage | No — inline styles |
| Lingua utente | `dev/js/app.js` `user?.lang` | ✅ Parziale | Letto da DB, non salvato via UI | No — hardcoded `tr()`, non `t()` |
| `openProfile()` | `dev/index.html` (onclick) | ⚠️ Chiamata presente | Funzione non trovata nel dev — legacy, probabilmente non implementata | No |
| `openChangePIN()` | `dev/index.html` `#pwdBtn` | ✅ Chiamata presente | Funzione in `dev/js/app.js` | No — inline style |
| Notifiche push | `js/push.js` | ✅ Live | Service worker, subscription Supabase | No — non collegato a preferenze UI |
| Quiet hours | Non trovato | ❌ Non esiste | Da costruire | N/A |
| Data di nascita | Campo `users.birthday` in DB | ✅ DB | Usato per compleanni in chat | Non esposto in UI |
| Ruolo/permessi | `users.role` in DB | ✅ Live | Usato per isAdmin() ecc. | Non editabile da UI |
| Presence log | `js/presence.js` `loadPresenceLog()` | ✅ Live | Solo Max vede storico presenze | Concetto importabile |

### Decisioni per /workspace

**Priorità 1 — da costruire subito (serve al prototipo):**
- [x] User menu dropdown (MZ▾) — già in v5
- [x] Language switch dentro menu — già in v5
- [x] Role switcher demo — già in v5
- [ ] Chef AI panel/drawer — v6

**Priorità 2 — da costruire quando si connette Supabase:**
- [ ] Profile page (tab `profile:current-user`) con avatar, nome, lingua
- [ ] Change PIN (inline form nel profile tab)
- [ ] Photo upload (Supabase Storage)

**Priorità 3 — backlog:**
- [ ] Notification preferences
- [ ] Quiet hours (10 PM – 7 AM CDT)
- [ ] Birthday display

### Regola di migrazione

Prima di copiare una feature dalla live app nel workspace:

1. **Serve ancora?** — Solo se connessa a un flusso reale
2. **Usa theme tokens?** — Se no, riscrivere CSS da zero
3. **Usa i18n t()?** — Se no, sostituire tutti i tr() con t()
4. **Usa event delegation?** — Se no, rimuovere tutti gli onclick= inline
5. **È una pagina/tab o modal?** — Modal grandi → convertire in tab

**Non copiare mai:** Tailwind hardcoded, inline style, `onclick="funzione('arg')"`, `document.createElement()` con innerHTML+stili inline.

---

## Layout topbar target (v6+)

```
Desktop (≥ 768px):
┌─────────────────────────────────────────────────────────────────┐
│ [B] Brigade    [  ⌕ Cerca...  ]   🤖  ●TL ●DV ●CL  DEMO  [MZ▾]│
└─────────────────────────────────────────────────────────────────┘

Mobile (< 768px):
┌─────────────────────────────────────────────────────────────────┐
│ [B] Brigade    [  ⌕ Cerca  ]    🤖   DEMO   [MZ▾]              │
└─────────────────────────────────────────────────────────────────┘
```

MZ▾ dropdown:
```
┌─────────────────────┐
│ Max Zubboli         │
│ Executive Chef      │
├─────────────────────┤
│ 👤 Profilo          │
├─────────────────────┤
│ 🌐 Lingua           │
│  [IT] [EN] [ES]     │
├─────────────────────┤
│ 🎭 Ruolo (demo)     │
│  [Executive Chef ▾] │
├─────────────────────┤
│ 🔕 Notifiche        │
│ 🕙 Quiet hours      │
│ 🔑 Cambia PIN       │
├─────────────────────┤
│ ↩ Esci              │
└─────────────────────┘
```
