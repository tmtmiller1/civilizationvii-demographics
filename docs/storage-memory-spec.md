# Storage and memory work: implementation specification

Status: specification only, nothing built, nothing watched. Written 2026-11-01 against 87865a9 and checked against
8c932a7 (main, pushed), which carries the Hall of Fame file store, the blocked-store recovery and the repair sheet
as a layer; the tree is clean at that commit. The analysis it comes from is summarised in section 0; the rest is what
to build, in what order, and what each change does to saves written by older and newer copies of the mod.

Terms used throughout:

- "history": the per-turn sample stream the sampler keeps in the save under the GameConfiguration key
  `Demographics__demographics-history-v1__json` (`ui/storage/`).
- "campaign": the chronicle document under `Demographics__history-campaign-v1` (`ui/history/store/`).
- "archive": the Hall of Fame slice in `demographics-halloffame.sqlite`, or in `modSettings` when the file can't be
  used (`ui/history/store/history-archive-store.js`).
- "old build": any released Demographics up to and including 2.10.0, and the unreleased file-store build at 8c932a7.
  "New build": the build that ships this work.

## 0. Compatibility summary

Only item 4 changes a format on disk. Everything else changes when and how often the same bytes are written.

| Item | Old save opened by the new build | Save written by the new build, opened by an old build | Data loss | Player-visible change |
| --- | --- | --- | --- | --- |
| 1. Drop the town trend write | Reads fine; the stale `townTrendBuf` key is deleted from the settings slice on the next write | Old build sees no `townTrendBuf` and never wrote one it reads | None (the value had no reader) | None |
| 2. One history load per turn | No format change | No format change | None | Shorter turn end |
| 3. Hall of Fame write cadence | No format change | No format change | A crash loses up to N turns of Hall of Fame progress for a game whose save is older than that anyway | Hall of Fame row catches up on the next load |
| 4. Packed history (schema v2) | Reads v1, saves v2 from the first turn on | Old build can't read v2: it parks it under `json__rejected_v2`, shows empty charts for that game, and starts a fresh v1 history. Upgrading again restores the v2 history; turns played on the old build stay parked | On downgrade only, see 4.5 | Charts keep more history before thinning |
| 5. Housekeeping | No format change | No format change | None | None |
| 6. Screen reads the sampler's copy | No format change | No format change | None | Faster screen open |
| 10. Five small fixes (section 10) | The hidden `persistenceMode` key is deleted from the settings slice on the next write | Old build reads a slice without a key it only read when set by hand | None | One settings write per click; a history-size line on the Hall of Fame |

The settings slice, the campaign document, the archive slice and the archive file formats are untouched by every item.

## 1. Remove the town trend buffer write

### 1.1 Today

`doSample` (ui/sampler/demographics-sampler.js, the `recordAuxHistory` call) persists `townTrendBuf` through
`DemographicsSettings.setSettings` on every sampled turn. One `setSettings` is: `readRootForWrite` (one or two
`getItem` reads of the shared `modSettings` row, about 6.5 ms each on a 0.5-0.8 MB row, plus a parse),
`sliceToPersist`, `JSON.stringify` of the whole root, `setItem` through the keeper, then `verifyWrite` (another
`getItem` and parse). The buffer's only reader, `getTownTrend` in
ui/screen-demographics/views/settlements/towns-history.js, has no callers in ui/ or tests/.
ui/screen-demographics/settlements/settlements-trace.js keeps the same `{t, pop}` window (cap 12, keyed `"x,y"`,
stamped with the same chartTurn) for every settlement of every alive player, on the history blob, and
settlements-data.js reads it through `getCityTrend`.

### 1.2 Change

1. In demographics-sampler.js remove the `recordAuxHistory(...)` call and the `recordLocalTownsNow` import.
2. Delete `ui/screen-demographics/views/settlements/towns-history.js`. Its two exports have no other importers.
3. In ui/sampler/sampler-sample-lifecycle.js delete `recordAuxHistory` (no test imports it).
4. In ui/core/demographics-settings.js add `const RETIRED_KEYS = ["townTrendBuf", "persistenceMode"];` and delete
   those keys inside `normalizeSlice` (after the spread copy, before `migrateSlice`). `normalizeSlice` runs on the
   seed from storage and on every `sliceToPersist`, so the keys leave the stored slice on the first settings write of
   the session and never enter `memoryBucket`. Don't bump `SCHEMA_VERSION`: tests/settings-clobber.mjs uses stamp 2
   as "a future build". `persistenceMode` is retired by section 10.2.

### 1.3 Compatibility

The key lives only in this mod's slice of `modSettings`, is scoped by game seed, and is a few KB. An old build
reading a slice without it does what it does on a new install: `loadBuffer` returns an empty buffer. No other mod
reads the slice.

### 1.4 Tests

