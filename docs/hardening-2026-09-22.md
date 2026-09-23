# Hardening pass, 2026-09-22 (2.7.3)

What was audited after the shared-storage bug, what changed, what was watched in game and what was not. The
question behind the pass was "how do we stop breaking the mod the way the storage bug broke it": not one more
guard, but the classes of failure the existing gates (tsc, eslint, the node harnesses, mutation testing) cannot see
because they only ever run the mod's own code against the mod's own fixtures.

## The three classes the gates could not see

1. Contracts with resources the mod does not own. The shared `modSettings` entry in localStorage, the GameConfiguration
   document in a networked game, Chart.js globals, CSS custom properties on `:root`, the base game's DOM hooks for the
   endgame button. A unit test cannot tell you that another mod erases the store when it holds two keys.
2. Data the mod did not write. Records and samples left by an older or newer build, by another mod's slice, or by a
   truncated save. The array was type-checked everywhere; its elements were trusted everywhere.
3. Code that runs outside the render boundary. Click, hover, resize and timer handlers re-enter the renderers after
   the initial render's try/catch has returned. A throw there reaches the engine's dispatcher and the panel stays
   blank with no message.

## What changed

### Shared storage (localStorage `modSettings`)

- A read that throws is no longer treated as an empty store. Both writers (settings and the Hall of Fame archive)
  now tell a throw apart from an empty value, re-read once on empty, and refuse to write when the store reports rows
  but the read is empty. Before, one throwing read followed by a working write replaced the whole shared entry with
  Demographics' slice alone.
- Every settings write is read back. If the read-back does not contain Demographics' slice with its schema stamp,
  the session goes read-only (memory still serves reads). Under the first-key bug this bounds the damage to one
  write instead of copying the foreign value into the shared entry on every option change.
- The Hall of Fame storage note shows the settings persistence state (kept in memory only, storage unavailable)
  with Repair storage named as the fix. Localized in all eleven languages. The same line was first added to the
  in-screen Options view's footer before the audit found that view is mounted by nothing but a test (see "Dead
  views" below), so the note went where players actually look.
- A newer schema stamp on the slice is kept, not lowered; an array under the slice id is ignored.
- Gate: `tests/storage-invariants.mjs` fails any write of a top-level key other than the shared one, any reset of the
  shared entry, any `clear()` outside the repair, and any write that is not preceded by a read in the same function.

### Save-persistent data (GameConfiguration)

- Downgrade protection. A history, campaign or settings value the current build cannot use (newer version, parse
  failure) is parked under `<key>__rejected` before the empty replacement is written, and restored on a later load by
  a build that can read it. Before, the next turn's save overwrote it for good.
- Payload budget. The serialised history is decimated further above 3 MiB and logged on every save above 6 MiB; the
  size is recorded on the storage instance and shown by the storage controls. No engine limit is known; this keeps
  the save from growing without bound in a long twelve-civilization game.
- The in-memory mirror is no longer written into an empty store that belongs to a different game (the seed guard
  the parsed path already had now applies to the empty path).
- Hall of Fame records with a newer version survive merge, eviction and the byte cap untouched and are not rendered.
- Multiplayer: the effective analytics policy is published under a per-seat key; the shared key is written only by
  the host or in a single-machine game. Emigration 3.1.2 reads the per-seat key first.

### Render boundaries and element guards

Every view and every re-render path reached from a handler now has a logged boundary and shows "Chart failed to
render" (`LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED`) in place of an empty panel: `renderActiveView`, the Rankings
sub-views and their sort/toggle closures, Relations `repaint`/`repaintRing`, hover and resize, the History tab and
Hall of Fame (whose detail page now appends Back before anything that can throw), the timeline redraw, playback tick
and ruler handlers, the map legend, the Conflicts re-render thunks, the Gantt hover, and the Chart.js plugin hooks.
Null or partial elements inside persisted arrays (samples, wars, players, crisis snapshot columns, archive records,
campaign series) are filtered or defaulted at every consumer the audit listed; each guard has a harness assertion
and was mutation-checked by reverting it.

### Lifecycle

