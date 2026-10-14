// chart-line-wonder-markers.js
//
// Wonder-built event detection, icon/name resolution, hover tooltip, and the
// Chart.js HTML-overlay marker plugin used by chart-line.js (its only caller).

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { localeFontFamily, localYear, stylizeLocaleTag, t } from "/demographics/ui/core/demographics-i18n.js";
import { escapeHtml } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * A detected wonder event on a civ's line.
 * @typedef {Object} WonderEvent
 * @property {number|*} turn Chart-X position (or raw turn fallback).
 * @property {string} year Game-year string ("" when unknown).
 * @property {string} wonderType Engine constructible type.
 * @property {"built"|"destroyed"} [kind] Event kind; "built" when omitted.
 * @property {string} [iconUrl] Resolved icon URL.
 * @property {string} [wonderName] Resolved wonder display name.
 * @property {string} [wonderDescription] Resolved flavor description (plain, for length tests).
 * @property {string} [wonderDescriptionHtml] The same description as engine markup HTML.
 */

/**
 * Read the `showWonderMarkers` setting; defaults off on the Crisis Stage
 * chart, on elsewhere.
 * @param {string} metricId
 * @returns {boolean}
 */
export function shouldShowWonders(metricId) {
  const wonderDefault = metricId === "crisis_stage" ? false : true;
  try {
    return !!DemographicsSettings.getSetting("showWonderMarkers", wonderDefault);
  } catch (_) {
    // DemographicsSettings.getSetting may throw; fall back to the per-metric default.
    return wonderDefault;
  }
}

/**
 * Detect wonder-built events by diffing each civ's `wonderTypes` list between
 * consecutive samples. Pre-existing wonders on a civ's first observed sample
 * are seeded (not emitted).
 * @param {Snapshot[]} samples
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries
 * @param {(sample: Snapshot, offsets: Map<string, number>, boundaries: AgeBoundary[]) => (number|undefined)} sampleX
 *   Sample → chart-X position resolver (provided by chart-line.js).
 * @returns {Map<string, WonderEvent[]>} pid → detected wonder events.
 */
export function collectWonderEvents(samples, ageOffsets, boundaries, sampleX) {
  /** @type {Map<string, WonderEvent[]>} */
  const wonderEventsByPid = new Map();
  /** @type {Map<string, Set<string>>} */
  const seenTypesByPid = new Map(); // pid → Set of types seen so far
  /** @type {Set<string>} */
  const sampledPids = new Set(); // pids we've ever observed in any sample
  for (const sample of samples) {
    if (!sample?.players) continue;
    for (const pid of Object.keys(sample.players)) {
      const samplePlayer = sample.players[pid];
      const types = Array.isArray(samplePlayer?.wonderTypes) ? samplePlayer.wonderTypes : null;
      // "First sample for this civ" is whether we've ever sampled this civ at
      // all, not whether we've seen a wonderTypes array for them; otherwise a
      // civ's very first mid-run wonder would be treated as a seed and dropped.
      const isFirstSample = !sampledPids.has(pid);
      sampledPids.add(pid);
      if (types && types.length > 0) {
        foldWonderTypes({
          wonderEventsByPid,
          seenTypesByPid,
          pid,
          sample,
          types,
          isFirstSample,
          ageOffsets,
          boundaries,
          sampleX
        });
      }
    }
  }
  return wonderEventsByPid;
}

/**
 * @param {{
 *   wonderEventsByPid: Map<string, WonderEvent[]>,
 *   seenTypesByPid: Map<string, Set<string>>,
 *   pid: string,
 *   sample: Snapshot,
 *   types: string[],
 *   isFirstSample: boolean,
 *   ageOffsets: Map<string, number>,
 *   boundaries: AgeBoundary[],
 *   sampleX: (sample: Snapshot, offsets: Map<string, number>,
 *     boundaries: AgeBoundary[]) => (number|undefined),
 * }} params
 */
