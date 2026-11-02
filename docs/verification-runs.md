# Runs watched in a game

What's been seen working in a running game, with the run that showed it. Everything built but not seen yet is on
the workspace's `WATCH_LIST.md`. This file stays out of the release notes: `CHANGELOG.md` feeds the Workshop change
note.

## Hall of Fame game detail under the write cadence (Unreleased)

One lab game on 2026-11-01, the working copy at 1487e43, every other mod off, Antiquity seed 4242, driven to turn 9
so the Hall of Fame file (written at turns 1 and 6) sat behind the turn. The current game's detail page (map,
timeline, rivals, highlights) was opened in game from the Hall of Fame's Games tab and again from the main menu
after a quit.

- In game at turn 9: the detail drew one map canvas with its legend ("Territory, Antiquity, T7"), the timeline, and
  the record read 9 turns, 1 most settlements, 5.9K population. Both the record built from the live campaign and
  the archive store's in-memory copy said 9 turns: `noteRecord` upserts the record every turn, so the views never
  see the file's lag.
- At the main menu after the quit: the same game, the same map frame and timeline, 9 turns (the quit's unload
  flush wrote the file). The size line was absent there, as designed. No error line in the run.

## Storage and memory work, every other mod off, old build against new (Unreleased)

Three lab games on 2026-11-01, Antiquity seed 4242, every other mod off. Game A ran the working copy at 3c8ef3c
(Wave A and B plus the one-write Rankings click), Game B ran the Workshop 2.10.0 copy through the same script, Game C
ran the working copy again for the upgrade path. Each of A and B: 32 turns under `lab drive`, a save and load at turn
15, the screen opened once at turn 15 (Rankings, then its Hall of Fame sub-tab), a quit to the main menu at turn 32
with the Hall of Fame opened there. Counters wrapped `localStorage.setItem`, the history key's `getValue` and
`JSON.parse` on strings over 2 KB, so the old build's numbers come from the same probes without its debug switch.
Run folders `2026-11-02T00-37-07` (A), the two after it (B, C); probe scripts and logs in the session scratchpad.

| Measure, six majors, Small | 2.10.0 (B) | New build (A) |
| --- | --- | --- |
| History value in the save at turn 15 / turn 30, characters | 105,896 / 210,017 | 25,125 / 43,926 |
| History loads a turn (`getValue` on the key, probe reads removed) | 3 | 1 |
| `JSON.parse` of a large string a turn | about 6 | about 1 |
| Shared-row writes a turn (`setItem modSettings`) | 1 (`townTrendBuf`) | 0 |
| Rankings tab click: writes / large parses / handler time | 3 / 9 / 31.4 ms | 1 / 0 / 3.6 ms |
| Screen open: large parses / push to second frame | 1 / 37 ms | 0 / 34 ms |
| `perf doSample` mean over turns 2 to 15: total / write phase | 13.0 ms / 0.6 ms | 12.9 ms / 0.1 ms |
| `lab drive` wall time, turns 1 to 15 / 15 to 30 | 4.45 s / 4.78 s a turn | 3.47 s / 4.75 s a turn |

The wall time per turn is dominated by the game's own AI turns and varies by a second between runs, so the two
builds' drive times are the same within noise; the sampler's own cost at this payload size is also the same within a
tenth of a millisecond. What changed is what the save carries (a fifth of the size at turn 30), the work a turn does
on the shared settings row (one write gone) and on the history value (two loads and five parses gone), and what a
click costs (one write instead of three, a tenth of the time). Those gaps widen with the payload: at turn 74 the old
format was 673 KB (the gate measurement above).

Chart data: the 30 samples of both builds at turn 30, six civs, eleven metrics (score, GDP, gold per turn,
population, cities, science, culture, production, military, land, wonders) plus the civ name: 2,160 cells, all
equal. The Rankings page text at turn 15 was the same in both.

