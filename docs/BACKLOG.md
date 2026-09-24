# Backlog

Open items not yet addressed. Newest first.

## 1280x720 still renders too large: the layout and the type scale have different floors

**Status:** open, measured in game 2026-09-23 (1.5.0, save AugustusExp66, shots in the session scratchpad). **[High]**
Reported by the player as "things are not rendering correctly at the lower resolution". Shipped in 2.7.3 as a
declared known issue (changelog, README section 1, Workshop description): the scaling pass improves every resolution
and 1280x720 is readable but tight. This item is the fix, and it is the next thing on the list.

**What is on screen at 1280x720.** Top 25 Settlements shows two and a half podium cards and two and a half ranked
rows, with "Founded ~1050 CE" wrapping inside a podium card. Civilization Rank by Yield falls to the matrix layout and
its right-hand column is cut mid-glyph at the frame edge; several leader names ellipsise ("Harriet Tub...",
"Friedrich, O..."), and the "(formerly Great Britain)" line runs into the row beneath it. None of this is a clipping
bug in one view: it is the same cause in every view.

**The cause, in numbers.** The engine's root font-size is a constant 16.2px at every resolution, so `rem` does not
track resolution and the mod carries all of it in one `transform: scale()` on the frame
(`ui/core/demographics-font-ladder.js`). That transform has a floor of `MIN_VISUAL_SCALE` 0.70. Text has a SEPARATE,
higher floor, `MIN_TYPE_VISUAL` 0.82, applied as a boost of `0.82 / 0.70` = 1.171 on the type ladder. So at 720p:

| | reference 2880x1800 | 1280x720 |
|---|---|---|
| Visual scale | 1.00 | 0.70 (proportional would be 0.40) |
| Frame's own coordinate space | 2765 x 1692 px | 1755 x 967 px |
| Type ladder multiplier | 1.000 | 1.171 |

The frame's local space is 63% of the reference's width and 57% of its height while the text inside it is 117% of the
reference size. Relative to its container, text is about 1.8x wider and 2.0x taller than it is at the reference. Every
box sized in layout units - a podium card, a table row, a matrix column, a label gutter - is therefore roughly half
the size the text it holds now needs. The density stylesheet's micro tier compacts some chrome but does not close a
gap that large.

This mismatch is also what put the war timeline's crisis labels on top of the first war names (fixed in 2.7.3 by
reserving a band sized with `typeBoost()`), and it is why `.demographics-settle-mapbtns` measures past its row.
Any further fix of this shape is a patch on the symptom.

**Ways out, not yet chosen:**
1. **One floor.** Set `MIN_VISUAL_SCALE` to `MIN_TYPE_VISUAL` (0.82) and drop the boost, so boxes and text agree
   again. Text stays the size it is now; the frame's local space shrinks about 15%, so slightly less fits and what
   does not fit scrolls instead of colliding. Smallest change; needs a sweep of everything that assumed a boost.
2. **No type floor.** Let text scale with the layout at 0.70. Everything is consistent and more fits, but body text
   lands near 10.7px on a 720p screen, which was measured and rejected as hard to read on 2026-09-23.
3. **Reflow rather than scale.** Below a threshold, change the layout instead of shrinking it: fewer matrix columns
   with horizontal paging, a single-column Settlements page, shorter column headings. Most work, best result, and the
   only one that makes 1280x720 genuinely comfortable rather than merely uncollided.

A decision is needed before any more per-view resolution fixes: 1 and 3 compose, 2 rules out the others.

## Hardening pass 2.7.3: items that need the game or a second client

**Status:** open (added with the hardening pass, 2026-09-23). See `docs/hardening-2026-09-22.md`.

**Needs a hand on the keyboard (unwatched, harness-verified only):**
- Escape closing the Demographics screen (`screen-lifecycle-support.js`); the smoke run dispatches a synthetic
  `sys-menu` engine-input, not a real key.
- The cinematic tour interrupted by End Turn or a diplomacy screen restoring the camera without reopening the
  screen (`city-camera-controller.js`, reason "interrupt").
- The end-of-game screen button after the next game patch (one UI.log line names the missing selector now).