function foldWonderTypes(params) {
  const {
    wonderEventsByPid,
    seenTypesByPid,
    pid,
    sample,
    types,
    isFirstSample,
    ageOffsets,
    boundaries,
    sampleX
  } = params;
  let seen = seenTypesByPid.get(pid);
  if (!seen) {
    seen = new Set();
    seenTypesByPid.set(pid, seen);
  }
  if (isFirstSample) {
    // Seed-only: these were pre-existing when the sampler first observed
    // this civ. Don't emit.
    for (const wonderType of types) seen.add(wonderType);
    return;
  }
  for (const wonderType of types) {
    if (seen.has(wonderType)) continue;
    seen.add(wonderType);
    let events = wonderEventsByPid.get(pid);
    if (!events) {
      events = [];
      wonderEventsByPid.set(pid, events);
    }
    const chartX = sampleX(sample, ageOffsets, boundaries);
    events.push({
      turn: typeof chartX === "number" ? chartX : sample.turn,
      year: sample.gameYear || "",
      wonderType
    });
  }
}

/**
 * Detect wonder destructions: a wonder is destroyed when its type is present at
 * some sample yet absent from the final sample's global set, which excludes the
 * benign cases (damaged-then-repaired wonders return; captured wonders move to
 * the captor's list). Marked at the last turn seen standing and attributed to
 * the civ that last held it.
 * @param {Snapshot[]} samples
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries
 * @param {(sample: Snapshot, offsets: Map<string, number>, boundaries: AgeBoundary[]) => (number|undefined)} sampleX
 *   Sample → chart-X position resolver (provided by chart-line.js).
 * @returns {Map<string, WonderEvent[]>} pid → detected destruction events.
 */
export function collectWonderDestructions(samples, ageOffsets, boundaries, sampleX) {
  /** @type {Map<string, { pid: string, turn: number|*, year: string }>} */
  const lastSeen = new Map(); // wonderType → last sample it stood (pid + X + year)
  /** @type {Set<string>} */
  let presentInFinal = new Set(); // ends as the final sample's global type set
  for (const sample of samples) {
    if (!sample?.players) continue;
    presentInFinal = foldSamplePresence(sample, ageOffsets, boundaries, sampleX, lastSeen);
  }
  return emitWonderDestructions(lastSeen, presentInFinal);
}

/**
 * @param {Snapshot} sample
 * @param {Map<string, number>} ageOffsets
 * @param {AgeBoundary[]} boundaries
 * @param {(sample: Snapshot, offsets: Map<string, number>, boundaries: AgeBoundary[]) => (number|undefined)} sampleX
 * @param {Map<string, { pid: string, turn: number|*, year: string }>} lastSeen
 *   wonderType → last-seen record (mutated).
 * @returns {Set<string>}
 */
function foldSamplePresence(sample, ageOffsets, boundaries, sampleX, lastSeen) {
  const present = new Set();
  const players = sample.players;
  if (!players) return present;
  const chartX = sampleX(sample, ageOffsets, boundaries);
  const turn = typeof chartX === "number" ? chartX : sample.turn;
  for (const pid of Object.keys(players)) {
    const types = players[pid]?.wonderTypes;
    if (!Array.isArray(types)) continue;
    for (const wonderType of types) {
      present.add(wonderType);
      lastSeen.set(wonderType, { pid, turn, year: sample.gameYear || "" });
    }
  }
  return present;
}

/**
 * @param {Map<string, { pid: string, turn: number|*, year: string }>} lastSeen
 * @param {Set<string>} presentInFinal
 */
function emitWonderDestructions(lastSeen, presentInFinal) {
  /** @type {Map<string, WonderEvent[]>} */
  const out = new Map();
  for (const [wonderType, info] of lastSeen) {
    if (presentInFinal.has(wonderType)) continue; // still standing in the latest sample
    let events = out.get(info.pid);
    if (!events) {
      events = [];
      out.set(info.pid, events);
    }
    events.push({ turn: info.turn, year: info.year, wonderType, kind: "destroyed" });
  }
  return out;
}

/**
 * Merge per-pid destruction events into the build-event map (mutating it), so a
 * single resolve/render pass covers both marker kinds.
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events (mutated).
 * @param {Map<string, WonderEvent[]>} destructionsByPid
 */
export function mergeWonderEvents(wonderEventsByPid, destructionsByPid) {
  for (const [pid, events] of destructionsByPid) {
    const existing = wonderEventsByPid.get(pid);
    if (existing) existing.push(...events);
    else wonderEventsByPid.set(pid, events.slice());
  }
}

