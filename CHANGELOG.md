# Changelog

All notable changes to the **Demographics** mod for Civilization VII. Loosely
follows [Keep a Changelog](https://keepachangelog.com/) and Semantic Versioning.
The Steam Workshop change note for each release is generated from the matching
section below by `release.sh`.

## [Unreleased]

## [2.3.2] - 2026-07-04

A follow-up to the 2.3.0 4K fix. The All Civilizations comparison is transposed so
its labels are readable at every resolution and UI scale, plus a Scaled/Civ toggle,
score-ordered columns, heading icons, and larger table text.

### Changed
- **All Civilizations view is now metrics-as-rows (no more clipped/tiny headers).**
  The comparison previously put each of the ~21 metrics in its own *column*, so at
  4K / low UI scale there was no room for the localized column headers — Polish
  "Pozycja", "Technologie", "Powierzchnia terenu" were cut off ("Pozycja" →
  "ozycj") or shrunk to nothing. It now lays out each **metric as a row** with its
  name in a wide left column (which reads at full size), and each **civilization as
  a column** — far fewer columns, and the long labels have horizontal room. Every
  cell shows the world rank with its value beneath it, the local player's column is
  pinned on the left, and other civs can still be hidden/shown. Metric names use the
  engine's font auto-fit (`coh-font-fit-mode: shrink`) so they stay on one line at
  any resolution without wrapping.
- **Scaled / Civ toggle in the All Civilizations view.** Metrics that come in a
  scaled-"people" and a raw-Civ-numbers pair — Population, and (with the Emigration
  companion) the migration flows — now show a **single row** with a Scaled/Civ
  button that swaps the whole column in place, matching the toggle on the other
  tabs, instead of two identically-labelled rows. Fixes the duplicate "Population"
  row (base `population` vs `population_civ`) the transpose exposed.
- **Civilizations are ordered as a leaderboard.** Beside the local player's pinned
  column, the other civilizations are now laid out left→right in descending
  **civilization-score** order (previously alphabetical by leader name), so the
  view reads as a ranking. Ties fall back to leader name.
- **Metric row headings show icons.** Each metric name in the left column now
  leads with its icon (gold, science, culture, food, production, population,
  diplomacy, military, wonders, score, …) for faster scanning.
- **Larger table text.** The metric names, values, ranks and civilization names in
  the All Civilizations table are set a step larger for readability.
- **Category-leader cards above the table.** The "rank by category" strip — one
  card per metric naming the civilization that leads it — is back above the All
  Civilizations table, matching the All Settlements panel.

## [2.3.0] - 2026-07-04

A localization release. Polish is now a supported language, and every remaining
hardcoded interface string has been moved behind a translation tag so the whole
UI can be localized. Also fixes oversized World Rankings text at 4K.

### Added
- **Polish (pl_PL) localization.** Polish is now a registered language with a
  translation file covering every string in the mod. It ships as English
  placeholders pending community translation, so any not-yet-translated row
  falls back cleanly to English — exactly as an untranslated string does in the
  other languages.
- **The other nine languages are now fully translated.** German, Spanish,
  French, Italian, Japanese, Korean, Portuguese (BR), Russian and Simplified
  Chinese had a backlog of interface strings still showing English (chart
  titles, tab and column labels, page names, and more). Every one is now
  translated, using the game's own terminology, so those languages read as a
  complete localization rather than a partial one.
- **Full translation coverage for the interface.** The strings that were still
  hardcoded in English — the History time-range filter pills (*25y … 1000y*),
  the Relations node-focus caption, the City-State ally fallback, and the
  "Player N" / "War #N" fallback labels — now resolve through translation tags,
  so they localize with the rest of the UI. The Relations focus caption also
  drops an English-only plural suffix in favour of a count-based phrasing that
  translates correctly in every language. This closes the gaps a translator
  would otherwise hit.
- **War display names now fully localize.** The dynamic war names (recurrence
  ordinals, world/great/regional labels, duration flair) were already built from
  translation templates; the last English leaks in that path — the "Unknown"
  fallback adjective that could surface inside a name, and single-belligerent
  wars that fell back to the raw stored name — are now localized too. The names
  are composed at display time, so nothing is baked into save files and existing
  saves are unaffected.

### Fixed
- **Numbers now format for the player's language.** Grouped figures and
  abbreviated magnitudes (e.g. *1.23M*, *12,345 km²*, *+3.4/turn*) previously
  always used English separators (`1,234.5`) regardless of language. They now
  route through the game's own `Locale.toNumber`, the same API the base game
  uses, so a German player sees `1.234,5`, a French player `1 234,5`, and so on.
  Off-engine (and if the API is ever unavailable) it falls back to the previous
  formatting, so nothing regresses.
- **World Rankings text no longer oversized at 4K.** Every tab of the World
  Rankings screen used a larger type scale than the rest of the mod, which read
  as oversized on high-resolution displays and left too little room for longer
  names. The leader, civilization, metric-label and value text is retuned to
  match the mod's other tables (and the civilization-table name column widened),
  so names — including longer localized ones — fit, while the smooth
  per-resolution scaling introduced in 2.1.2 is preserved.

## [2.2.0] - 2026-07-02

Influence now shows in the Settlement rankings, alongside the other yields.

### Added
- **Influence column in the Settlement rankings.** The "Settlement Rank by
  Yield" table (and the settlement showcase, per-settlement dossier, and
  category-leader strip) now show Influence alongside the other yields, matching
  the "Civilization Rank by Yield" tab which already listed it. Influence is a
  ranked/sortable column but stays out of the composite Score — it is an
  empire-pooled yield only sparsely emitted per settlement, so counting it would
  skew the economic Score toward the few civs with influence-generating
  buildings. Localized in all supported languages.

