# 01 — Foundations (Phase 0)

The implementation prerequisites. Settle every item here before Phase 1 code. These are the details
the design doc ([00-design.md](00-design.md)) deliberately omits.

---

## A. Metric-ID → hub/page map

Metric IDs are **stable persisted keys** — keep them verbatim; only their page grouping changes.
Current source: `views/history/view-history.js` `PAGES` (the `metrics: [...]` arrays).

| Current metric id | Current page | New hub | New page id |
|---|---|---|---|
| `score` | economy | statistics | `economy` |
| `gdp` `gold` `gpt` `production` `crops` `trade` | economy | statistics | `economy` |
| `milpower` | power | geopolitics | `military` |
| `population` | power | migration | `population` *(stays Demographics-owned; the Migration anchor)* |
| `settlements` `settlement_cap_pct` `land` `wonders` | power | statistics | `expansion` |
| `techs` `civics` `science_yield` `culture_yield` | knowledge | statistics | `science_culture` |
| `influence` `hpt` `approval` | knowledge | statistics | `society` |
| `deals` | knowledge | geopolitics | `agreements` |
| `legacy_radar` | age | statistics | `age` |
| `resources_stack` … `resources_treasure` (7) | resources | statistics | `resources` |
| `wars_gantt` `war_graphs` | conflicts | geopolitics | `wars` |
| `crisis_stages` `crisis_graphs` | crises | geopolitics | `crises` |

- `wars_gantt`, `war_graphs`, `crisis_stages`, `crisis_graphs`, `legacy_radar`, `resources_stack` are
  **synthetic metrics** (custom renderers, not the line pipeline) — they keep their renderers; only
  the page they sit under changes.
- `population` is the lone metric that crosses into a hub Emigration also fills. It stays a Demographics
  metric (line chart); Emigration injects the rest of Migration *after* it (anchor id `population`).
- Pill order within `science_culture`: `science_yield · techs · culture_yield · civics` (keep each
  track's yield→count adjacent).

## B. Page-id & persistence migration

Persisted keys that reference IDs:
- `currentPage` (last page per hub) and the group-selection store `historyGroupSel`
  (`GROUP_SEL_KEY`, keyed by group id) — `views/history/view-history.js`.
- `timeFiltersByMetric` — keyed by **metric id** → survives automatically (metric ids unchanged).
- `settlementsSubTab`, `settlementsSortKey` — Rankings view, unchanged.

Page ids that change: `power` (deleted), `knowledge` (split), `conflicts` → `wars`. `view-history-state.js`
already clamps an unknown page to the first visible page, so stale state degrades gracefully (no crash).
To preserve the user's last-page where sensible, add a one-shot alias map applied on read:

```
const PAGE_ID_ALIASES = { power: "expansion", knowledge: "science_culture", conflicts: "wars" };
```

Emigration's metric-group id (`emig_graphs`, today's "Data" group) is retired by the Phase 3 hub
contribution — drop its persisted `historyGroupSel[emig_graphs]` entry on migrate (harmless if left;
it just goes unread).

## C. Hub architecture — a hub hosts THREE content kinds

Today `renderActiveView` dispatches the top-level views: `history` (metric pages), `rankings`
(`view-settlements`, a full custom view), `relations` (`view-relations`, a full custom view), plus
`EXTERNAL_PANELS` with `topLevel:true`. The reorg needs hubs that mix these. Unify via **one
generalized PageDef**:

```
PageDef = {
  id: string,
  label: string,                 // LOC key
  tier?: "basic"|"standard"|"analyst",   // default "standard" (see §D)
  // EXACTLY ONE of:
  metrics?: string[],            // host line/synthetic pipeline (Statistics, Military, Wars, Crises…)
  group?: GroupSpec,             // host 2D group (members × views) — pills + Scaled/Civ binding (Net Migration)
  render?: (host, ctx) => void,  // a full custom view as a page (Relations; emigration Network/Causes/…)
  hidePolicyBanner?: boolean
}
```

**Important — three page kinds, not two.** Some pages reuse the host's existing machinery rather than
drawing themselves:
- `metrics` → the host line/synthetic chart pipeline (a metric id row).
- `group` → the host's existing **2D metric-group** resolver (`resolve2DGroup` in `view-history.js`):
  member pills + a Scaled/Civ-style view binding. This is what the **Net Migration** page is — the
  current `emig_graphs` group, relocated into the hub as one page (see [04](04-phase3-emigration-fills-migration.md)).
  Emigration's line charts stay **host-rendered** via their registered `accessor`s; the page just
  selects among already-registered metric ids.
- `render` → a fully custom view (Relations; Emigration's Network / Causes / My Cities / Policies /
  Notifications / Guide).

Hub definitions (host-owned):
- **statistics** — page row from §A (all `metrics` pages).
- **geopolitics** — `military` `wars` `crises` (`metrics`) + `relations` (`render` → `view-relations`)
  + `agreements` (`metrics: ["deals"]`).
- **migration** — `population` (`metrics: ["population"]`); the rest injected by Emigration (Phase 3).
  Standalone Demographics shows only `population`.
- **rankings** — stays the existing `view-settlements` custom view (a hub with a single implicit page,
  or kept as a dedicated top-level view — simplest is to leave Rankings exactly as today and only
  reskin its tab label). Recommended: **leave Rankings untouched**; it is already a clean hub.

