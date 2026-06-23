# 03 — Phase 2: Hub contribution API

Add the additive `registerHubPages` API so a companion can inject pages into a named hub at a
position. No behavior change for existing callers; nothing consumes it yet (Phase 3 does).

Prereqs: Phase 1 landed (hubs exist). Contract: [01-foundations.md](01-foundations.md) §E.

## Steps

1. **Expose hub ids** (`core/demographics-metrics.js`): `export const HUB_IDS =
   Object.freeze(["statistics","migration","geopolitics"])` (rankings is not injectable). Mirror onto
   the `globalThis.DemographicsMetricsAPI` surface.

2. **`registerHubPages(hubId, pages, opts)`**: validate `hubId ∈ HUB_IDS`; reject duplicate page ids;
   normalize each page to the PageDef shape (01 §C) — accepting **all three kinds** (`render`,
   `metrics`, `group`); store in an `EXTERNAL_HUB_PAGES` registry keyed by hub, carrying `opts.after`.
   Return false on unknown hub / dup / validation fail.

3. **Wire the hub renderer to merge + dispatch injected pages**: when a hub builds its page row
   (Phase 1's hub renderer), append `EXTERNAL_HUB_PAGES[hub]` after the anchor page (`opts.after`),
   else at the end. Apply the same `tier` gating. Dispatch by kind: `metrics` → host chart pipeline;
   `group` → `resolve2DGroup` (member pills + Scaled/Civ binding); `render` → call into the page body.
   A `group` injected page must work identically to a locally-defined one (this is the Net Migration path).

4. **`ctx` builder**: reuse the external-panel render ctx (the one that already supplies
   `panelControls`, `groupView`, `settings`, `history`) so injected `render` pages get the shared
   controls row + Options line for free.

5. **Drain path**: register `_api.registerHubPages` alongside the others and ensure
   `_api.pending` jobs that call it run after it exists (existing drain loop already covers this).

6. **Back-compat**: leave `registerPanel`/`registerMetricGroup` intact — older companions still work.

## Files
`core/demographics-metrics.js` (HUB_IDS, registry, `registerHubPages`, ctx reuse), the hub renderer
from Phase 1 (`views/history/view-history.js`) to merge injected pages.

## Acceptance (in addition to 01 §H)
- `DemographicsMetricsAPI.registerHubPages` is callable; bad hub id / dup id returns false, no throw.
- A throwaway test page registered to `migration` with `{after:"population"}` renders immediately
  after Population, gated by its `tier`, with a working shared controls row.
- Both a `render` test page AND a `group` test page (members × scaled/civ views) inject and render
  correctly — the `group` page shows member pills + the Scaled/Civ toggle via `resolve2DGroup`.
- Existing `registerPanel`/`registerMetricGroup` callers behave exactly as before.
- Demographics-only still loads (no companion required); `npm run verify` green.