## [2.1.2] - 2026-06-28

Every screen now scales smoothly to lower resolutions.

### Fixed
- **Every screen now renders properly on lower resolutions.** On sub-1080p
  displays (1366×768, 1600×900 and similar) the game pins the UI font at its
  smallest size, so all the fixed elements — titles, tab bars, the chart toolbar
  and legends, the World Rankings header band, the Settlements avatars and
  sub-tabs, the Relations filter chips — kept their full size and crowded the
  actual data into a sliver (the reported "charts only use 20% of the screen").
  The fixed-size content now scales *continuously* with the available height:
  each element eases smoothly from its full size down to a readable floor as the
  window gets shorter, with no abrupt jumps between resolutions. At the standard
  resolutions (1080p / 1440p / 4K) nothing changes.

## [2.1.1] - 2026-06-27

A correctness pass on two charted figures that could balloon to absurd values on
long or slow (Marathon) games — the same "a number escaped its bound" class the
2.1.0 population rework addressed, now closed for war casualties and GDP. No
saves affected; presentation only.

### Fixed
- **War-casualties no longer read in the billions on long / slow games.** The
  "soldiers killed" chart used an unbounded `1.009^turn` era multiplier (the same
  term the population formula already dropped), which ran to thousands× on a long
  Marathon game. It is now capped at a full game's worth of era growth, so casualty
  figures stay sane and comparable across eras and speeds.
- **GDP no longer balloons purely because time passed.** The GDP figure multiplied
  per-turn yield by the raw turn counter with no bound, making a mature empire read
  hundreds of times "richer" late game (worse on Marathon). The turn factor is now
  capped at a full game's length, so a normal game is unchanged while overtime / slow
  speeds / very long games can't run the figure away.
- **Hardened the population soft ceiling** against a divide-by-zero in the (today
  impossible) case of a zero ceiling.

## [2.1.0] - 2026-06-27

A population-realism release. The scaled "people" figures the dashboard shows
are completely reworked so that **every age reads at a believable historical
scale** — towns in the thousands, great cities up to ~1 million in the
pre-modern world, and true 10–38 million megacities only in the Modern age — and
the empire total is now the exact **sum of its settlements** rather than a
separate, hotter number. Existing saves are unaffected; this is presentation
only and never touches gameplay.

### Changed
- **Population scaling is now grounded in Civilization VII's own per-era growth
  formula.** The old `raw^1.11 × 90,000 × 1.009^turn` curve (which slammed late
  games into billions and reset awkwardly at every age) is gone. Each settlement
  is now valued from the game's real growth cost per era, so a settlement reads
  at a sane size for *whatever age it's in*, with a smooth, continuous hand-off
  across age boundaries (no jump when a new age begins).
- **The civ-wide Population metric is the sum of its settlements' estimates.**
  Previously the empire total used a separate, much hotter formula on the
  aggregate, which over-counted badly in the late game. It now adds up the same
  per-settlement people figures shown on the Settlements board, so "empire" and
  "sum of cities" finally agree, and the number is historically sane.
- **Per-settlement variation is now drawn from real game signals.** Two
  same-size settlements still never read identically, but the small spread is now
  derived from each settlement's actual happiness, urban/rural mix, and growth
  trend (with its identity only as a final tie-breaker) — a thriving city reads a
  touch larger than a stagnant one — instead of a bare name hash.

### Added
- **Modern megacities.** In the Modern age the largest cities can now grow into
  the real 10–38 million range, emerging gradually as the age advances rather
  than popping in at the boundary.
