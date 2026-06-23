# 05 — Phase 4: Control-grammar sweep + consolidations

Apply the control grammar (00-design) uniformly and finish the consolidations that reduce redundant
controls. Mostly subtraction + restyling; no new IA.

Prereqs: Phases 1–3 (the pages exist and render in the hubs).

## Steps

1. **Single Population unit anchor**: one `Population: Scaled | Civ` `[FILTER]` as the fixed left
   anchor of the Migration hub's shared controls row. Delete the duplicates that write the same
   `NumberMode`: the Network "Units" toggle and the per-tab "Numbers" filter (they already share state).
   Files: `emigration-network-viz.js`, `emigration-network-flow.js`, `emigration-views.js`.

2. **Net Migration merge** (if any residue from Phase 3): ensure it is one page with direction pills +
   Graph|Table, not separate tabs; Refugees Arrived|Left toggle present.

3. **Network pills → Dots · Arrows**: finish the rename in `emigration-flow-tab.js` /
   `emigration-network-viz.js` (page stays "Network").

4. **Grammar pass — every hub/page**: filters = flat boxed buttons; view-changes = rounded pills;
   row template `[FILTERS] [PILLS] ····· [Options ▸]`, filters left / Options pinned right (matches the
   Demographics time-filter row, which is the reference). Audit Statistics, Migration, Geopolitics pages.

5. **Hide dead filters**: hide disabled cross-age time filters (Age I/II/III) and the disabled radar
   snapshot ages (Antiquity/Exploration) — dead greyed controls read as broken. Files:
   `views/history/history-time-filter.js`, `views/history/history-controls.js`.

6. **Graph | Table where a table exists**: wire the toggle on Net Migration (ledger). Universal
   metric-table remains the deferred build (01 §G) — do not block here.

## Files
`emigration-network-viz.js`, `emigration-network-flow.js`, `emigration-flow-tab.js`,
`emigration-views.js` (Emigration grammar + anchor), `views/history/history-time-filter.js`,
`views/history/history-controls.js`, shared `view-pills.js` (filter/pill variants) on the Demographics
side.

## Acceptance (in addition to 01 §H)
- Exactly one Scaled/Civ control per Migration screen (the left anchor); toggling it persists and
  drives every migration page.
- No greyed/disabled filter buttons visible anywhere.
- Every page's controls row follows the template (filters left, Options right, one line).
- Network pills read Dots · Arrows.
- `npm run verify` green for both mods.
