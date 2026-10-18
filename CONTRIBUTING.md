# Contributing

Demographics is a read-only Civilization VII UI mod. This page covers the setup, the one check to run before you
submit, and the conventions the code follows.

## Typed JavaScript, no build step

The mod is typed JavaScript, not TypeScript. Civilization VII loads `.js` files directly into the Coherent GameFace
engine at runtime; there is no transpile step, and what ships is what you wrote (no minification, no generated output).
Types come from JSDoc annotations checked by `tsc --noEmit` (`checkJs`), so the `/** @param … */` blocks are the type
system. Keep them on exported functions and anywhere a type isn't obvious. Don't add `.ts` files or a build step.

## Setup

```sh
npm install
```

## Before you submit: `npm run verify`

```sh
npm run verify
```

This must pass with zero errors and zero warnings. It runs:

1. `tsc --noEmit`: JSDoc type checking (`checkJs`).
2. `eslint ui`: style and size limits.
3. every test in `tests/`, including the worst-case History load test `tests/history-stress.mjs`.

`npm test` runs `tests/run-all.mjs`, which finds every test file in `tests/` by itself, so a new test runs as soon as it
exists. `node tests/run-all.mjs relations chart` runs only the files whose names contain one of the words given.

## Style limits (enforced by ESLint)

- cyclomatic complexity ≤ 10
- max statements per function ≤ 18
- max nesting depth ≤ 4
- max parameters ≤ 5 (bundle extras into a single options/context object)
- max lines per function ≤ 50, per file ≤ 500
- line length ≤ 120 (strings, templates, regular expressions and URLs exempt)

When a function trips a limit, prefer extracting a small, named helper or a context object over disabling the rule.

## Conventions

- Engine access is defensive. The GameFace API surface can be absent or throw (`Camera`, `UI.Player`, `Stats` and
  others may be undefined). Guard with `typeof X !== "undefined"` or the local `safeCall` wrappers and degrade; never
  assume an engine global exists.
- Persistence. History is stored in the GameConfiguration KV store (`Configuration.editGame().setValue` /
  `getGame().getValue`), seed-stamped and self-resetting on a new game. Settings live in the shared `localStorage`
  `modSettings` key: only ever write the single `demographics` slice, and never add a second top-level `localStorage`
  key, as other mods wipe `localStorage` when they see more than one.
- Localization. User-facing strings are LOC keys resolved via `t()`; never hardcode display English in `.js`. Every
  new tag goes into `en_us` and all 10 other locales under `text/<locale>/ModText.xml` to keep tag parity (a tag
  missing from a locale renders as the raw `LOC_...` string there); a non-English `<Text>` may be an English
  placeholder pending translation. Metric names resolve from `LOC_DEMOGRAPHICS_METRIC_<ID>`, not the `label` in the
  metric registry. Some tags are base-game-owned and absent on purpose (`BASE_GAME_LOC_KEYS` in
  `ui/core/demographics-i18n.js`). Full workflow: [`text/README.md`](text/README.md).
- Styling. The mod's CSS custom properties start with `--dg-`, so it styles only its own screen and never reads or
  overrides another mod's variables.
- Comments explain why (engine quirks, workarounds), not what. Keep internal ticket and process references out of
  shipped code.

## Naming

- Functions and methods are camelCase and start with a verb; classes are PascalCase; constants that never change
  are UPPER_SNAKE_CASE; files are kebab-case. Shared singletons (`log`, `viewState`) are camelCase like any object.
- Booleans read as a yes/no question: `isOwn`, `hasMet`, `shouldReveal`.
- Names say what the thing is. No abbreviations a reader has to decode (`player`, not `pl`; `format…`, not `fmt…`),
  and single letters only for loop counters, short comparators and conventional math (`x`, `y`, `r`, `g`, `b`).
  `pid` (a player id) and `ctx` (a context object) are fine: the game and the codebase use them everywhere.
- Exported names never start with `_`. An export is part of the module's surface; if it exists only for tests, say
  so in its name (`_resetForTests` is the one pattern kept).
- Verbs keep one meaning across the mod:

| Verb | Means |
| --- | --- |
| `read…` | reads the engine (`Players`, `GameInfo`, `Configuration`) and returns plain data |
| `collect…` | the sampler gathering one turn's figures for a player |
| `compute…` | pure math on data already read; no engine or DOM |
| `resolve…` | looks something up, with a fallback when it is missing |
| `get…` | returns stored state or a setting |
| `format…` | turns a value into display text |
| `build…` | creates and returns a DOM element (or a data structure) without attaching it |
| `render…` | fills a host element the caller passes in |
| `draw…` | draws into an SVG or canvas |
| `make…` | returns a configured function or object (a factory) |

- Some names are stored in players' saves and settings, or read by other mods, and never change: the mod id,
  every `LOC_` tag, the settings and storage keys, the save-data keys (including the one-letter history event fields
  described in `types/history.d.ts`), and the globals `DemographicsMetricsAPI`, `DemographicsData` and
  `DemographicsLiveRefresh`. Renaming one needs a migration.
