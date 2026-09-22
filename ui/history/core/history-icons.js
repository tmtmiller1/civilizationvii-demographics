// history-icons.js
//
// The game's own icons for the timeline. Everything here is a texture path ("blp:..." or
// "fs://game/..."), used as a CSS background, because the icon table (UI.getIconURL) is loaded in
// game only while the Hall of Fame also shows at the main menu; texture paths draw in both (watched
// on 1.5.0). A wonder's or religion's own icon is therefore resolved in game when the record is
// built and stored with it; everything else comes from the fixed table below.

import { safe } from "/demographics/ui/history/core/history-log.js";

/** The icon for each kind of timeline mark, and the fallbacks for wonders and religions. */
export const KIND_ICONS = /** @type {Record<string, string>} */ ({
  victory: "blp:ntf_team_victorious",
  wonder: "blp:ntf_wonder_completed",
  triumph: "blp:ntf_triumph_wil",
  religion: "blp:ntf_religion_created",
  capture: "blp:ntf_capital_captured",
  lost: "blp:ntf_capital_lost",
  elim: "blp:ntf_player_defeated",
  crisis: "blp:ntf_crisis",
  war: "blp:ntf_declare_war",
  peace: "blp:ntf_make_peace"
});

/** The icon for each family of natural disaster. */
export const DISASTER_ICONS = /** @type {Record<string, string>} */ ({
  volcano: "blp:ntf_volcano_erupts_1",
  flood: "blp:ntf_river_floods_1",
  storm: "blp:ntf_storm_arrived",
  fire: "blp:ntf_volcano_active",
  other: "blp:ntf_default"
});

/**
 * The icon of a mark: its own resolved icon when it has one, else its kind's.
 * @param {{k:string, i?:string}} m Mark.
 * @returns {string} Texture path ("" when there is none).
 */
export function markIcon(m) {
  return m.i || KIND_ICONS[m.k] || "";
}

/**
 * A wonder's or religion's own icon, looked up in the game's icon table (in game only; "" at the
 * main menu, where the table is not loaded, or for other kinds).
 * @param {string} type Engine type (e.g. "WONDER_PYRAMIDS", "RELIGION_BUDDHISM").
 * @param {string} kind Mark kind.
 * @returns {string} Texture path, or "".
 */
export function engineIcon(type, kind) {
  if (!type || (kind !== "wonder" && kind !== "religion")) return "";
  if (typeof UI === "undefined" || typeof UI.getIconURL !== "function") return "";
  const url = safe(() => UI.getIconURL(type, kind === "religion" ? "PLAYER" : ""), "");
  return typeof url === "string" && /^(blp:|fs:\/\/)/.test(url) ? url : "";
}