/** @param {WonderEvent} wonderEvent Mutated. */
function resolveWonderIcon(wonderEvent) {
  try {
    if (typeof UI !== "undefined" && typeof UI.getIconURL === "function") {
      wonderEvent.iconUrl = UI.getIconURL(wonderEvent.wonderType, "WONDER");
    }
  } catch (_) {
    // UI.getIconURL may be absent or throw; leave wonderEvent.iconUrl unset (event dropped upstream).
  }
}

/** @param {string} tag */
function safeComposeLocaleTag(tag) {
  try {
    if (typeof Locale?.compose === "function") return Locale.compose(tag);
  } catch (_) {
    // Locale.compose may throw on malformed tags.
  }
  return tag;
}

/**
 * @param {string} composed
 * @param {string} rawTag
 * @param {string} best
 */
function shouldUseWonderDescription(composed, rawTag, best) {
  if (!composed) return false;
  if (composed === rawTag) return false;
  return composed.length > best.length;
}

/** @param {*} info The Constructibles lookup row (or null). */
function bestWonderDescription(info) {
  const candidates = [info?.Description, info?.Tooltip].filter(Boolean);
  let best = "";
  let bestTag = "";
  for (const tag of candidates) {
    const composed = safeComposeLocaleTag(tag);
    if (!shouldUseWonderDescription(composed, tag, best)) continue;
    best = composed;
    bestTag = tag;
  }
  // The tag comes back too: the tooltip renders through innerHTML, so it wants the engine's
  // stylized markup, while the length test above needs the composed plain string.
  return { text: best, tag: bestTag };
}

/** @param {WonderEvent} wonderEvent Mutated. */
function resolveWonderMeta(wonderEvent) {
  try {
    const info =
      typeof GameInfo !== "undefined" &&
      GameInfo.Constructibles &&
      typeof GameInfo.Constructibles.lookup === "function"
        ? GameInfo.Constructibles.lookup(wonderEvent.wonderType)
        : null;
    wonderEvent.wonderName = resolveWonderName(wonderEvent.wonderType, info);
    // Flavor / mechanical description. Civ7's Constructibles table carries
    // Description (short mechanical line) and Tooltip (richer text); prefer
    // the longer of the two when both compose successfully.
    const best = bestWonderDescription(info);
    if (best.text) {
      wonderEvent.wonderDescription = best.text;
      wonderEvent.wonderDescriptionHtml = stylizeLocaleTag(best.tag);
    }
  } catch (_) {
    // GameInfo.Constructibles.lookup may be absent or throw; fall back to the raw type as name.
    wonderEvent.wonderName = wonderEvent.wonderType;
  }
}

/**
 * @param {string} wonderType
 * @param {*} info The Constructibles lookup row (or null).
 * @returns {string}
 */
function resolveWonderName(wonderType, info) {
  if (info && info.Name && typeof Locale?.compose === "function") {
    return Locale.compose(info.Name);
  }
  if (info && info.Name) return info.Name;
  return wonderType.replace(/^BUILDING_/, "").replace(/_/g, " ");
}

/**
 * Resolve icon + name for every wonder event, dropping events with no icon
 * and pruning pids that end up empty.
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events (mutated).
 */
export function resolveWonderEvents(wonderEventsByPid) {
  // Resolve display name + icon URL for each event using the engine's
  // canonical accessors. Cite: utilities-image.js
  //   Icon.getWonderIconFromDefinition() === UI.getIconURL(type, "WONDER")
  for (const [pid, events] of wonderEventsByPid) {
    /** @type {WonderEvent[]} */
    const kept = [];
    for (const wonderEvent of events) {
      if (!wonderEvent.wonderType) continue;
      resolveWonderIcon(wonderEvent);
      // Only drop events where the engine returned no icon URL at all.
      if (!wonderEvent.iconUrl) continue;
      resolveWonderMeta(wonderEvent);
      kept.push(wonderEvent);
    }
    if (kept.length === 0) wonderEventsByPid.delete(pid);
    else wonderEventsByPid.set(pid, kept);
  }
}

/**
 * Mutable wrapper around the singleton wonder hover-tooltip element.
 * @typedef {Object} WonderTipState
 * @property {HTMLElement|null} wonderTip The tip element (lazily created).
 * @property {number} [placeToken] Counter identifying the current show, so a re-place frame queued
 *   by an earlier hover can be dropped once the tip is hidden or another marker takes it over.
 * @property {{ w: number, h: number }} [lastTipSize] The last size actually measured off the tip,
 *   used as the estimate on the tick a tip is shown (GameFace has not laid it out yet).
 */