**Needs a two-client networked game (not implementable from one machine):** **[High]**
- Every client writes the full sample history into GameConfiguration every turn
  (`storage-backend.js` `getConfigStore`, `demographics-storage.js` `save`); the campaign write is host-gated since
  2.7.2, the history payload is not. Test: two clients on a LAN, guest ends a turn, host reads
  `Demographics__demographics-history-v1__json` and checks whether the last sample's `met` flags are the guest's
  viewpoint. If they are, gate `save()` with the same `mayStoreCampaign` rule and let guests adopt the host copy on
  load, as the campaign already does.
- The `__rejected` parking keys and the per-seat policy keys have not been watched in a networked game.

**Dead view:** RESOLVED 2026-09-24. `ui/screen-demographics/views/settlements/view-settlements-detail.js` was
deleted with its test and its `package.json` / `required-scripts-gate.mjs` entries (286 lines). It was never in the
modinfo, so the engine had never loaded it; `release.sh` rsyncs the whole tree, so it had been shipping as dead
weight in the zip. `npm run verify` green before and after (94 harnesses, then 93 — the delta is the deleted test).
(The in-screen Options view moved to `devtools/options-view/` on 2026-09-23.)

**Hotseat viewpoint mixing:** **[Medium]** `met` flags come from whichever seat sampled last
(`sampler-collectors-core.js` `collectMet`, comment there lists the two designs), and the archive record is built for
the first seat of each turn. Seat 1 can see civs only seat 2 met; seat 2 has no Hall of Fame entry.

## Code-size audit 2026-09-24: deduplication left undone

**Status:** open, measured 2026-09-24, deferred by choice. **[Low]**

Context: an audit of what could be removed from `ui/` (56,494 JS lines + 7,535 CSS) without changing behaviour or
appearance. The dead view above was the only free win and is done. Two dedupe items were measured and deliberately
skipped; a third (orphan LOC keys) was found on the way. Note that naive line-window clone detection badly overstates
all of these — it matches runs that straddle rule and function boundaries. The numbers below come from parsing whole
CSS rules and whole function bodies, which is the figure to trust.

**CSS rules with identical declaration bodies:** **[Low]** 8 groups, 51 lines total, out of 745 rules. Skipped
because it is not a mechanical no-op: 3 of the 8 are cross-file merges, and the modinfo declares 7 stylesheets in a
fixed order, so moving a rule between them changes cascade order. Separately, the biggest apparent repetition — the
four `border-*-color` longhands, seen 167 times — is not duplication to remove: GameFace drops the `border-color`
shorthand, so the longhands are required, and each occurrence sits in a rule whose other declarations differ. 51
lines is not worth cascade risk.

**Duplicate helper functions:** **[Low]** 16 groups of byte-identical function bodies, 163 lines gross, roughly 110
net once the import lines each call site needs back are subtracted. The large ones are `safe` (6 copies, 35 lines),
`showCsvToast` (2, 21), `relationshipKeyMap` (2, 16), `gameSeed` (2, 12) and `buildYearToChartMap` (2, 10). These are
genuine copy-paste and extraction is legitimate; it was skipped only as not worth the churn. The usual risk is
already covered — `tests/modinfo.mjs` gates import closure, shell-group completeness and import cycles of size > 1.
One thing to watch if this is ever done: `ui/screen-demographics/settlements/settlements-adjacency.js` currently has
zero imports, so a shared helper would give it its first import edge.

**Orphan LOC keys:** **[Medium]** 136 keys are defined in `text/en_us/ModText.xml` and reachable from nothing in the
repo — not `ui/`, not `devtools/`, not the modinfo — and each is translated across all 11 locales. They are stale
names from earlier refactors: `LOC_DEMOGRAPHICS_TAB_HISTORY`, `_TAB_RELATIONS`, `_TAB_SETTLEMENTS`, `_TAB_TOWNS` and
`_TAB_ADVISOR` where the live tabs are `_TAB_STATISTICS` / `_MIGRATION` / `_GEOPOLITICS` / `_CAMPAIGN_HISTORY` /
`_RANKINGS` / `_EMIGRATION`; the whole `_TOWNS_*` and `_ADVISOR_*` families; `_SUBTITLE`, `_FOOTNOTE`, `_CLOSE`,
`_BODY`. Two things must be true before any sweep:

