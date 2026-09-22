// history-state.js
//
// Session view state shared by every view (selected tabs, filters, the open game). Kept in memory
// only: it resets when the game restarts, which is the expected behavior for view selections.

/**
 * @typedef {Object} ViewState
 * @property {string} tab History page: "chronicle" | "lineage".
 * @property {string} hofTab Hall of Fame tab: "overview" | "games" | "leaders" | "civs" | "records".
 * @property {string} age Chronicle age filter: "all" or an age type.
 * @property {string} filter Chronicle category filter.
 * @property {boolean} newestFirst Chronicle order.
 * @property {number} limit Chronicle rows to render.
 * @property {boolean} showShort Show short unfinished games in the Hall of Fame.
 * @property {string|null} detail Id of the game open in the Hall of Fame detail view.
 * @property {string} tlAge Timeline window: "all" or an age type.
 * @property {number} tlZoom Timeline zoom (1, 2 or 4).
 * @property {{key:string, pids:number[]}|null} tlCivs Civilizations picked in the timeline's filter, for the game
 *   `key` (another game starts again from just your own).
 */

/** @type {ViewState} */
export const viewState = {
  tab: "chronicle",
  hofTab: "overview",
  age: "all",
  filter: "all",
  newestFirst: true,
  limit: 300,
  showShort: false,
  detail: null,
  tlAge: "all",
  tlZoom: 1,
  tlCivs: null
};

/** Chronicle rows added by "Show more". */
export const LIMIT_STEP = 300;