/**
 * @param {WonderTipState} state Mutated.
 * @param {HTMLElement} wrap
 */
function ensureWonderTip(state, wrap) {
  if (state.wonderTip && state.wonderTip.isConnected) return state.wonderTip;
  const wonderTip = document.createElement("div");
  wonderTip.className =
    "demographics-wonder-tooltip demographics-line-wonder-tip demographics-tip-chrome";
  wrap.appendChild(wonderTip);
  state.wonderTip = wonderTip;
  return wonderTip;
}

/**
 * @param {{
 *   state: WonderTipState,
 *   wrap: HTMLElement,
 *   wonderEvent: WonderEvent,
 *   civLabel: string,
 *   iconLeft: number,
 *   iconTop: number,
 *   iconSize: number,
 * }} params
 */
function showWonderTip(params) {
  const { state, wrap, wonderEvent, civLabel, iconLeft, iconTop, iconSize } = params;
  const tip = ensureWonderTip(state, wrap);
  const yearStr = wonderEvent.year ? " · " + localYear(wonderEvent.year) : "";
  // Game-authored text: `wonderDescriptionHtml` is already the engine's own markup (icons, tips),
  // so it goes in unescaped; the escaped plain string is the fallback when stylize gave nothing.
  const plainDesc = wonderEvent.wonderDescription;
  const descBody = wonderEvent.wonderDescriptionHtml || (plainDesc ? escapeHtml(plainDesc) : "");
  const descHtml = descBody
    ? '<div style="margin-top:0.4rem;color:rgb(160,146,120);">' + descBody + "</div>"
    : "";
  // For a destruction, lead with a burnt-orange "Destroyed" banner carrying the
  // raze turn/year; the civ line then reads as who held it (its builder, unless
  // it was captured first). Built events keep their original "Built by" line.
  const destroyedHtml =
    wonderEvent.kind === "destroyed"
      ? '<div style="color:rgb(214,138,92);font-weight:700;font-size:0.8rem;' +
        'letter-spacing:0.02rem;margin-bottom:0.15rem;">' +
        escapeHtml(t("LOC_DEMOGRAPHICS_WONDER_DESTROYED")) +
        ' · ' +
        escapeHtml(t("LOC_DEMOGRAPHICS_WONDER_TURN", wonderEvent.turn)) +
        escapeHtml(yearStr) +
        "</div>"
      : "";
  const turnHtml =
    wonderEvent.kind === "destroyed"
      ? ""
      : '<div style="color:rgb(150,134,110);font-size:0.74rem;">' +
        escapeHtml(t("LOC_DEMOGRAPHICS_WONDER_TURN", wonderEvent.turn)) +
        escapeHtml(yearStr) +
        "</div>";
  tip.innerHTML =
    "" +
    '<div style="font-family:' + localeFontFamily("body") + ';' +
    "font-weight:700;color:rgb(236,224,198);font-size:0.92rem;" +
    "letter-spacing:0.02rem;margin-bottom:0.3rem;" +
    "border-bottom:1px solid rgba(204,188,163,0.2);" +
    'padding-bottom:0.3rem;">' +
    escapeHtml(wonderEvent.wonderName || t("LOC_DEMOGRAPHICS_WONDER_FALLBACK_NAME")) +
    "</div>" +
    destroyedHtml +
    '<div><span style="color:#e5d2ac;">' +
    escapeHtml(t("LOC_DEMOGRAPHICS_WONDER_BUILT_BY")) +
    "</span> " +
    escapeHtml(civLabel) +
    "</div>" +
    turnHtml +
    descHtml;
  tip.style.display = "block";
  placeWonderTip(state, { left: iconLeft, top: iconTop, size: iconSize });
}

/**
 * An anchor icon's position and edge length, in chart-wrap-local px.
 * @typedef {{ left: number, top: number, size: number }} WonderIconAnchor
 */

/**
 * @param {WonderTipState} state The tip state wrapper (its re-place token is bumped).
 * @param {WonderIconAnchor} icon
 */
