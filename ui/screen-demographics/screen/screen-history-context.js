// screen-history-context.js
//
// Builds the render context handed to the Historical Data view: a snapshot of
// the screen's current state plus the mutate-persist-rerender callbacks. Pulled
// out of ScreenDemographics so the screen class owns lifecycle, not view wiring.

/**
 * The history view's mutation callbacks. Each updates a state field, persists
 * it where applicable, and re-renders.
 * @typedef {object} HistoryCallbacks
 * @property {(id: string) => void} setActiveRadarAge Set the radar-chart age.
 * @property {(pid: Pid | null) => void} setWarsFilterPid Filter wars by player.
 * @property {(id: number | null) => void} setWarGraphsWarId Select a war for War Graphs.
 * @property {(id: string) => void} setCrisisGraphsAge Select a crisis scope for Crisis Graphs.
 * @property {(v: boolean) => void} setWarsShowCs Toggle city-states in wars.
 * @property {(v: boolean) => void} setWarsActiveOnly Toggle active-only wars.
 * @property {(pid: Pid | null) => void} setResourcesViewerPid Open resources.
 * @property {(leaderKey: string) => void} toggleFocusCiv Toggle a focused civ.
 * @property {() => void} clearFocus Clear all focused civs.
 * @property {(id: string) => void} setActiveMetric Switch the active metric.
 * @property {(id: string) => void} setActivePage Switch the active page.
 * @property {(id: string) => void} setActiveTimeFilter Switch the time filter.
 * @property {(leaderKey: string) => void} toggleCiv Toggle a hidden civ.
 * @property {(hide: boolean, keys: string[]) => void} setAllCivsHidden Hide/show all civs.
 * @property {() => void} requestReload Reload history and re-render.
 */

/**
 * Build the context object passed to the history view, including all of its
 * state values and the callbacks that mutate-then-persist-then-rerender.
 * @param {*} screen The ScreenDemographics instance.
 * @returns {*} The history view render context.
 */
export function buildHistoryContext(screen) {
  return {
    history: screen.history,
    activeMetric: screen.activeMetric,
    activePage: screen.activePage,
    activeTimeFilter: screen.activeTimeFilter,
    hiddenCivs: screen.hiddenCivs,
    focusedCivs: screen.focusedCivs,
    resourcesViewerPid: screen.resourcesViewerPid,
    chartMod: screen.chartMod,
    settings: screen.settings,
    storage: screen.storage,
    activeRadarAge: screen.activeRadarAge,
    warsFilterPid: screen.warsFilterPid,
    warGraphsWarId: screen.warGraphsWarId,
    crisisGraphsAge: screen.crisisGraphsAge,
    warsShowCs: screen.warsShowCs,
    warsActiveOnly: screen.warsActiveOnly,
    ...buildHistoryCallbacks(screen)
  };
}

/**
 * Build the history view's mutation callbacks. Each updates a state field,
 * persists it where applicable, and re-renders.
 * @param {*} screen The ScreenDemographics instance.
 * @returns {HistoryCallbacks} The callback bag merged into the history context.
 */
function buildHistoryCallbacks(screen) {
  return {
    setActiveRadarAge: (id) => screen._setAndPersist("activeRadarAge", "activeRadarAge", id),
    setWarsFilterPid: (pid) => screen._setAndPersist("warsFilterPid", "warsFilterPid", pid),
    setWarGraphsWarId: (id) => screen._setAndPersist("warGraphsWarId", "warGraphsWarId", id),
    setCrisisGraphsAge: (id) => screen._setAndPersist("crisisGraphsAge", "crisisGraphsAge", id),
    setWarsShowCs: (v) => screen._setAndPersist("warsShowCs", "warsShowCs", !!v),
    setWarsActiveOnly: (v) => screen._setAndPersist("warsActiveOnly", "warsActiveOnly", !!v),
    setResourcesViewerPid: (pid) =>
      screen._setAndPersist("resourcesViewerPid", "resourcesViewerPid", pid),
    toggleFocusCiv: (leaderKey) => screen._toggleFocusCiv(leaderKey),
    clearFocus: () => screen._clearFocus(),
    setActiveMetric: (id) => screen._setActiveMetric(id),
    setActivePage: (id) => screen._setAndPersist("activePage", "activePage", id),
    setActiveTimeFilter: (id) => screen._setActiveTimeFilter(id),
    toggleCiv: (leaderKey) => screen.toggleCiv(leaderKey),
    setAllCivsHidden: (hide, keys) => screen.setAllCivsHidden(hide, keys),
    requestReload: () => screen._reload()
  };
}