- tests/settings-clobber.mjs or a new tests/settings-retired-keys.mjs: a stored slice holding `townTrendBuf` and
  another unknown key; after one `setSetting`, the written root has the unknown key and not `townTrendBuf`.
- A static assertion (the style of tests/storage-invariants.mjs) that `ui/sampler/` contains no `setSettings(` call:
  the sampler never writes the shared row. Put it in storage-invariants.mjs as rule (f).

### 1.5 In game

With debug logging on, no `settings: setSettings townTrendBuf` line per turn, and the `perf doSample` line's
`majors+minors` phase drops by the write cost. Nothing else to watch.

## 2. One history load per sample pass

### 2.1 Today

Inside one `doSample`, `DemographicsStorage.load()` runs three times:

| Call site | File |
| --- | --- |
| `seedNodeBaselinesForSample` | ui/sampler/demographics-sampler.js |
| `computeChartTurn` | ui/sampler/sampler-chart-turn.js |
| `appendSample` (calls `this.load()`) | ui/storage/demographics-storage.js |

Each `load()` copies the whole value out of GameConfiguration, parses it, runs `dropPrematureBoundarySamples` and
`localizeStoredNames` over every sample. Nothing writes between the three calls, so they return equal content.

### 2.2 Change

Thread one loaded history through the pass. No semantics change: the three calls already see the same bytes.

1. demographics-storage.js `appendSample(snapshot, opts)`: accept `opts.history`. When it is a valid history
   (`isValid(opts.history, VERSION)`) use it instead of `this.load()`. Everything after the load is unchanged
   (`_insertSnapshot`, `_maybeDecimate`, persist or mirror).
2. sampler-chart-turn.js `computeChartTurn(ageType, localTurn, history)`: the history is a required argument and the
   module's own `DemographicsStorage.load()` goes (section 10.5).
3. demographics-sampler.js `doSample`: `const history = DemographicsStorage.load();` right after the alive-player
   check, then `seedNodeBaselinesForSample(ageType, history)`, `computeChartTurn(ageType, localTurn, history)`, and
   `finalizeSample(snapshot, localTurn, tStart, minorCount, history)`.
4. sampler-sample-lifecycle.js `persistSnapshot(storage, tripIfTooMany, snapshot, history)` passes
   `{ persist: false, history }`; `finalizeSampleLifecycle` takes the history through `deps`.
5. `runWarTracker(snapshot, turn, history)` and `recordSettlementHistory(history, built)` already take the object.