- `LOC_OPTIONS_GROUP_DEMOGRAPHICS` is in that set but must NOT be deleted — the engine composes it (see
  `ENGINE_COMPOSED` in `tests/loc-keys.mjs`). It is now pinned there, and the gate fails if it goes missing.
- A further 42 of the flagged keys are live in `devtools/options-view/`, which is outside `ui/`. Any orphan check
  has to scan `ui/` + `devtools/` + `demographics.modinfo`, or it will condemn those 42 wrongly.

Once the 136 are gone, the reverse check in `tests/loc-keys.mjs` can be widened from the `ENGINE_COMPOSED` list to a
full "every defined key is reachable" assertion with no allowlist. Today that assertion would fail on all 136.

## History and Hall of Fame: checks still open after the merge

**Status:** open (added with the History release, 2026-09-22). **[Medium]**

**Watched in game (1.5.0):** capture over real turns (map frames, disasters, foundings,
Triumphs, Emigration migration totals, rival tracks), icons resolved from the game's icon
table, the archive written while over its byte cap (trimmed, the live game kept whole),
persistence across restarts, one entry per campaign when a save is loaded twice, and the
campaign carried across the Antiquity to Exploration transition. The worst case (twelve
civilizations, 750 turns, every cap saturated) is `tests/history-stress.mjs`.

**Not yet watched:**
- A victory, and the end-of-game screen opening World Rankings on the Hall of Fame.
- The ten translations on screen (text fit and wording in the Hall of Fame and timeline).
- Clicking the timeline ruler to move the cursor, and the population readout hiding when
  the pointer leaves the lane (the CDP harness cannot deliver real clicks).
- Multiplayer: the analytics policy applied to the History tab and the timeline filter.

**Known limit:** the game's `localStorage.getItem` returns the value of the alphabetically
first key, whatever key is asked for. When another mod has stored a key that sorts ahead of
the shared `modSettings` entry (for example one starting with `!`), the archive reads that
instead, so it refuses to read or write (status `foreign`) and the Hall of Fame explains why.
A workaround would need a storage key that sorts ahead of the others, which would break
other mods the same way; not planned.

## Real translations for the 22 Top-25 / diplomacy localization keys

**Status:** open (added alongside the pl_PL full-translation integration). **[Low]**

