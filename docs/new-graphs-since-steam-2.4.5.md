# New graphs since the last Steam upload

The version currently live on the Steam Workshop is **v2.4.5** (uploaded Jul 11).
The pending update (**v2.5.1**, bundling everything from **2.5.0**) is the first
Steam release to carry the graphs below. 2.5.1 itself added no new graphs — it
only renamed two scatter metrics and the Natural Wonders pill — so every graph in
this note arrived in the 2.5.0 release.

Verified against the live code (`ui/screen-demographics/charts/…` and the metric
registry in `ui/metrics/`), not just the changelog prose.

---

## A whole new page: Religion

An age-gated **Religion** page (`chart-religion-lines.js`, `pantheon-effects.js`),
showing only the set that applies to the current age:

- **Antiquity** — the pantheon each civilization chose and its yields.
- **Exploration onward** — founded-religion standings, religion **spread over
  time**, and **followers as a share of population**.

## New boards on existing pages

- **Wonders & Races (Society page)** — a wonders board plus a per-wonder **race
  view** showing which civ is winning the race for each wonder
  (`chart-line-wonder-markers.js`, built on wonder samples the mod already took).
- **Settlements Atlas (Settlements & Land page)** — a size-distribution and
  **urbanization** view of the empire's footprint (`chart-settlement-boards.js`).
- **By-type breakdowns**, stacked by civilization with localized type names:
  - **Military** — units trained / killed / lost **by unit type**.
  - **Settlements & Land** — buildings and districts **by type**, including a
    dedicated **Quarters board** (`chart-quarters-board.js`).

## Fifteen new metrics (each a new graph)

Every metric below is a new time-series graph on its page:

| Page | New metrics |
|------|-------------|
| Society | Faith, Tourism, Great People, Great Works |
| Settlements & Land | Cities, Towns, Settlement Cap |
| Military | Units Killed, Units Lost, Combats, Wars Declared, Wars Received, Settlements Conquered, Conquest % |
| Wonders group | Natural Wonders *(the "Natural Wonders Discovered" pill in this update)* |

## World Rankings

- **Civilization Rank by Yield** is a **sortable civs-as-rows table** again, with
  click-to-sort yield columns (Score, Food, Science, …). It falls back to the wide
  civs-as-columns matrix at very large Interface Sizes; a `worldRankingsAllCivsLayout`
  setting (`auto`/`table`/`matrix`) can pin the layout.

---

## Not graphs, but shipping in the same update

- The dashboard is now reachable from the **end-of-game results screen** and the
  **pause menu**, so history stays accessible after the subsystem dock is gone.
- **Empty metrics and pages hide themselves** — a metric with no data no longer
  renders a blank graph, and pages/hubs whose metrics are all empty are hidden.
- Civilization-first legends/tooltips ("Civilization (Leader)"), clearer settlement
  ownership on the Top 25 podium and settlements list, and single-line handling for
  long two-word names.

All new labels are localized across all 11 languages.