`recordAgeBoundary`, `runKickoff`, `resetSamplerRuntimeState` and `reenableSampler` keep their own single load.
`sampleNow()` (the screen's on-demand sample) goes through `doSample` and gets the change for free.

Don't make `load()` itself return `_mem`: `load()` is also what detects a save of a different game, a newer parked
payload and a store that moved under the mirror, and the sampler's correctness paths rely on it reading the store.
Item 6 adds a separate view-only fast path.

### 2.3 Compatibility

None on disk. In memory, `_mem` ends the pass pointing at the same object as before (set by `appendSample` with
`persist: false`, then by `save`).

### 2.4 Tests

- New tests/sampler-single-load.mjs: a fake `DemographicsStorage` counting `load()` calls; one `doSample` with the
  engine stubs the sampler tests already use makes exactly one load and one save.
- tests for `computeChartTurn` with and without the `history` argument give the same result for the same samples.
- `appendSample` with `opts.history` of a different seed must not be accepted: it falls back to `load()` (guard on
  `String(opts.history.seed) === String(this._seed)` when both are known, the same rule `_memIsForDifferentGame` uses).

### 2.5 In game

The `perf doSample` debug line: the `write` phase falls to one parse plus the stringify. Sample count after a quit
and load equals the count before. One lab run of 20 turns, with the Demographics screen opened once mid-run.

## 3. Hall of Fame file write cadence

### 3.1 Today

ui/history/capture/history-capture.js `persist(doc)` runs on every local turn and every forced reason. It does
`saveCampaign(doc)` (stringify the campaign into GameConfiguration; 31 KB at turn 76, keep as is), then
`buildRecord(doc)` and `saveRecord(rec)`. `saveRecord` → `persistArchive` → `persistToFile`: `readFile` and parse
the slice (up to 512 KB), `mergeSlices`, `pruneUnfinished`, `fitSlice` (a `JSON.stringify` of the whole slice to
measure it), `writeFile` (stringify again, an INSERT that copies the previous payload into `Backup`, then a SELECT of
the payload compared with the written text). Three or four passes over up to 512 KB and about a 1 MB row rewrite per
turn, for a record that changes by a few numbers.

### 3.2 Change

history-archive-store.js:

1. Add `dirty: false` to `state`.
2. `noteRecord(rec)`: `loadArchive(); upsert(state.slice, rec); state.dirty = true;`. Returns nothing. The in-game
   views read `state.slice.games` through `allRecords()`, so they see the upsert at once.
3. `flushArchive()`: `if (!state.dirty) return true; const ok = persistArchive(); if (ok) state.dirty = false;
   return ok;`.
4. `saveRecord(rec)` becomes `noteRecord(rec); return flushArchive();`. Every existing caller and test keeps its
   behaviour (tests/history-archive-store.mjs asserts `saveRecord` return values; unchanged).
5. `persistToFile`: pass the measured text from `fitSlice` into `writeFile(slice, text)` so the slice is stringified
   once per write, not twice. `fitSlice` returns the final text; `writeFile(slice, text)` uses it when given.

history-capture.js:

6. `const HOF_FILE_EVERY = 5;` (local turns) and `lastFlushTurn` in `state`.
7. `persist(doc, reason, turn)`: `saveCampaign` as today; `const rec = buildRecord(doc)`; then
   `if (reason !== "turn" || turn - state.lastFlushTurn >= HOF_FILE_EVERY) { saveRecord(rec); state.lastFlushTurn =
   turn; } else noteRecord(rec);`. The forced reasons are `load`, `victory`, `defeat`, `age-ended`.
8. `stopCapture()` calls `flushArchive()` first. Bootstrap already runs `stopCapture` from `BeforeUnload`
   (ui/demographics-bootstrap.js `startHistory`), so quitting to the menu or reloading the UI flushes.
9. `_resetForTests` resets `lastFlushTurn`.

`buildRecord` still runs every turn; its cost is the timeline and map pack over an in-memory document, and the
record is what `noteRecord` upserts. Leave it.

### 3.3 Compatibility

No format change. The archive slice, the file schema and the `modSettings` fallback are as they are. The main-menu
Hall of Fame reads the file at its own page load; after a quit to the menu the file holds the flush from
`BeforeUnload`. After an exit to desktop or a crash the file holds the last flush, at most `HOF_FILE_EVERY - 1` turns
behind the last turn played; the campaign in the save (autosave or manual) is the durable copy, and the next load's
`sampleNow("load")` writes the file with reason `load`.

What the player can notice: a game abandoned without saving shows its Hall of Fame row up to the last flush rather
than the last turn, for an unfinished game only. Finished games (victory, defeat) always flush at once.

### 3.4 Failure modes

- `BeforeUnload` not firing on some exit path: covered by the per-N write; the loss is bounded.
- `persistArchive` failing on a forced reason: `state.dirty` stays true, so the next `persist` call of any reason
  tries again, and `flushArchive` at unload tries again. Today a failed write is simply retried next turn; the same.
- Another page (the main-menu Hall of Fame) deleting a game between flushes: `persistToFile` reads and merges the file
  before every write, as today, and `hideGame` is a `hidden` entry that merges by the newer timestamp, so a delete
  made elsewhere survives the flush.

### 3.5 Tests

- tests/history-archive-store.mjs: `noteRecord` doesn't write (the fake `localStorage` and the fake `Database.query`
  see no `setItem`/INSERT); `flushArchive` writes once; a second `flushArchive` with nothing new writes nothing;
  `saveRecord` still writes at once.
- tests/history-capture-mp.mjs or a new tests/history-capture-cadence.mjs: with a fake `Database`, four `turn`
  samples write the file once at the first (`load`) and once at turn 5; a `victory` sample writes at once;
  `stopCapture` after a `turn` sample writes.
- The `writeFile(slice, text)` path: text given and not given produce the same row.

### 3.6 In game

