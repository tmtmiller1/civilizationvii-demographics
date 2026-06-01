# Community Reaction Review

This note records the current assessment of which parts of the Demographics mod are most likely to draw mockery, dismissal, or low-effort criticism from the Civilization community or from general internet audiences.

The main conclusion is straightforward: the mod is more likely to be mocked for tone, verbosity, and visible developer thinking than for weak implementation. The core idea is coherent. The presentation layer sometimes reads like a mix of patch notes, interface copy, and internal design notes.

## High-Level Risk Summary

- The mod looks ambitious to the point of inviting "everything mod" jokes.
- The interface text often explains the implementation instead of staying in player-facing language.
- Several strings sound like placeholders, debug text, or spreadsheet labels.
- Long tooltip bodies make the mod look defensive or over-engineered even when the underlying behavior is reasonable.
- The README is in better shape after the rewrite, but the in-game text still carries much of the old tone.

## What Is Unlikely To Get Mocked

- The core feature set: charts, factbook, relations, conflicts, and Triumphs overlays.
- The read-only scope.
- The technical direction.
- The general level of effort.

The weak point is not seriousness. The weak point is copy discipline.

## Main Sources Of Negative Reaction

### 1. Visible developer-placeholder text

Anything that looks like a harness check, test string, or internal note will get screenshotted immediately.

### 2. Spreadsheet or product-analytics phrasing

Terms like "analytics dashboard," "world factbook," "aggregate," and formula-driven labels make the mod sound more like BI software than a Civ mod. Some players will like that. Others will joke about it.

### 3. Over-explaining engine limits in the UI

The current copy often explains why something is impossible, how storage works, or which API is missing. That reads as developer justification rather than player-facing help.

### 4. Long tooltip essays

The longest strings are not just descriptive. They teach the internal model. That makes the UI feel heavier than the feature itself.

### 5. Formula branding

When a feature label opens with a symbolic formula or pseudo-economic model, some players will read it as smart and others will read it as self-serious.

## Top 10 Specific Phrases Or UI Strings Most Likely To Draw Heat

The list below ranks the exact strings most likely to get quoted or mocked, based on visibility and tone.

| Rank | Source | Tag or section | Current text | Why it draws reaction |
|---|---|---|---|---|
| 1 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_BODY` | `Hello. If you can read this, the harness works.` | This is the clearest placeholder in the mod. It reads like test scaffolding shipped to production. |
| 2 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_CAPTION_GDP_TRIGGER` | `GDP = Σ weighted yields × turn × 1M · hover for explanation` | Leading with a formula makes the feature look like parody spreadsheet culture. |
| 3 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_CAPTION_GDP_BODY` | `A pseudo-realistic value...` plus the full weighted formula and justification | "Pseudo-realistic" is easy to make fun of, and the rest reads like a defense brief for a made-up metric. |
| 4 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_CAPTION_APPROVAL_TRIGGER` | `Diplomatic Approval = Σ relationship-weighted scores · hover for explanation` | Same issue as GDP. The math-forward label makes the UI feel self-serious before the player even asks for detail. |
| 5 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_CAPTION_APPROVAL_BODY` | Full signed aggregate explanation with weight table and suzerain damping | This is accurate, but it reads like internal system documentation instead of interface copy. |
| 6 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_TOOLTIP_CROSSAGE_BODY` | `Civ 7 wipes every storage channel a mod could use...` | It is useful context, but phrased like an engine postmortem. Players who just wanted a tooltip may read it as complaining. |
| 7 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_TOOLTIP_CSV_BODY` | `Civ 7's UI sandbox has no file-write API, so the clipboard is the only hand-off.` | This sounds like middleware documentation. It explains the engineering constraint instead of the player action. |
| 8 | text/en_us/ModText.xml | `LOC_MOD_DEMOGRAPHICS_DESCRIPTION` | `Per-turn historical graphs, world factbook, global relations rings, conflicts gantt...` | "conflicts gantt" is technically accurate and publicly awkward. It reads like project-management software in a Civ mod listing. |
| 9 | text/en_us/ModText.xml | `LOC_DEMOGRAPHICS_FOOTNOTE` | `Live history from the sampler.` | "sampler" is an internal-sounding term. It reads like implementation vocabulary leaked into UI copy. |
| 10 | README.md | opening description | `read-only analytics dashboard` and the broad feature stack in the first paragraph | The rewritten README is cleaner, but the framing still invites jokes about enterprise BI for Civilization. |

## Additional Notes On Secondary Risk Strings

These are not as bad as the top ten, but they still contribute to the same impression:

- `World Factbook` sounds formal enough that some players will read it as roleplay and others will read it as overbranding.
- `Historical Data` is clean but dry.
- `Live history from the sampler.` sounds like internal terminology escaped review.
- `Test-of-Time Legacies API unavailable.` reads like an error string, not a player-facing message.
- `Clipboard unavailable · wrote CSV to UI.log` is useful but very tool-like.
- `Re-pull legacy progress from VictoryManager.getVictoryProgress()` exposes method naming directly in the UI.

## Why These Strings Matter More Than The Feature Set

The mod can be large, nerdy, and dense without becoming mockable on its own. The part that gets mocked is usually the mismatch between the feature and the voice used to explain it.

Examples:

- A war timeline is normal.
- Calling it a `conflicts gantt` invites jokes.
- A GDP proxy is normal.
- Calling it `pseudo-realistic` and leading with a sigma formula invites jokes.
- Explaining that CSV uses the clipboard is normal.
- Explaining that the UI sandbox lacks file-write API support sounds like a postmortem.

## Practical Rewrite Priorities

If the goal is reducing public-facing mockability without changing features, the highest-value order is:

1. Remove placeholder and harness text.
2. Shorten long tooltip bodies by at least half.
3. Move engine and API explanation out of primary UI copy and into docs or About text.
4. Replace internal nouns like `sampler`, `aggregate`, and `gantt` where a simpler player-facing term exists.
5. Keep formulas and weight tables optional, not front-loaded.

## Short Version

The Demographics mod is at the highest risk of being mocked when it sounds like a developer talking to other developers inside the UI. The most visible fixes are copy fixes, not feature cuts.