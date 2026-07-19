# Demographics: pill-based selectors + World Rankings restructure

Bring the Emigration "pill" pattern (a row of rounded toggle buttons) into the core Demographics
screen, and collapse the World Rankings view from 4 flat tabs into 2 sub-tabs each with a pill pair.
Demographics mod only. Build/sync: `./release.sh && rsync -a --delete dist/demographics/ "$MODS/demographics/"`.
Verify: `npx tsc --noEmit`, `eslint`, and the test harnesses; new LOC keys must be added to all locales
(i18n parity harness = 247×9 today).

---

## Shared groundwork: extract the pill renderer  — DONE

**Done:** `pillRow(items, activeKey, onPick)` now lives in
`ui/screen-demographics/views/shared/view-pills.js` (declared in the modinfo); view-history.js imports
it (its metric/view group toggles use it).


The pill renderer currently lives privately in `view-history.js` as `toggleRow(items, activeKey,
onPick)` (rounded buttons, one highlighted, click → onPick). Both parts below need it.
- [ ] Move `toggleRow` into a small shared module, e.g.
  `ui/screen-demographics/views/shared/view-pills.js`, exporting `pillRow(items, activeKey, onPick)`
  (items: `{key, label}[]`). Keep the existing inline styling (the bumped size we just set).
- [ ] Update `view-history.js` to import it (its metric-group toggles already use it).

---

## Part 1 — Historical Data: metric row → pills (remove the 3rd-level tab row)  — DONE (synced)

**Done:** `buildMetricTabRow` (history-tabs.js) now renders the 3rd-level metric selector as a
`pillRow` instead of an `fxs-tab-bar` — applied consistently everywhere it's used (so the Emigration
panel's sub-tab row is pills too). Page tab row (Economy/Power/…) stays as native tabs. Age-gating
(`visibleMetricsForAge`), labels (external panel labels or `LOC_DEMOGRAPHICS_METRIC_<ID>` via `t`),
selection/persistence (`ctx.setActiveMetric`), the "Graphs" metric-group pills, and the policy banner
position all preserved. Removed the now-unused `applyNavHelpClasses`. view-pills.js added to the
modinfo (harness passes). tsc + eslint clean, synced.


**Current nesting (3 tab levels):** top view tabs (Historical Data / Emigration / …) → **page tab row**
(Economy · Power · Knowledge & Influence · Resources · Conflicts · Crises · [Age]) → **metric tab row**
(per-page metrics, e.g. Economy → Score · GDP · Gold · …). The metric row is `buildMetricTabRow`
(history-tabs.js), a native `fxs-tab-bar`.

**Interpretation (matches the World-Rankings ask + the Emigration precedent): keep the 6 pages as the
sub-tab row; turn the *metric* selector (3rd level) into pills.** Result: page tabs → metric **pills** →
chart — no third tab row. (If you instead want the *page labels themselves* rendered as pills, that's a
small variant — flag before building.)

- [ ] Replace the `fxs-tab-bar` in `buildMetricTabRow` with `pillRow(...)`, preserving everything it
  does today:
  - `visibleMetricsForAge(page.metrics)` age-gating (drop age-hidden metrics);
  - labels via `externalTabLabel(id)` else `LOC_DEMOGRAPHICS_METRIC_<ID>` / `LOC_DEMOGRAPHICS_NYI`;
  - active highlight = `activeMetric`; click → the existing `onPageTabSelected`/metric-select handler
    (`ctx.setActiveMetric`) so selection still persists + re-renders;
  - the appended page-description caption (`appendPageDescription`) stays.
- [ ] The metric-group ("Graphs") path is unaffected: its group id appears as one pill; selecting it
  still renders the group's own metric/view pills below (resolveGroupMember), and the policy banner
  still sits between the pills and the chart.
- [ ] Pills wrap (flex-wrap) so dense pages (Knowledge = 8 metrics) lay out cleanly.

**Shared-code note (confirm):** `buildMetricTabRow` is also used to render the **Emigration panel's**
sub-tabs (Network · Civilizations · … · Graphs). Converting it makes those pills too. That's consistent
with "pills for Demographics as well," but it does restyle the Emigration tab's sub-tab row — confirm
that's wanted, or gate pills to non-panel pages only.

**Files:** `ui/screen-demographics/views/history/history-tabs.js` (metric row → pills),
`ui/screen-demographics/views/shared/view-pills.js` (new), `view-history.js` (import).

---

## Part 2 — World Rankings: 4 tabs → 2 sub-tabs, each with a pill pair  — DEFERRED

> Deferred per user (2026-06): not changing World Rankings for now; focus on Historical Data (Part 1).
> Kept below for when we return to it.

**Current:** `view-settlements.js` `SUBTABS` = 4 native tabs:
`civranking` (Civilization Ranking), `civilizations` (Civilization Rank by Yield — the per-civ matrix),
`showcase` (Top 25 Settlements), `table` (Settlement Rank by Yield). Dispatch on `st.subTab`.

**Target:** two sub-tabs (native tab bar), each with a 2-pill selector:
- **Civilization Ranking** → pills: **Civilization Ranking** (`civranking`) · **Civilization Rank by
  Yield** (`civilizations`).
- **City Ranking** → pills: **Top 25 Settlements** (`showcase`) · **Settlement Rank by Yield** (`table`).

- [ ] Redefine the sub-tab bar to two entries: `civ` (Civilization Ranking) and `city` (City Ranking).
- [ ] Under each sub-tab, render a `pillRow(...)` for its two sub-views; map the existing render
  functions unchanged: `renderCivRanking` / `ViewWorldRankingsAllCivs.render` (civ), `renderShowcase` /
  `renderTable` (city).
- [ ] State: persist the active sub-tab (`civ`/`city`) AND the active pill per sub-tab. Default:
  `civ` + `civranking`. Reuse `getSetting`/`setSetting` (keys e.g. `rankingsSubTab`, `rankingsCivPill`,
  `rankingsCityPill`); migrate the old `settlementsSubTab` value if present (civranking/civilizations →
  civ; showcase/table → city).
- [ ] LOC: add two sub-tab labels (`LOC_DEMOGRAPHICS_RANKINGS_TAB_CIV` = "Civilization Ranking",
  `LOC_DEMOGRAPHICS_RANKINGS_TAB_CITY` = "City Ranking") to **all locales**. Pill labels reuse the
  existing `LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVRANK/_CIVS/_SHOWCASE/_TABLE`.

**Files:** `ui/screen-demographics/views/settlements/view-settlements.js` (sub-tab bar → 2 + pill rows +
2-level state + dispatch), `view-pills.js` (shared), `text/*/ModText.xml` (2 new keys × all locales),
`tests/i18n.mjs` expectation if it hard-codes the key count.

---

## Decisions (locked, 2026-06)
1. **Pages stay as the tab row; the metric selector (3rd-level tab row) becomes pills.** (Page labels
   are NOT pills.)
2. **Convert it consistently — NO gating.** `buildMetricTabRow` renders pills everywhere it's used, so
   the Emigration panel's sub-tab row (Network/Civilizations/…/Graphs) becomes pills too. (Supersedes
   the earlier "keep Emigration as tabs" — user asked for the 3rd row to be pills consistently.)
3. World Rankings: deferred.

## Suggested order
1. Extract `pillRow` to the shared module — DONE.
2. Part 1 (Historical Data metric pills) — DONE.
3. ~~Part 2 (World Rankings)~~ — deferred.
