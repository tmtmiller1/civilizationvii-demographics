# Runs watched in a game

What's been seen working in a running game, with the run that showed it. Everything built but not seen yet is on
the workspace's `WATCH_LIST.md`. This file stays out of the release notes: `CHANGELOG.md` feeds the Workshop change
note.

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