- The unmounted in-screen Options view (Clear history, Reset war history, forced sample, storage knobs, session
  readout) moved out of the shipped mod to `devtools/options-view/`; its destructive buttons are two-click armed
  there, because `window.confirm` does not exist in GameFace.
- The sampler kill switch counts consecutive failures; the age-boundary debounce is keyed by seed and reset on start;
  founding stamps and capture listeners are cleared on a new game or UI reload; Chart.js instances are destroyed on
  close; the relations view drops its module-level references on close.
- Escape closes the Demographics screen the way it closes the Hall of Fame (not yet watched).
- A cinematic tour interrupted by an interface-mode change (End Turn, diplomacy) restores the camera without
  reopening Demographics (not yet watched).
- The endgame entry logs one error naming the missing selector when the end-of-game screen mounts without its action
  row, and ignores text nodes in its observer.
- CSS custom properties are prefixed `--dg-ia-`.
- Chart.js globals: the base game's `fxs-hof-chart.js` sets the same four values process-wide, so the mod keeps
  setting them (verdict recorded in `chart-line.js`); the two extra keys it set are gone.
- The end-of-age settlement archive builds a lite board per turn (no constructible-name scan, no build-queue read);
  persisted values are unchanged and pinned by test.

### Release gates added

| Script | Fails when |
| --- | --- |
| `test:storage-invariants` | any localStorage write that breaks the single-shared-key contract |
| `test:core-imports` | a `/core/...` or `/base-standard/...` import does not exist in the installed game (skips without the game) |
| `test:loc-keys` | a LOC key referenced in code is not in `text/en_us` or the base-game registry |
| `test:control-assets` | a `Controls.define` asset is missing on disk or from the modinfo group that loads it |
| `test:modinfo` | a runtime import cycle exists (new check) |

## Watched and not watched

Harness verdicts are not game verdicts. The full `npm run verify` chain is green. The items below still need an
in-game observation before they count as fixed; the smoke run in `devtools/mp-probe` covers the first group.

Watched in the smoke run `devtools/mp-probe/runs/20260922-222523` (hotseat, two human seats, three turns, every view
and Rankings sub-tab, History pages, the Hall of Fame note, a synthetic Cancel engine-input, the stored payload and
policy keys): every view rendered with zero fallbacks and zero mod error lines, the store held exactly one row before
and after, the screen closed on the synthetic Cancel, the per-seat and shared policy keys were written, and no crash
report was produced.

Not watched, needs a hand on the keyboard:

- Escape closing the Demographics screen (a synthetic engine-input event is not a real key).
- The cinematic tour interrupted by End Turn not reopening the screen.
- The endgame button on a real end-of-game screen after a game patch.

## Not fixed: needs a two-client networked game

- Every client writes the full sample history into GameConfiguration every turn (host-gated for the campaign since
  2.7.2, not for the history payload). Whether a guest's write reaches the host, and whether it is what crashed the
  reported multiplayer game, cannot be told from one machine. Cheapest test: two clients on a LAN, guest ends a turn,
  host reads `Demographics__demographics-history-v1__json` and checks the `met` flags for the guest's viewpoint.
- Hotseat: `met` flags in a sample come from whichever seat sampled last, and the archive record is built for the
  first seat of each turn. Two designs are written up in `sampler-collectors-core.js` at the `collectMet` comment.

## Dead views found on the way

`ui/screen-demographics/views/options/` was imported by tests only; no screen had mounted it since the settings moved
to the native Options screen on 2026-06-19. What it still held was development instrumentation (forced sample,
Clear history, Reset war history, storage knobs, a session readout), so it moved to `devtools/options-view/` with its
harness and README, out of the deploy and release sets. `ui/screen-demographics/views/settlements/view-settlements-detail.js`
is likewise imported by a test only (BACKLOG).

## Verdict on "never again"

The storage bug was a contract with a shared resource that no test in the repo modelled. The four new gates model the
contracts the audit found (single shared key, base-game module paths, LOC keys, control assets, import cycles). The
class that remains unmodelled is engine behaviour that differs from the documented API (the first-key read bug
itself); for that the only defence is the read-back after every write and the refusal to write what was not read,
which are now the rule in both writers.
