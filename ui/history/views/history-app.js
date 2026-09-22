// history-app.js
//
// Entry points for the history features inside Demographics:
// - render(): the History tab (lazy view of screen-demographics), with Chronicle and Lineage pages;
// - renderHallOfFame(): the Hall of Fame, shown as a World Rankings sub-tab in game and as its own
//   screen from the main menu.

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { derr } from "/demographics/ui/history/core/history-log.js";
import { liveCampaign } from "/demographics/ui/history/capture/history-live.js";
import { tabBar } from "/demographics/ui/history/views/history-widgets.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";
import { renderChronicle } from "/demographics/ui/history/views/view-chronicle.js";
import { renderLineage } from "/demographics/ui/history/views/view-lineage.js";
import { castFromDoc, eventVisible } from "/demographics/ui/history/model/history-narrate.js";
import { buildTimeline } from "/demographics/ui/history/model/history-timeline.js";
import { timelineWithMap } from "/demographics/ui/history/views/history-timeline-view.js";
import { mapView } from "/demographics/ui/history/model/history-map.js";
import { engineIcon } from "/demographics/ui/history/core/history-icons.js";
import { emptyState, section } from "/demographics/ui/history/views/history-widgets.js";
import { t } from "/demographics/ui/history/core/history-text.js";
import { renderHof } from "/demographics/ui/history/views/view-hof.js";

export const HISTORY_PAGES = [
  { id: "chronicle", label: "LOC_DEMOGRAPHICS_HIST_TAB_CHRONICLE" },
  { id: "timeline", label: "LOC_DEMOGRAPHICS_HIST_TL_TITLE" },
  { id: "lineage", label: "LOC_DEMOGRAPHICS_HIST_TAB_LINEAGE" }
];

/**
 * The Timeline page for the game being played.
 * @param {HTMLElement} body Container.
 * @param {CampaignDoc|null} doc Campaign.
 * @param {"full"|"met"|"own"} visibility Analytics visibility.
 */
function renderTimelinePage(body, doc, visibility) {
  if (!doc || !doc.ages.length) {
    body.appendChild(emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_CHRONICLE")));
    return;
  }
  const cast = castFromDoc(doc, visibility);
  const tl = buildTimeline(doc, (e) => eventVisible(e, cast), cast.known, engineIcon);
  body.appendChild(el("div", { cls: "dgh-scroll" }, [section(t("LOC_DEMOGRAPHICS_HIST_TL_TITLE"), timelineWithMap(tl, mapView(doc), cast, null, "live"))]));
}

/** GameConfiguration key where Demographics publishes the effective analytics policy. */
const POLICY_KEY = "DemographicsAnalyticsPolicyEffective_v1";

/**
 * The analytics policy as a visibility mode, read from the value the Demographics screen publishes
 * on open (a host ceiling in multiplayer, else the player's own choice). Unknown or unreadable
 * values fall back to "met", the default policy.
 * @returns {"full"|"met"|"own"} Visibility.
 */
export function historyVisibility() {
  let v = "";
  try {
    v = String(Configuration.getGame().getValue(POLICY_KEY) || "");
  } catch (_) {
    // GameConfiguration unavailable: use the default.
  }
  if (v === "full") return "full";
  return v === "own-civ-only" || v === "disabled" ? "own" : "met";
}

/**
 * Render the History tab. Signature matches screen-demographics' lazy views.
 * @param {HTMLElement} host The cleared view host.
 * @param {*} [_args] `{ history, settings }` from the screen (unused: the chronicle has its own store).
 */
export function render(host, _args) {
  const rerender = () => render(host);
  try {
    clear(host);
    if (!HISTORY_PAGES.some((p) => p.id === viewState.tab)) viewState.tab = "chronicle";
    const root = el("div", { cls: "dgh-app" });
    host.appendChild(root);
    root.appendChild(
      tabBar(HISTORY_PAGES, viewState.tab, (id) => { viewState.tab = id; rerender(); }, "demographics-page-tabs")
    );
    const body = el("div", { cls: "dgh-view dgh-view--" + viewState.tab });
    root.appendChild(body);
    const visibility = historyVisibility();
    if (viewState.tab === "lineage") renderLineage(body, liveCampaign(), visibility);
    else if (viewState.tab === "timeline") renderTimelinePage(body, liveCampaign(), visibility);
    else renderChronicle(body, liveCampaign(), rerender, visibility);
  } catch (e) {
    derr("history render failed", e);
  }
}

/**
 * Render the Hall of Fame into a host.
 * @param {HTMLElement} host Container.
 * @param {{mode: "game"|"shell"}} opts In game the current campaign is included live.
 */
export function renderHallOfFame(host, opts) {
  const rerender = () => renderHallOfFame(host, opts);
  try {
    clear(host);
    const root = el("div", { cls: "dgh-app" });
    host.appendChild(root);
    const body = el("div", { cls: "dgh-view dgh-view--hof" });
    root.appendChild(body);
    const inGame = opts.mode === "game";
    renderHof(body, { live: inGame ? liveCampaign() : null, rerender, embedded: inGame });
  } catch (e) {
    derr("hall of fame render failed", e);
  }
}
