const FIREWORK_STEP_MS = 550;
const DEFAULT_FOV = 45;

export const FIREWORK_VFX = [
  "VFX_WON_Firework_01",
  "VFX_WON_Firework_02",
  "VFX_WON_Firework_03",
  "VFX_WON_Firework_04",
  "VFX_WON_Firework_05",
  "VFX_WON_Firework_06",
  "VFX_WON_Firework_07",
  "VFX_WON_Confetti"
];

const CLUTTER_LAYERS = [
  "fxs-yields-layer",
  "fxs-worker-yields-layer",
  "fxs-resource-layer",
  "fxs-hexgrid-layer",
  "fxs-city-borders-layer",
  "fxs-culture-borders-layer",
  "fxs-appeal-layer",
  "fxs-general-appeal-layer",
  "fxs-trade-layer",
  "fxs-continent-layer",
  "fxs-settlement-recommendations-layer",
  "fxs-discovery-layer",
  "fxs-random-events-layer"
];

/** @type {*} */
let lens_mgr = null;
import("/core/ui/lenses/lens-manager.js")
  .then((mod) => {
    const loaded = /** @type {*} */ (mod);
    lens_mgr =
      (loaded && (loaded.default || loaded.LensManager || loaded)) || null;
  })
  .catch(() => {
    // lens-manager unavailable in this context; overlays will not be hidden.
  });

/**
 * Set camera vertical field of view.
 * @param {number} fov The field of view.
 */
export function setFoV(fov) {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.setVerticalFoV === "function") {
      Camera.setVerticalFoV(fov);
    }
  } catch (_) {
    // API may be unavailable.
  }
}

/**
 * Read camera vertical FoV.
 * @returns {number} The active FoV.
 */
export function readFoV() {
  try {
    const state =
      typeof Camera !== "undefined" && Camera.getState ? Camera.getState() : null;
    const fov = state && (state.verticalFoV || state.fov);
    return typeof fov === "number" && fov > 0 ? fov : DEFAULT_FOV;
  } catch (_) {
    return DEFAULT_FOV;
  }
}

/**
 * Whether cinematic push-cameras are available.
 * @returns {boolean} True when push/pop cameras exist.
 */
export function cameraSupportsTour() {
  return (
    typeof Camera !== "undefined" &&
    typeof Camera.pushDynamicCamera === "function" &&
    typeof Camera.pushFlyoverCamera === "function" &&
    typeof Camera.popCamera === "function"
  );
}

/**
 * Push a dynamic orbit shot.
 * @param {{x: number, y: number}} plot The plot.
 * @param {*} params Camera params.
 */
export function pushOrbit(plot, params) {
  try {
    Camera.pushDynamicCamera({ x: plot.x, y: plot.y }, params);
  } catch (_) {
    // pushDynamicCamera can throw mid-transition.
  }
}

/**
 * Push a flyover shot.
 * @param {{x: number, y: number}} plot The plot.
 * @param {*} params Camera params.
 */
export function pushFlyover(plot, params) {
  try {
    Camera.pushFlyoverCamera({ x: plot.x, y: plot.y }, params);
  } catch (_) {
    // pushFlyoverCamera can throw mid-transition.
  }
}

/**
 * Pop one active shot camera if present.
 * @param {*} holder Flow state holder.
 */
export function popShotCamera(holder) {
  try {
    if (holder && holder.pushedCamera && typeof Camera !== "undefined" && Camera.popCamera) {
      Camera.popCamera();
      holder.pushedCamera = false;
    }
  } catch (_) {
    // popCamera can throw if stack is unexpected.
  }
}

/**
 * Read whether a map clutter layer is enabled.
 * @param {string} name The layer name.
 * @returns {boolean} True when the layer is enabled.
 */
export function layerOn(name) {
  try {
    return (
      !!lens_mgr &&
      typeof lens_mgr.isLayerEnabled === "function" &&
      !!lens_mgr.isLayerEnabled(name)
    );
  } catch (_) {
    return false;
  }
}

/**
 * Hide map clutter layers and return previously-enabled names.
 * @returns {string[]} The layers that were enabled.
 */