**Context:** integrating the Polish localization added 22 new LOC keys — the settlement
ordinals `LOC_DEMOGRAPHICS_SETTLEMENTS_ORDINAL_7..25` (19) and
`LOC_DEMOGRAPHICS_DIPLOMACY_ACTION_{SHARE_INNOVATIONS,PIONEERING,GIVE_INFLUENCE_TOKEN}` (3).
Polish (`pl_PL`) is fully translated; **en_us** carries the real English words; the other
nine locales (`de_de es_es fr_fr it_it ja_jp ko_kr pt_br ru_ru zh_cn`) currently hold
**placeholders** to satisfy the `tests/i18n.mjs` parity gate: ordinals 7–25 use the bare
digit (matching each locale's existing `ORDINAL_6="6"` convention) and the three diplomacy
actions use the English string.

**Work:** supply real translations for the ordinal words and the three diplomacy-action
labels in the nine placeholder locales. Behavior is correct as-is (digit / English fallback);
this is polish, not a bug. Keep the parity gate green.

## UI/UX feedback from AndySafik (2026-07 playtest) — points 1–5

**Status:** RESOLVED in 2.5.0. All nine sub-items were implemented — the responsive
sortable Civilization Rank by Yield table (2.1/2.2), Civilization-first labels on the
legend + matrix header + settlement owner cell (1.1/4/5), the Top 25 Settlements
Settlement/Civilization/Leader hierarchy and per-row civ line (3.2/3.3), and the
single-line podium card names (1.2/3.1). Item 1.1 on the Civilization Ranking podium
needed no change (already civilization-primary). Two follow-ups tracked below.

### Deferred / to-verify from the 2.5.0 hybrid

- **`MIN_METRIC_COL_REM = 2.4` is an untuned guess.** The rem-width threshold in
  `view-worldrankings-allcivs.js` that switches Civ Rank by Yield between the sortable
  table and the matrix was set analytically, not measured in-engine. Validate at 4K ×
  XL Interface Size and adjust (raising it favours the matrix, the safe side).
- **Table branch intentionally omits matrix-only affordances.** Hiding/ghosting a civ
  column and the Scaled/Civ population number-mode toggle are matrix-only (they don't
  map to a rows table); their settings persist so switching back to the matrix restores
  them. Revisit if players want per-civ hide or the Civ-number mode in the table too.

## War-cost figures contaminate across age boundaries

**Status:** open (surfaced by the 2026-07-10 corpus bug-hunt audit). **[High · Confirmed]**
— manifests once a game reaches Exploration/Modern.

**Sites:** [ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js:455](../ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js)
(`warWindow`) and `:470` (`participantCost`); callers
[ui/screen-demographics/charts/wars/chart-wars-tooltip.js:141](../ui/screen-demographics/charts/wars/chart-wars-tooltip.js)
(+`:256`) and
[ui/screen-demographics/charts/conflicts/chart-conflicts-graphs.js:643-647](../ui/screen-demographics/charts/conflicts/chart-conflicts-graphs.js)
(`buildWarView`); compounding: `chart-wars-tooltip.js:46` (ongoing-war `eTurn` fallback fed
a *global* chart turn from `chart-conflicts-timeline.js:310`).

**Defect:** sample `.turn` is **age-local** and resets to 1 each age
([ui/sampler/sampler-snapshot-build.js:24](../ui/sampler/sampler-snapshot-build.js)), and a
war's `startTurn`/`endTurn` are likewise age-local. But `warWindow`/`participantCost` filter
the **full, all-age** sample stream with `s.turn >= warStart && s.turn <= warEnd` and no age
scoping. The Crises page fixed exactly this class via `groupCtx` age-filtering
(`chart-crisis-stages.js:228`, `ctx.samples.filter(s => sampleAgeKey(s) === age)`); the
Wars/Conflicts cost path never got that treatment.

**Failure scenario:** a war runs Exploration local turns 8–25; `warWindow` also pulls in
every Antiquity sample whose age-local turn is 8–25. `losses` (`sumDeclines`) then counts the
Antiquity→Exploration reset as a fabricated wartime loss; `net`/`accrued` (`last − first` over
whole-game cumulative counters) take `first` from Antiquity and over-count everything since;
an ongoing war's `eTurn` falls back to a *global* chart turn compared against age-local
`s.turn`, effectively unbounding the window. The War tooltip cost table and War Graphs sub-tab
show wrong loss/net/casualty numbers for any war outside Antiquity (`milpowerLevel`, via
`lastFinite`, stays correct).

**Fix:** age-scope the sample stream before windowing — filter to `sampleAgeKey(s) === war's
age` (as `groupCtx` does) in `warWindow`/`participantCost`/`buildWarView`, and use the
age-local last turn (not the global `chartTurn`) as the ongoing-war `eTurn` fallback.

**Design:** age-filter the sample stream **before** windowing, reusing existing helpers — no
new persistence rail.
- Derive the war's age from its global anchor:
  `const warAge = sampleAgeKey(findStartSample(samples, war.startChartTurn));`
  (`findStartSample` at `ui/sampler/sampler-wars-augment.js:193` already returns the sample
  with the greatest `chartTurn ≤ target`; `sampleAgeKey` at
  `ui/screen-demographics/charts/crises/crisis-stage-data.js:122`). This mirrors how the crisis
  path reads `group.sample.age` in `groupCtx` (`chart-crisis-stages.js:226`).
- Add one small helper (e.g. in `chart-conflicts-cost.js`):
  ```js
  export function warAgeScope(samples, war) {
    const warAge = sampleAgeKey(findStartSample(samples, war.startChartTurn));
    const scoped = (samples || []).filter((s) => sampleAgeKey(s) === warAge);
    const ageLastTurn = scoped.reduce((m, s) =>
      typeof s?.turn === "number" && s.turn > m ? s.turn : m, 0);   // cf. ageLastTurns, crisis-stage-data.js:134
    return { scoped, ageLastTurn };
  }
  ```
- Apply at all THREE windowing sites — the fix inside `warWindow` alone is insufficient
  because `buildWarView` has its own inline copy:
  1. `chart-wars-tooltip.js:141` — `const { scoped } = warAgeScope(samples, w); warWindow(scoped, tip.warStart, tip.warEnd);`
  2. `chart-wars-tooltip.js:256` — `participantCost(scoped, entry, tip.warStart, tip.warEnd)` (same `scoped`).
  3. `chart-conflicts-graphs.js:645` (`buildWarView`) — window over `scoped` instead of the
     full `samples`.
  (`warStart/warEnd/joinTurn/leaveTurn` stay unchanged — they're already age-local and now
  match the age-scoped stream.)
- **Ongoing-war end fallback:** replace the global-latest fallback (`chart-wars-tooltip.js:46`
  `latestTurn`; `chart-conflicts-graphs.js:644` `latest`) with `ageLastTurn` from
  `warAgeScope`, so an ongoing war in an older age doesn't window to a latest turn living in a
  different age's reset space.
- **Rejected alternative:** a `warSnapshots` boundary rail like `crisisSnapshots`
  (`sampler-age-boundary.js`). War cost is endpoint cumulative diffs
  (`milLostCum[last] − milLostCum[0]`), not decimation-sensitive per-turn sums, so scoping
  fully resolves the cross-age *collision* without a new sampler write path.
- **Verify:** in a game with a war in Exploration, confirm the War tooltip and War Graphs cost
  table show only that war's losses (no Antiquity contamination); confirm an ongoing war in an
  older age windows to that age's last turn, not the global latest.

## Population/cap figures bypass the mod's locale number convention

**Status:** open (2026-07-10 audit). **[Low · Confirmed]**

**Sites:** [ui/core/ui-helpers.js:45](../ui/core/ui-helpers.js) (`fmtPop` →
`Math.round(v).toLocaleString()`);
[ui/screen-demographics/views/options/view-options-storage-controls.js:86](../ui/screen-demographics/views/options/view-options-storage-controls.js)
(+`:92`).

**Defect:** these use JS `Number.prototype.toLocaleString()` instead of the mod's own
`Locale.toNumber`-based formatters (`metrics/metrics-format.js`). In Gameface the JS runtime
locale is effectively `en`, so settlement population estimates and the storage-cap readout
show English grouping (`1,234,567`) regardless of the player's language — contradicting the
mod's number-l10n convention.

**Fix:** route `fmtPop` and the cap displays through `formatCount`/`formatBigNumber` from
`metrics-format.js`.

**Design:** replace the `Math.round(v).toLocaleString()` in `fmtPop` (`ui/core/ui-helpers.js:45`)
with the mod's `Locale.toNumber`-based formatter — import `formatCount` (or `formatBigNumber`
for the abbreviated form) from `ui/metrics/metrics-format.js` and return `formatCount(Math.round(v))`.
Do the same for the two storage-cap displays at
`ui/screen-demographics/views/options/view-options-storage-controls.js:86,92`. Keep the graceful
fallback the metrics formatter already provides when `Locale` is unavailable off-engine.
**Verify:** switch the in-game language to one with non-`,` grouping (e.g. de/fr) and confirm
the settlement population estimate and the storage-cap readout use the locale's grouping, not
English `1,234,567`.