- **"One more turn" keeps scaling.** If you continue past the natural end of the
  game, population keeps growing into a speculative future instead of flat-lining
  at the historical cap (bounded so it can never run away).
- **The Population chart bridges age transitions.** Civ VII mechanically slashes
  settlement population when an age rolls over; the people line now smooths across
  that artificial reset so it reads as a continuous history — while still showing
  a genuine war or collapse that happens to land near the boundary.

### Internal
- A historical-anchor + age-boundary-continuity test suite, a cross-mod parity
  guard pinning the shared scaling to the **Emigration** companion mod, and an
  upper safety bound so a bad engine read can never resurrect a multi-billion
  figure. Design + review notes under `reports/`.

## [2.0.8] - 2026-06-27

A stability and quality-assurance release. No charts, metrics, or behaviour
changed for the player. This hardens how the mod stores its history and adds a
large automated test-coverage pass (around four dozen new regression harnesses)
that exercises the error paths and edge cases of nearly every screen and
subsystem, so corrupt input, missing data, and unavailable engine APIs are
handled gracefully instead of crashing.

### Changed
- **Saved-history persistence now uses a versioned envelope.** Demographics
  history is written as `{ v: 2, data: ... }` instead of a bare payload, so future
  schema changes can be migrated cleanly. Loading remains fully
  backward-compatible: legacy raw payloads from older versions are still read,
  so existing saves are unaffected.

### Added
- **Storage / persistence hardening harnesses** covering the persistence layer's
  failure modes, so a corrupt, truncated, or old-schema blob is handled
  gracefully instead of throwing: `storage-schema` (versioned-envelope shape),
  `storage-load-branches` (malformed / legacy load paths), `storage-backend-branches`
  (storage-backend availability fallbacks), `storage-cap-branches` (bounded-growth
  caps), and `governance-branches` (analytics-visibility governance paths).
- **Relations-graph coverage** — the largest area, hardening the Global Relations
  diagram end to end: `relations-queries-branches`, `relations-shared-branches`,
  `relations-settings-branches`, `relations-filters-branches`,
  `relations-filters-dom-branches`, `relations-viewer-controls-branches`,
  `relations-node-info-branches`, `relations-edges-branches`,
  `relations-edges-cs-branches`, `relations-ring-compute-branches`,
  `relations-ring-svg-branches`, `relations-ring-svg-nodes-branches`,
  `relations-ring-svg-edges-branches`, `relations-ring-svg-backdrop-branches`,
  and `relations-render-integration`.
- **Line-chart coverage** for the history graphs: `chart-line-axis-branches`,
  `chart-line-config-branches`, `chart-line-datasets-branches`,
  `chart-line-series-branches`, `chart-line-legend-branches`,
  `chart-line-plugins-branches`, `chart-line-event-markers-branches`,
  `chart-line-wonder-markers-branches`, and `chart-line-render-integration`.
- **Settlements and city-map coverage**: `settlements-pure-branches`,
  `settlements-detail-render-branches`, `settlements-render-integration`, and
  `city-map-view-branches`.
- **Radar, World Rankings and resources coverage**: `radar-data-branches`,
  `worldrankings-profiles-branches`, `resources-radar-render-integration`, and
  `options-worldrankings-render-integration`.
- **Crisis, conflicts and history view render coverage**:
  `crisis-render-integration`, `conflicts-render-integration`, and
  `history-view-render-integration`.
- **Bootstrap, registration and shared-helper coverage**: `bootstrap-branches`,
  `hardware-branches`, `screen-demographics-registration-branches`,
  `re-export-barrels-branches`, `ui-helpers-contracts-branches`,
  `camera-utils-branches`, `view-pills-branches`, and `wars-naming-branches`.
- New shared test scaffolding (`tests/_dom-stub.mjs`, an engine panel-support
  stub) so the render-integration harnesses can drive the real view code
  off-engine.
- **`scripts/required-scripts-gate.mjs`** — a script-integrity guard that fails
  the build if a required test script is missing from `package.json` or from the
  `verify` chain, so a harness can't be silently dropped.
- **`release:gate`** script chaining `required-scripts`, `verify`, and `coverage`
  into a single pre-release check.

### Internal
- Strengthened the package gates so `verify` and the coverage chain (`test:js`)
  run the new harnesses, preventing accidental script-chain regressions; the
  automated suite now runs roughly four dozen more harnesses than 2.0.7.
- Pruned generated coverage temp artifacts (`coverage/tmp`) from the working tree
  to keep local outputs reproducible and avoid stale report carryover.

## [2.0.7] - 2026-06-25

A full-codebase resolution / Interface-Size hardening pass (follow-up to the 2.0.6
ring fix), driven by an audit for every place content could clip, overflow, or
mis-scale at a non-default resolution or Interface Size.