- File names keep their `demographics-` prefix where they have one. The game's module loader can confuse two mods'
  files with the same name (Demographics once broke other mods by shipping `mod-options.js`), so a generic name
  that another mod might also use should carry the prefix.

## Project layout

```
ui/
  demographics-bootstrap.js   entry UIScript (engine.whenReady → load decorator + sampler)
  core/        cross-cutting infra (settings, contracts, i18n, audio, palette, a11y, dock decorator)
  metrics/     metric registry, helpers, formatting
  sampler/     per-turn sampling + collectors + war/age tracking
  storage/     history persistence (backend, load, schema, retention, cap)
  screen-demographics/
    screen/ charts/ views/ camera/ settlements/ styles/
  history/     History tab and Hall of Fame
    core/      logging, text (t() with saved-text fallback for the main menu), DOM helpers, game icons
    capture/   per-turn world reading and diffing, crises, disasters, territory-map frames
    store/     campaign document (GameConfiguration) and Hall of Fame archive (localStorage slice)
    model/     timeline, territory map, narration, Hall of Fame rankings (pure, unit-tested)
    views/     Chronicle, Timeline, Lineage, Hall of Fame pages, map canvas
    screen/    main-menu Hall of Fame screen and button (shell scope)
text/<locale>/ModText.xml     localized strings (11 locales)
devtools/                     development-only views and probes, never shipped
```

## Screen size and small screens

The screen is laid out once against a 2880x1800 reference and drawn through one `transform: scale(s)`, with `s` taken
from the window height and kept between 0.7 and 1.3 (`ui/core/demographics-font-ladder.js`). Text has its own floor:
below a 0.82 scale the type ladder is boosted so text never draws smaller than it would at 0.82. Size spacing,
portraits and icons in `--dg-u`, which follows the layout, and a box that exists to hold a word in `--dg-t`, which
follows the text.

Every window under 1260 px tall sits at the 0.7 floor, so 1920x1080, 1600x900, 1366x768 and 1280x720 all draw text at
the same size and only the frame's own size changes: 2633 local px wide at 1080p, 1755 at 720p. The boards that split
their width between many columns run out of room for their words first. A layout scale below 0.7 doesn't fix that:
the columns share a fixed slice of the screen and the text in them can't shrink, so it buys only a few percent per
column at 720p while it shrinks the portraits, icons and chart labels that don't follow the type floor.

So the small-screen lower bound is about content, not scale. When the frame's own width is under 2000 local px
(1366x768, 1280x720, 1280x800 and windows that size), `applyVisualScale` puts the `dg-compact` class on the frame, and
the last block of `screen-demographics-density.css` makes room on the boards:

- names and headings step down one size, never below body text;
- portraits beside names in the ranked lists and tables drop, and the row's color stripe and the names stay;
- Settlement Rank by Yield drops its Type column, since the All, Cities and Towns chips still split them;
- table column headings wrap onto two lines at one size, with shrink-to-fit only as a last resort;
- the Civilization Rank by Yield grid's row headings drop their icons;
- a name that can still be cut shows its full text as a tooltip (`buildNameLine`, `applyCompactTooltip`).

1920x1080 and larger look exactly as before, for four reasons: `isCompactViewport` is false for any window at least
1920x1080, the scale and frame-size formulas haven't changed, every rule in the small-screen block is scoped to
`.dg-compact`, and the tooltips are only added with it. `tests/compact-layout.mjs` checks all four, including a sweep of
window sizes from 1920x1080 to 5120x2880. A new small-screen rule goes in that block, scoped the same way, without a
`font-family` (the Chinese, Japanese and Korean font lists come from the generated locale stylesheet).

## Trying a change in game

The game runs plain copies from its Mods folder, not the repo. `node scripts/deploy.mjs` replaces `Mods/demographics`
with the files that ship, and `node scripts/deploy.mjs --check` reports a stale copy. Files under `ui/history/screen/`
and the shell group of `demographics.modinfo` load at the main menu, where only setup text and no game data exist;
`tests/modinfo.mjs` checks that nothing in that group imports game-only code.

## Measuring the cost of a turn with Emigration

When late-game turns feel heavy with both Demographics and Emigration on, split the cost before changing anything. On a
turn where both mods run, the debug logs report Emigration's migration pass duration and Demographics' sample duration;
opening the Emigration tab exercises the render code the two share. Comparing those three says whether a slow turn is
the Emigration pass, the Demographics sample or the embedded page. The bridge between the mods is a thin read-only
layer over each mod's existing tallies, so it is rarely the cause.

## Releasing

`./release.sh` produces the upload zip. It mutes debug logging in the dist copy and ships readable JS; there is no
minification path. The shipped file layout matches the dev tree.

## License

Changes go under the same terms as the mod: the Tower Mod License 1.0 in [LICENSE](LICENSE), with `ui/core/settings-keeper.js` under
MIT. By sending a change, you agree I can release it under those terms.
