# BOH OS — WARNING MASTER SYSTEM v2.0
*Authoritative reference for all warnings, alerts, insights and decision rules.*
*Load alongside SPEC when working on warnings, invoice review, or the attention queue.*

---

## The Central Insight

**OQR is not a category of warning. OQR is the channel through which every warning speaks to the chef.**

A blocking warning has a question. An alert has a question. An insight has a question —
even if it is self-concluding ("Price went up 18%. Seen? [OK]").

```
CODE     → describes THE PROBLEM   (what went wrong)
SEVERITY → describes THE URGENCY   (blocking / alert / insight)
OQR      → is ALWAYS the delivery  (one question, one answer, done)
```

**Codes are for the machine. The chef sees context, never codes.**
Codes live in exactly three places: the database (analytics), the source code (routing),
and this document. The UI shows only: emoji + item name + a question in plain English.

> ⚖️ **Baby Spinach** — Pack: 4# 4# BX
> I don't recognise this format. How much does one case weigh?

Never: `INV-PACK-001: pack_description unparseable`.

---

## Core Rules (BIOS)

These are laws of the system, not warnings.

| Rule | Statement |
|---|---|
| BIOS-001 | First time ask, second time learn. |
| BIOS-002 | Invoice workflows are for Admin and Sous Chef, not Cooks. |
| BIOS-003 | Missing item without substitution = Alert. |
| BIOS-004 | Substitutions = Insight. |
| BIOS-005 | Credit Memo questions identify root cause (ordering error vs delivery error). |
| BIOS-006 | Every received item is automatically created. |
| BIOS-007 | Item not used in recipes = Insight. |
| BIOS-008 | Ambiguous match = Blocking. |
| BIOS-009 | Resolved warnings remain in analytics history. |
| BIOS-010 | Decision warnings differ from missing-data warnings. |
| BIOS-011 | Warnings may be postponed but stay in queue. → *Approving with open questions IS the postponement. No "Later" button needed.* |
| BIOS-012 | Data Priority Model (see below). |
| BIOS-013 | Every decision is reversible. |
| BIOS-014 | Historical reports are not recalculated retroactively. |

**Design philosophy:**
The system should not ask *what to do*. The system should ask *who owns the problem*.

Warnings exist only when:
1. The system does not know a relationship.
2. The system may learn something incorrect.
3. Human attribution is required.

---

## Data Priority (BIOS-012)

When values conflict, trust in this order:

| Priority | Field | Note |
|---|---|---|
| P1 | Invoice Total | Source of truth. Never trust OCR unit prices over line totals. |
| P2 | Unit Cost | |
| P3 | Quantity Purchased | |
| P4 | Metadata & Analytics | |

---

## Severity Levels

| Severity | Color | Meaning | Examples |
|---|---|---|---|
| **Blocking** | 🔴 Red | Missing data that poisons food cost. Must be answered eventually. | Unparseable pack, ambiguous match |
| **Alert** | 🟡 Amber | A decision or attribution is needed. | Missing item, qty mismatch |
| **Insight** | 🔵 Blue | Information. One tap and done. | Price spike, substitution, unused item |

Amber is the default warning color; red only for high severity (avoid "broken app" look).

---

## Warning Registry

Every warning entry defines: internal code, severity, trigger, the OQR question the chef
sees, possible answers, who resolves it, and what the system learns (BIOS-001).

### 🔴 Blocking

#### INV-PACK-001 — Pack not parseable *(was OQR-008)*
- **Trigger:** Parser cannot extract weight/count from `pack_description`.
- **Why it matters:** Without weight, cost-per-100g cannot be calculated.
- **OQR question:** ⚖️ *"[Item] — Pack: [raw]. I don't recognise this format. How much does one case weigh?"*
- **Answer:** Numeric weight + unit (lb / oz / kg / g).
- **Resolves:** Admin / Sous Chef.
- **Learns:** Stores `corrected_weight_g` on item, recalculates `price_per_100g`. Future identical pack strings for this SKU resolve automatically (BIOS-001).

#### INV-MATCH-001 — Ambiguous ingredient match
- **Trigger:** Invoice line matches 2+ ingredients with similar confidence.
- **Why it matters:** Wrong match poisons costing. Unmatched is safer than wrong match.
- **OQR question:** 🔗 *"[Item] — which ingredient is this? [Option A] [Option B] [Neither — new]"*
- **Resolves:** Admin.
- **Learns:** Saves to `ingredient_links` — next time automatic.
- **Status:** ⬜ Not yet implemented.

