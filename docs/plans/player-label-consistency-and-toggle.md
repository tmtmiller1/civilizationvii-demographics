# Player-Label Consistency + Civ/Leader Toggle (and two adjacent tester issues)

_Date: 2026-07-15 · Target: Demographics v2.5.0 · Source: tester/translator feedback (AndySafik)_

Three items from the same conversation:

1. **Label consistency** — the interface mixes several player-labeling orders; the tester wants one consistent hierarchy, ideally a **live on-screen toggle** (like Turn/Year and Scaled/Game-Population) to flip the whole UI between **Civilization → Leader** and **Leader → Civilization**. _(analysis + recommended method below)_
2. **D1** — the **Population line graph** always shows Scaled population; it should offer the same **Scaled / Game(Civ)** toggle World Rankings already has.
3. **D2** — after a Top-25 **cinematic**, "Return to Greatest Settlements" lands on the Global Statistics graph instead of the settlement rankings. _(root-caused; it's a bug)_

---

## 1. Label consistency + Civ/Leader toggle

### The problem (confirmed) — four orderings coexist

There is **no single name formatter**; ~6 formatters + several inline builders spread across four conventions:

| Order | Where | Code |
|---|---|---|
| **Civ (Leader)** | line-chart legends + tooltips | `charts/shared/chart-shared.js:145-149` (`displayName`), applied `chart-line-series.js:453`; tooltip `chart-line-tooltip.js:143-146` |
| **Leader (Civ)** | wars/resources civ dropdowns; Triumphs radar | `chart-shared.js:364-367` (`civOptionLabel`); `charts/triumphs/chart-triumphs-radar-data.js:98-99` |
| **Civ / Leader** (two-line, civ primary) | World Rankings matrix/table/leader cards; Top-25 settlements; Civ Ranking | `worldrankings-allcivs-render.js:185-205`, `…-table.js:321-324`, `…-leaders.js:120-131`; `view-settlements-showcase.js:106-111,174-175`; `view-settlements-civranking.js:50,172-173` |
| **Leader, Civ** (comma) | Relations ring nodes | `relations-ring-svg-nodes.js:86-90` |
| Leader-only | settlements table/detail; relations dropdown | `view-settlements-table.js:60`, `view-settlements-detail.js:64`, `relations-viewer-controls.js:78-81` |

(One stale comment: `chart-line-series.js:452` says `"Leader (Civ)"` but the code outputs Civ (Leader) — fix while here.)

### Key enabler: the data is already uniform

Every persisted sample, settlement owner, and World-Rankings profile carries **both** `leaderName` and `civName` (`sampler-snapshot-helpers.js:73-89`, `settlements-data.js:239-242`, `worldrankings-allcivs-profiles.js:84-131`), with live fallbacks (`chart-line-series.js:363-375`). So flipping primary↔secondary can **never** expose a missing half. City-states (no `civName`) already fall back to the one name they have.

### Recommended method: **a live global toggle, backed by one ordering helper**

Not a settings-only option, and not "just pick one order." The tester's deeper point is correct: since Test of Time lets players run the classic single-leader ruleset **or** the new civ-switching progression, some identify with the leader and some with the civilization — so the right answer is to **let the player choose, live**, exactly like the existing Turn/Year switch. Method:

1. **One global flag + persisted setting**, modeled precisely on the Turn/Year `xAxisMode` pattern (`chart-shared.js:235-249`: module-level getter/setter + `setSetting`). Call it `nameOrder` ∈ `{civLeader, leaderCiv}`, default **`civLeader`** (the tester's preference, and already the most-used convention — line charts, World Rankings, settlements).
2. **One shared helper** `orderedNames(leaderName, civName) → [primary, secondary]` (new `ui/core/player-label.js`, or in `chart-shared.js`). It returns the pair in the current global order; **each call site keeps its own layout** — inline `primary (secondary)` for charts, two-line stacked for cards, `primary, secondary` for the ring. The toggle changes *which name leads*, never a screen's layout. This is what makes it globally consistent without rewriting every view's markup.
3. **Redirect the ~11 call sites** (table above) to build their label from `orderedNames(...)` instead of hard-coding the order. Leader-only sites become "primary-only" (show whichever name is primary) so even compact spots follow the hierarchy; the ring's comma form and the charts' parenthetical form are preserved, just reordered.
4. **The toggle control** — a `pillRow(…, "filter")` (the flat boxed variant used by Scaled/Civ, `view-pills.js:16-27`) in the chart toolbar beside Turn/Year, persisted; on change call `ctx.requestReload()`. Because consumers read the global fresh at render (the Turn/Year model), one flip re-labels the entire screen.

**Effort:** M — 1 global + 1 helper + ~11 mechanical call-site edits + 1 toolbar control. Low risk (inputs uniform; no data changes; UI-only). Well-covered by the existing render-on-reload machinery.

**Why this over the alternatives:** a settings-screen option works but forces the player to leave the screen (the tester explicitly prefers an on-screen switch); picking one fixed order resolves the inconsistency but ignores the legitimate civ-vs-leader identity split the ruleset creates. The toggle does both — consistent *and* per-player.

---

## 2. D1 — Population graph Scaled / Game(Civ) toggle

The Population page charts the single metric `population` (scaled) — `view-history.js:241-245` (and it's injected as the first pill of `society` in standalone builds, `:309-311`). The raw twin already exists: `population_civ` (`demographics-metrics.js:265-281`), and World Rankings already swaps `population → population_civ` via `scaledToCivPairs()` (`worldrankings-allcivs-render.js:65`) driven by `setMatrixNumberMode`.

**Recommended:** the lightest, most consistent option — a small toolbar toggle in `history-controls.js` modeled on `appendTimeUnitsToggle` (`:225-255`), shown only when `activeMetric === "population"`, persisting a `populationNumberMode` setting and swapping `population → population_civ` at the single point the metric id is handed to `buildSeriesFromHistory` (`chart-line-series.js:487`) — mirroring the World Rankings pattern exactly. (Alternative: register a built-in metric group for the page, but a one-member group renders a redundant metric pill.)

**Effort:** S. Reuses the metric twin and the World-Rankings swap idiom.

---

## 3. D2 — Cinematic "Return to Greatest Settlements" lands on the wrong view (BUG)

**Root cause found.** Cinematic teardown → `city-camera-controller.js:565` (`restoreFromCinematic`) → `:580` `reopenScreen()`, which correctly writes the intended target (`city-camera-controller.js:280-294`):

```js
DemographicsSettings.setSetting("activeView", "rankings");
DemographicsSettings.setSetting("settlementsSubTab", "showcase");
```

But reopening runs `_restoreState`, which **hard-codes the view and discards the persisted `activeView`** — `screen-demographics.js:343-349`:

```js
_restoreState() {
  // Always OPEN to Global Statistics → Economy → Score …
  this.activeView = "statistics";   // ← line 347: overrides the "rankings" just written
  this.activeMetric = "score";
  this.activePage = "economy";
```

So the return lands on Global Statistics. (`settlementsSubTab:"showcase"` is honored later at `view-settlements.js:599`, but the user never reaches the settlements view, so it doesn't help.)

**Fix (recommended):** give the cinematic return path a **one-shot override** the reset honors. `reopenScreen` sets a transient `setSetting("pendingReturnView", "rankings")`; `_restoreState` reads-and-clears it and, when present, uses it instead of the hard-coded `"statistics"`, else keeps today's always-open-to-Statistics behavior. This preserves the deliberate "fresh open → Global Statistics" default while honoring the cinematic's explicit return. Culprit line: `screen-demographics.js:347`; fix in `_restoreState` (`:343-364`).

**Effort:** S (small, localized bugfix).

---

## Suggested order

D2 (bug, small) → D1 (small, tester-visible) → Label toggle (M). All three are independent of the source-mod-gap plan and of each other.