function placeWonderTip(state, icon) {
  positionWonderTip(state, icon);
  // That first placement can only estimate the tip's size (see resolveWonderTipSize). A wonder tip
  // is placed once per hover and, unlike the cursor tooltip, never gets a second chance from a
  // mousemove, so re-place it once GameFace has laid the real box out. The token drops a queued
  // frame whose tip has since been hidden or handed to another marker.
  const token = (state.placeToken || 0) + 1;
  state.placeToken = token;
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    if (state.placeToken !== token) return;
    if (!state.wonderTip || state.wonderTip.style.display !== "block") return;
    positionWonderTip(state, icon);
  });
}

/**
 * @param {HTMLElement} wonderTip
 * @param {{ w: number, h: number }|null|undefined} lastSize Size measured on a previous show.
 */
function resolveWonderTipSize(wonderTip, lastSize) {
  // GameFace lays an element out a frame after it is shown, so on the tick that reveals the tip
  // offsetWidth/Height still read 0. A zero width makes the right-edge flip unreachable and the
  // clamp a no-op, which left a tip near the right of the plot running off the frame and cut by
  // the panel edge. Estimate from the previous show (the tip is a singleton with a capped
  // max-width, so its size barely moves) and let placeWonderTip settle it.
  const w = wonderTip.offsetWidth;
  const h = wonderTip.offsetHeight;
  if (w > 0 && h > 0) return { tipW: w, tipH: h, measured: true };
  return { tipW: lastSize ? lastSize.w : 0, tipH: lastSize ? lastSize.h : 0, measured: false };
}

/**
 * @param {HTMLElement} wonderTip
 * @param {HTMLElement|*} wrap
 * @param {WonderIconAnchor} icon
 * @param {{ w: number, h: number }|null|undefined} lastSize Size measured on a previous show.
 */
function computeWonderTipPlacement(wonderTip, wrap, icon, lastSize) {
  const GAP_X = 18;
  const { tipW, tipH, measured } = resolveWonderTipSize(wonderTip, lastSize);
  // Above and to the right of the icon by default, so the cursor never
  // overlaps the tip.
  let left = icon.left + icon.size + GAP_X;
  let top = icon.top - tipH / 2 + icon.size / 2;
  if (wrap && left + tipW > wrap.clientWidth - 4) {
    left = icon.left - tipW - GAP_X;
  }
  if (wrap) {
    const maxLeft = wrap.clientWidth - tipW - 4;
    if (left > maxLeft) left = maxLeft;
    if (left < 4) left = 4;
    const maxTop = wrap.clientHeight - tipH - 4;
    if (top > maxTop) top = maxTop;
    if (top < 4) top = 4;
  }
  return { left, top, tipW, tipH, measured };
}

/**
 * @param {*} wonderTip Carries a custom `.arrow` child.
 * @param {number} left The tip's resolved left (px).
 * @param {number} iconLeft px.
 * @param {number} tipW px.
 * @param {number} tipH px.
 */
function applyWonderTipArrow(wonderTip, left, iconLeft, tipW, tipH) {
  if (!wonderTip.arrow) {
    const arrow = document.createElement("div");
    arrow.className = "wonder-tip-arrow demographics-line-wonder-tip-arrow";
    wonderTip.appendChild(arrow);
    wonderTip.arrow = arrow;
  }
  const arrow = wonderTip.arrow;
  if (left > iconLeft) {
    arrow.style.left = "-16px";
    arrow.style.top = tipH / 2 - 8 + "px";
    arrow.style.borderRightColor = "rgba(33, 35, 42, 0.97)";
    arrow.style.borderLeftColor = "transparent";
  } else {
    arrow.style.left = tipW - 0 + "px";
    arrow.style.top = tipH / 2 - 8 + "px";
    arrow.style.borderLeftColor = "rgba(33, 35, 42, 0.97)";
    arrow.style.borderRightColor = "transparent";
  }
  arrow.style.borderTopColor = "transparent";
  arrow.style.borderBottomColor = "transparent";
}

/**
 * @param {WonderTipState} state
 * @param {WonderIconAnchor} icon
 */
