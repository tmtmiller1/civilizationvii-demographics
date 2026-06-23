# 04 — Phase 3: Emigration fills the Migration hub

Switch Emigration from a sibling top-level tab to a hub contributor: its pages render inside the
Migration hub, after Population. Keep the standalone window for solo installs; feature-detect so older
hosts still get today's behavior.

Prereqs: Phase 2 (`registerHubPages`, `HUB_IDS`). Contract: [01-foundations.md](01-foundations.md) §E.

## Architecture note (read first)

Emigration's migration line charts (`emig_net_cum`, `emig_out_cum`, `emig_in_cum`, `emig_refugees`,
`emig_refugees_in`, and `_pts` variants) are **host-rendered metrics** — each is a `registerMetric`
spec with an `accessor: (ctx) => value`, drawn by Demographics' line pipeline and grouped today by
`registerMetricGroup(GRAPHS_GROUP)` (the "Data" group, id `emig_graphs`) with a Scaled/Civ view
binding. **Emigration does not draw these lines itself.** Therefore:

- **Net Migration** is NOT a from-scratch render page. It is the existing `emig_graphs` 2D group,
  **relocated into the Migration hub as a single `group` PageDef** (01 §C). The host's `resolve2DGroup`
  draws it. Direction pills = group members; Scaled/Civ = the existing view binding.
- The **other** migration pages (Network, Causes, My Cities, Policies, Notifications, Guide) ARE
  `render` PageDefs (Emigration draws them, as the section views already do).

So Phase 3 injects a MIX: one `group` page (Net Migration) + several `render` pages.

## Steps

1. **Feature-detect** (`ui/emigration-migration-page.js`): on the ready host API, if
   `typeof api.registerHubPages === "function"` AND `api.HUB_IDS?.includes("migration")` → **hub mode**;
   else fall back to today's `registerPanel({ topLevel:true })` (unchanged), so an older Demographics
   still shows the Emigration tab. Same `_api.pending` queueing for load order.

2. **Net Migration = relocate the `emig_graphs` group as one `group` page.** Register it onto
   `migration` `{ after:"population" }` as a `group` PageDef built from the existing `GRAPHS_GROUP`
   members/views. Map members → direction pills (the metrics keep their ids; the host draws them):

   | Pill | metric id (Scaled) | metric id (Civ) |
   |---|---|---|
   | Net | `emig_net_cum` | `emig_net_cum_pts` |
   | Immigration | `emig_in_cum` | `emig_in_cum_pts` |
   | Emigration | `emig_out_cum` | `emig_out_cum_pts` |
   | Refugees ▸ Arrived | `emig_refugees_in` | `emig_refugees_in_pts` |
   | Refugees ▸ Left | `emig_refugees` | `emig_refugees_pts` |

   - Scaled/Civ = the group's existing view binding (`get/set NumberMode`). Refugees collapses its two
     members under an `Arrived | Left` sub-toggle (00-design Chart-preservation).
   - `Graph | Table` is a **page-level** view pill (a 3rd axis beyond the group's members × scaled/civ):
     **Graph** = host line render of the selected direction pill; **Table** = the existing ledger
     (shows all directions at once, so the direction pills are inert in Table mode). Implement as a
     page-level render switch wrapping the group, not as another group "view" — `resolve2DGroup` stays
     2D (members × scaled/civ).
   - Emigration still calls `registerMetric(SPECS)` (the metrics must exist for the group to reference);
     only `registerMetricGroup(emig_graphs)` + the `ledger` `registerPanel` sub-tab are dropped in hub mode.
   - This **subsumes** today's `emig_graphs` metric group + the hidden `ledger` sub-tab — stop calling
     `registerMetricGroup(emig_graphs)` and the `ledger` `registerPanel` sub-tab in hub mode.

3. **Render pages**: register `network` · `causes` · `my_cities` · `policies` · `notifications` ·
   `guide` as `render` PageDefs (reuse the existing section views via `renderDashboardSubtab`), same
   anchor. Network pills `Dots · Arrows`; My Cities = today's `cityflows` section (label rename);
   `guide` carries `hidePolicyBanner: true`.

4. **Population coupling**: the host owns the `population` metric (the anchor). Emigration's pages sit
   after it; the `Population: Scaled | Civ` filter (Phase 4) is the shared unit control for the hub
   (it drives the same `NumberMode` the Net Migration group binding reads).

5. **Retire the sibling tab in hub mode**: don't also `registerPanel({topLevel:true})` when hub mode
   is active (avoid a duplicate Emigration tab). The standalone **window** (dock button) is untouched.

## Files
`ui/emigration-migration-page.js` (feature-detect + `registerHubPages` contribution + fallback),
`ui/emigration-demographics.js` (direction-pill wiring; retire `emig_graphs` group in hub mode),
section renderers reused as-is (`emigration-views.js` and friends).

## Acceptance (in addition to 01 §H)
- Both installed: Migration hub shows `Population` then Network/Net Migration/Causes/My Cities/Policies/
  Notifications/Guide; no duplicate "Emigration" top-level tab.
- Net Migration: Net/Immigration/Emigration/Refugees pills work; Refugees has Arrived|Left (both
  charts reachable); Graph|Table swaps to the ledger table.
- Older host (no `registerHubPages`): Emigration appears as today's sibling tab (fallback path).
- Emigration-only (no host): standalone window unchanged.
- `npm run verify` green for **both** mods.
