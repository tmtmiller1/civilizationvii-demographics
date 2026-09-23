// view-lineage.js
//
// Lineage: one row per leader, one column per age, each cell the civilization that leader led in
// that age, in the leader's color. Shows at a glance how every empire changed across the ages and
// when a line ended. Leaders the player has not met are left out.

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { t, typeName } from "/demographics/ui/history/core/history-text.js";
import { castFromDoc } from "/demographics/ui/history/model/history-narrate.js";
import { civIcon, emptyState, leaderIcon, section } from "/demographics/ui/history/views/history-widgets.js";
import { ageName } from "/demographics/ui/history/views/view-chronicle.js";

/**
 * Player ids in display order: the local player, then everyone else known, living first.
 * @param {CampaignDoc} doc Campaign.
 * @param {(pid:number) => boolean} known Visibility.
 * @returns {number[]} Ids.
 */
export function lineageOrder(doc, known) {
  return Object.keys(doc.players)
    .map(Number)
    .filter((pid) => known(pid))
    .sort((a, b) =>
      Number(b === doc.local) - Number(a === doc.local) ||
      Number(!!doc.players[String(a)].elim) - Number(!!doc.players[String(b)].elim) ||
      a - b
    );
}

/**
 * One cell: the civilization held in an age, a "fallen" marker, or nothing.
 * @param {HnrPlayer} p Player.
 * @param {HnrAge} age Age.
 * @param {string} color Readable display color.
 * @returns {HTMLElement} Cell.
 */
function cell(p, age, color) {
  const span = (p.civs || []).find((c) => c.age === age.age);
  const fell = p.elim && p.elim >= age.start && p.elim <= age.end;
  if (!span) {
    const note = fell ? t("LOC_DEMOGRAPHICS_HIST_LINEAGE_FALLEN") : p.elim === -1 ? t("LOC_DEMOGRAPHICS_HIST_LINEAGE_GONE") : "";
    return el("div", { cls: "dgh-lin-cell is-empty", text: note });
  }
  const name = el("div", { cls: "dgh-lin-civrow" }, [
    civIcon(span.civ, "dgh-civ-icon dgh-civ-icon--md"),
    el("div", { cls: "dgh-lin-civ", text: typeName(span.name, span.civ) })
  ]);
  const kids = [name];
  if (fell) kids.push(el("div", { cls: "dgh-lin-fell", text: t("LOC_DEMOGRAPHICS_HIST_LINEAGE_FELL_TURN", p.elim) }));
  return el("div", { cls: "dgh-lin-cell", style: { borderColor: color || "#a8845a" } }, [
    el("div", { cls: "dgh-lin-band", style: { backgroundColor: color || "#a8845a" } }),
    ...kids
  ]);
}

/**
 * Render the lineage grid.
 * @param {HTMLElement} host Container.
 * @param {CampaignDoc|null} doc Campaign.
 * @param {"full"|"met"|"own"} [visibility] Analytics visibility (see castFromDoc).
 */
export function renderLineage(host, doc, visibility = "met") {
  clear(host);
  if (!doc || !doc.ages.length) {
    host.appendChild(emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_CHRONICLE")));
    return;
  }
  const cast = castFromDoc(doc, visibility);
  const head = el("div", { cls: "dgh-lin-row dgh-lin-head" }, [
    el("div", { cls: "dgh-lin-leader", text: t("LOC_DEMOGRAPHICS_HIST_COL_LEADER") }),
    ...doc.ages.map((a) => el("div", { cls: "dgh-lin-cell dgh-lin-age", text: ageName(doc, a.age) }))
  ]);
  const rows = lineageOrder(doc, cast.known).map((pid) => {
    const p = doc.players[String(pid)];
    return el("div", { cls: "dgh-lin-row" + (pid === doc.local ? " is-mine" : "") }, [
      el("div", { cls: "dgh-lin-leader" }, [leaderIcon(p.leader), el("div", { cls: "dgh-lin-name", text: cast.leaderName(pid) })]),
      ...doc.ages.map((a) => cell(p, a, cast.color(pid)))
    ]);
  });
  const hidden = Object.keys(doc.players).length - rows.length;
  host.appendChild(el("div", { cls: "dgh-scroll" }, [
    section(t("LOC_DEMOGRAPHICS_HIST_LINEAGE_TITLE"), [el("div", { cls: "dgh-lineage" }, [head, ...rows])]),
    hidden > 0 ? el("div", { cls: "dgh-note", text: t("LOC_DEMOGRAPHICS_HIST_HIDDEN_LEADERS", hidden) }) : null
  ]));
}
