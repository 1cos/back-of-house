# BOH OS — SPEC
*Source of truth for every Claude session.*
*Load this first, always.*

---

## The Vision — Il Sous Chef Digitale

**BOH OS is not a management app. It is a digital sous chef.**

The perfect sous chef does not bring the chef 10 problems at once.
He approaches during service and says one thing:

*"Chef, the Bolognese is low."*
Chef says: *"Make another batch."*
He says: *"Done."*
Back to work.

**This is the exact model for every interaction in BOH OS.**

The app knows everything. It interrupts only when a decision is needed.
It presents one problem, one suggestion, one action.
The chef taps. Done. Next.

This is the **One Question Rule (OQR)** — the central mantra of the entire project.

Not: "Here is the inventory page with 596 items, filters, columns, tabs."
Yes: "Chef, 3 items changed price this week. Want to see?"

Not: "Fill this form to create a production task."
Yes: "Need to make Arrabbiata today. How much? [ 1 batch ] [ 2 batches ] [ I decide ]"

Not: "You have 286 recipe warnings."
Yes: "There's a yield issue on Arrabbiata. Fix it now? [ Yes ] [ Later ]"

**The sous chef knows everything. He only interrupts when the chef must decide.**

---

## What Is BOH OS

Kitchen operating system for Zeno's on the Square, Weatherford TX.
Chef/owner: Max. Key staff: Anto, Tela, Cole, Samantha, Sofia.

Not a generic app. Not accounting software.
A digital sous chef for a real working kitchen.

**The primary object is not a recipe or invoice — it is a decision requiring chef attention.**

---

## Stack

### HTML (current / production)
- Vanilla JS modules, no framework
- Supabase (DB, Edge Functions, Realtime)
- Groq LLaMA 3.3 70B (AI)
- Google Vision OCR (free tier, 1000/month)
- GitHub Pages deployment → https://1cos.github.io/back-of-house
- Safari/iPhone: requires `maximum-scale=1,user-scalable=no`

### Flutter (in progress / future)
- Flutter + Dart, iPhone-first
- Same Supabase project ID: `hykjompnvajjhggrnned`
- Localization: English (primary), Italian, Spanish
- Target: App Store, Siri AI integration (iOS 27+)

---

## Supabase

Project name: **Mise en Place**
Project ID: `ydqmumpytgrlceuinoqt`
URL: https://ydqmumpytgrlceuinoqt.supabase.co

Key tables:
- `users` (pin column, role)
- `recipes`, `recipe_versions`, `recipe_lines`, `recipe_steps`, `recipe_notes`, `recipe_qa_warnings`
- `inventory_items`, `inventory_vendors`, `vendor_sku_aliases`
- `inventory_invoice_imports`, `inventory_invoice_import_lines`
- `ingredient_links`

Edge Functions:
- `process-invoice` — OCR pipeline (Google Vision → Groq parser)
- `ai-translate` — multilingual with `__detect__` mode

RLS note: direct table deletes from Flutter may fail. Use RPC security definer functions for dev tools.

---

## Modules — Status

| Module | HTML | Flutter |
|---|---|---|
| Auth / PIN | ✅ | ✅ |
| Dashboard | ✅ | ✅ |
| Recipes | ✅ | ✅ active |
| Inventory | ✅ stub | ✅ active |
| Invoice Import / OCR | 🔧 parser broken | ✅ active |
| Prep / Production | ✅ | ⬜ not started |
| Closing Checklist | ✅ | ✅ |
| Chat / Sous Chef | ✅ | ⬜ |
| Vendor Parser UI | 🔧 partial | — |
| Whiteboard | ⬜ scoped | ⬜ |
| Touch Bistro import | ⬜ awaiting CSV | ⬜ |
| TripleSeat integration | ⬜ awaiting creds | ⬜ |

---

## Module Files (HTML)

| Module | Primary file(s) |
|---|---|
| App shell | `index.html`, `app.js`, `init.js` |
| Auth | `auth.js` |
| Invoice pipeline | `invoice.js`, `vendor-parser-ui.js`, `vendor-documents-review.js` |
| Ingredients | `ingredients.js` |
| Recipes | `recipes.js` |
| Prep | `prep.js` |
| Briefing | `briefing.js` |
| Closing | `closing.js` |
| Chat | `chat.js`, `souschef.js` |
| News | `news.js` |
| Admin | `admin.js` |
| Utils | `utils.js` |
| Hardie's | `hardies-invoice.js`, `hardies-order.js`, `hardies-credit.js` |

---

## Module Files (Flutter)

Core path: `lib/features/`

| Module | Path |
|---|---|
| Dashboard | `dashboard/` |
| Recipes | `recipes/` |
| Inventory | `inventory/` |
| Invoice imports | `inventory/imports/` |
| Production | `production/` |
| Stations | `stations/` |
| Shell / nav | `shell/main_shell.dart` |
| Localization | `lib/l10n/` |

---

## Vendor Parsers (HTML)

Vendor-specific parsing rules exist for:
- Hardie's
- Ben E. Keith
- Frugé
- FreshPoint Dallas ← known parser gap
- Global Gourmet

General parser insufficient. Vendor signature detection required.

---

## Core Design Rules (Both Stacks)

**One Question Rule (OQR) — the mantra:**
Never ask the chef to solve multiple problems at once.
One issue → one suggestion → one confirm → one override option.
Bottom of screen. One tap. Done. Next.

Pattern:
```
[ Problem in one line ]
[ Why it matters in one line ]
[ Suggested solution ]
[ PRIMARY ACTION ]  [ manual override ]
```

HTML: fixed bottom card or bottom sheet.
Flutter: `showModalBottomSheet` or persistent bottom card.

**Imported data is not confirmed data.**
Never show imported values as truth. Always flag for review.

**No fake defaults.**
Blank > placeholder > invented value. Never save a guessed value silently.

**Unmatched is safer than wrong match.**
Invoice line matching: wrong match poisons costing.

**Complete files only.**
No partial patches. No TODO placeholders.

**Scope discipline.**
Fix only what was asked. Do not refactor adjacent code.