### Fixed
- **History charts now re-fit when the window or Interface Size changes.** Every
  chart (line, war Gantt, war/crisis graphs, resources, Legacy radar) measured its
  size once and kept it; changing Interface Size or resizing while Demographics was
  open left the chart stale (overflowing or shrunk) until a metric was re-picked.
  They now re-render on resize, mirroring the relations ring.
- **Charts size to the real panel at every resolution.** Chart dimensions now come
  from the measured host (with a generous high-res / ultrawide ceiling, replacing a
  fixed 2800×1400 cap that left wide monitors under-resolved), and the line chart no
  longer falls back to a hardcoded 1920×1080 when the engine hides `window.inner*`.
- **Global Relations edge tooltips no longer clip off-panel.** The ring's edge-hover
  label was nudged a fixed amount down-right with no edge detection, so hovering an
  edge near the panel's right/bottom clipped it. It now flips to up-left near those
  edges and wraps long localized labels (same edge-flip the war graphs got in 2.0.5).
- **War / crisis graph tooltips no longer clip at a cell's left/top corner.** The
  hover tip flipped near the viewport edge but could land at a negative offset on a
  small left-column cell; it's now clamped to stay on-cell.
- **Global Relations filter legend tracks the Interface Size.** The legend and the
  City-State "viewer" dropdown were pinned at a hardcoded offset chosen to clear the
  tab/toolbar rows, but that chrome grows with Interface Size, so at larger sizes the
  legend overlapped the tabs. Their position is now measured at runtime, the legend's
  height is capped to the panel (a fixed `min-height` floor that could push it
  off-screen was removed — the same min-over-max trap as the ring), and its sample-
  line swatches scale with Interface Size.
- **Line-chart legend clears the Y axis at every Interface Size.** The overlaid
  legend used fixed offsets to clear the Y-axis labels; it now aligns to the plot's
  measured inner edge, so it never overlaps the axis numbers when they grow.
- **Settlements podium column can shrink** so the ranked list beside it isn't crushed
  (and its names hard-truncated) on a narrow frame at a large Interface Size.
- **Radar axis labels stay on-canvas.** Long localized Legacy-path labels now anchor
  inward instead of overrunning the chart's edge.
- **Small UI glyphs now scale with Interface Size.** The wonder/raze markers, town
  population bars, and population-trend arrows were fixed pixel sizes (tiny next to
  rem-scaled text at large Interface Sizes); they're now in rem. The two-line
  settlement-name clamp got a touch more headroom so a tall fallback font can't shave
  its second line.

## [2.0.6] - 2026-06-25

### Fixed
- **Global Relations diagram still clipped at the bottom on some setups.** The
  ring's bottom node (and ~20% of the wheel) could hang below the frame off-screen
  at larger Interface Sizes / shorter windows, most visibly with a full lobby
  (7–12 majors, the largest ring). Earlier fixes removed the SVG min-height floors,
  but the diagram's flex container could still resolve taller than the frame in
  GameFace, so the box itself overran the bottom edge. The view now **measures the
  visible space in pixels at runtime** (the body's top to the frame's bottom, minus
  the caption row) and caps the diagram to it — so the whole ring always fits at
  **any resolution or Interface Size**, with no hard-coded sizes. The fit re-runs on
  window resize, and the SVG keeps scaling to the capped box via `meet`.

## [2.0.5] - 2026-06-25

A correctness + robustness pass from a full multi-subsystem audit.

### Changed
- **Removed the Refresh and Time buttons from the Triumphs radar screen.** Both
  were meaningless on a snapshot view (the radar reloads when you pick a snapshot,
  and the turn/year toggle has no time axis to act on); the snapshot selector,
  Copy CSV, and Options controls remain.

### Fixed
- **CSV export dropped most rows in multi-age games.** The per-turn CSV keyed
  rows by `turn`, which resets to 1 each age, so same-numbered turns across ages
  collided and all but the last age's row was silently lost (~2/3 of rows in a
  3-age game). Rows are now keyed/sorted by the monotonic `chartTurn`, and a new
  `age` column disambiguates the (still age-local) `turn` value.
- **CSV formula-injection guard.** A player-renamed civ/leader/town name starting
  with `=`, `+`, `-`, or `@` was written verbatim and would execute as a formula
  when the CSV was opened in Excel/Sheets. Such cells are now prefixed with a
  single quote (numbers, including negative/BCE years, are left untouched).
- **Saved settings no longer freeze old defaults.** Each write baked every current
  default value into the saved slice, so a later change to a shipped default would
  never reach anyone who had ever opened the options. Only real overrides are now
  persisted (defaults are overlaid at read time); this also heals already-baked
  saves on their next write.