export function hideClutterLayers() {
  /** @type {string[]} */
  const hidden = [];
  if (!lens_mgr || typeof lens_mgr.disableLayer !== "function") return hidden;
  for (const name of CLUTTER_LAYERS) {
    if (layerOn(name)) hidden.push(name);
    try {
      lens_mgr.disableLayer(name);
    } catch (_) {
      // Unknown layer should not abort the rest.
    }
  }
  return hidden;
}

/**
 * Re-enable previously hidden map layers.
 * @param {string[]} names Layer names.
 */
export function restoreClutterLayers(names) {
  if (!lens_mgr || typeof lens_mgr.enableLayer !== "function") return;
  for (const name of names || []) {
    try {
      lens_mgr.enableLayer(name);
    } catch (_) {
      // Ignore single-layer restore failure.
    }
  }
}

/**
 * Merge dynamic-camera defaults with role params.
 * @param {*} base Base params.
 * @param {number} arc Orbit arc.
 * @returns {*} Full dynamic-camera params.
 */
export function orbitParams(base, arc) {
  return Object.assign(
    { easeInFactor: 2, easeOutFactor: 2, maxArcAngle: arc, leadInRange: 0 },
    base
  );
}

/**
 * Merge flyover defaults with role params.
 * @param {*} base Base params.
 * @returns {*} Full flyover-camera params.
 */
export function flyoverParams(base) {
  return Object.assign(
    {
      focusRange: 48,
      targetDistance: 120,
      endpointRange: 48,
      curvature: 0.5,
      panStrength: 0.35,
      maxMovement: 130,
      easeInFactor: 2.5,
      easeOutFactor: 2
    },
    base
  );
}

/**
 * Build a shot descriptor.
 * @param {string} kind Shot kind.
 * @param {{x: number, y: number}} plot Shot plot.
 * @param {*} params Camera params.
 * @param {*} [caption] Optional caption.
 * @param {number|null} [fov] Optional FoV override.
 * @returns {{kind: string, plot: *, params: *, duration: number, caption: *, fov: number|null}} Shot descriptor.
 */
export function shot(kind, plot, params, caption, fov) {
  return {
    kind,
    plot,
    params,
    duration: params.duration,
    caption: caption || null,
    fov: fov || null
  };
}

/**
 * Build the opening or finale establish shot.
 * @param {{x: number, y: number}} city The city plot.
 * @param {boolean} rotate Whether rotation is allowed.
 * @param {string} role "open" | "finale".
 * @returns {*} Shot descriptor.
 */
export function establishShot(city, rotate, role) {
  const base =
    role === "finale"
      ? {
          focusHeight: 12,
          cameraHeight: 90,
          orbitRadius: 132,
          duration: 5.5,
          arcHeight: 10
        }
      : {
          focusHeight: 10,
          cameraHeight: 100,
          orbitRadius: 152,
          duration: 5.5,
          arcHeight: 12
        };
  const arc = rotate ? (role === "finale" ? 95 : 80) : 38;
  return shot("orbit", city, orbitParams(base, arc));
}

/**
 * Build an oblique flyover shot.
 * @param {{x: number, y: number}} plot The target plot.
 * @param {number} angle Primary angle.
 * @param {number} duration Shot duration in seconds.
 * @param {*} [caption] Optional caption.
 * @returns {*} Shot descriptor.
 */
export function obliqueShot(plot, angle, duration, caption) {
  return shot(
    "flyover",
    plot,
    flyoverParams({
      cameraHeight: 38,
      focusHeight: 7,
      duration,
      primaryAngle: angle
    }),
    caption
  );
}

/**
 * Build a two-shot POI vignette.
 * @param {{loc: {x: number, y: number}, cap: *}} poi Point of interest.
 * @param {number} index The POI index.
 * @returns {Array<*>} Shots for this POI.
 */
export function poiVignette(poi, index) {
  const approach = obliqueShot(poi.loc, 150 + index * 55, 3.0, poi.cap);
  const orbit = shot(
    "orbit",
    poi.loc,
    orbitParams(
      {
        focusHeight: 8,
        cameraHeight: 64,
        orbitRadius: 92,
        duration: 4.5,
        arcHeight: 7
      },
      60
    ),
    poi.cap
  );
  return [approach, orbit];
}