`SELECT Updated FROM demographics_hof.HallOfFame` (through the lab's eval) changes on turns 1, 6, 11, ... and after a
quit to the main menu. The in-game Hall of Fame tab shows the current turn's record between flushes.

## 4. Packed history payload (history schema 2, envelope 3)

This is the one on-disk format change. Read 4.5 before deciding to ship it.

### 4.1 Today

Each sample's `players[pid]` is the object `buildSnapshotPlayer` makes (ui/sampler/sampler-snapshot-helpers.js):
ten identity fields (`leaderType`, `civType`, `leaderName`, `civName`, `leaderTypeString`, `civTypeString`,
`primaryColor`, `secondaryColor`, `met`, `continent`), a `metrics` object with about 40 keyed numbers (the 35 registry
metrics plus the war cumulatives and refugees), and `wonderTypes`, the full list of a civ's wonders repeated every
sample. The envelope is `{ v: 2, data: history }` with `history.version === 1` (`VERSION` in
demographics-storage.js, `PAYLOAD_SCHEMA_VERSION` in storage-retention.js).

Measured 2026-11-01 on Small with 6 majors: about 9.5 KB a sample. The 3 MB soft budget (`PAYLOAD_SOFT_BYTES`)
arrives near turn 320 there and near turn 160 with 12 civilizations, and `serializeWithinBudget` then halves the cap
and re-decimates: a visible thinning of the charts. The adaptive sample cap is rarely what limits history; the byte
budget is.

### 4.2 Change: pack and unpack at the storage boundary only

Everything above the storage module keeps today's in-memory shape. Packing happens in `serializePayload`; unpacking
in `payloadFromBlob`. Both live in ui/storage/, in a new module `storage-pack.js` with two pure functions,
`packHistory(history)` and `unpackHistory(packed)`.

On disk:

```
{ "v": 3, "data": {
    "version": 2,
    "seed": ..., "ageBoundaries": [...], "eliminated": {...},
    ... every other top-level history field verbatim (wars, risings, legacySnapshots, crisisSnapshots,
        settleTrace, settleAges, and anything else present) ...
    "roster": [ { "leaderType": ..., "civType": ..., "leaderName": ..., "civName": ...,
                  "leaderTypeString": ..., "civTypeString": ..., "primaryColor": ..., "secondaryColor": ...,
                  "continent": ... }, ... ],
    "mk": [ "score", "gdp", ... ],
    "samples": [
      { ... every sample field verbatim except "players" ...,
        "p": { "<pid>": { "r": 0, "m": true, "v": [ 123, null, 4.5, ... ], "w": [ "WONDER_..." ], "x": {...} } } }
    ]
} }
```

Rules, exact:

- `roster`: one entry per distinct value tuple of the nine identity fields (everything in `buildSnapshotPlayer`
  except `met`, `metrics`, `wonderTypes`). Entries are objects, not arrays, so an absent field stays absent (JSON
  turns `undefined` into `null` inside arrays, and `continent` can legitimately be `null`). Dedupe by
  `JSON.stringify` of the nine fields in fixed order. No assumption about what changes and when: a civ switch at an
  age boundary, a colour change, a leader rename all just make another roster entry.
- `r`: roster index. `m`: `met` verbatim, omitted when `met` is absent.
- `mk`: metric key dictionary in first-seen order across the whole payload. `v[i]` is `metrics[mk[i]]` when its value
  is `typeof "number"`; otherwise `null`. Trailing `null`s trimmed. A metric value that isn't a number (a string, a
  boolean, `null`) goes verbatim into `x.metrics[key]`. On unpack, `null` in `v` means absent.
- `w`: omitted when `wonderTypes` deep-equals the previous packed sample's `wonderTypes` for the same pid (compare
  by `JSON.stringify`); `0` when `wonderTypes` is absent or not an array where the previous one was an array; the
  array otherwise. "Previous" means the previous sample in array order in which this pid appears. The first
  appearance of a pid always writes `w` (array or `0`).
- `x`: every other key on the player object, verbatim (`civ`, `leader`, `isMajor`, `eliminated`, anything an older
  build or a companion added). Omitted when empty.
- A `players[pid]` that isn't an object is kept verbatim under `p[pid]` with no `r` key; unpack returns it as is.
- Field order inside a sample is preserved except that `p` is written where `players` was.

`unpackHistory` rebuilds `players[pid]` objects with the field order `buildSnapshotPlayer` uses, then `x` keys, so the
unpacked object deep-equals `JSON.parse(JSON.stringify(original))` with one documented deviation: a metric value
that was `NaN` or `Infinity` in memory is `null` after today's JSON round trip and absent after a pack round trip.
No view reads a metric without a `typeof === "number"` check (ui/metrics, chart-line-series.js, chart-boards.js).

Where it plugs in:

- storage-retention.js `serializePayload(history)`: `JSON.stringify({ v: 3, data: packHistory(history) })`. Every
  write goes through it: `save`, `_preferMemWhenNewer`, `clear`, `commitRestore`. `parkRejected` writes raw text and
  stays raw.
- storage-load.js `payloadFromBlob(parsed)`: after choosing `parsed.data`, `if (data && data.version === 2 &&
  Array.isArray(data.roster)) return unpackHistory(data);`. A v2 payload whose `roster`/`mk`/`samples` aren't the
  shapes above makes `unpackHistory` return `null`, which `isValid` rejects, so the text gets parked under
  `json__rejected_v2` like any other unreadable payload.
- The Tutorial-bag fallback (`getPlayerStore`/`getGlobalStore`) only ever holds v1 text and reads through the same
  path.

### 4.3 Version handling

- demographics-storage.js: `VERSION = 2`. `emptyHistory(seed, 2)`.
- storage-schema.js `isValid(history, version)`: `history.version === version || history.version === 1` (accept the
  one older schema). `normalize` must not touch `version`: `loadParsed` runs `normalize` before `supersedeOlder`,
  and `supersedeOlder` needs `parsed.version < version` to see a v1 as older.