- **History now resets on a new game / different save.** History is stamped with
  the game seed but the seed was never checked on load, so a prior game's data
  could load into a new one (and a stale in-memory mirror could resurrect it).
  Added a seed-mismatch reset on both the stored payload and the memory mirror.
- **Settlements "Options" button vanished** after sorting/toggling inside the All
  Civilizations sub-tab, because that view clears its host on each internal
  re-render. The toolbar is now re-attached after every re-render (idempotently).
- **Chart tooltips clipped off the bottom.** The war-graphs hover tooltip and the
  Gantt tooltip only flipped horizontally; both now also flip vertically so hovers
  in the lower rows of scrollable grids stay on-screen.
- **Crisis graphs re-parsed the entire sample history on every legend toggle**
  (~8× per click). Parsed series are now cached per game, so a visibility toggle
  reuses them instead of re-walking the whole stream.
- **Global Relations diagram robustness.** An orphaned ring's deferred portrait
  placement could spin in an unbounded animation-frame loop against a detached
  node after rapid re-renders; added a liveness check and a retry cap. The view's
  in-memory filter / node-focus caches now reset when the game/save changes, so a
  second game in one session no longer inherits the previous game's selections.
- **Wrapped rows could overlap vertically.** Several `flex-wrap` containers used a
  single-value `gap`, whose row-gap GameFace drops on wrap; converted to explicit
  two-value gaps. Hardened two dropdowns (`.demographics-option-dropdown`,
  `.demographics-chart-viewer-dropdown`) against the same `min-width` >
  `max-width` overflow trap as the relations ring, and de-duplicated a conflicting
  `.demographics-option-hint` rule that resolved differently by file load order.

### Internal
- Markers that relied on `stroke-dasharray` (which Coherent ignores) had the no-op
  attribute removed and the color-based differentiation documented inline.
- Release tooling: the Workshop change-note now keeps multi-line bullet text and
  always leads with the version; the `verify` gate runs the two tests it had been
  skipping (`test:settlements-data`, `test:civ-color-utils`).

## [2.0.4] - 2026-06-25

### Fixed
- **Global Relations diagram clipped / "too big for the UI" on some displays.**
  The relations ring (the Politics & Relationships / Agreements view) is an SVG
  that scales to fit its panel, but a `min-height: 22rem` floor on the SVG
  overrode that — CSS `min-height` wins over both `height` and `max-height` — so
  at a larger Interface Size or on a short window the diagram overflowed its
  container and got cut off. Removed the SVG floor so the ring always scales to
  fit the space available. (Reported on the Steam Workshop page.)

## [2.0.3] - 2026-06-25

### Fixed
- **Critical mod-compatibility fix (dead Begin Game button / missing mod options).**
  Demographics shipped a file named `mod-options.js` — the same basename many other
  mods use for their options bootstrap. The game's UI module loader resolves these by
  basename, so Demographics' copy (which has no default export) shadowed every other
  mod's `mod-options.js`, making their option modules fail with "does not provide an
  export named 'default'". That broke the Begin Game button after the load screen and
  hid those mods' options entirely. Demographics' bootstrap is now
  `demographics-mod-options.js` — a unique name that can never shadow another mod.
  (Companion to the 2.0.2 shared-settings fix.)

## [2.0.2] - 2026-06-25

### Fixed
- **Critical mod-compatibility fix.** Demographics could wipe other mods' settings
  out of the shared options store. Mods share one `modSettings` blob (one slice
  each), and when the game's UI layer handed back a momentarily-empty or unreadable
  copy of it, Demographics wrote back only its own slice — deleting every other
  mod's saved options. The visible result was other mods (e.g. Classic Leader
  Screens, Dynamic Main Menu, Flag Corps, Map Trix) behaving as if uninstalled and,
  in some setups, the "Start Game" button doing nothing after the load screen.
  Demographics now re-reads on an empty result, refuses to write when the shared
  store can't be safely read, and only ever touches its own slice — so it can never
  drop another mod's settings.

## [2.0.1] - 2026-06-24

### Changed
- UI now scales cleanly across resolutions. Tab rows (the Geopolitics / Global
  Relations tabs and every other tab bar) could overflow past the window edge at
  lower resolutions or with long localized labels; each tab now shrinks to share
  the available width instead of spilling off-screen. The Global Relations filter
  legend, the Settlements podium/advisor cards, and the inline dropdowns likewise
  clamp to the panel so they never run past a narrow frame.

### Fixed
- Hardened the Options-screen category bootstrap that runs at the main menu: its
  writes to the engine's shared Options model are now fully guarded, so a future
  game patch that reshapes that model can no longer throw there and take the main
  menu down with it.