/**
 * Return purchased-plot indices for a city.
 * @param {*} componentId City component id.
 * @returns {number[]} Plot indices.
 */
export function cityPurchasedIndices(componentId) {
  try {
    const city =
      componentId && typeof Cities !== "undefined" && Cities.get
        ? Cities.get(componentId)
        : null;
    const plots = city && typeof city.getPurchasedPlots === "function"
      ? city.getPurchasedPlots()
      : null;
    return Array.isArray(plots) ? plots : [];
  } catch (_) {
    return [];
  }
}

/**
 * Resolve map location from plot index.
 * @param {number} index Plot index.
 * @returns {{x: number, y: number}|null} Plot location.
 */
export function indexToLoc(index) {
  try {
    const loc =
      typeof GameplayMap !== "undefined" && GameplayMap.getLocationFromIndex
        ? GameplayMap.getLocationFromIndex(index)
        : null;
    return loc && typeof loc.x === "number" ? loc : null;
  } catch (_) {
    return null;
  }
}

/**
 * Return purchased plots as [{idx,x,y}] for a city.
 * @param {*} componentId City component id.
 * @returns {Array<{idx: number, x: number, y: number}>} Purchased plots.
 */
export function livePurchased(componentId) {
  /** @type {Array<{idx: number, x: number, y: number}>} */
  const out = [];
  for (const idx of cityPurchasedIndices(componentId)) {
    const loc = indexToLoc(idx);
    if (loc) out.push({ idx, x: loc.x, y: loc.y });
  }
  return out;
}

/**
 * Whether a plot is a natural wonder.
 * @param {number} x Plot x.
 * @param {number} y Plot y.
 * @returns {boolean} True for natural wonder.
 */
function isNatWonder(x, y) {
  try {
    return (
      typeof GameplayMap !== "undefined" &&
      typeof GameplayMap.isNaturalWonder === "function" &&
      !!GameplayMap.isNaturalWonder(x, y)
    );
  } catch (_) {
    return false;
  }
}

/**
 * Sum plot yields for an owner.
 * @param {number} idx Plot index.
 * @param {number} pid Owner player id.
 * @returns {number} Total yield.
 */
function plotYieldSum(idx, pid) {
  try {
    const yields =
      typeof GameplayMap !== "undefined" && GameplayMap.getYields
        ? GameplayMap.getYields(idx, pid)
        : null;
    if (!yields) return 0;
    let total = 0;
    for (const entry of yields) {
      const amount = Array.isArray(entry) ? entry[1] : entry;
      if (typeof amount === "number" && isFinite(amount)) total += amount;
    }
    return total;
  } catch (_) {
    return 0;
  }
}

/**
 * Return highest-yield plot from a list.
 * @param {Array<{idx: number, x: number, y: number}>} plots Purchased plots.
 * @param {number} pid Owner player id.
 * @returns {{x: number, y: number}|null} Highest-yield plot.
 */