#### INV-DUP-001 — Possible duplicate ingredient
- **Trigger:** New auto-created ingredient (BIOS-006) is ≥96% similar to an existing one.
- **OQR question:** 👯 *"Is '[New name]' the same as '[Existing name]'? [Same — merge] [Different — keep both]"*
- **Resolves:** Admin.
- **Learns:** Soft merge or permanent distinction.
- **Status:** ⚠️ Partial (Similarity Cleanup exists as batch tool, not as inline warning).

#### INV-OCR-001 — Missing critical data
- **Trigger:** Qty, pack, unit, cost or another required field missing after parse.
- **OQR question:** 📄 *"[Item] — the [field] is missing. What is it?"* (direct input)
- **Resolves:** Admin.
- **Status:** ⬜ Not yet implemented.

#### DOC-PARSE-001 — Document unreadable *(was PARSE_ERROR / PARSER_ERROR)*
- **Trigger:** Zero line items extracted from document.
- **OQR question:** 🔴 *"This document couldn't be read. [Re-upload] [Process manually]"*
- **Resolves:** Admin.
- **UI:** Red banner on the document card. No amber question — this is a system failure, not a decision.

#### DOC-VENDOR-001 — Unknown vendor *(was UNKNOWN_VENDOR)*
#### DOC-TYPE-001 — Unknown document type *(was UNKNOWN_DOC_TYPE)*
#### DOC-NOPARSER-001 — No parser for vendor/type *(was NO_PARSER)*
- Same treatment as DOC-PARSE-001: red banner, re-upload or manual.

### 🟡 Alert

#### ALT-MISS-001 — Item missing with no substitution *(was ALT-001)*
- **Trigger:** Ordered > 0, received 0, and no substitution line on the invoice.
- **Why it matters:** The kitchen is missing product for tonight. Someone must own this.
- **OQR question:** 🚨 *"[Item] didn't arrive and there's no substitute. Who handles it? [I will handle it] [Assign task]"*
- **Assign flow:** First the role (Sous Chef / Lead Cook), then optionally drill down to the person (Anto, Tela, Cole, Samantha, Sofia).
- **Result:** Creates a task in `sous_chef_tasks` assigned to role or person.
- **Resolves:** Admin / Sous Chef.
- **Status:** ⬜ Not yet implemented.

#### INV-QTY-001 — Quantity mismatch *(was OQR-007)*
Three distinct cases by direction:

| Case | Condition | OQR question | Answers |
|---|---|---|---|
| A — Unexpected | ordered = 0, received > 0 | *"This arrived but wasn't expected."* | [Substitution] [More options] |
| B — Short ship | ordered > received | *"What happened with the missing quantity?"* | [Short ship — OK] [Back order / other] |
| C — Over-delivery | ordered < received | *"More arrived than ordered."* | [Accept extra] [Return excess] |

- Case B with no substitution on the document escalates to **ALT-MISS-001**.
- **Resolves:** Admin / Sous Chef.

#### DOC-CREDIT-001 — Credit memo root cause *(was OQR-001)*
- **Trigger:** Credit memo received.
- **Why it matters:** BIOS-005 — credits must identify root cause for vendor analytics.
- **OQR question:** 🧾 *"Was this an ordering error or a delivery error?"* + original order reference if missing (direct input).
- **Resolves:** Admin.

### 🔵 Insight

#### INV-SUB-001 — Vendor substitution *(was OQR-002)*
- **Trigger:** Substitution marker on invoice line, or ordered 0 / received > 0 confirmed as sub.
- **OQR question:** 🔄 *"[New item] replaced [original]. Accepted? [Yes] [No, reject it]"*
- **Learns:** Builds substitution history per vendor.

#### INV-PACKCT-001 — Count-based pack confirmation *(was OQR-006)*
- **Trigger:** First time a CT/EA pack is seen for an item.
- **OQR question:** 📦 *"1 case = [N] [items]. Correct? [Yes] [No, fix it]"*
- **Learns:** Confirmed pack never asks again (BIOS-001).

#### INV-PRICE-001 — Price spike
- **Trigger:** Unit price changed beyond threshold vs last purchase.
- **OQR question:** 📈 *"[Item] went from $X to $Y (+Z%). [Accept new price] [Flag it]"*
- **Status:** ✅ Implemented in invoice.js price change detection.