- storage-retention.js `prepareHistoryForSave`: after `isValid`, set `history.version = version`. From then on the
  mirror and the disk both say 2.
- storage-load.js `readRestorable` accepts the current version's slot only (`json__rejected_v2`); unchanged code,
  new value.

Load matrix for the new build:

| Stored primary | What happens |
| --- | --- |
| v1 (any old save) | Read as today (it is already the in-memory shape). `supersedeOlder` checks `json__rejected_v2`: if a parked v2 of this seed exists, the v1 is parked under `json__rejected_v1` and the v2 restored. Otherwise the v1 is used and the first save writes v2 |
| v2 | Unpacked and used |
| v3 or later (a future build) | Parked under `json__rejected_v3`, `json__rejected_v2` checked for a restorable payload, else mirror or empty. Today's behaviour with the numbers shifted |
| Unparseable | Parked under `json__rejected` (unversioned), as today |

### 4.4 Byte and time expectations

Per player per sample, identity drops from about 300 bytes to about 20, metric keys (about 480 bytes) to zero, and
the wonder list to zero on most turns. Estimate 9.5 KB a sample to 3.5-4 KB on Small with 6 majors; `minors` and
`rel` are untouched. The 3 MB soft budget then arrives near turn 800 on Small and near turn 400 with 12
civilizations, past the end of most games, so the sample cap becomes the limit again. Measure on a real payload
before trusting these numbers (4.7).

Packing adds one pass over the samples per save and one per load. Both are cheaper than the `JSON.parse` they ride
with. `_lastPayloadBytes` and the soft and hard budgets apply to packed bytes, which is the intent.

### 4.5 Compatibility, in detail

Old save, new build: every v1 payload loads unchanged on the first turn and is written back as v2 on the first save.
Tutorial-bag fallbacks (saves from before the GameConfiguration backend) load as before.

