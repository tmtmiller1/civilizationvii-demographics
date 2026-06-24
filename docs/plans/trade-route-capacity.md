# Trade Route Capacity view

Status: **proposed** (API availability not yet confirmed — see Step 0).

## Goal

Give the player a snapshot of their trade-route economy from two angles:

1. **Empire total** — the player's current trade-route **cap** (the maximum number
   of routes they can run, which rises over the game via techs/civics/buildings/
   policies) and how many of those slots are **currently in use**. e.g. `7 / 9`.
2. **Per-civ usage** — how many active trade routes the player currently runs **to
   each other civilization**. e.g. Rome → Egypt: 2, Rome → Aksum: 1.

Snapshot only — read live when the view is opened. No time-series sampling, no
persistence, no new storage schema.

## Placement (both)

- **Economy hub → new "Trade Capacity" page** (pill/page next to the existing
  Trade Routes page): a small header showing `used / cap`, then a per-civ table
  (civ name + leader swatch + active-route count), sorted by count desc. Reuse the
  settlements/table styling already in the mod.
- **Global Relations ring**: overlay each partner civ's active-route count on the
  diagram (on the node, or as an edge label), plus the `used / cap` total in the
  caption. Reuse the existing ring node/edge label machinery.

Shared collector feeds both surfaces so the numbers are guaranteed identical.

## Step 0 — Confirm the data source (DO THIS FIRST; gates everything)

Before any UI work, verify Civ7 exposes these at runtime from a UIScript context.
Candidate APIs to probe (names to confirm against the installed base-game source
under `…/Resources/Base/modules`, not assumed):

- **Cap (max routes):** likely a player trade accessor, e.g.
  `player.Trade?.getTradeCapacity?.()` / `getMaxOutgoingRoutes?.()` or a
  modifier-derived value. Find the real accessor; confirm it reflects
  tech/civic/policy increases.
- **Active routes + their targets:** likely `player.Trade?.getTradeRoutes?.()` or
  a routes collection whose entries carry an origin/destination player or city,
  from which the partner civ (player id) is resolved. Confirm we can map each
  active route → partner player id.
- **City-states:** decide whether CS routes are counted in the per-civ breakdown
  or shown as a separate "City-States" row (recommend: separate row, mirrors how
  the relations ring already splits Civ vs City-States).

Deliverable of Step 0: a one-paragraph note in this file recording the exact
accessors found (or "not available → cut/defer"). If the cap or per-partner target
isn't reachable, fall back to whatever IS available (e.g. global used/cap only,
no per-civ split) and note the limitation.

## Implementation outline (pending Step 0)

1. **Collector** — `ui/sampler/` or a small `views/.../trade-capacity-data.js`
   helper that returns `{ cap, used, perCiv: [{ pid, count }], cityStates: n }`,
   all read live. Pure, no side effects; guarded with `typeof`/`?.` like the rest
   of the sampler so a missing API degrades gracefully instead of throwing.
2. **Economy page** — register a page/metric (see `views/history/view-history.js`
   PAGES + `history-tabs.js`); render a `render`-style snapshot table (pattern:
   `renderRelationsPage` / the settlements table views). Localize all strings via
   `t()` + `LOC_DEMOGRAPHICS_*` keys across all 9 locales (see
   [[project_demographics_localization]]).
3. **Relations ring overlay** — extend the ring node/edge label builders
   (`views/relations/relations-ring-svg-nodes.js` / `-edges.js`) to optionally
   show the per-civ count; wire the `used / cap` into the relations caption.
4. **Tiers/visibility** — decide UI-complexity tier (basic vs standard) for the new
   page; respect the analytics-governance policy if it hides per-civ detail.

## Tests / verification

- Add a node harness for the collector's shape + the per-civ aggregation (mirror
  `tests/settlements-data.mjs`).
- `npm run verify` green (tsc + eslint + harnesses + i18n parity for new keys).
- Smoke-test in-game: open both surfaces, confirm `used` matches the in-game trade
  lens, cap rises after unlocking a route-granting tech, per-civ counts add up to
  `used` (minus any city-state split).

## Risks / open questions

- **API may not expose a per-partner target or an explicit cap.** Step 0 decides
  whether this ships full, reduced (global only), or is deferred.
- New LOC keys must be added to all 9 locales or i18n parity fails the gate.
- Ship as a **2.0.x feature** in its own commit, independent of the 2.0.1
  hardening/scaling release already prepared.