#### INV-UNUSED-001 — Item not used in any recipe *(BIOS-007)*
- **Trigger:** Received item has no link to any recipe after matching.
- **OQR question:** 💡 *"[Item] isn't used in any recipe. [OK, noted] [Add to a recipe]"*
- **Status:** ⬜ Not yet implemented.

---

## Code Migration Map

Old codes in `invoice_warnings` and `vendor_documents.warnings` map as follows:

| Old code | New code |
|---|---|
| OQR-001 | DOC-CREDIT-001 |
| OQR-002 | INV-SUB-001 |
| OQR-006 | INV-PACKCT-001 |
| OQR-007 | INV-QTY-001 |
| OQR-008 | INV-PACK-001 |
| ALT-001 | ALT-MISS-001 |
| PARSE_ERROR, PARSER_ERROR | DOC-PARSE-001 |
| UNKNOWN_VENDOR | DOC-VENDOR-001 |
| UNKNOWN_DOC_TYPE | DOC-TYPE-001 |
| NO_PARSER | DOC-NOPARSER-001 |

---

## Lifecycle

```
Document arrives → warnings are born
        ↓
Answer them in Vendor Documents Review (if you have time)
        OR
Approve → document enters the system → open questions
          migrate automatically to the HOME BANNER
        ↓
From the banner: one tap → the OQR question opens →
answer → it disappears
        ↓
History stays in invoice_warnings analytics (BIOS-009)
```

**Approve is never blocked.** Approving with open questions *is* postponement (BIOS-011).
Nothing is lost, nothing blocks you, everything waits where you see it every morning.

### Home Banner

- Lives on the home page, color-coded by severity (red / amber / blue).
- **Role visibility (BIOS-002):**
  - **Admin** sees everything.
  - **Chef / Sous Chef** sees only what concerns their work (alerts and assigned tasks; not invoice data questions).
  - **Cooks** see nothing from the invoice pipeline.
- One tap on a banner item opens its OQR question directly. Answer → gone.

### Warning states (`invoice_warnings.status`)

| State | Meaning |
|---|---|
| `open` | Born, unanswered. Visible in review and/or banner. |
| `resolved` | Answered. `resolution`, `resolved_by`, `resolved_at` recorded. Stays in analytics. |

No `deleted` state. Resolved warnings are never removed (BIOS-009).
Every resolution is reversible from analytics (BIOS-013).

---

## Database

### `invoice_warnings`
Analytics history table. One row per warning ever raised.

| Column | Notes |
|---|---|
| `code` | Internal code from the registry above |
| `severity` | `blocking` / `alert` / `insight` (check constraint, added in this session) |
| `status` | `open` / `resolved` |
| `resolution` | JSON of the answer given |
| `resolved_by`, `resolved_at` | Attribution |
| `document_id`, `vendor`, `item_description`, `field`, `message` | Context |

### `vendor_documents.warnings` (JSONB)
Working copy: warnings still open on the document. Resolving a question removes it
here and marks the matching `invoice_warnings` row resolved.

---

## Implementation Status

| Piece | Status |
|---|---|
| Severity column + backfill | ✅ Done (this session) |
| INV-PACK-001 weight question in Vendor Review | ✅ Done (this session, as OQR-008) |
| DOC-PARSE-001 red banner | ✅ Done (this session, as PARSE_ERROR) |
| FreshPoint pack parser (repeated-weight patterns) | ✅ Done (this session) |
| Resolve → `invoice_warnings` analytics update | ✅ Done (this session) |
| Code migration OQR-* → new codes (DB + JS) | ⬜ Next |
| Home Banner (queue + role visibility) | ⬜ Next |
| ALT-MISS-001 (missing item → assign role → person) | ⬜ Next |
| INV-MATCH-001, INV-DUP-001 inline, INV-OCR-001, INV-UNUSED-001 | ⬜ Backlog |

---

## Decisions Made (2026-06-12)

| Decision | Choice | Reason |
|---|---|---|
| OQR is the channel, not a category | Every warning = one question | An alert has a question too; even insights are self-concluding questions |
| Codes never shown in UI | Context only: emoji + item + plain question | "When we have 200 codes, what code is that? I want context." |
| Internal naming | Domain-based (INV-*, DOC-*, ALT-*) | Self-documenting in source; chef never sees them anyway |
| Approve blocking | Never blocked | Open questions migrate to home banner; that IS postponement (BIOS-011) |
| Assign Task target | Role first, then optionally person | Flexible attribution without forcing a name |
