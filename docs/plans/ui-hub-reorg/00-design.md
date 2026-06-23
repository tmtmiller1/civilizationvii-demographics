# 00 — Design (the target IA)

Source of truth for *what* we're building. Implementation prerequisites live in
[01-foundations.md](01-foundations.md); per-phase steps in the numbered files.

## Principle

Organize by the player's **subject / question**, keep each subject in exactly ONE place. Naming hubs
or pages after **data-types or mods** guarantees overlap (data-types overlap). **Hubs are subjects,
not presentation-types** — a hub holds whatever serves it (trend lines, maps, tables, event
timelines, policy panels), mixed freely. The placement test is "does this serve the subject," never
"is this a trend or an event." "Demographics" and "Emigration" are **mod names** (brand + standalone
windows), never tabs. Depth is uniform: **hub → page → pills** (+ optional Graph/Table render
toggle). No deeper.

## Target IA (final)

```
GLOBAL STATISTICS            "how do my empire's outputs compare?"
  Economy            Score · GDP · Gold · GPT · Production · Food · Trade
  Resources          7 resource views
  Science & Culture  pills: Science · Techs · Culture · Civics       · view: Graph | Table
  Society            Approval · Happiness/turn · Influence
  Expansion          Settlements · Settlement cap % · Land · Wonders
  Age                Legacy radar

MIGRATION                    "what's happening to my population, and why?"
  Population
  Net Migration      pills: Net · Immigration · Emigration · Refugees[Arrived|Left] · view: Graph | Table
  Network            pills: Dots · Arrows
  Causes
  My Cities
  Policies
  Notifications
  Guide

GEOPOLITICS                  "what's going on between civs?"
  Military           Mil Power
  Wars               Gantt · graphs
  Crises             Stages · graphs
  Relations
  Agreements         (Deals)

RANKINGS                     "where do I rank right now?" (snapshot — unchanged World Rankings view)
  Civilization Ranking · All Civilizations · Top 25 / Showcase · All Settlements
```

### Rules baked in
- **Graph | Table is a render toggle** intended for every line-metric page (a table of GDP is as valid
  as one of Science). NOTE: this is a *build* — see 01-foundations §Table-renderer spike; Phase 1 ships
  Graph-only and the toggle appears only where a table already exists.
- **Flatten until a page would become a grab-bag — then stop.** Science·Techs·Culture·Civics is one
  coherent subject; never fuse unrelated subjects (the "Power" mistake: military + population + land
  + wonders).

### What moves / dies vs today
- **"power" page deleted** → Mil Power → Geopolitics ▸ Military; Settlements/Cap %/Land/Wonders →
  Expansion; **Population → Migration**.
- **"knowledge" page split** → Techs/Civics/Science/Culture → Science & Culture; Influence/Happiness/
  Approval → Society; Deals → Geopolitics ▸ Agreements.
- **"conflicts" → Wars**; Crises stays; Relations (its own top-level view today) → a page in Geopolitics.
- **Emigration** stops being a sibling tab → becomes the body of Migration.

### Naming guards
- Network representations are **Dots · Arrows** (not a "Network" pill inside the Network page).
- Migration city view is **My Cities** — distinct from Rankings ▸ *All Settlements* and Statistics ▸
  Expansion ▸ *Settlements*.
- **Guide** (drop "to Emigration" inside the combined hub).

## Standalone matrix (hard constraint)

| Installed | Top level |
|---|---|
| **Demographics only** | `Global Statistics · Migration · Geopolitics · Rankings`. Migration = Population only. |
| **Emigration only** | Existing standalone window, unchanged. No host needed. |
| **Both** | The hubs, Emigration interleaved into Migration under Population. Standalone window still opens. |

## Chart-preservation (no chart silently dropped)
- **Refugees is TWO charts** — Arrived (in) / Left (out). One *Refugees* pill with an **Arrived | Left**
  toggle (two time-series, one at a time). A diverging mirror only reads for a single civ; these are
  multi-civ comparative lines, so avoid it. Never collapse to net-only (hides source-vs-haven).
- **Score stays** a trend pill in Statistics ▸ Economy (its current home). Not moved to Rankings.
- Scaled/Civ "points" variants are NOT separate charts — same chart under the `Population: Scaled | Civ`
  filter.
- Parked "Town Advisor" is not a live view — nothing to carry.

## Control grammar (every hub, both mods)

| Acts on | Control | Look |
|---|---|---|
| Which/what data (scope, subset, unit basis) | `[FILTER]` | flat boxed button (year-filter look) |
| How the same data is drawn (encoding, chart type) | `[PILL]` | rounded pill |
| A different dataset | tab / sub-tab | tab bar |

Row template, every tab: **`[scope/unit FILTERS] [render PILLS] ····· [ Options ▸ ]`** — filters
left, Options pinned right, one line.