## Persistence scope collides for two games sharing a user-fixed seed

**Status:** deferred, by-design limitation (surfaced by the 2026-07-10 corpus
persistence-key audit). Not fixable by seed-field choice; a real fix is a storage-schema
change judged not worth the risk. Documented, not fixed.

**Symptom:** If a player starts two separate games with the *same manually-specified
fixed map seed*, the demographics history for the two games shares persistence scope. The
`seedMismatch` reset guard sees equal seeds and does not reset, so the newer game can
read/append onto the older game's series.

**Why field choice can't fix it:** scope resolves as `startSeed ?? gameSeed ?? mapSeed`
([ui/storage/demographics-storage.js:298](../ui/storage/demographics-storage.js)). When
the user fixes the seed, all three of those fields are identical by construction, so no
alternative seed field distinguishes the two games.

**What a real fix would require:** add a non-seed per-game salt/nonce generated at first
write and persisted, fold it into the scope key, and rework the `seedMismatch` guard
around it. That is a storage-key-scheme change — it would force a one-time history reset,
the way the geographic_labels area-id fix did — taken on for a negligible-probability edge
(two games with the same hand-picked fixed seed). Judged net-negative: the change is more
likely to introduce a bug than the edge is to ever occur. For normal auto-seeded play the
collision probability is negligible.