Also watched in Game A: the stale `townTrendBuf` key (seeded into the slice by hand at turn 1) was gone after the
first click and an unknown key beside it stayed; the Rankings click wrote `activeView, settlementsSubTab,
historyGroupSel` in one `setSettings` call; the quit at turn 32, two turns after a cadence write, made the unload
flush write the Hall of Fame file (`Updated` moved at the quit); the size line read "15 turns, 25 KB, up to 2,000
turns kept"; no error line.

Downgrade and upgrade (Games B and C): 2.10.0 loading the new build's turn-15 save parked the schema 2 text under
`json__rejected_v2` (25,125 characters), wrote a fresh schema 1 primary with one sample and showed one sample's worth
of charts; that game was saved. The new build loading that save parked the schema 1 primary under `json__rejected_v1`
(10,997 characters), restored the schema 2 payload (15 samples), cleared the `_v2` slot and logged both steps; its 15
samples equal Game A's first 15 cell for cell.

## Storage and memory work, one lab run (Unreleased)

Design: [storage-memory-spec.md](storage-memory-spec.md). One lab game on 2026-11-01, Antiquity seed 4242, the
usual set of mods with the working copy at 80c5c3a deployed to `Mods/demographics` and its debug switch on; probe
scripts kept in the session scratchpad, readings in the run folder `~/.tower-bench/runs/2026-11-01T23-43-56/drive.log`.
Thirty turns under `lab drive`, a save and load at turn 15, the screen opened once at turn 15 with the Rankings tab
and its Hall of Fame sub-tab visited, then a quit to the main menu and the Hall of Fame opened there.

- **Packed history (item 4).** From turn 1 the save's history value began `{"v":3,"data":{"version":2,"seed":4242`,
  3,472 characters at turn 1 and 49,140 at turn 30 (about 1.3 KB a turn with six majors early in Antiquity). The
  mirror reported version 2, and the stored and in-memory sample counts matched the turn every time they were read.
- **Save and load.** The turn-15 save (`Network.saveGame`, then `Network.loadGame` from inside the game) came back
  with 15 samples, the same count and bytes as before the load; UI.log shows the BeforeUnload flush, a fresh storage
  init and one load of 15 samples.
- **One history load per turn (item 2).** 16 `load: ok` lines over turns 1 to 15 (the kickoff plus one a turn) and 15
  over turns 15 to 30. The sampler's `perf doSample` line at turn 16: total 18.0 ms, `majors+minors` 13.9,
  `write` 0.2, `warTracker` 4.0.
- **No per-turn settings write (item 1).** No `setSettings` line and no `townTrendBuf` anywhere in the run's log.
- **Hall of Fame file cadence (item 3).** `Updated` on `demographics_hof.HallOfFame` changed at turns 1, 6 and 11,
  then after the load at 15 and at 20, 25 and 30; unchanged on every other turn. The quit to the main menu landed on
  a flush turn, so the unload flush had nothing to write; the main menu read the turn-30 row.
- **Screen reads the mirror (item 6).** Opening the screen at turn 15 wrote no `load: ok` line; the Hall of Fame tab
  drew the keep line and the games list over the mirror's data.
- **One write per click (10.1).** The Rankings tab click wrote `setSettings settlementsSubTab,activeView` once. It
  also wrote `setSettings historyGroupSel` from `resetGroupSelections` in view-history.js, a separate function the
  spec didn't cover, so the click still costs two writes of the shared row. Folding that key into the handler's one
  call is the follow-up.
- **History-size line (10.3).** The in-game Hall of Fame read "Chart history in this save: 15 turns, 27 KB, up to
  2,000 turns kept." The main-menu Hall of Fame (opened through its menu button) showed the keep line and no size
  line.
- No `[Demographics.*]` error line in the whole run.

