# Demographics for Civilization VII

Demographics is an in-game analytics dashboard for Civilization VII. It samples every civilization every turn and renders the history as interactive graphs, ranked factbooks, a global-relations ring, a conflicts timeline, and per-civ progress overlays on the native Triumphs cards. It is presentation-only — it never writes to gameplay state.

It is intended to be a spiritual successor to robk's Demographics (Civ V), Gedemon's CivGraphs (Civ VI), and Slothoth's Global Relations (Civ VII), unified into one screen with Civ VII's Test of Time data sources.

## Features

### Historical Data
- Per-turn time-series graphs rendered with Chart.js, styled to match Civ VII's native graph chrome (BodyFont, engine grid colors, parchment palette).
- 20+ metrics organized into four sub-pages:
  - **Economy** — Score, GDP, Treasury, GPT, Production, Crops, Trade Routes
  - **Power** — Military Power, Population, Settlements, Cap Utilization, Land Area, Wonders
  - **Knowledge & Influence** — Techs, Civics, Science, Culture, Diplomatic Approval, Influence, Happiness, Active Deals
  - **Triumphs** — Legacy Radar, Triumphs Over Time, Crisis Stage
- Per-civ line colors pulled from each civ's primary banner color so the chart matches the in-game palette.
- Time-range filter pills (25y / 50y / 100y / 300y / 500y / 1000y / Current Age / 1st-2nd-3rd Age / All Time) — remembered per metric.
- Year-aware X-axis labels (`T-52 / 2725 BCE`).
- Per-metric Y-axis formatter (`$1.2B` for GDP, `Stage 1` for crisis, etc.).
- Hidden/focused civs, smoothed lines (3-turn moving average, opt-in), eliminated civs hidden (opt-in), CSV export of every sample.

### World Factbook
- "Demographics on steroids" matrix: per-civ profile cards with every tracked metric, current value, and rank vs the rest of the world.
- Hides unmet civs as generic placeholders by default (toggle in Options).

### Global Relations
- Concentric ring layout: viewer civ at the center, met civs on the inner ring, met city-states on the outer ring.
- Edges colored by political, economic, and attitude relationships (Allied / Helpful / Friendly / Neutral / Unfriendly / Hostile / At War).
- City-state nodes show their type glyph (Militaristic / Cultural / Economic / Scientific / Expansionist / Diplomatic). Type resolution falls through to `GameInfo.Independents` so met-but-uncourted CSes still get the right icon.
- Filters, tooltips on every node and edge, colorblind-mode swap of the relationship palette.

### Conflicts
- Gantt chart of every war this game has seen, sourced from the engine's diplomacy events (`Game.Diplomacy.getPlayerEvents` → `DIPLOMACY_ACTION_DECLARE_WAR`).
- Real declarer (`initialPlayer`), real participant rosters from supporting/opposing players including called-to-arms allies, stable war identity by `uniqueID`.
- Defaults to the 50-year window so you land on a useful slice instead of the full timeline.

### Native Triumphs Decorator
- A runtime decorator (`demographics-triumphs-decorator.js`) watches the native Legacies → Triumphs popup and injects a per-civilization progress-bars block into every triumph card.
- Reads each civ's `Players.get(pid).Legacies.getProgress(LegacyType)` live, with the race-paired legacy row resolution so first-come-first-served triumphs still surface real progress data.
- Every card gets one row per major civ — empty bar for zero progress, attribute-color fill for active, gold for triggered — so cards render at consistent heights.

### Other
- Persistent settings via `modSettings` (per-save-game).
- Adaptive history storage cap based on game speed, with manual override (`Auto` / `1k` / `2.5k` / `5k` / `10k` / `Unlimited`).
- Performance mode (buffers writes, throttles hover) for long games.
- Colorblind mode swaps the rotating palette and attitude colors to the Wong CVD-safe palette.

## Installation

1. Download or subscribe to the mod.
2. Place the `demographics` folder in your Civilization VII Mods directory:
   - Windows: `%localappdata%/Firaxis Games/Sid Meier's Civilization VII/Mods/`
   - macOS: `~/Library/Application Support/Civilization VII/Mods/`
3. Enable **Demographics** in-game from the Additional Content menu.

## Usage

- Click the Demographics icon in the subsystem dock to open the dashboard.
- Use the top tabs to switch between Historical Data, World Factbook, Global Relations, and Options.
- Within Historical Data, the second-row tabs pick a metric page; the third row picks a metric.
- The native Legacies → Triumphs popup automatically shows per-civ progress bars on every card — no toggle needed.

## Compatibility

- No vanilla game files are overwritten.
- Per-save history data is stored on the local player's `Tutorial`
  property bag, the same surface the engine uses for cross-age legacy
  and unlock tracking. It survives age transitions and quit-to-menu
  without touching other mods' namespaces.
- The native-Triumphs decorator is purely additive — it appends a div
  to existing cards and never patches engine components.
- Defensive accessor wrapping throughout, so engine-side schema drift
  surfaces as missing data rather than crashes.

## Credits

- **robk** — original "Demographics" mod for Civilization V.
- **Gedemon** — CivGraphs mod for Civilization VI.
- **Slothoth** — Global Relations mod for Civilization VII (the basis of the relations ring here).
- The Civ modding community for documentation, sample mods, and testing.
- Civilization VII rebuild and enhancements by Tower.

## License

MIT. See LICENSE for details.

## Design Note: Scripting Limitations

Civilization VII does not currently expose gameplay scripting hooks
(Lua, custom turn handlers, AI overrides) or 3D-asset modding.
Demographics works strictly inside what *is* exposed: reading game
state through the `Game.*` / `Players.*` / `GameInfo.*` accessors and
presenting it inside Coherent GameFace UI. This is why the mod is a
read-only dashboard and not an AI or balance mod.