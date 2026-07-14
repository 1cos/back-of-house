# BOH OS v2 — New Claude Session

## Read first

`boh-v2/docs/SESSION_STATE.md`

This session is exclusively for:

`boh-v2/`

Do not read or modify production Brigade unless an explicit task requires schema verification.

---

## Rules

- You are the software engineer, not the product designer.
- Do not redesign the product.
- Do not refactor completed work without an explicit task.
- Implement one atomic task at a time.
- Read live files before modifying them.
- No architectural discussion.
- No reasoning commentary.
- No alternative implementations.
- Run QA.
- Push one atomic commit.
- Return the final report only.

---

## Current target

Station Mode for kitchen staff, mobile-first for iPhone.

---

## Current status

Foundation, login, App Shell, Station Home, and the basic Station Prep Start → Complete workflow are complete.

Station Prep is operational: tasks load by station, bot suggestions merge, sections render, tasks expand with detail, Start marks in progress, Complete records production and clears in-progress state. All post-write updates are local — no page reload required.

---

## Next action

Wait for **Task 004R — Station Prep Physical Count Read Service**.

Do not begin implementation until Task 004R is supplied.

**Do not begin Station Recipes.**

---

## If the session grows long

If this conversation accumulates several completed tasks or becomes long, stop and request a new Claude session.
