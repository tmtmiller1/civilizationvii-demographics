// cinematic-tour-highlights.js
//
// City "what to feature" analysis for the Top-Cities cinematic tour: scans a
// settlement for the points of interest worth filming - visitable wonders,
// special / unique-quarter districts, and top-yield plots - and assembles the
// POI list the tour's camera shots are built around. Extracted from
// cinematic-tour.js so that file keeps the camera + playback mechanics while the
// "what's interesting in this city" logic lives here. Pure analysis over engine
// globals (no imports); cityHighlights() is the entry point, consumed by buildTour.

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
 * Return unique-quarter display info, including the engine's own localized
 * description (the "what goes on here" flavor) when present.
 * @param {*} quarterType Unique quarter type.
 * @returns {{name: string, type: string, description: string}|null} Quarter info.
 */
export function uniqueQuarterInfo(quarterType) {
  try {
    const row =
      typeof GameInfo !== "undefined" && GameInfo.UniqueQuarters
        ? GameInfo.UniqueQuarters.lookup(quarterType)
        : null;
    if (row && row.Name && typeof Locale !== "undefined" && Locale.compose) {
      return {
        name: Locale.compose(row.Name),
        type: row.UniqueQuarterType,
        description: row.Description ? Locale.compose(row.Description) : ""
      };
    }
  } catch (_) {
    // lookup/compose can throw.
  }
  return null;
}

/**
 * Resolve unique-quarter districts for a target city.
 * @param {*} target Settlement record.
 * @returns {Array<{name: string, location: {x: number, y: number},
 *   quarterType: string, description: string}>} District entries.
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
        quarterType: info.type,
        description: info.description || ""
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
 * Append wonder POIs into a city highlight list.
 * @param {Array<{loc: {x: number, y: number}, cap: *}>} pois POI accumulator.
 * @param {*} target Settlement record.
 */
function pushWonderPois(pois, target) {
  for (const wonder of visitableWonders(target)) {
    pois.push({
      loc: wonder.location,
      cap: { nameKey: wonder.nameKey, year: wonder.year }
    });
  }
}

/**
 * Append district POIs into a city highlight list.
 * @param {Array<{loc: {x: number, y: number}, cap: *}>} pois POI accumulator.
 * @param {*} target Settlement record.
 */
function pushDistrictPois(pois, target) {
  for (const district of Array.isArray(target.districts) ? target.districts : []) {
    if (!district || !district.location) continue;
    pois.push({
      loc: district.location,
      cap: { text: district.name, flavor: district.description || "" }
    });
  }
}

/**
 * Append natural-wonder and rich-plot POIs.
 * @param {Array<{loc: {x: number, y: number}, cap: *}>} pois POI accumulator.
 * @param {*} target Settlement record.
 */
function pushTerrainPois(pois, target) {
  const plots = livePurchased(target.componentId);
  for (const plot of plots) {
    if (!isNatWonder(plot.x, plot.y)) continue;
    pois.push({
      loc: { x: plot.x, y: plot.y },
      cap: { textKey: "LOC_DEMOGRAPHICS_SETTLEMENTS_POI_NATURAL" }
    });
    break;
  }
  const rich = topYieldPlot(plots, target.owner && target.owner.pid);
  if (!rich) return;
  pois.push({
    loc: rich,
    cap: { textKey: "LOC_DEMOGRAPHICS_SETTLEMENTS_POI_DISTRICT" }
  });
}

/**
 * Build POIs for city highlights.
 * @param {*} target Settlement record.
 * @returns {Array<{loc: {x: number, y: number}, cap: *}>} Points of interest.
 */
export function cityHighlights(target) {
  /** @type {Array<{loc: {x: number, y: number}, cap: *}>} */
  const pois = [];
  pushWonderPois(pois, target);
  pushDistrictPois(pois, target);
  pushTerrainPois(pois, target);
  return pois;
}
