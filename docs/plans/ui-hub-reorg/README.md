# UI Hub Reorganization — plan set

> **STATUS (2026-06-23): all phases 1–5 implemented, both mods `npm run verify` green, installed to the
> live Civ7 Mods dirs. Awaiting in-game runtime verification.** See the per-phase "STATUS" notes and the
> deferred items at the bottom of this file.


Restructure the combined Demographics + Emigration analytics UI around the **player's questions**
(not the mod boundary), as four subject hubs: **Global Statistics · Migration · Geopolitics ·
Rankings**. Demographics owns the hub shell; Emigration fills the Migration hub when present. Each
mod must keep working standalone.

## Read in this order

| File | Role |
|---|---|
| [00-design.md](00-design.md) | **The what** — final IA (L1/L2/L3), principles, standalone matrix, chart-preservation, control grammar. Source of truth for the target. |
| [01-foundations.md](01-foundations.md) | **Phase 0 — the how-prerequisites.** Metric-ID map, ID/persistence migration, the hub architecture (3 content kinds), tier/age-gating remap, `registerHubPages` contract, new LOC keys, the Table-renderer spike. Nothing else builds cleanly until this is settled. |
| [02-phase1-demographics-hubs.md](02-phase1-demographics-hubs.md) | Phase 1 — Demographics-only hub + L2 reorg (ships standalone). |
| [03-phase2-hub-api.md](03-phase2-hub-api.md) | Phase 2 — the `registerHubPages` contribution API. |
| [04-phase3-emigration-fills-migration.md](04-phase3-emigration-fills-migration.md) | Phase 3 — Emigration injects its pages into the Migration hub. |
| [05-phase4-grammar-consolidations.md](05-phase4-grammar-consolidations.md) | Phase 4 — control-grammar sweep + the Net Migration / Population-anchor consolidations. |
| [06-phase5-solo-parity.md](06-phase5-solo-parity.md) | Phase 5 — standalone Emigration window adopts the same grammar. |

## Invariants (every phase)
- `npm run verify` green for the mod(s) touched at the end of each phase.
- **Both mods work standalone at every step** — Demographics never imports Emigration; Emigration
  feature-detects the host.
- **No chart dropped** (see 00-design §Chart-preservation).
- **Metric IDs are stable persisted keys** — never hard-rename a metric id; only regroup. Page/group
  ids that change get an alias (see 01-foundations §Persistence migration).
- New player-facing text = LOC key added to en_us **and all 9 locale files**; needs a game relaunch.

## Implementation notes / deferred items (2026-06-23)

What shipped vs the design, and what's intentionally deferred:

- **Phase 3 — Migration pages are FLAT as designed**, but built by reusing existing host machinery:
  Net Migration is the relocated `emig_graphs` 2D group on a host hub page (`emig_net_migration`); the
  other pages (Network, Causes, My Cities, Policies, Notifications, Guide) are `render` pages calling
  the dashboard section renderer. The Emigration panel is still registered **non-top-level** purely so
  the "Net Migration (Table)" group member can route to its ledger sub-tab; it shows nowhere as a tab.
- **Net Migration pills** are the existing group members (Net Migration Graph/Table, Emigration,
  Immigration, Refugees Left, Refugees Arrived) + Scaled/Civ. The design's *refined* pill set
  (Net · Immigration · Emigration · Refugees[Arrived|Left] + a Graph|Table view axis) is **deferred** —
  every chart is preserved and reachable today; the refinement is cosmetic re-grouping.
- **Phase 4 single Population unit anchor — DEFERRED (by architecture).** Each hub page renders
  independently, so there's no single shared controls row to host one anchor; the Scaled/Civ setting is
  already unified via `NumberMode` (toggling on any page sticks), so there's no functional duplication
  bug — only multiple visual instances. A true single anchor needs a shared per-hub controls row (a
  larger host change), left for later.
- **Universal Graph|Table** remains descoped (no generic metric-table renderer; see 01 §G).
- **Locale text**: the 11 new keys carry **English text in all 10 locales** (parity holds); real
  translations are a follow-up.
