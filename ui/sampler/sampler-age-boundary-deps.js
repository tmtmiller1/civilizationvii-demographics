// sampler-age-boundary-deps.js
//
// Builder for PlayerAgeTransitionComplete dependency bag.

/**
 * Build dependency bag consumed by age-boundary handler.
 * @param {{
 *   resetAgeCaches: () => void,
 *   getCurrentAgeType: () => (string|undefined),
 *   storage: { load: () => any, save: (history:any) => void },
 *   ilog: (...a:any[]) => void,
 *   tripIfTooMany: (label:string, e:any) => void,
 *   doSample: () => any,
 *   getCurrentTurn: () => (number|undefined),
 *   isDisabled: () => boolean
 * }} deps Dependencies.
 * @returns {import("/demographics/ui/sampler/sampler-age-boundary.js").AgeBoundaryDeps}
 *   Age-boundary dependency bag.
 */
export function buildAgeBoundaryDeps(deps) {
  return {
    resetAgeCaches: deps.resetAgeCaches,
    getCurrentAgeType: deps.getCurrentAgeType,
    loadHistory: () => deps.storage.load(),
    saveHistory: (history) => deps.storage.save(history),
    ilog: deps.ilog,
    tripIfTooMany: deps.tripIfTooMany,
    doSample: deps.doSample,
    getCurrentTurn: deps.getCurrentTurn,
    isDisabled: deps.isDisabled
  };
}