## [2.0.0] - 2026-06-23

### Fixed
- Crisis Impact's per-civ losses (Population / Crop / Production Lost) blanked out
  to "—" when an earlier age's crisis was viewed from a later age, leaving only
  Military Power. Those figures are sums of per-turn declines, so they need dense
  samples — but old samples are decimated as the game grows, and recomputing from
  the thinned stream loses the dips (while one-sample figures survive). Each age's
  per-civ **cumulative crisis cost is now snapshotted at the age boundary**, while
  that age's samples are still dense (alongside the existing triumph snapshot), and
  the Crises page renders a finished age's cumulative + the cross-age overall block
  from the snapshot, falling back to live computation for the current age. (Per-stage
  tables still compute live; the confirmed symptom was the cumulative/overall.)
- War names used the player's **current-age** civilization instead of the civ
  they were when the war happened (a player is Han in Antiquity but Qajar in
  Modern, yet an Antiquity war showed as "Qajar"). War rosters were re-stamped
  from the live (current) civ every sample — and never cleared on war end — even
  though a player's civilization changes each age while history persists across
  ages. Roster civ identity is now pinned to the war's **start age**, re-derived
  from the recorded sample at the war's start chart-turn, which also corrects
  existing saves on the next sample.

### Added
- Companion-mod metric hook (`globalThis.DemographicsMetricsAPI` with
  `registerMetric` + `registerMetricToPage`). Lets a separate mod contribute a
  metric that flows through the normal sample → store → line-chart pipeline and
  appears on a chosen Historical Data page. Inert unless another mod calls it, so
  base behavior is unchanged. The handshake is load-order-independent: this module
  is dynamic-imported (after `engine.whenReady`), so it drains any registrations a
  companion mod queued before it loaded. (Used by the companion **Emigration** mod
  to add a net-migration graph next to Population.)
- Companion-mod **panel** hook (`DemographicsMetricsAPI.registerPanel`). Beyond a
  line-chart metric, a companion mod can contribute a whole **page** whose body it
  renders itself: the Historical Data screen adds it as its own page/tab and hands the
  companion's `render(container, ctx)` callback a container (the time-filter and CSV
  toolbar are suppressed for these custom pages). Inert unless called; the base mod
  gains no dependency on the companion. (Used by **Emigration** to add a dedicated
  Migration dashboard page.)

## [1.3.0] - 2026-06-09