**Note:** all seed fields are stable across save/reload (unlike the renumbered
`getAreaId` that caused the geographic_labels bug), so this is purely a same-seed *scope*
collision, not a reload-instability bug.

## Crisis Impact: antiquity per-age cumulative thins out over time

**Symptom:** Viewed from a later age, the antiquity crisis's "Cumulative impact
across all stages" block (and likely its per-stage tables) eventually shows only
one populated row, "Military Power (Current)", while the loss columns
(Population / Crop / Production Lost, etc.) go blank.

**Status:** RESOLVED for the cumulative + cross-age overall blocks (the confirmed
symptom). Diagnosis confirmed in code as **sample decimation** (below), not a
windowing bug: the loss figures route through `sumDeclines` (needs ≥2 dense
samples → null/"—" otherwise) while Military Power uses `lastFinite` (survives on
one sample). Fix: each age's per-civ **cumulative crisis cost is snapshotted at
the age boundary**, while that age's samples are still dense, mirroring the
triumph snapshot (`_snapshotCrisisCost` in
[sampler-age-boundary.js](../ui/sampler/sampler-age-boundary.js) →
`history.crisisSnapshots[age]`). The render prefers the snapshot for a finished
age (`buildAgeCrisisCols` / `mergeAgeCols` in the new
[crisis-cost-model.js](../ui/screen-demographics/charts/crises/crisis-cost-model.js)),
falling back to live computation for the current age. Earlier age-boundary
windowing bugs were already fixed (`crisisStageSegments` + `ageLastTurns`;
age-scoped `groupCtx`; onset "arming" in `crisisStageOnsets`).

**Remaining:** the per-STAGE tables still recompute live, so a heavily-decimated
finished age could still thin its per-stage (not cumulative) loss columns. The
cumulative is snapshot-backed; extend the same snapshot to per-stage windows if a
screenshot confirms the per-stage tables are also sparse.

**Leading hypothesis:** sample decimation. Old samples are thinned as the game
grows to cap save size (see `ui/storage/storage-cap.js` /
`storage-retention.js`). The cumulative's "losses" metrics
(`sumDeclines` over `populationRaw` / `crops` / `production`) need dense
turn-by-turn samples to sum the per-turn dips; once the antiquity crisis turns
are decimated, only "Military Power (Current)" survives (it needs just one
sample via `lastFinite`). The per-stage tables and the cumulative share the same
code path over the same age-scoped samples, so if the cumulative is sparse the
stages should be too, which would confirm decimation rather than a windowing
bug.

**Proposed fix:** snapshot each crisis's total impact when its age ends, the way
the mod already snapshots triumph/legacy state at age boundaries
(`history.legacySnapshots`, see `recordAgeBoundary` in
`ui/sampler/sampler-age-boundary.js`). Persist the per-civ crisis cost totals
into the history blob at the age transition so the Crisis Impact tab can render
them from the snapshot regardless of later decimation. Render path would prefer
the stored snapshot for a finished age and fall back to live windowing for the
current age's ongoing crisis.

**Before building:** confirm the diagnosis with a fresh screenshot: specifically
whether the antiquity Intensifies / Culminates per-stage tables are *also*
sparse now. If the stages are full but only the cumulative is sparse, it's a
windowing bug to find instead, not decimation.