function positionWonderTip(state, icon) {
  const wonderTip = state.wonderTip;
  if (!wonderTip) return;
  const wrap = wonderTip.parentNode;
  const { left, top, tipW, tipH, measured } = computeWonderTipPlacement(
    wonderTip,
    wrap,
    icon,
    state.lastTipSize
  );
  // Remember only a real measurement; an estimate must not be laundered into the cache.
  if (measured) state.lastTipSize = { w: tipW, h: tipH };
  wonderTip.style.left = left + "px";
  wonderTip.style.top = top + "px";
  applyWonderTipArrow(wonderTip, left, icon.left, tipW, tipH);
}

/** @param {WonderTipState} state */
function hideWonderTip(state) {
  // Bump the token so a re-place frame queued by the show cannot move a tip that is now hidden.
  state.placeToken = (state.placeToken || 0) + 1;
  if (state.wonderTip) state.wonderTip.style.display = "none";
}

const WONDER_ICON_SIZE = 28;

/**
 * @param {Record<string, *>} dataset
 * @param {number|*} turn
 */
function findEventDataPoint(dataset, turn) {
  let dataPoint = dataset.data.find((/** @type {*} */ point) => point && point.x === turn);
  if (!dataPoint) {
    let bestDist = 3;
    for (const point of dataset.data) {
      if (!point) continue;
      const dist = Math.abs(point.x - turn);
      if (dist < bestDist) {
        bestDist = dist;
        dataPoint = point;
      }
    }
  }
  return dataPoint || null;
}

/**
 * @param {WonderTipState} tipState
 * @param {HTMLElement} wrap
 * @param {WonderEvent} wonderEvent
 * @param {string} civLabel
 */
function createWonderMarker(tipState, wrap, wonderEvent, civLabel) {
  const marker = document.createElement("div");
  marker.className = "demographics-wonder-marker demographics-line-wonder-marker";
  // Only real per-wonder icons reach this code path; events without a
  // specific icon are pre-filtered upstream, so no generic fallback is
  // stacked. Per-event icon URL stays inline (dynamic).
  if (wonderEvent.kind === "destroyed") {
    // A destroyed wonder reads as "lost": a faded copy of the wonder icon with
    // a burning raze badge. The wonder image goes on a child div so its
    // fade/grayscale doesn't bleed onto the badge; the badge image is a constant in CSS.
    marker.classList.add("demographics-line-wonder-marker--destroyed");
    const icon = document.createElement("div");
    icon.className = "demographics-line-wonder-destroyed-icon";
    icon.style.backgroundImage = "url('" + wonderEvent.iconUrl + "')";
    marker.appendChild(icon);
    const badge = document.createElement("div");
    badge.className = "demographics-line-wonder-raze-badge";
    marker.appendChild(badge);
  } else {
    marker.style.backgroundImage = "url('" + wonderEvent.iconUrl + "')";
  }
  // Custom hover tooltip; native `title` doesn't render in Coherent. Anchor
  // the tip to the icon's position read at hover time (the marker may have
  // been repositioned since this listener was attached).
  marker.addEventListener("mouseenter", () => {
    showWonderTip({
      state: tipState,
      wrap,
      wonderEvent,
      civLabel,
      iconLeft: marker.offsetLeft,
      iconTop: marker.offsetTop,
      iconSize: WONDER_ICON_SIZE
    });
  });
  marker.addEventListener("mouseleave", () => hideWonderTip(tipState));
  return marker;
}

/**
 * @param {Record<string, *>} ctx
 * @param {Record<string, *>} dataset
 * @param {WonderEvent[]} events
 * @param {number} pid
 */
function renderDatasetWonderMarkers(ctx, dataset, events, pid) {
  const { wrap, xScale, yScale, offX, offY, wonderMarkerEls, renderedKeys, tipState } = ctx;
  for (const wonderEvent of events) {
    if (wonderEvent.turn < xScale.min || wonderEvent.turn > xScale.max) continue;
    const dataPoint = findEventDataPoint(dataset, wonderEvent.turn);
    if (!dataPoint) continue;
    const x = xScale.getPixelForValue(wonderEvent.turn);
    const y = yScale.getPixelForValue(dataPoint.y);
    const leftPx = offX + x - WONDER_ICON_SIZE / 2;
    const topPx = offY + y - WONDER_ICON_SIZE / 2;
    const key = pid + ":" + (wonderEvent.kind === "destroyed" ? "d" : "b") + ":" + wonderEvent.turn;
    renderedKeys.add(key);
    const marker = getOrCreateWonderMarker({
      wonderMarkerEls,
      key,
      tipState,
      wrap,
      wonderEvent,
      datasetLabel: dataset.label
    });
    // Update position only: rewriting the entire style string would
    // invalidate the browser's hover state and cause a blink.
    if (marker.style.left !== leftPx + "px") marker.style.left = leftPx + "px";
    if (marker.style.top !== topPx + "px") marker.style.top = topPx + "px";
  }
}

