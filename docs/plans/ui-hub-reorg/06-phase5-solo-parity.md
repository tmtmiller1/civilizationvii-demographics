# 06 — Phase 5: Standalone Emigration parity

Make the standalone Emigration window (dock button, no host) feel identical to the embedded Migration
hub: same control grammar, same page names, same Net Migration / Network structure. This is polish so
the two entry points don't diverge.

Prereqs: Phase 4 (grammar settled in the embedded path).

## Steps

1. **Mirror the grammar** in the standalone dashboard (`emigration-screen.js` /
   `emigration-window.js` / `emigration-views.js`): same flat-filter vs rounded-pill rules, same
   `[FILTERS] … [Options]` row, same single Scaled/Civ anchor.

2. **Page-name parity**: Network (Dots·Arrows), Net Migration (Net/Immigration/Emigration/
   Refugees[Arrived|Left] + Graph|Table), Causes, My Cities, Policies, Notifications, Guide — same
   labels and order as the hub.

3. **No host assumptions**: the window must not read any Demographics-only API; Population (host metric)
   simply isn't present in solo mode — the window opens on its own first page as today.

4. **Dock-button routing** (optional): when a hub-capable host is present, the dock button may open the
   host's Migration hub instead of the standalone window; both must remain functional.

## Files
`ui/emigration-screen.js`, `ui/emigration-window.js`, `ui/emigration-views.js` (standalone grammar +
labels), dock-button wiring.

## Acceptance (in addition to 01 §H)
- Emigration-only: window pages/labels/controls match the embedded Migration hub (minus Population).
- Toggling Scaled/Civ in the window persists and matches embedded behavior.
- With a host present, the dock button reaches the hub (if wired) and the standalone window still works.
- `npm run verify` (emigration) green.
