# Tooltip probe (dev)

Captures the intermittent **"line-chart tooltip numbers do not change as I scroll across the
graph"** fault. Not shipped; `AffectsSavedGames=0`, so it cannot touch a save.

## Why this exists rather than a fix

The fault has never been reproduced from script. Everything that *can* be driven programmatically
is correct — measured on 1.5.0, 2026-09-24, against a 232-point chart:

| checked | result |
|---|---|
| Stored series | 232 points, filter "All Time" |
| `Interaction.modes.index` vs `nearest` across x | identical sets; both resolve per-turn |
| `chart._eventHandler` sweep | A26 → A64 → A103 → A141 → E19 → E58 → E72 |
| Rendered values | $1.99B → $9.15B → $31.10B → … → $680.84B |
| Tooltip `pointer-events` | `none` — not stealing the cursor |
| Chart.js listeners | all five attached, `DomPlatform` |
| Duplicate/orphan tooltip element | exactly one |
| Canvas vs CSS size | `chartWidth 2650 == canvasW 2650`, dpr 1 |

The one step that cannot be driven is a **real mouse hover**: GameFace's `MouseEvent` constructor
ignores its init dict (`new MouseEvent("mousemove",{clientX:500}).clientX === 0`), and CDP's
`Input.dispatchMouseEvent` is accepted but never delivered to the page — an instrumented run caught
zero events, which is how that was established. A real hand on a real mouse is the only instrument
left.

## What it measures

Hover has three stages, each with a different failure:

1. **NATIVE** — a real `mousemove` reaches the DOM (`clientX` changes)
2. **DERIVED** — Chart.js converts it to a chart x (`_eventHandler` receives a changing `x`)
3. **RENDER** — the tooltip DOM is rewritten (header/value text changes)

When the cursor has clearly travelled (>60px) but the rendered text has not, it prints one verdict
line naming the first stage that stopped. That names the bug outright.

It hooks `Chart.prototype._eventHandler` once — covering every instance, present and future — and
listens on `document` in the capture phase. Both survive the canvas being replaced on re-render,
which is what defeated an earlier single-canvas hook (it caught nothing).

## Use

```sh
cp -R devtools/tooltip-probe ~/Library/Application\ Support/Civilization\ VII/Mods/demographics-tooltip-probe
```

Launch, open Demographics, and hover across a line chart the way that triggers it. A verdict prints
every 45 samples. Then:

```sh
grep 'TOOLTIP-PROBE' ~/Library/Application\ Support/Civilization\ VII/Logs/UI.log
```

`console.error` is used throughout because `console.log` does not reach `UI.log`.

A live handle is exposed for a CDP session that does not want to wait for a window to fill:

```js
window.__dgTooltipProbe.hooked()   // is Chart.prototype instrumented?
window.__dgTooltipProbe.state      // the current window's raw samples
window.__dgTooltipProbe.dump()     // log a verdict for whatever has been collected so far
```

All four verdict branches were exercised by injecting samples through `state` and calling `dump()`
(watched in `UI.log`, 2026-09-24): frozen render → stage 3, frozen derived x → stage 2, no derived
samples → stage 1, all moving → healthy.

Remove the folder from `Mods/` when finished — a duplicate or stale dev mod is its own class of
problem.

## Reading the verdict

- `FAULT stage 1 NATIVE->DERIVED` — the cursor moved but `_eventHandler` never fired. Something is
  intercepting the canvas, or the listener is detached. Note the legend overlay
  (`.demographics-line-legend-overlay`) sits over the plot's upper-left with `pointer-events: auto`
  and is **intentionally** interactive (click-to-toggle civs), so hovering *there* is expected to
  produce this and is not the bug.
- `FAULT stage 2 DERIVED` — `getRelativePosition` is mis-converting the native event. This is the
  step no script can reach, and the most likely home for the fault.
- `FAULT stage 3 RENDER` — hit-testing is fine but the external tooltip handler is stale or not
  running.
- `healthy` — all three moved; the fault was not active for that window.
