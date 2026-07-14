# BOH OS v2 — New Claude Session

Read first:

`boh-v2/docs/SESSION_STATE.md`

This session is exclusively for:

`boh-v2/`

Do not read or modify production Brigade unless an explicit task requires schema or flow verification.

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

Foundation, login, App Shell, Station Home, and the Station Prep workflow through Start, Complete, Count, and Reconcile are complete.

---

## Next action

Wait for **Task 004Y — Station Prep WIP Detail**.

Do not begin implementation until Task 004Y is supplied.

**Do not begin Station Recipes.**

---

## DO NOT

Do not:

- modify JavaScript
- modify CSS
- modify HTML
- modify translations
- modify services
- modify database queries
- implement Task 004Y
- implement WIP actions
- implement Recipes
- modify production Brigade
- create additional documentation
- change completed-task commit hashes
- remove previously completed task history

---

## QA

Verify:

1. Exactly two files modified
2. No files created
3. No application code changed
4. All seven new completed tasks are recorded
5. All seven commit hashes are copied accurately
6. Count and reconciliation flow is described factually
7. Current limitations are factual
8. 004Y is the immediate next task
9. Station Recipes are explicitly deferred
10. NEXT_SESSION_PROMPT.md tells Claude to wait
11. Both documents are in English
12. Production Brigade remains unchanged

---

## OUTPUT

Return exactly:

1. Files modified
2. Completed tasks added
3. Current Station Prep status
4. Next task recorded
5. QA results
6. Commit hash
7. Live document paths
8. Confirmation to open a new Claude session

Do not begin Task 004Y.

---

## If this conversation accumulates several completed tasks or becomes long, stop and request a new Claude session.
