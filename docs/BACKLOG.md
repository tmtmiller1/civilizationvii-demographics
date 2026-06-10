# Backlog

Open items not yet addressed. Newest first.

## Crisis Impact — antiquity per-age cumulative thins out over time

**Symptom:** Viewed from a later age, the antiquity crisis's "Cumulative impact
across all stages" block (and likely its per-stage tables) eventually shows only
one populated row — "Military Power (Current)" — while the loss columns
(Population / Crop / Production Lost, etc.) go blank.

**Status:** Partially addressed. The age-boundary windowing bugs are fixed —
each crisis is now bounded within its own age (`crisisStageSegments` +
`ageLastTurns` in
[crisis-stage-data.js](../ui/screen-demographics/charts/crises/crisis-stage-data.js)),
windows are age-scoped (`groupCtx` in
[chart-crisis-stages.js](../ui/screen-demographics/charts/crises/chart-crisis-stages.js)),
and phantom next-age crises from a lingering crisis stage are suppressed
(onset "arming" in `crisisStageOnsets`). The remaining thin-out is a separate
cause.

**Leading hypothesis:** sample decimation. Old samples are thinned as the game
grows to cap save size (see `ui/storage/storage-cap.js` /
`storage-retention.js`). The cumulative's "losses" metrics
(`sumDeclines` over `populationRaw` / `crops` / `production`) need dense
turn-by-turn samples to sum the per-turn dips; once the antiquity crisis turns
are decimated, only "Military Power (Current)" survives (it needs just one
sample via `lastFinite`). The per-stage tables and the cumulative share the same
code path over the same age-scoped samples, so if the cumulative is sparse the
stages should be too — which would confirm decimation rather than a windowing
bug.

**Proposed fix:** snapshot each crisis's total impact when its age ends, the way
the mod already snapshots triumph/legacy state at age boundaries
(`history.legacySnapshots`, see `recordAgeBoundary` in
`ui/sampler/sampler-age-boundary.js`). Persist the per-civ crisis cost totals
into the history blob at the age transition so the Crisis Impact tab can render
them from the snapshot regardless of later decimation. Render path would prefer
the stored snapshot for a finished age and fall back to live windowing for the
current age's ongoing crisis.

**Before building:** confirm the diagnosis with a fresh screenshot — specifically
whether the antiquity Intensifies / Culminates per-stage tables are *also*
sparse now. If the stages are full but only the cumulative is sparse, it's a
windowing bug to find instead, not decimation.