New save, old build (downgrade): the old build's `isValid` wants `version === 1`, so it parks the v2 text under
`json__rejected_v2` (one write of up to the payload's size), logs `history version 2 is not 1`, looks for
`json__rejected_v1` (none unless an earlier upgrade parked one), then uses its mirror if it has this game in memory
(only when the downgrade happened without a restart) or starts an empty history. The player sees empty charts for
that game and the old build records a fresh v1 from the next turn. The campaign document, the Hall of Fame, the
settlement trace on the v2 blob and the settings are what they were, except the settlement trace and the age archive
(`settleTrace`, `settleAges`) which live on the history blob and go with it.

Upgrade again after a downgrade: the new build reads the v1 primary, finds the parked v2 for this seed, parks the v1
under `json__rejected_v1` and restores the v2. The game resumes with the history as it was before the downgrade;
turns sampled on the old build stay parked, bounded to one payload, and aren't merged. Merging them is possible
(`insertSnapshot` dedupes by age and local turn) but the old build's `chartTurn` values restart from its empty
history and the war records' chart turns with them, so a merge needs a chart-turn rebase that this spec doesn't
attempt. Say in the changelog that going back to an older Demographics hides the current game's charts until the
upgrade is reinstalled.

Companions and tools: no module outside tower_mods/demographics reads the history or campaign keys (grep over
tower_mods, tower_mods_in_dev and tools on 2026-11-01). Emigration contributes `refugeesCum` through the
`EmigrationData` hook at sample time and reads nothing back from the store.

Multiplayer: unchanged. Every client writes its own history key as today; the campaign keeps its host-only rule.

Exports: history-csv.js and demographics-csv.js read the loaded history, not the stored text.

### 4.6 Tests

- New tests/storage-pack.mjs:
  - Round trip: for each fixture history in tests/ that carries samples (storage-display-names.mjs,
    wars-naming.mjs, wars-civ-naming.mjs, sampler-risings.mjs, risings-chart.mjs build them; lift them into a shared
    fixture module), `unpackHistory(JSON.parse(JSON.stringify(packHistory(h))))` deep-equals
    `JSON.parse(JSON.stringify(h))` after dropping metric values that are `null`.
  - Identity change mid-stream makes a second roster entry and unpacks to the right names on both sides of it.
  - Wonder list: unchanged runs omit `w`; a civ whose list goes from an array to absent unpacks to absent; a pid that
    skips a sample and returns gets `w` written again.
  - Non-number metric values and unknown player keys survive in `x`.
  - A sample whose `players` value isn't an object, and a player entry that isn't an object, survive verbatim.
  - Malformed packed input (`roster` not an array, `r` out of range, `v` longer than `mk`) returns `null` from
    `unpackHistory`; the loader parks it.
- tests/storage-load.mjs additions:
  - v1 primary with no parked v2: loads, saves as v2 (`JSON.parse(written).v === 3`, `.data.version === 2`).
  - v1 primary with a parked v2 of the same seed: v1 parked under `_v1`, v2 restored.
  - v1 primary with a parked v2 of another seed: v1 kept, slot untouched.
  - v2 primary: loads; `_lastPayloadBytes` is the packed length.
  - Simulated old build (an `isValid` requiring version 1) on a v2 text: parks under `_v2`, returns empty.
- tests/storage-schema.mjs: `isValid` accepts 1 and 2, rejects 3 and 0; `normalize` leaves `version` alone.
- tests/storage-decimate.mjs and storage-invariants.mjs: unchanged, run as the regression gate.

### 4.7 In game

Before building, the cheap measurement: take the history value out of a lab save at turn 70 or later (the lab's eval
can read `Configuration.getGame().getValue(...)`), run `packHistory` on it in node, and compare lengths. If the
saving is under 35 percent, stop and say so before building the rest.

After building: one lab run of 30 turns on a Small map; save and load at turn 15 (v1 to v2 transition happens at
turn 1 of the run); the Statistics line charts, Conflicts, Rankings and the Top Cities cards show the same values
as a run on the current build at the same seed. Then the downgrade path: switch the registry to the Workshop 2.10.0
copy, load the save, confirm empty charts and the parked key in a Database dump, switch back, load, confirm the
history is back. Add every unwatched cell to WATCH_LIST.md under the Demographics setup.

## 5. Housekeeping

### 5.1 Parked slots

Bounded by design: one slot per schema version plus the unversioned one, each at most one payload. After item 4 a
downgrade leaves one v2 payload in the save until the next upgrade restores it. No change beyond this note; a
seed-based sweep would almost never fire because the slots in a save carry that save's seed.

### 5.2 Hard budget wording

`PAYLOAD_HARD_BYTES` (6 MB) is the only size measured safe, for two turns, on 2026-11-01; 24 MB hung the game. The
comment in storage-cap.js says no engine limit is known. Change the comment to the measurement, and the log line in
`_notePayloadBytes` to say the game has hung at four times this size. `serializeWithinBudget` already stops under the
soft budget unless three halvings can't get there, so no logic change.

### 5.3 War records

`history.wars` has no cap (`risings` has 300). A record carries two rosters of a few short strings each; a long game
has tens of wars. Note only.

## 6. The screen reads the sampler's copy

### 6.1 Today

screen-demographics.js calls `this.storage.load()` at attach (`_loadHistory`), after an on-demand sample
(`_ensureInitialSample`) and on every view `requestReload` (`_reload`). Each is a full parse of the payload plus
`localizeStoredNames`, while the sampler's `_mem` holds the same content.

### 6.2 Change

demographics-storage.js gets `loadForView()`:

```
loadForView() {
  this._init();
  const store = this._pickStore();
  const mem = this._mem;
  if (store && mem && !this._memIsForDifferentGame()) {
    const raw = this._readRaw(store);
    if (typeof raw === "string" && raw.length === this._lastPayloadBytes) return mem;
  }
  return this.load();
}
```

The length check is what makes it safe: `_lastPayloadBytes` is set on every save (the serialized length) and every
load (the raw length), so a store that still holds what the mirror last wrote or read has that exact length. A save of
a different game fails the seed check; a different save of the same game loaded mid-session has a different length
unless it is byte-identical in length, in which case the screen shows the mirror until the next turn's save. The
bridge copy of the string remains; the parse and the localize pass go.

The screen's three sites call `loadForView()`. The sampler never calls it.

Sharing the object is safe because nothing mutates sample objects after insertion: `insertSnapshot` replaces whole
samples, decimation and the cap reassign `history.samples` to new arrays, `localizeStoredNames` runs on a fresh parse
inside `load()`, and no view assigns into `history.samples` or a player object (grep over ui/screen-demographics,
ui/history, ui/metrics, ui/core on 2026-11-01: only reads). Pin that with a rule in storage-invariants.mjs: no
`history.samples =`, `.samples.push(`, `.samples.splice(` outside ui/storage/ and ui/sampler/.

### 6.3 Compatibility

None on disk. Do this after item 2 so the mirror is the object the sampler finished with.

### 6.4 Tests

- tests/storage-load.mjs or a new tests/storage-view.mjs: after `save`, `loadForView()` returns the mirror and makes
  no parse (count `JSON.parse` through a wrapped store returning a string with a `length` property only); after the
  store's value changes length, it falls back to `load()`; with a mirror of another seed it falls back.

### 6.5 In game

Open the Demographics screen late in a lab game with debug logging on: no `load: ok ... bytes=` line on open; the
charts match the previous build's.

## 7. Test and verification plan, in one place

Before any code: `npm run verify` and `npm run coverage` on the working copy, so a failure later is attributable.

| Item | Unit tests | Lab check |
| --- | --- | --- |
| 1 | settings retired key; invariant (f) | no per-turn settings write in the log |
| 2 | single-load counter; chartTurn parity; seed guard | `perf doSample` write phase; count after quit and load |
| 3 | noteRecord/flushArchive; cadence; unload flush | `Updated` changes on turns 1, 6, 11 and after quit to menu |
| 4 | pack round trip; load matrix; schema accept list | pack a real payload first; 30-turn run; downgrade and upgrade |
| 5 | none | none |
| 6 | view fast path, three branches | no parse line on screen open |
| 10.1 | invariant (h): one `setSetting(` per function body | one `setSettings` debug line per Rankings click |
| 10.2 | storage hook tests: one engine hook, no `BeforeAgeTransition` | none |
| 10.3 | `decimationStatus().samples`; i18n parity; HoF renders the line in game and not at the menu | the line reads the right count and size on the in-game Hall of Fame; absent at the main menu |
| 10.4 | capture stops after 25 errors and logs once | none |
| 10.5 | `computeChartTurn` with a history argument; no storage import | covered by item 2's run |

One lab run covers items 1, 2, 3, 6 and 10 together (20 to 30 turns, Small, one screen open with the Hall of Fame tab
visited, one quit to menu with the Hall of Fame opened there). Item 4 needs its own run plus the downgrade run. Every
cell not watched goes on WATCH_LIST.md the same day.

## 8. Rollout order and release notes

Ship items 1, 2, 3, 5, 6 and 10 together as a point release: no format change, so a player can go back to the
previous build freely. Its changelog says what the player gets: a shorter turn end, a faster Demographics screen, the
Hall of Fame file written every few turns, one storage write per click, and a line on the Hall of Fame saying how
much chart history the save holds. Ship item 4 as its own release, with these lines in CHANGELOG.md and
CHANGELOG.steam.txt:

- "Chart history takes about half the space in the save, so long games keep more turns before thinning."
- "Going back to an older Demographics hides the current game's charts until this version is reinstalled; the
  history isn't lost."

README.md (the budget paragraph near line 356) and docs/README.md keep their wording; the numbers change only in the
code comments. docs/verification-runs.md gets the lab runs.

## 9. Invariants to keep

- Every write of the shared `modSettings` row is preceded by a read in the same function (storage-invariants.mjs
  rule (e)); items 1 and 3 remove writes, they add none.
- The sampler never writes the shared row (new rule (f)).
- The in-memory history shape seen by every module outside ui/storage/ is unchanged by item 4.
- `normalize` never changes `version`; only `prepareHistoryForSave` and `emptyHistory` set it.
- An unreadable stored payload is parked, never overwritten, on every path (`parkRejected`), old build or new.
- `load()` keeps reading the store; only `loadForView()` may answer from the mirror.
- No code outside ui/storage/ and ui/sampler/ assigns into `history.samples` or a sample's player object.
- No function body under ui/ calls `setSetting(` more than once; a handler that changes several keys uses one
  `setSettings(` (new rule (h), section 10.1).

## 10. Small fixes shipped with Wave A

Five changes found while reading for the items above. Each is in a file a Wave A fork already owns or in the lead's
file, none changes a format on disk, and each has its own test.

### 10.1 One settings write per click

Today: `_onViewTabSelected` in ui/screen-demographics/screen/screen-demographics.js writes `settlementsSubTab` and
then `activeView` as two `setSetting` calls, and the time-filter handler writes `activeTimeFilter` then
`timeFiltersByMetric` the same way. Every `setSetting` is a full read, parse, stringify, write and read-back of the
shared row, about 25 ms, so those clicks pay twice.

Change (Fork A3): each handler makes one `setSettings` call with both keys.
`this.settings.setSettings(id === "rankings" ? { settlementsSubTab: "civranking", activeView: id } : { activeView:
id })` and `this.settings.setSettings({ activeTimeFilter: id, timeFiltersByMetric: this.timeFiltersByMetric })`. The
`hiddenCivs` writers are single calls in separate functions and stay.

Test: storage-invariants.mjs rule (h): no function body under ui/ holds more than one `setSetting(` call, using the
same brace-matching helper as rule (e), with the same documented limits. Lead adds the rule; the fork reports.

### 10.2 Retire the hidden persistence mode

Today: ui/storage/demographics-storage.js reads a `persistenceMode` setting that no Options control, document or
test mentions. Its only value, `legacy_tutorial_bag`, registers an extra `BeforeAgeTransition` flush hook. Nobody
can set it except by editing the stored slice by hand.

Change (lead): delete `PERSISTENCE_MODE`, `activePersistenceMode`, the `_beforeAgeTransitionHook` field, the
`BeforeAgeTransition` branch of `_installEngineHooks` and its `engine.off` in `_teardown`. The `BeforeUnload` flush
stays. `persistenceMode` joins `RETIRED_KEYS` (section 1.2 item 4) so a slice that carries it loses it on the next
write. The Tutorial-bag read fallback in storage-backend.js is unrelated and stays: it is how saves from before the
GameConfiguration backend still load.

Compatibility: an old build reads the key only when it is present, and after the retirement it isn't; the old
build's default is the same `within_age` behaviour the new build has.

Test: the storage tests that stub `engine.on` see exactly one hook registered (`BeforeUnload`) and `teardown` removes
exactly that one.

### 10.3 Dead storage API, and a history-size line on the Hall of Fame

Today: `decimationStatus()` in demographics-storage.js was written for an Options panel that was never built, and
nothing in the UI calls it. `writeStorePayload` in storage-retention.js has no caller (the private method of that
name in demographics-storage.js uses `writeSerializedPayload`). The four re-exports at the foot of
demographics-storage.js (`resolveEffectiveCap`, `detectGameSpeedType`, `ADAPTIVE_DEFAULTS_BY_SPEED`,
`HARD_MAX_SAMPLES`) have no importer.

Change: drop the dead exports and wire the status into the one page players look at for storage trouble.

1. (Lead) `decimationStatus()` gains `samples: this._mem?.samples?.length ?? 0`. Remove the four re-exports. Remove
   `writeStorePayload` from storage-retention.js and the two test cases that call it.
2. (Fork A2) ui/history/capture/history-live.js: `export const live = { doc: null, historySize: null };`.
   history-capture.js `startCapture` sets `live.historySize = () => DemographicsStorage.decimationStatus()` (static
   import of the storage default export; history-capture already runs in game only) and `stopCapture` sets it back to
   null. history-live.js stays free of storage imports so the main-menu page never loads the sampler's modules.
3. (Fork A2) ui/history/views/history-app.js, where `HofCtx` is built (`live: inGame ? liveCampaign() : null`):
   add `historySize: inGame ? live.historySize : null`, importing `live` from history-live.js. `HofCtx` typedef in
   view-hof.js gains `@property {(() => {samples:number, bytes:number, cap:number}|null)|null} [historySize]`.
4. (Fork A2) view-hof.js `storageNote`, healthy branch only: after `keepLine`, push `historySizeNote(ctx)` when it
   returns an element. `historySizeNote` calls `ctx.historySize?.()`, returns null unless `samples > 0`, and
   otherwise returns `el("div", { cls: "dgh-note dgh-note--size", text: t("LOC_DEMOGRAPHICS_HIST_HISTORY_SIZE",
   samples, Math.round(bytes / 1024), Number.isFinite(cap) ? cap : samples) })`. The line never shows at the main
   menu (`historySize` is null there) and never while the archive is blocked (the blocked branch is unchanged).
5. (Fork A2) Text key `LOC_DEMOGRAPHICS_HIST_HISTORY_SIZE` in all twelve text/*/ModText.xml files, English:
   "Chart history in this save: {1_Count} turns, {2_Kb} KB, up to {3_Cap} turns kept." tests/i18n.mjs enforces
   parity, so the fork writes all twelve.

`bytes` is `_lastPayloadBytes`: the last serialized or read length, packed bytes after item 4. It is 0 until the
sampler's kickoff load, which runs before any player can open the screen.

Why this and not deletion: the size line answers "how big is Demographics making my save" from a screenshot, which
is the question the 2026-11-01 crash report needed answered and couldn't be.

Tests: `decimationStatus()` reports the mirror's sample count; a view-hof render test with `historySize` returning
`{samples: 120, bytes: 950000, cap: 2000}` shows the line and with `historySize: null` does not; the i18n parity
test.

### 10.4 Say so when the chronicle stops recording

Today: history-capture.js `sampleNow` gives up for the session once `state.errors` reaches `MAX_ERRORS` (25) and
logs nothing when it does; each failure logs on its own, the stop doesn't. The sampler's kill switch logs its trip.

Change (Fork A2): in the catch of `sampleNow`, after `state.errors++`, when `state.errors === MAX_ERRORS` log one
error line: "chronicle capture stopped for this session after 25 errors; the Hall of Fame record keeps its last
state". Nothing else changes.

Test: with a `readWorld` that throws, 25 calls produce the stop line exactly once and the 26th call does nothing.

### 10.5 Drop the chart-turn fallback load

Today: `computeChartTurn` in ui/sampler/sampler-chart-turn.js loads the history itself. After item 2 every runtime
caller passes the history in, and the fallback is reachable only from tests.

Change (Fork A1): `computeChartTurn(ageType, localTurn, history)` takes the history as a required argument and
treats anything without a `samples` array as empty. Remove the `DemographicsStorage` import from the module. Add
tests/sampler-chart-turn.mjs covering an empty history, a same-age continuation, an age change, and a non-array
`samples`.

Compatibility: none on disk.