/**
 * @param {{
 *   wonderMarkerEls: Map<string, HTMLElement>,
 *   key: string,
 *   tipState: WonderTipState,
 *   wrap: HTMLElement,
 *   wonderEvent: WonderEvent,
 *   datasetLabel: string|*,
 * }} params
 */
function getOrCreateWonderMarker(params) {
  const { wonderMarkerEls, key, tipState, wrap, wonderEvent, datasetLabel } = params;
  /** @type {HTMLElement|null|undefined} */
  let marker = wonderMarkerEls.get(key);
  if (marker && !marker.isConnected) {
    // DOM was wiped by something external (panel reattach); drop our
    // reference and recreate below.
    wonderMarkerEls.delete(key);
    marker = null;
  }
  if (!marker) {
    marker = createWonderMarker(tipState, wrap, wonderEvent, datasetLabel || t("LOC_DEMOGRAPHICS_CIV_UNKNOWN"));
    wrap.appendChild(marker);
    wonderMarkerEls.set(key, marker);
  }
  return marker;
}

/**
 * @param {Map<string, HTMLElement>} wonderMarkerEls
 * @param {Set<string>} renderedKeys
 */
function gcWonderMarkers(wonderMarkerEls, renderedKeys) {
  for (const [key, el] of wonderMarkerEls) {
    if (!renderedKeys.has(key)) {
      try {
        el.remove();
      } catch (_) {
        // Element.remove may throw if already detached by Coherent; drop the ref regardless.
      }
      wonderMarkerEls.delete(key);
    }
  }
}

/**
 * Build the HTML-overlay wonder-marker Chart.js plugin. Markers are managed
 * as absolutely-positioned divs over the chart wrap (canvas drawImage of BLP
 * sources is unreliable in Coherent); updates are differential to avoid hover flicker.
 * @param {Array<{ leaderType: *, pid?: number }>} allSeries The series list (for pid lookup).
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid
 * @param {Map<string, HTMLElement>} wonderMarkerEls
 * @param {WonderTipState} tipState
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makeWonderMarkersPlugin(
  allSeries,
  wonderEventsByPid,
  wonderMarkerEls,
  tipState
) {
  return {
    id: "demographicsWonderMarkers",
    /**
     * @param {*} chart
     */
    afterDatasetsDraw(chart) {
      const wrap = chart.canvas.parentNode;
      if (!wrap) return;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      const datasets = chart.data.datasets || [];
      // Track which keys we render this pass; anything in the map but not in
      // this set at the end gets removed.
      const renderedKeys = new Set();
      const passCtx = {
        wrap,
        xScale,
        yScale,
        offX: chart.canvas.offsetLeft,
        offY: chart.canvas.offsetTop,
        wonderMarkerEls,
        renderedKeys,
        tipState
      };
      for (let i = 0; i < datasets.length; i++) {
        renderOneDatasetWonders(passCtx, datasets[i], allSeries, wonderEventsByPid);
      }
      // Garbage-collect any markers that no longer correspond to a visible
      // event (e.g. dataset hidden by user click, or scale panned to exclude
      // the turn).
      gcWonderMarkers(wonderMarkerEls, renderedKeys);
    }
  };
}

/**
 * @param {Record<string, *>} passCtx
 * @param {Record<string, *>} dataset
 * @param {Array<{ leaderType: *, pid?: number }>} allSeries
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid
 */
function renderOneDatasetWonders(passCtx, dataset, allSeries, wonderEventsByPid) {
  if (!dataset || dataset.hidden) return;
  const series = allSeries.find((entry) => entry.leaderType === dataset.leaderType);
  const pid = series?.pid;
  if (typeof pid !== "number") return;
  const events =
    wonderEventsByPid.get(String(pid)) || wonderEventsByPid.get(/** @type {*} */ (pid));
  if (!events || events.length === 0) return;
  renderDatasetWonderMarkers(passCtx, dataset, events, pid);
}