### Fixed
- Crisis Impact tab: each age's crisis now stays bounded within its own age, so the antiquity crisis's "Ends" stage and its per-age cumulative impact keep their real values after you advance into Exploration (previously they went blank because the window ran into the next age's reset turn numbers). A separate "Overall crisis impact across all ages" total now appears only once crises exist in two or more ages (i.e. after the Exploration crisis occurs). Crisis-stage detection also no longer mistakes a crisis level lingering from the previous age into the new age's first turns for a fresh crisis — it waits for that age to report a pre-crisis reading first — so a phantom next-age crisis no longer appears before the real one begins.
- Historical Data charts no longer collapse at the start of a new age. GDP and Population dropped toward zero at every age boundary because their era-scaling used the age-local turn (`Game.turn`), which restarts at 1 each age — they now scale off the monotonic chart turn and stay continuous. Techs, Civics, and Score (which falls back to techs + civics) reset to 0 each age because each age has its own fresh tech/culture tree; they are now carried forward cumulatively across ages. Trade Routes still step down at an age boundary, which is correct — routes genuinely end at the age transition.

### Improved
- Release packaging now ships readable JavaScript by default. Dist minification is opt-in via `MINIFY_DIST_JS=1` in `release.sh`.
- Workshop and README copy now state the readable-source release posture and companion `triumphs-progress-overlay` split.

### Internal
- Wave 2 refactor decomposition expanded across major view controllers:
	- Settlements split into detail, civ ranking, showcase, and table modules.
	- Relations name-map and city-state node-info extraction moved into `relations-node-info.js`.
	- Options storage controls and action controls moved into dedicated modules.
	- History chart host/render routing moved into `view-history-chart-render.js`.

## [1.2.0] - 2026-06-05

### Added
- Wonders overlay: destroyed wonders are now marked. When a wonder is lost because its city is razed, a marker appears on that civilization's line at the turn it fell — the wonder icon, dimmed, with a small burning raze badge — alongside its existing "built" marker. Hovering shows the wonder name and a "Destroyed · Turn" line.

### Fixed
- Radar graph: the Refresh button no longer shows a missing-glyph box ("[]") in front of the label. The unsupported icon character was removed in every language.
- Options screen: the sample-cap and poll-interval choices no longer show a missing-glyph box ("[]") before their performance caveats; the caveats now read as plain parentheticals (e.g. "Unlimited (very large saves, may slow performance)"), in every language.

### Improved
- Faster Demographics screen (lazy loading): the heavy All Civilizations and Global Relations tabs, and the Conflicts charts (the wars timeline and the per-war graphs), now load on demand the first time you open them, instead of all being parsed when the screen first opens. The default Historical Data view is unchanged.
- Smaller download and faster load (minification): shipped builds are now minified, cutting the mod's JavaScript size by roughly 70% (about 1.0 MB down to 0.3 MB) with no change in behavior.

### Internal
- Dead-code removal: deleted the unused in-screen triumph charts (`chart-triumphs.js`, ~1,080 lines) together with their now-orphaned CSS (~380 lines) and leftover view state — about 1.5k lines in total. The native Triumphs decorator is unaffected.
- Build pipeline (minification): `release.sh` now minifies every shipped JS file in place (esbuild, per-file transform) while preserving the module layout and import paths, and constant-folds out the debug logging. Source stays unminified and readable; only the shipped `dist/` copy is minified, so players never need any build tooling.
- Loading architecture: the chart barrel (`demographics-chart.js`) now imports the heavy Conflicts charts on demand via `ensureChartForMetric`, and the screen imports the All Civilizations/Relations tab modules on first open — replacing the previous all-at-once static imports.

## [1.1.12] - 2026-06-04

### Fixed
- Historical Data line charts: crisis stage markers now recover missing intermediate stage labels when sampled data jumps across crisis stages between turns, so the second stage label no longer disappears while the crisis line continues.
- Historical Data line charts: crisis labels now render above age-boundary labels, preventing the later age pill from covering a crisis label at the same horizontal position.
- Historical Data line charts: crisis stage detection now scans every player row in a sample and uses the highest valid crisis stage, avoiding missing onset labels when one row carries a stale lower value.
- Historical Data filters: year-relative windows now scan the mapped chart-X domain correctly instead of reading an undefined sample field, so 25/50/100/300/500/1000-year filters clamp to the intended range.
- History storage: late-game decimation now preserves the latest age by age tag instead of relying only on legacy boundary-turn comparisons, reducing the risk of thinning current-age samples.

### Improved
- Historical Data line charts: crisis marker layout now stacks overlapping crisis labels into separate lanes instead of drawing one label directly on top of another.
- Historical Data line charts: font resolution across config, crisis markers, age markers, and plugin overlays now uses the same guarded fallback path, keeping chart text stable even if the Chart.js global is unavailable or partially initialized.
- Historical Data line charts: focus glow respects skipped points, preventing the highlight overlay from bridging across gaps that the underlying Chart.js line does not connect.

### Internal
- Refined the line-chart time and crisis marker pipeline to keep chart-X mapping, time-range filters, and marker overlays aligned under the new persisted `chartTurn` chronology model.
- Reworked decimation and crisis helper structure to satisfy the mod's complexity and verification gates without changing user-facing behavior.

## [1.1.11] - 2026-06-04

### Improved
- Global Relations: the Major Civilizations ring is now centered higher in the panel, so the diagram reads as centered on the window instead of sitting low beneath the tab row.

### Documentation
- The Workshop description now details the Conflicts and Crises views — the war Gantt timeline and per-war graphs, and the staged crisis severity bars, per-stage cost tables, and crisis graphs.

## [1.1.10] - 2026-06-03

### Fixed
- Line charts: civilizations with near-black banner colors (e.g. Alexander) are now drawn in their secondary banner color when that reads better against the dark chart background, so their line, label, and value no longer disappear. If neither banner color is readable, the color is lifted to a visible tone preserving its hue.

### Improved
- Line charts: a global pass now keeps every civilization's line color visually distinct — when two civs would otherwise share a near-identical color, the lower-priority line is reassigned to a well-separated color so lines never blur together. In extreme cases (banner colors that collide or can't be made readable) the chart falls back to arbitrary, evenly-spread colors.
- Wars timeline: war labels for conflicts involving a near-white-bannered civilization now render in red so the label stays legible against the cream-on-dark default.

### Thanks
- **renouf** — for reporting the unreadable dark line colors (a black Alexander line on the dark background) that prompted all of the chart color-readability work in this release.

## [1.1.9] - 2026-06-02

### Added
- Relations legend titles for both Global Relations tabs:
	- Major Civilizations
	- City States
- New chart-line sibling modules to continue the monolith split:
	- `chart-line-axis.js`
	- `chart-line-config.js`
	- `chart-line-event-markers.js`
	- `chart-line-plugins.js`
	- `chart-line-tooltip.js`

