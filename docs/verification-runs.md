# Runs watched in a game

What's been seen working in a running game, with the run that showed it. Everything built but not seen yet is on
the workspace's `WATCH_LIST.md`. This file stays out of the release notes: `CHANGELOG.md` feeds the Workshop change
note.

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
