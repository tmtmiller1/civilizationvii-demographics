# Changelog

All notable changes to the **Demographics** mod for Civilization VII. Loosely
follows [Keep a Changelog](https://keepachangelog.com/) and Semantic Versioning.
The Steam Workshop change note for each release is generated from the matching
section below by `release.sh`.

## [1.2.0] - 2026-06-05

### Added
- Wonders overlay: destroyed wonders are now marked. When a wonder is lost because its city is razed, a marker appears on that civilization's line at the turn it fell — the wonder icon, dimmed, with a small burning raze badge — alongside its existing "built" marker. Hovering shows the wonder name and a "Destroyed · Turn" line.

### Fixed
- Radar graph: the Refresh button no longer shows a missing-glyph box ("[]") in front of the label. The unsupported icon character was removed in every language.
- Options screen: the sample-cap and poll-interval choices no longer show a missing-glyph box ("[]") before their performance caveats; the caveats now read as plain parentheticals (e.g. "Unlimited (very large saves, may slow performance)"), in every language.

### Improved
- Faster Demographics screen (lazy loading): the heavy World Factbook and Global Relations tabs, and the Conflicts charts (the wars timeline and the per-war graphs), now load on demand the first time you open them, instead of all being parsed when the screen first opens. The default Historical Data view is unchanged.
- Smaller download and faster load (minification): shipped builds are now minified, cutting the mod's JavaScript size by roughly 70% (about 1.0 MB down to 0.3 MB) with no change in behavior.

### Internal
- Dead-code removal: deleted the unused in-screen triumph charts (`chart-triumphs.js`, ~1,080 lines) together with their now-orphaned CSS (~380 lines) and leftover view state — about 1.5k lines in total. The native Triumphs decorator is unaffected.
- Build pipeline (minification): `release.sh` now minifies every shipped JS file in place (esbuild, per-file transform) while preserving the module layout and import paths, and constant-folds out the debug logging. Source stays unminified and readable; only the shipped `dist/` copy is minified, so players never need any build tooling.
- Loading architecture: the chart barrel (`demographics-chart.js`) now imports the heavy Conflicts charts on demand via `ensureChartForMetric`, and the screen imports the Factbook/Relations tab modules on first open — replacing the previous all-at-once static imports.

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
- The line chart now reveals a civ's full history the moment you meet them, instead of being stuck showing only data from the meeting turn forward (now consistent with the Radar and Factbook views).
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
Factbook current-values-and-ranks view; the Global Relations ring; and Triumph
card progress overlays. Detailed per-version notes predate this changelog.