### Improved
- Overhauled the war-titling system on the Wars timeline so generated conflict names read consistently and avoid repetitive/misleading labels across ages.
- Reworked long-war duration naming: rare/accurate suffixing, realistic rounded spans, and strict "Hundred Years' War" gating.
- Improved chart and relations tooltip readability and presentation so hover details are clearer and more consistent across views.
- Continued reducing `chart-line.js` size and surface area by extracting cohesive subsystems without behavior changes. The line chart architecture is now split into focused modules for axis math, config shape-builders, overlays, and tooltip rendering.
- Global Relations overlay layout polish:
	- Viewer label/dropdown placement no longer clashes with panel framing.
	- Viewer controls and legend now align on the same horizontal plane (viewer on left, legend on right).

### Fixed
- City-State Global Relations viewer control positioning so the "Viewer" label and dropdown do not collide with the border frame.
- Selector-scoping bug where a viewer-position rule could affect tab-header layout; now isolated so only the viewer host receives that positioning.
- Resolved multiple war-graph rendering bugs affecting timeline labeling and edge-case display behavior.

### Internal
- Updated remediation tracking for the chart-line split workstream and synchronized extracted module references in docs.
- Release changenote source now reflects all bullets in this section so Steam Workshop updates show the full change list for this upload.

## [1.1.8] - 2026-06-01

### Improved
- Larger crisis-marker text on the history charts: both the crisis stage/year note and the crisis name are easier to read.

### Fixed
- War-tab labels now stay readable over any civilization bar color — including white, black, or a black+white mix — via a crisp dark text outline.

### Internal
- Continued breaking up the `chart-line.js` monolith: extracted the history→series pipeline (`chart-line-series.js`) and the series→dataset shaping (`chart-line-datasets.js`). Behavior-identical; `chart-line.js` is now roughly 432 lines, down about 82% from the original ~2,394.

## [1.1.7] - 2026-06-01

### Added
- Met-history reveal mode: a new Options sub-toggle under "Hide unmet civ stats" that chooses, once you meet a civilization, whether to reveal its entire history (default) or only data from first contact forward.

### Fixed
- The line chart now reveals a civ's full history the moment you meet them, instead of being stuck showing only data from the meeting turn forward (now consistent with the Radar and All Civilizations views).
- Greatly reduced settings log spam: the shared `modSettings` localStorage blob is parsed quietly with a single warning per session instead of an error on every settings write.

## [1.1.6] - 2026-05-31

### Added
- Full localization across 10 languages (English, German, Spanish, French, Italian, Japanese, Korean, Portuguese, Russian, Chinese) with a `t()` helper and locale-gated text loading.
- War history rebuilt on real data: cumulative participation roster (join / leave / active), per-participant cost accounting, "withdrew" markers, and sides labeled by civilization name instead of "Attackers/Defenders".
- Unmet-civ spoiler guard as a reversible Options toggle (`hideUnmetStats`, default on): diplomacy, influence, and relations values are withheld for civilizations you have not met, with charts eliding rather than showing zero.
- One-time downsampling notice plus a read-only history-cap and decimation status line in Options.
- MIT license.

### Changed
- Localized and credibility-hardened crisis names, with native-speaker passes across all languages and renames to avoid charged real-world references.
- Moved the spoiler guard from sample-time to display-time so the toggle is fully reversible without re-sampling.
- Adopted an honest persistence model: history persists within an age (cross-age state does not survive current engine builds) and the UI states this plainly.
- Relabeled the sample-frequency setting as the performance control (lighter per-turn work on slow machines or long games).
- Audited all README and Workshop claims for accuracy.

### Fixed
- Replaced fabricated war casualties and battle counts with data-backed per-side war costs.
- Fixed a `cumulativeOffset` ReferenceError in the war-timeline age offsets.
- Settings shared-namespace defense: stamp a schema version into the persisted slice and warn once if it returns missing-amid-siblings, malformed, or version-mismatched.

### Internal
- Split monolithic files into roughly 15 typed modules (barrel re-exports), holding zero TypeScript, ESLint, and complexity/length violations.
- Migrated static inline styles to CSS classes mod-wide.
- Defaulted all debug flags off in source and removed a debug-only Triumphs probe.
- Added a `release.sh` zip allow-list audit so stray files cannot ship.

## Earlier releases (pre-1.1.6)

Initial public releases established the core read-only analytics dashboard:
Historical Data time-series (Economy / Power / Knowledge & Influence / Triumphs)
with per-civ colors, time-range filters, smoothing, and CSV export; the World
All Civilizations current-values-and-ranks view; the Global Relations ring; and Triumph
card progress overlays. Detailed per-version notes predate this changelog.
