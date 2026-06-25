# Changelog

All notable changes to the **Demographics** mod for Civilization VII. Loosely
follows [Keep a Changelog](https://keepachangelog.com/) and Semantic Versioning.
The Steam Workshop change note for each release is generated from the matching
section below by `release.sh`.

## [Unreleased]

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