So the build is: generalize `history` into a **hub renderer** keyed by hub id, where each page is
`metrics` or `render`. `relations` stops being a top-level view and becomes a geopolitics page.

## D. Tier & age gating (must be carried)

Tiers (`core/demographics-tiers.js`): `basic` shows only `BASIC_PAGES = {economy, power, knowledge}`
and hides `BASIC_HIDDEN_VIEWS = {relations}`; `standard` shows all; `analyst` adds power-user options.
Age gating: `visibleMetricsForAge()` (`history-tabs.js:150`) filters metrics per age.

Remap for the new page set — move gating from a page-set constant to a per-page `tier` field, with the
basic tier = the everyday comparison pages:

| Page | tier |
|---|---|
| statistics: economy, science_culture, society, expansion | basic |
| statistics: resources, age | standard |
| migration: population, net_migration | basic |
| migration: network, causes, my_cities, policies, notifications, guide | standard |
| geopolitics: military | basic |
| geopolitics: wars, crises, agreements | standard |
| geopolitics: relations | standard *(was basic-hidden — keep hidden at basic)* |
| rankings (whole hub) | basic |

- The four **hubs** themselves are visible at every tier; only their advanced pages hide at basic.
- `visibleMetricsForAge()` is unchanged and applies within `metrics` pages exactly as today.
- `pageVisibleInTier` becomes `pageVisibleInTier(pageDef)` reading `pageDef.tier`.

## E. `registerHubPages` contract (built in Phase 2; consumed in Phase 3)

Additive to the existing API (`registerMetric`, `registerMetricToPage`, `registerPanel`,
`registerMetricGroup` in `core/demographics-metrics.js`; companion drains via `_api.pending`).

```
DemographicsMetricsAPI.registerHubPages(
  hubId: "statistics" | "migration" | "geopolitics",
  pages: PageDef[],                       // PageDef from §C (render pages, namespaced ids)
  opts?: { after?: string }               // anchor page id, e.g. "population"; else appended
): boolean                                // false if hub unknown / dup ids / API too old
```

- Pages may be **`render`, `metrics`, or `group`** kind (§C). A `group` page reuses the host's
  `resolve2DGroup` (member pills + Scaled/Civ view binding) — this is how Emigration relocates its
  `emig_graphs` group as the Net Migration page without re-drawing line charts.
- Hub ids are exposed as a frozen `HUB_IDS` export so a companion can feature-detect targets.
- `ctx` passed to `render` mirrors today's panel ctx: `{ settings, history, panelControls, groupView,
  setActiveTimeFilter, clearFocus, ... }` (reuse the external-panel ctx builder).
- Ordering/anchor: insert after the page whose id === `opts.after`; unknown anchor → append.
- Load-order safe: if `registerHubPages` isn't defined yet, companion pushes onto `_api.pending`
  (same drain path as today).
- Feature-detect on the Emigration side: `typeof api.registerHubPages === "function"` → hub mode; else
  fall back to `registerPanel({topLevel:true})` (today's behavior) so an older host still works.

## F. New LOC keys (en_us + all 9 locale files; relaunch to show)

Hub tabs: `LOC_DEMOGRAPHICS_TAB_STATISTICS`, `LOC_DEMOGRAPHICS_TAB_MIGRATION`,
`LOC_DEMOGRAPHICS_TAB_GEOPOLITICS` (`LOC_DEMOGRAPHICS_TAB_RANKINGS` exists).
New page labels: `LOC_DEMOGRAPHICS_PAGE_SCIENCE_CULTURE`, `_SOCIETY`, `_EXPANSION`, `_MILITARY`,
`_WARS`, `_RELATIONS`, `_AGREEMENTS` (`_ECONOMY`, `_RESOURCES`, `_AGE`, `_CRISES` exist).
Migration page labels come from the Emigration LOC namespace (`LOC_EMIG_*`) injected in Phase 3
(Population label is host-side: `LOC_DEMOGRAPHICS_PAGE_POPULATION`).
Reuse existing metric/pill labels where present; only genuinely new strings get keys. Retire (leave in
place, just unused): `LOC_DEMOGRAPHICS_PAGE_POWER`, `_KNOWLEDGE`, `_CONFLICTS`.

## G. Table-renderer spike (the one real scope risk)

**Finding:** there is no generic line-metric Table renderer — the only table code is crisis-specific
(`charts/crises/*`) and the Emigration ledger. So "universal Graph | Table" is a build, not a toggle.

**Decision for this plan:**
- Phase 1 ships **Graph-only** for Statistics; the Graph | Table pill appears **only where a table
  already exists** (Net Migration ledger in Phase 3/4).
- A generic metric-table renderer (metric × civ × time → sortable, CSV already exists for export) is a
  **separate later task**, not a Phase 1 blocker. Tracked as a follow-up, flagged so the universal
  toggle isn't assumed free.

## H. Per-phase acceptance criteria (template)

Each phase is done when: (1) `npm run verify` is green for the touched mod(s); (2) the standalone
matrix in 00-design still holds (test Demographics-only and Emigration-only loads); (3) no chart from
the preservation list is unreachable; (4) persisted state from the prior version loads without error
(stale ids alias or clamp, never throw); (5) the in-game checklist for that phase (in its file) passes.
