# 02 — Phase 1: Demographics hubs (standalone)

Restructure Demographics' own top tabs into the four hubs and rebuild the L2 page rows. Ships and is
fully usable with **Demographics installed alone** (Migration hub = Population only). No Emigration
dependency, no new API yet.

Prereqs: [01-foundations.md](01-foundations.md) §A (id map), §C (PageDef + hub architecture), §D
(tier remap), §F (LOC keys), §B (page-id aliases).

## Steps

1. **Generalize PageDef** (`views/history/view-history.js`): allow a page to carry `render(host,ctx)`
   OR `metrics[]`, plus a `tier` field (per 01 §C/§D). Update the page renderer to dispatch: `metrics`
   → existing chart pipeline; `render` → call it into the page body.

2. **Replace the page set with hub-scoped page sets.** Define `HUBS` (statistics / migration /
   geopolitics) each with their `PAGES` per the id map (01 §A). Keep Rankings as the existing
   `view-settlements` view (01 §C — leave untouched).
   - statistics: economy, resources, science_culture, society, expansion, age
   - migration: population *(only; Emigration adds the rest in Phase 3)* — the hub renderer must handle
     a **single-page hub** gracefully (no page-tab row, or a 1-item row; don't assume ≥2 pages).
   - geopolitics: military, wars, crises, relations(render→view-relations), agreements

3. **Top tab bar** (`screen/screen-demographics.js`): change `VIEW_TABS` from
   `history · rankings · relations` to `statistics · migration · geopolitics · rankings`. Remove
   `relations` as a top-level view (it's now a geopolitics page). Map each hub tab to the hub renderer;
   `rankings` keeps dispatching to `view-settlements`.

4. **Relations as a page**: wrap `views/relations/view-relations.js`'s `render` as a geopolitics
   `render` PageDef. Carry over its tier (basic-hidden → `tier: standard`, hidden at basic per 01 §D).

5. **Tier gating** (`core/demographics-tiers.js`): replace `BASIC_PAGES`/`BASIC_HIDDEN_VIEWS` with
   per-page `tier` reads (`pageVisibleInTier(pageDef)`), seeded with the table in 01 §D. Keep
   `getTier()` fail-safe behavior.

6. **Persistence aliases** (`views/history/view-history-state.js`): apply `PAGE_ID_ALIASES`
   (01 §B) on read of the persisted current page before the clamp, so a returning user lands on the
   moved page rather than the hub's first page.

7. **LOC**: add the new hub/page keys (01 §F) to en_us **and all 9 locale files**.

8. **Score / Refugees / charts**: Score remains an `economy` metric (no work — just don't move it).
   Refugees/Net-Migration belong to Phase 3 (they arrive with Emigration). Nothing in Phase 1 drops a
   chart — verify every `metrics` id from the old PAGES is present in some new page (01 §A is exhaustive).

## Files
`screen/screen-demographics.js` (VIEW_TABS + dispatch), `views/history/view-history.js` (PageDef
generalization, hub page sets), `views/history/view-history-state.js` (aliases + clamp),
`views/history/history-tabs.js` (page-row build reads `tier`), `core/demographics-tiers.js` (per-page
tier), `views/relations/view-relations.js` (wrap as render page), text XML (en_us + 9 locales).

## Acceptance (in addition to 01 §H)
- Demographics-only: four hub tabs appear; every old page's metrics are reachable under a new page;
  Relations opens as a Geopolitics page; Rankings unchanged.
- Basic tier shows economy/science_culture/society/expansion + military + population + rankings; hides
  resources/age/wars/crises/agreements/relations and migration's advanced pages.
- A save with `currentPage` = `power`/`knowledge`/`conflicts` opens on expansion/science_culture/wars
  (alias), never a thrown error.
- `wars_gantt`, `crisis_stages`, `legacy_radar`, `resources_stack` synthetic renderers still draw.
- `npm run verify` (demographics) green.