export function topYieldPlot(plots, pid) {
  let best = null;
  let bestSum = 0;
  for (const plot of plots) {
    const sum = plotYieldSum(plot.idx, pid);
    if (sum > bestSum) {
      bestSum = sum;
      best = plot;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Return district at location.
 * @param {{x: number, y: number}} plot Plot location.
 * @returns {*} District object or null.
 */
export function districtAtPlot(plot) {
  try {
    return typeof Districts !== "undefined" && typeof Districts.getAtLocation === "function"
      ? Districts.getAtLocation({ x: plot.x, y: plot.y })
      : null;
  } catch (_) {
    return null;
  }
}

/**
 * Return unique-quarter display info.
 * @param {*} quarterType Unique quarter type.
 * @returns {{name: string, type: string}|null} Quarter info.
 */
export function uniqueQuarterInfo(quarterType) {
  try {
    const row =
      typeof GameInfo !== "undefined" && GameInfo.UniqueQuarters
        ? GameInfo.UniqueQuarters.lookup(quarterType)
        : null;
    if (row && row.Name && typeof Locale !== "undefined" && Locale.compose) {
      return { name: Locale.compose(row.Name), type: row.UniqueQuarterType };
    }
  } catch (_) {
    // lookup/compose can throw.
  }
  return null;
}

/**
 * Resolve unique-quarter districts for a target city.
 * @param {*} target Settlement record.
 * @returns {Array<{name: string, location: {x: number, y: number}, quarterType: string}>} District entries.
 */
export function resolveSpecialDistricts(target) {
  const out = [];
  /** @type {Record<string, boolean>} */
  const seen = {};
  for (const plot of livePurchased(target.componentId)) {
    const district = districtAtPlot(plot);
    const quarterType = district ? district.uniqueQuarterType : null;
    if (quarterType == null) continue;
    if (
      typeof UniqueQuarterTypes !== "undefined" &&
      quarterType === UniqueQuarterTypes.NO_QUARTER
    ) {
      continue;
    }
    if (seen[String(quarterType)]) continue;
    seen[String(quarterType)] = true;
    const info = uniqueQuarterInfo(quarterType);
    if (info && info.name) {
      out.push({
        name: info.name,
        location: { x: plot.x, y: plot.y },
        quarterType: info.type
      });
    }
  }
  return out;
}

/**
 * Return wonder records that include map location.
 * @param {*} target Settlement record.
 * @returns {Array<*>} Visitable wonder records.
 */
export function visitableWonders(target) {
  const out = [];
  for (const wonder of Array.isArray(target.wonders) ? target.wonders : []) {
    if (wonder && wonder.location && typeof wonder.location.x === "number") {
      out.push(wonder);
    }
  }
  return out;
}

/**
 * Build POIs for city highlights.
 * @param {*} target Settlement record.
 * @returns {Array<{loc: {x: number, y: number}, cap: *}>} Points of interest.
 */
export function cityHighlights(target) {
  const pois = [];
  for (const wonder of visitableWonders(target)) {
    pois.push({
      loc: wonder.location,
      cap: { nameKey: wonder.nameKey, year: wonder.year }
    });
  }
  for (const district of Array.isArray(target.districts) ? target.districts : []) {
    if (district && district.location) {
      pois.push({ loc: district.location, cap: { text: district.name } });
    }
  }
  const plots = livePurchased(target.componentId);
  for (const plot of plots) {
    if (isNatWonder(plot.x, plot.y)) {
      pois.push({
        loc: { x: plot.x, y: plot.y },
        cap: { textKey: "LOC_DEMOGRAPHICS_SETTLEMENTS_POI_NATURAL" }
      });
      break;
    }
  }
  const rich = topYieldPlot(plots, target.owner && target.owner.pid);
  if (rich) {
    pois.push({
      loc: rich,
      cap: { textKey: "LOC_DEMOGRAPHICS_SETTLEMENTS_POI_DISTRICT" }
    });
  }
  return pois;
}

/**
 * Build the full cinematic tour shot sequence.
 * @param {*} target Settlement record.
 * @param {(key: string, dflt: *) => *} cfg Read settings function.
 * @returns {Array<*>} Shot sequence.
 */
export function buildTour(target, cfg) {
  const rotate = cfg("topCities.flybyAllowRotate", true) === true;
  const medium = cfg("topCities.flybyPreset", "short") === "medium";
  const city = target.location;
  const pois = cityHighlights(target);
  const maxPois = Math.min(pois.length, 10);
  const shots = [establishShot(city, rotate, "open")];
  if (pois.length) {
    pois.slice(0, maxPois).forEach((poi, index) => {
      for (const poiShot of poiVignette(poi, index)) shots.push(poiShot);
    });
  } else {
    shots.push(obliqueShot(city, 210, 5.0));
  }
  if (medium && !pois.length) shots.push(obliqueShot(city, 330, 4.5));
  shots.push(establishShot(city, rotate, "finale"));
  return shots;
}

/**
 * Schedule transition from animating to inspecting.
 * @param {number} ms Delay milliseconds.
 * @param {number} token Active token.
 * @param {*} flowState Active state.
 * @param {(token: number) => boolean} isToken Token validator.
 * @param {(state: *) => void} clearTimers Timer clearing callback.
 */
export function scheduleInspect(ms, token, flowState, isToken, clearTimers) {
  setTimeout(() => {
    if (isToken(token) && flowState.phase === "animating") {
      flowState.phase = "inspecting";
      clearTimers(flowState);
    }
  }, ms);
}

/**
 * Run single-shot cinematic approach.
 * @param {{focus: {x: number, y: number}, zoom: number}} frame Camera frame.
 * @param {number} token Active token.
 * @param {*} flowState Active flow state.
 * @param {{cfg: (key: string, dflt: *) => *, clamp: (v: number, lo: number, hi: number) => number, addKf: (frame: *) => void, isToken: (token: number) => boolean, clearTimers: (state: *) => void}} deps Dependencies.
 */
export function animateSingle(frame, token, flowState, deps) {
  flowState.phase = "animating";
  const duration = deps.clamp(deps.cfg("topCities.cinematicDurationMs", 1200), 600, 2200);
  const tilt = deps.clamp(deps.cfg("topCities.cinematicTilt", 32), 24, 40);
  const zoom = deps.clamp(Math.min(frame.zoom, 0.55), 0.3, 0.6);
  deps.addKf({ duration: duration / 1000, focus: frame.focus, zoom, tilt, end: true });
  scheduleInspect(duration + 150, token, flowState, deps.isToken, deps.clearTimers);
}

/**
 * Return fireworks target plots.
 * @param {*} target Settlement record.
 * @returns {Array<{x: number, y: number}>} Firework plots.
 */
export function fireworkPlots(target) {
  const plots = target.location ? [target.location] : [];
  for (const wonder of visitableWonders(target)) plots.push(wonder.location);
  return plots.slice(0, 6);
}

/**
 * Trigger one random firework burst.
 * @param {{x: number, y: number}} plot Plot location.
 */
export function fireOneFirework(plot) {
  try {
    if (
      typeof WorldUI === "undefined" ||
      typeof WorldUI.triggerVFXAtPlot !== "function"
    ) {
      return;
    }
    const asset = FIREWORK_VFX[Math.floor(Math.random() * FIREWORK_VFX.length)];
    const offset = {
      x: (Math.random() - 0.5) * 1.2,
      y: (Math.random() - 0.5) * 1.2,
      z: 4 + Math.random() * 8
    };
    WorldUI.triggerVFXAtPlot(asset, { x: plot.x, y: plot.y }, offset, {
      angle: Math.random() * 360,
      scale: 1
    });
  } catch (_) {
    // A single failed burst should not break the sequence.
  }
}

/**
 * Start staggered fireworks for duration.
 * @param {Array<{x: number, y: number}>} plots Target plots.
 * @param {number} durationMs Duration in milliseconds.
 * @returns {number[]} Pending timer ids.
 */
export function startFireworks(plots, durationMs) {
  /** @type {number[]} */
  const timers = [];
  if (!plots.length) return timers;
  for (const plot of plots) fireOneFirework(plot);
  const count = Math.max(1, Math.floor(durationMs / FIREWORK_STEP_MS));
  for (let index = 1; index <= count; index++) {
    timers.push(
      setTimeout(
        () => fireOneFirework(plots[index % plots.length]),
        index * FIREWORK_STEP_MS
      )
    );
  }
  return timers;
}

/**
 * Cancel any pending firework timers.
 * @param {*} holder Flow state holder.
 */
export function removeFireworks(holder) {
  try {
    for (const timer of (holder && holder.fireworkTimers) || []) clearTimeout(timer);
  } catch (_) {
    // clearTimeout rarely throws.
  }
  if (holder) holder.fireworkTimers = [];
}

/**
 * Whether settlement is top-three ranked.
 * @param {*} target Settlement record.
 * @returns {boolean} True for rank <= 3.
 */
function isTop3(target) {
  const rank = target.ranks && target.ranks.composite;
  return typeof rank === "number" && rank <= 3;
}

/**
 * Run tour shots sequentially.
 * @param {Array<*>} shots Shot sequence.
 * @param {number} token Active token.
 * @param {*} flowState Flow state.
 * @param {{delay: (ms: number) => Promise<void>, isToken: (token: number) => boolean, updateFlybyProgress: (state: *, i: number, n: number) => void, updateNowShowing: (caption: *) => void}} deps Dependencies.
 * @returns {Promise<"done"|"aborted">} Outcome.
 */
async function runTour(shots, token, flowState, deps) {
  for (let index = 0; index < shots.length; index++) {
    if (!deps.isToken(token)) return "aborted";
    popShotCamera(flowState);
    if (shots[index].fov) {
      setFoV(shots[index].fov);
      flowState.fovTouched = true;
    }
    if (shots[index].kind === "orbit") {
      pushOrbit(shots[index].plot, shots[index].params);
    } else {
      pushFlyover(shots[index].plot, shots[index].params);
    }
    flowState.pushedCamera = true;
    deps.updateFlybyProgress(flowState, index + 1, shots.length);
    deps.updateNowShowing(shots[index].caption);
    await deps.delay(Math.round(shots[index].duration * 1000));
  }
  return deps.isToken(token) ? "done" : "aborted";
}

/**
 * Start a timeout watchdog for tour playback.
 * @param {Array<*>} shots Shot sequence.
 * @param {number} token Active token.
 * @param {*} flowState Flow state.
 * @param {(token: number) => boolean} isToken Token validator.
 * @param {(reason: string) => void} teardownActiveCinematic Teardown callback.
 */
function startTourWatchdog(
  shots,
  token,
  flowState,
  isToken,
  teardownActiveCinematic
) {
  let total = 3000;
  for (const shotDef of shots) total += Math.round((shotDef.duration || 2) * 1000);
  flowState.watchdog = setTimeout(() => {
    if (isToken(token) && flowState.phase === "animating") {
      teardownActiveCinematic("ERR_TIMEOUT");
    }
  }, total);
}

/**
 * Run flyby sequence with full fallbacks.
 * @param {*} target Settlement record.
 * @param {{focus: {x: number, y: number}, zoom: number}|null} frame Fallback frame.
 * @param {number} token Active token.
 * @param {{flowState: *, cfg: (key: string, dflt: *) => *, clamp: (v: number, lo: number, hi: number) => number, addKf: (frame: *) => void, isToken: (token: number) => boolean, clearTimers: (state: *) => void, delay: (ms: number) => Promise<void>, updateFlybyProgress: (state: *, i: number, n: number) => void, updateNowShowing: (caption: *) => void, teardownActiveCinematic: (reason: string) => void, lookAtComponent: (componentId: *) => boolean, lookAtInstantReturn: (loc: {x: number, y: number}) => boolean}} ctx Runtime dependencies.
 */
export function animateFlyby(target, frame, token, ctx) {
  const flowState = ctx.flowState;
  flowState.phase = "animating";
  if (cameraSupportsTour() && target.location) {
    const shots = buildTour(target, ctx.cfg);
    if (isTop3(target)) {
      let total = 0;
      for (const shotDef of shots) total += Math.round((shotDef.duration || 2) * 1000);
      flowState.fireworkTimers = startFireworks(fireworkPlots(target), total);
    }
    startTourWatchdog(
      shots,
      token,
      flowState,
      ctx.isToken,
      ctx.teardownActiveCinematic
    );
    runTour(shots, token, flowState, {
      delay: ctx.delay,
      isToken: ctx.isToken,
      updateFlybyProgress: ctx.updateFlybyProgress,
      updateNowShowing: ctx.updateNowShowing
    }).then((outcome) => {
      if (outcome === "done" && ctx.isToken(token)) {
        flowState.phase = "inspecting";
        ctx.clearTimers(flowState);
      }
    });
    return;
  }
  if (frame) {
    animateSingle(frame, token, flowState, {
      cfg: ctx.cfg,
      clamp: ctx.clamp,
      addKf: ctx.addKf,
      isToken: ctx.isToken,
      clearTimers: ctx.clearTimers
    });
    return;
  }
  if (
    ctx.lookAtComponent(target.componentId) ||
    (target.location && ctx.lookAtInstantReturn(target.location))
  ) {
    flowState.phase = "inspecting";
    return;
  }
  ctx.teardownActiveCinematic("ERR_NO_FRAME");
}