Not watched in this run: the every-other-mod-off side of each item, the downgrade to 2.10.0 and back (the registry
switch is the owner's), and a chart-by-chart comparison with the previous build at the same seed.

## Packed history: the measurement gate (Unreleased)

Design: [storage-memory-spec.md](storage-memory-spec.md) section 4. Before the packer was built, its rules were run
in node over a real history payload (the gate in spec 4.7): the Demographics history read out of the turn-74
autosave of lab run `2026-11-01T18-16-10` (Antiquity, seed 4242, Small map, six majors, 73 samples) with the private
save reader. The envelope as the save held it was 673,155 characters; packed with the spec 4.2 rules it was 159,258,
a 76.3 percent saving (9,221 to 2,182 characters a sample). The gate asked for 35 percent. The packer in
`ui/storage/storage-pack.js` was built after this measurement; the in-game runs for the packed payload are on the
workspace's `WATCH_LIST.md`, group 25.

## The Hall of Fame in a file of its own (Unreleased)

Design: [archive-file-store.md](archive-file-store.md). Three lab launches on 2026-10-26, Antiquity seed 4242, quick
setup. Probe scripts and results are in the workspace's `tools/plans/next-2026-10-26/demographics-hof-file-probe/`;
captures in `working_screenshots/demographics-hof-file-2026-10-26/`.

`hof-gate` (the usual set plus a probe mod, 2.10.0 from the Workshop; no Demographics code changed yet): the engine
checks the design rests on. They're in the workspace's `engine-closed.md`, the `ATTACH DATABASE` entry: the round
trip across launches, the user folder from the save list, quiet attach failures, the main menu, and the read cost
(the shared row 157,947 characters in game, 5.8 ms for the first read).

`hof-A` (Demographics alone, the working copy, the owner's own settings store, which the lab put back afterwards):

- **Migration.** Before the run the store held 783,731 characters on disk, 524,156 of them the Hall of Fame (324
  games, 22 finished). At turn 1 `demographics-halloffame.sqlite` was in the user folder with 42 games: the 42 the
  2.10.0 keep rule leaves, minus its oldest unfinished game, plus the test game. `modSettings` no longer held the
  slice and was 259,548 characters on disk; each other section, Tower Settings Keeper's `__ls` and
  `__settings-keeper` included, matched the before copy. The store's records matched the file, the keep line read
  "Saved: 22 finished, 20 unfinished (latest 20 kept)", and no warning showed.
- **Settings read cost.** `getItem("modSettings")` plus `JSON.parse` in game: 0.63 to 0.79 ms on 4,341 characters,
  against 5.8 ms (2.4 to 2.9 ms on repeats) on 157,947 in `hof-gate`.
- **A new record.** After `lab turns 1` the file on disk held the test game at turn 2, and `modSettings` didn't change.
- **Delete.** `deleteRecord` (what the Delete button calls) on a finished game: the file had 41 games and the id under
  `hidden`. After `exitToMainMenu` the main menu read the file again and still showed 41.
- **The main menu Hall of Fame**, opened with `openHallOfFame()`: 40 games on Best Games (41 kept, one hidden by the
  short-game filter), the line "Saved: 21 finished, 20 unfinished (latest 20 kept)" (capture `runA-main-menu-hof.png`).
- **Fallback, a write that doesn't read back.** With the file moved away while attached, a second game started from
  the main menu kept the main menu's attachment, and its write failed ("attempt to write a readonly database" in
  `Database.log`). The store moved to `modSettings` at once: the slice was back there with the new test game, the
  delete still hidden, status ok, no warning.
- **Fallback, an attach that fails.** With a folder in the file's place, the next main-menu page's attach failed
  ("unable to open database" in `Database.log`); the Hall of Fame read 41 games from `modSettings`, status ok.
- **Lab restore.** `lab stop` moved the file the test game created into the run folder, so none was left behind, and
  put `modSettings` back byte for byte.

`hof-B` (the usual set with Tower Settings Keeper, the working copy; run A's file placed in the user folder first,
standing in for a player who already has one, and the owner's settings store with the slice in it):

- **Merge.** The file took in the `modSettings` slice; the game deleted in `hof-A` stayed deleted though `modSettings`
  still listed it; run A's turn-2 test game was cleared as a short unfinished game; the new test game was in.
  `modSettings` lost the slice and every other section matched the before copy, the keeper's included.
- **Record, delete, reload** as in `hof-A`: the test game at turn 2 in the file, a second game deleted, both deletes
  holding at the main menu, `modSettings` unchanged.
- **Lab restore of an existing file.** The lab backed up `demographics-halloffame.sqlite` at start; after `lab stop`
  the file's dump matched the one placed before the run (the bytes differ: `.backup` rewrites the pages).

`hof-B2` (2026-11-01, Demographics working copy and the usual set, the owner's settings store with the 42-game slice
and no file, run `2026-11-01T20-08-27`): the first load moved the slice to the file again, as in `hof-A`. The same
game also showed the UI attaching `LocalStorage.sqlite` by path and reading the `modSettings` row by key.

`hof-C` (2026-11-01, the same store with a row `AAA_probe` = `{"zoomSpeed":3,"enabled":true}` added to
`LocalStorage.sqlite` before launch, so `getItem("modSettings")` returns it):

- **Before the fix** (runs `20-12-10` and `20-13-47`, English): the Hall of Fame listed only the test game. The 42
  games never reached the file, and the repair then deleted the row that held them.
- **A row that isn't JSON** (run `20-11-15`): `getItem` returned null for every key, the probe's own included.
- **A row shaped like a settings root** (`{"probe-mod":{"x":1}}`, run `20-12-10`): Demographics took it for the root;
  a settings save wrote `{probe-mod, demographics}` under `modSettings`.
- **With the fix** (run `20-20-26`, German): the file held 42 games (the 2.10.0 keep rule dropped the oldest
  unfinished one) and the keep line read "Gespeichert: 22 abgeschlossen, 20 unfertig (die letzten 20 bleiben)". The
  rows Demographics read on disk didn't change; Tower Settings Keeper's blocked mode added its own row under the empty
  key, as designed. `Updated` read 1793564451 (seconds; milliseconds had overflowed the engine's 32-bit binding to
  -1732598118).
- **Footer and Repair** (English in `20-13-47`, German in `20-20-26`): after a settings save the settings module
  reported `read-failed`; the note read the new text with one Repair button under it and no red notice box; the
  button opened the sheet with the new text; the first click armed it, the second repaired. The store held only
  `demographics`, the file's payload and backup were byte for byte the same (42 games kept), and the line after read
  "Storage repaired. From now on Demographics saves its settings and Hall of Fame normally…" / "Speicher repariert…".
  One turn later the test game was in the file at turn 2.
- **The other nine languages** (runs `21-50` to `21-56`, the same blocked seed, one launch each with `DisplayLanguage`
  set in AppOptions.txt): es_ES, fr_FR, it_IT, ja_JP, ko_KR, pl_PL, pt_BR, ru_RU and zh_Hans_CN each showed the 42
  games, the keep line, the settings note with one Repair button and no red box, the sheet's title, two headings and
  paragraphs, the "again" line, the Repair and Cancel buttons, the armed text and the repaired line in that language,
  with no raw `LOC_` tag; the repair left the file's payload and backup untouched and the store holding only
  `demographics`. zh_Hant_HK, which the mod then had no text for, read in English throughout; after
  `text/zh_hk/ModText.xml` was added (16:45, run `hof-C3`, the same seed and probe, plus the four main-menu captures)
  it read in Traditional Chinese end to end: 42 games, keep line 已儲存：已完成 22 局…, the note, button, sheet, armed
  text and repaired line, no raw tag, file and store as in the other languages; the drawn page used the game's
  Traditional font with the sheet and the wrapped armed button inside the panel.
- **The drawn page** (`hof-C2`, 16:09 to 16:51, Russian, Polish, German and French, one launch each): after
  `exitToMainMenu`, a settings save and `openHallOfFame()`, the main menu's Hall of Fame was captured with
  `screencapture -l` at four points (`working_screenshots/demographics-hof-languages-2026-11-01/`, `first-pass/` is
  the earlier set). The note sits on one line under the keep line, the button under it; the sheet's title, headings and
  paragraphs wrap inside the panel; Repair and Cancel fit on one row. In the first pass the armed "Click again" button
  grew past the sheet's left edge in Russian and French (two Polish and German shots were stale frames of a covered
  window; the DOM had the sheet open). `.dgh-repair-actions` now wraps and `.dgh-repair-go` shrinks to the sheet; in
  the second pass the armed text wraps to two lines inside the panel with Cancel beneath it, in all four languages.
  That pass also showed the open sheet growing the foot of the page and pushing the "rest of your top ten" table up
  until its last rows were hidden, in every language.
- **The sheet as a layer** (`hof-C4`, 17:10 to 17:45): the sheet now opens in `.dgh-repair-host`, a fixed
  `100vw × 100vh` layer that dims the screen, so the page behind it keeps every row. Two earlier forms were watched
  and dropped in one game kept open at the main menu (`UI.reloadUI` between tries, boxes read with
  `getBoundingClientRect` a frame after each change): `top/right/bottom/left: 0` and then `width/height: 100%` on an
  absolute layer inside `.dgh-app` both left the layer 89 px tall, the sheet's own height, because the engine resolves
  a percentage against the flex-sized page as auto. With viewport units the layer measured 2880 × 1800 and the sheet
  sat centered (English captures `en_US-2-sheet.png`, `en_US-3-armed.png`; Russian and Polish `*-3-armed.png` and
  `*-4-after.png`, where the long armed text wraps to two lines inside the sheet with Cancel beneath, and the repaired
  page behind it keeps all ten table rows). A click on the dimmed page closes the sheet (`scrimClosed: true` in the
  DOM check) and the button reopens it. The captures of a covered window lag the DOM by one step now and then (a
  "sheet" shot showing the note, the "after" shot showing the armed sheet); the DOM readings in the run logs are the
  record of each step, the pictures show the layout.

`hof-D` (2026-11-01, run `21-49`, English, the same store with a row the keeper can name in front: `!chronicle` =
`{"v":1,"updated":1700000000000,"games":{}}`): Tower Settings Keeper logged "moved row "!chronicle" (42 bytes) out of
the way" and "folded !chronicle into the root", then came up with root `modSettings`, rows 1. `getItem("modSettings")`
then reached the real row, so the ordinary migration ran: the file held 42 games, the slice was gone from
`modSettings`, the keeper's `__ls` served the chronicle row back, settings saved (`ok`), and the Hall of Fame showed the
keep line with no note and no Repair button. The disk read of `hof-C` wasn't needed and didn't run.

Not seen: Windows and the Steam Deck; a player with no local save; the store loading before the save list answers
(tests only). All are on `WATCH_LIST.md`.

## Hall of Fame keep rule and Spoil Guard for companion mods (2.10.0)

`dg-hof-1` (2026-10-25, lab, Antiquity seed 4242, Heian, the usual set with the working copy live, the owner's own
settings store, which the lab put back afterwards):

- **Spoil Guard published at the start.** At turn 1, with the Demographics screen never opened (the only elements on
  the page were its launch button), `Configuration.getGame().getValue("DemographicsAnalyticsPolicyEffective_v1")`
  read `met-civs-only`. Spoil Guard switched off through its own option handler (the Options model initialised as
  the Options screen does, then `updateListener(info, false)`): `full`, the screen still closed; switched back on:
  `met-civs-only`.
- **Hall of Fame keep rule.** The store held 42 games: 22 finished (11 victories, 7 ended, 4 defeats) and 20
  unfinished, the newest the test game at turn 1, every other unfinished one 24 turns or more. After a turn: still 20
  unfinished, the test game at turn 2, the row 157,980 characters (157,947 before). The 310-game store from
  2026-10-18 had already been cut down before this run, so the drop itself wasn't seen again. On World Rankings >
  Hall of Fame the line read "Saved: 22 finished, 20 unfinished (latest 20 kept)", its tooltip "Finished games stay
  for good. Unfinished games under 20 turns are cleared once you start another game."
- Not seen: the line in a second language, and the main menu's Hall of Fame (the same view, read in game here).

## Risings ended by the age change (Unreleased)

- **2026-10-17, `lab3-B` (usual set) and `lab3-Bv` (Demographics with Partisans only), Antiquity seed 4242, fast
  setup, through `lab age-change` into Exploration.** A misery rising started at Heijo when age progress read 119 of
  120 landed on the last turn ("3 of 3 units"), and the age change cleared it. Two turns into Exploration
  `DemographicsStorage.load().risings` held
  `{"start":120,"age":"AGE_ANTIQUITY","end":1,"outcome":"age","endChartTurn":121,"endYear":"400 CE"}` with `ownerCiv`
  Heian Japan (Himiko), one past the last Antiquity sample. The Conflicts data (`buildRisingRows`) gave the row
  "Heijo Uprising", owner Heian Japan, 120 to 121, "Ended with the age.", and the Chronicle held a `rising` event at
  turn 120 and a `risingEnd` event `misery|age` at Exploration turn 2. Both sides read the same. The rising was
  started at 119 because one started at 120 only musters and is cleared as pending, so there's nothing to close.
  The drawn chart and the Chronicle page weren't opened; that's presentation and comes later.

## Small-screen layout (Unreleased)

- **2026-10-17, `lab4-D`, Modern seed 9001, fast setup, two turns in, windowed, render size set in
  `GraphicsOptions.txt`.** Six games: the usual set (the 16 Tower mods' `Mods/` copies; Aging Warehouses and Settlement
  Limit were also on in the 1366x768 game, which is where they registered) and Demographics alone, each at 1366x768,
  1280x720 and 1600x900. The screen was opened by script (`ContextManager.push("screen-demographics")`, as the dock
  button does) and the World Rankings pages picked through their tab bars. The page reported its own size each time
  (`documentElement` 1366x768, 1280x720, 1600x900).
  - 1366x768 and 1280x720, both sides alike: the frame carries `dg-compact`. Names on the ranked lists step down from
    2.08rem to 1.82rem, and the matrix's civilization and leader names from 1.43rem to 1.30rem. The list portraits are
    gone in Civilization Ranking (6 of 6) and Top 25 Settlements (25 of 25), and so is the header spacer over them;
    the podium cards keep theirs. Settlement Rank by Yield shows no Type column (0 of 26 cells drawn) and no owner
    portraits, with the All, Cities and Towns buttons above it, and the owner's civilization and leader read in full
    on two lines. Civilization Rank by Yield drew as the matrix on every size; its row headings show no icons (0 of
    20) and read larger in the space they leave. Every name line on the four pages carries its full text as
    `data-tooltip-content` (15, 12, 59 and 50 of them), none was cut short, and the captures show none ending in "...".
    The column headings fit on one line at both sizes in English, so the two-line wrap had nothing to do here.
  - 1600x900, both sides alike: no `dg-compact`, portraits on every list and table row, the Type column with its
    City pills, icons on the matrix's row headings, no hover text on names: the layout as before.
  - Captures in `working_screenshots/demographics-small-screen/` (`u` the usual set, `v` Demographics alone, then the
    size and the page). The drawn hover tooltip needs a real mouse and wasn't seen; the matrix's cells sit tight
    against their row lines at every size, 1600x900 included, so that isn't the small-screen layout's doing.
