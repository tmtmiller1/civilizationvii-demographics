// chart-line-wonder-markers.js
//
// Wonder-built event detection, icon/name resolution, hover tooltip, and the
// Chart.js HTML-overlay marker plugin used by chart-line.js (its only caller).

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { t, stylizeLocaleTag } from "/demographics/ui/core/demographics-i18n.js";
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
 * Read the `showWonderMarkers` setting; defaults OFF on the Crisis Stage
 * chart, ON elsewhere.
 * @param {string} metricId Active metric id.
 * @returns {boolean} Whether wonder markers should be shown.
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
 * @param {Snapshot[]} samples The sample stream.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @param {(s: Snapshot, off: Map<string, number>, b: AgeBoundary[]) => (number|undefined)} sampleX
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
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      const types = Array.isArray(ps?.wonderTypes) ? ps.wonderTypes : null;
      // "First sample for this civ" is whether we've ever sampled THIS CIV at
      // all, not whether we've seen a wonderTypes array for them; otherwise a
      // civ's very first mid-run wonder would be treated as a seed and dropped.
      const isFirstSample = !sampledPids.has(pid);
      sampledPids.add(pid);
      if (types && types.length > 0) {
        foldWonderTypes({
          wonderEventsByPid,
          seenTypesByPid,
          pid,
          s,
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
 * Fold one sample's wonder-type list into the running seen-set + event map.
 * @param {{
 *   wonderEventsByPid: Map<string, WonderEvent[]>,
 *   seenTypesByPid: Map<string, Set<string>>,
 *   pid: string,
 *   s: Snapshot,
 *   types: string[],
 *   isFirstSample: boolean,
 *   ageOffsets: Map<string, number>,
 *   boundaries: AgeBoundary[],
 *   sampleX: (s: Snapshot, off: Map<string, number>,
 *     b: AgeBoundary[]) => (number|undefined),
 * }} params Fold inputs.
 */
function foldWonderTypes(params) {
  const {
    wonderEventsByPid,
    seenTypesByPid,
    pid,
    s,
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
    for (const t of types) seen.add(t);
    return;
  }
  for (const t of types) {
    if (seen.has(t)) continue;
    seen.add(t);
    let events = wonderEventsByPid.get(pid);
    if (!events) {
      events = [];
      wonderEventsByPid.set(pid, events);
    }
    const wx = sampleX(s, ageOffsets, boundaries);
    events.push({
      turn: typeof wx === "number" ? wx : s.turn,
      year: s.gameYear || "",
      wonderType: t
    });
  }
}

/**
 * Detect wonder DESTRUCTIONS: a wonder is destroyed when its type is present at
 * some sample yet absent from the FINAL sample's global set, which excludes the
 * benign cases (damaged-then-repaired wonders return; captured wonders move to
 * the captor's list). Marked at the last turn seen standing and attributed to
 * the civ that last held it.
 * @param {Snapshot[]} samples The sample stream.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @param {(s: Snapshot, off: Map<string, number>, b: AgeBoundary[]) => (number|undefined)} sampleX
 *   Sample → chart-X position resolver (provided by chart-line.js).
 * @returns {Map<string, WonderEvent[]>} pid → detected destruction events.
 */
export function collectWonderDestructions(samples, ageOffsets, boundaries, sampleX) {
  /** @type {Map<string, { pid: string, turn: number|*, year: string }>} */
  const lastSeen = new Map(); // wonderType → last sample it stood (pid + X + year)
  /** @type {Set<string>} */
  let presentInFinal = new Set(); // ends as the final sample's global type set
  for (const s of samples) {
    if (!s?.players) continue;
    presentInFinal = foldSamplePresence(s, ageOffsets, boundaries, sampleX, lastSeen);
  }
  return emitWonderDestructions(lastSeen, presentInFinal);
}

/**
 * Fold one sample's wonder presence into `lastSeen` (mutated) and return the set
 * of wonder types present anywhere in this sample.
 * @param {Snapshot} s The current sample.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @param {(s: Snapshot, off: Map<string, number>, b: AgeBoundary[]) => (number|undefined)} sampleX
 *   Sample → chart-X position resolver.
 * @param {Map<string, { pid: string, turn: number|*, year: string }>} lastSeen
 *   wonderType → last-seen record (mutated).
 * @returns {Set<string>} The wonder types present in this sample.
 */
function foldSamplePresence(s, ageOffsets, boundaries, sampleX, lastSeen) {
  const present = new Set();
  const players = s.players;
  if (!players) return present;
  const wx = sampleX(s, ageOffsets, boundaries);
  const turn = typeof wx === "number" ? wx : s.turn;
  for (const pid of Object.keys(players)) {
    const types = players[pid]?.wonderTypes;
    if (!Array.isArray(types)) continue;
    for (const t of types) {
      present.add(t);
      lastSeen.set(t, { pid, turn, year: s.gameYear || "" });
    }
  }
  return present;
}

/**
 * Emit a destruction event for every wonder seen at some point but absent from
 * the final sample, keyed by the civ that last held it.
 * @param {Map<string, { pid: string, turn: number|*, year: string }>} lastSeen
 *   wonderType → last-seen record.
 * @param {Set<string>} presentInFinal Types still standing in the final sample.
 * @returns {Map<string, WonderEvent[]>} pid → destruction events.
 */
function emitWonderDestructions(lastSeen, presentInFinal) {
  /** @type {Map<string, WonderEvent[]>} */
  const out = new Map();
  for (const [t, info] of lastSeen) {
    if (presentInFinal.has(t)) continue; // still standing in the latest sample
    let events = out.get(info.pid);
    if (!events) {
      events = [];
      out.set(info.pid, events);
    }
    events.push({ turn: info.turn, year: info.year, wonderType: t, kind: "destroyed" });
  }
  return out;
}

/**
 * Merge per-pid destruction events into the build-event map (mutating it), so a
 * single resolve/render pass covers both marker kinds.
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events (mutated).
 * @param {Map<string, WonderEvent[]>} destructionsByPid pid → destruction events.
 */
export function mergeWonderEvents(wonderEventsByPid, destructionsByPid) {
  for (const [pid, events] of destructionsByPid) {
    const existing = wonderEventsByPid.get(pid);
    if (existing) existing.push(...events);
    else wonderEventsByPid.set(pid, events.slice());
  }
}

/**
 * Resolve the engine icon URL for a wonder event, mutating `ev.iconUrl`.
 * @param {WonderEvent} ev The event (mutated).
 */
function resolveWonderIcon(ev) {
  try {
    if (typeof UI !== "undefined" && typeof UI.getIconURL === "function") {
      ev.iconUrl = UI.getIconURL(ev.wonderType, "WONDER");
    }
  } catch (_) {
    // UI.getIconURL may be absent or throw; leave ev.iconUrl unset (event dropped upstream).
  }
}

/**
 * Compose a localization tag safely, returning raw tag on compose failure.
 * @param {string} tag Localization tag.
 * @returns {string} Composed string or original tag.
 */
function safeComposeLocaleTag(tag) {
  try {
    if (typeof Locale?.compose === "function") return Locale.compose(tag);
  } catch (_) {
    // Locale.compose may throw on malformed tags.
  }
  return tag;
}

/**
 * Whether a composed wonder description candidate is better than current best.
 * @param {string} composed Composed candidate.
 * @param {string} rawTag Raw localization tag.
 * @param {string} best Current best description.
 * @returns {boolean} True when candidate should replace best.
 */
function shouldUseWonderDescription(composed, rawTag, best) {
  if (!composed) return false;
  if (composed === rawTag) return false;
  return composed.length > best.length;
}

/**
 * Resolve the longest composable flavor description from a Constructibles row.
 * @param {*} info The Constructibles lookup row (or null).
 * @returns {{ text: string, tag: string }} The best description and the tag it came from.
 */
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
  // The TAG comes back too: the tooltip renders through innerHTML, so it wants the engine's
  // stylized markup, while the length test above needs the composed plain string.
  return { text: best, tag: bestTag };
}

/**
 * Resolve display name + flavor description for a wonder event, mutating it.
 * @param {WonderEvent} ev The event (mutated).
 */
function resolveWonderMeta(ev) {
  try {
    const info =
      typeof GameInfo !== "undefined" &&
      GameInfo.Constructibles &&
      typeof GameInfo.Constructibles.lookup === "function"
        ? GameInfo.Constructibles.lookup(ev.wonderType)
        : null;
    ev.wonderName = resolveWonderName(ev.wonderType, info);
    // Flavor / mechanical description. Civ7's Constructibles table carries
    // Description (short mechanical line) and Tooltip (richer text); prefer
    // the longer of the two when both compose successfully.
    const best = bestWonderDescription(info);
    if (best.text) {
      ev.wonderDescription = best.text;
      ev.wonderDescriptionHtml = stylizeLocaleTag(best.tag);
    }
  } catch (_) {
    // GameInfo.Constructibles.lookup may be absent or throw; fall back to the raw type as name.
    ev.wonderName = ev.wonderType;
  }
}

/**
 * Resolve a wonder's display name from its Constructibles row, falling back to
 * a humanized type string.
 * @param {string} wonderType The engine constructible type.
 * @param {*} info The Constructibles lookup row (or null).
 * @returns {string} The display name.
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
    for (const ev of events) {
      if (!ev.wonderType) continue;
      resolveWonderIcon(ev);
      // Only drop events where the engine returned NO icon URL at all.
      if (!ev.iconUrl) continue;
      resolveWonderMeta(ev);
      kept.push(ev);
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
 * Ensure the singleton wonder hover-tooltip exists and is attached to `wrap`.
 * @param {WonderTipState} state The tip state wrapper (mutated).
 * @param {HTMLElement} wrap The chart wrap to mount the tip into.
 * @returns {HTMLElement} The tip element.
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
 * Show the wonder hover-tooltip for an event, anchored to the icon.
 * @param {{
 *   state: WonderTipState,
 *   wrap: HTMLElement,
 *   ev: WonderEvent,
 *   civLabel: string,
 *   iconLeft: number,
 *   iconTop: number,
 *   iconSize: number,
 * }} params Tooltip inputs.
 */
function showWonderTip(params) {
  const { state, wrap, ev, civLabel, iconLeft, iconTop, iconSize } = params;
  const tip = ensureWonderTip(state, wrap);
  const yearStr = ev.year ? " · " + ev.year : "";
  // Game-authored text: `wonderDescriptionHtml` is already the engine's own markup (icons, tips),
  // so it goes in unescaped; the escaped plain string is the fallback when stylize gave nothing.
  const descBody = ev.wonderDescriptionHtml || (ev.wonderDescription ? escapeHtml(ev.wonderDescription) : "");
  const descHtml = descBody
    ? '<div style="margin-top:0.4rem;color:rgb(160,146,120);">' + descBody + "</div>"
    : "";
  // For a destruction, lead with a burnt-orange "Destroyed" banner carrying the
  // raze turn/year; the civ line then reads as who held it (its builder, unless
  // it was captured first). Built events keep their original "Built by" line.
  const destroyedHtml =
    ev.kind === "destroyed"
      ? '<div style="color:rgb(214,138,92);font-weight:700;font-size:0.8rem;' +
        'letter-spacing:0.02rem;margin-bottom:0.15rem;">' +
        escapeHtml(t("LOC_DEMOGRAPHICS_WONDER_DESTROYED")) +
        ' · ' +
        escapeHtml(t("LOC_DEMOGRAPHICS_WONDER_TURN", ev.turn)) +
        escapeHtml(yearStr) +
        "</div>"
      : "";
  const turnHtml =
    ev.kind === "destroyed"
      ? ""
      : '<div style="color:rgb(150,134,110);font-size:0.74rem;">' +
        escapeHtml(t("LOC_DEMOGRAPHICS_WONDER_TURN", ev.turn)) +
        escapeHtml(yearStr) +
        "</div>";
  tip.innerHTML =
    "" +
    '<div style="font-family:TitilliumWeb, sans-serif;' +
    "font-weight:700;color:rgb(236,224,198);font-size:0.92rem;" +
    "letter-spacing:0.02rem;margin-bottom:0.3rem;" +
    "border-bottom:1px solid rgba(204,188,163,0.2);" +
    'padding-bottom:0.3rem;">' +
    escapeHtml(ev.wonderName || t("LOC_DEMOGRAPHICS_WONDER_FALLBACK_NAME")) +
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
 * Place the tip against its icon now, then again on the next frame.
 * @param {WonderTipState} state The tip state wrapper (its re-place token is bumped).
 * @param {WonderIconAnchor} icon The anchor icon.
 */
function placeWonderTip(state, icon) {
  positionWonderTip(state, icon);
  // That first placement can only ESTIMATE the tip's size (see resolveWonderTipSize). A wonder tip
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
 * Resolve the size to place the tip from: its own box once GameFace has laid it out, otherwise the
 * size measured on a previous show.
 * @param {HTMLElement} wonderTip The tip element.
 * @param {{ w: number, h: number }|null|undefined} lastSize Size measured on a previous show.
 * @returns {{ tipW: number, tipH: number, measured: boolean }} The size and where it came from.
 */
function resolveWonderTipSize(wonderTip, lastSize) {
  // GameFace lays an element out a frame AFTER it is shown, so on the tick that reveals the tip
  // offsetWidth/Height still read 0. A zero width makes the right-edge flip unreachable and the
  // clamp a no-op, which left a tip near the right of the plot running off the frame and cut by
  // the panel edge (reported 2026-09-23). Estimate from the previous show - the tip is a singleton
  // with a capped max-width, so its size barely moves - and let placeWonderTip settle it.
  const w = wonderTip.offsetWidth;
  const h = wonderTip.offsetHeight;
  if (w > 0 && h > 0) return { tipW: w, tipH: h, measured: true };
  return { tipW: lastSize ? lastSize.w : 0, tipH: lastSize ? lastSize.h : 0, measured: false };
}

/**
 * Compute the tooltip's left/top placement relative to the icon, clamped
 * inside the chart wrap.
 * @param {HTMLElement} wonderTip The visible tip element.
 * @param {HTMLElement|*} wrap The chart wrap (for clamping).
 * @param {WonderIconAnchor} icon The anchor icon.
 * @param {{ w: number, h: number }|null|undefined} lastSize Size measured on a previous show.
 * @returns {{ left: number, top: number, tipW: number, tipH: number, measured: boolean }}
 *   The placement, the size it was computed from, and whether that size came off the element now.
 */
function computeWonderTipPlacement(wonderTip, wrap, icon, lastSize) {
  const GAP_X = 18;
  const { tipW, tipH, measured } = resolveWonderTipSize(wonderTip, lastSize);
  // Default: place above and to the right of the icon, so the cursor never
  // overlaps the tip.
  let left = icon.left + icon.size + GAP_X;
  let top = icon.top - tipH / 2 + icon.size / 2;
  // If not enough room to the right, try left side.
  if (wrap && left + tipW > wrap.clientWidth - 4) {
    left = icon.left - tipW - GAP_X;
  }
  // Clamp horizontally to the wrap so the tip stays on-screen.
  if (wrap) {
    const maxLeft = wrap.clientWidth - tipW - 4;
    if (left > maxLeft) left = maxLeft;
    if (left < 4) left = 4;
    // Clamp vertically as well.
    const maxTop = wrap.clientHeight - tipH - 4;
    if (top > maxTop) top = maxTop;
    if (top < 4) top = 4;
  }
  return { left, top, tipW, tipH, measured };
}

/**
 * Apply the connecting arrow's edge + color to a wonder tooltip.
 * @param {*} wonderTip The tip element (carries a custom `.arrow` child).
 * @param {number} left The tip's resolved left (px).
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} tipW Measured tip width (px).
 * @param {number} tipH Measured tip height (px).
 */
function applyWonderTipArrow(wonderTip, left, iconLeft, tipW, tipH) {
  if (!wonderTip.arrow) {
    const arrow = document.createElement("div");
    arrow.className = "wonder-tip-arrow demographics-line-wonder-tip-arrow";
    wonderTip.appendChild(arrow);
    wonderTip.arrow = arrow;
  }
  const arrow = wonderTip.arrow;
  // Position arrow on the edge closest to the icon.
  if (left > iconLeft) {
    // Tooltip is to the right of the icon.
    arrow.style.left = "-16px";
    arrow.style.top = tipH / 2 - 8 + "px";
    arrow.style.borderRightColor = "rgba(33, 35, 42, 0.97)";
    arrow.style.borderLeftColor = "transparent";
  } else {
    // Tooltip is to the left of the icon.
    arrow.style.left = tipW - 0 + "px";
    arrow.style.top = tipH / 2 - 8 + "px";
    arrow.style.borderLeftColor = "rgba(33, 35, 42, 0.97)";
    arrow.style.borderRightColor = "transparent";
  }
  arrow.style.borderTopColor = "transparent";
  arrow.style.borderBottomColor = "transparent";
}

/**
 * Position the wonder tooltip near its icon and draw the connecting arrow.
 * @param {WonderTipState} state The tip state wrapper.
 * @param {WonderIconAnchor} icon The anchor icon.
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
  // Add a small arrow to visually connect the tip to the icon.
  applyWonderTipArrow(wonderTip, left, icon.left, tipW, tipH);
}

/**
 * Hide the wonder hover-tooltip.
 * @param {WonderTipState} state The tip state wrapper.
 */
function hideWonderTip(state) {
  // Bump the token so a re-place frame queued by the show cannot move a tip that is now hidden.
  state.placeToken = (state.placeToken || 0) + 1;
  if (state.wonderTip) state.wonderTip.style.display = "none";
}

const WONDER_ICON_SIZE = 28;

/**
 * Find the data point on a dataset nearest to a wonder event's turn, within a
 * small tolerance.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {number|*} turn The event's chart-X turn.
 * @returns {{ x: number, y: number }|null} The matched point, or `null`.
 */
function findEventDataPoint(ds, turn) {
  let dp = ds.data.find((/** @type {*} */ p) => p && p.x === turn);
  if (!dp) {
    let bestDist = 3;
    for (const p of ds.data) {
      if (!p) continue;
      const d = Math.abs(p.x - turn);
      if (d < bestDist) {
        bestDist = d;
        dp = p;
      }
    }
  }
  return dp || null;
}

/**
 * Create (and wire hover) a wonder marker element for an event.
 * @param {WonderTipState} tipState The wonder tooltip state.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {WonderEvent} ev The event.
 * @param {string} civLabel The civ display label.
 * @returns {HTMLElement} The marker element.
 */
function createWonderMarker(tipState, wrap, ev, civLabel) {
  const mk = document.createElement("div");
  mk.className = "demographics-wonder-marker demographics-line-wonder-marker";
  // Only real per-wonder icons reach this code path - events without a
  // specific icon are pre-filtered upstream, so no generic fallback is
  // stacked. Per-event icon URL stays inline (dynamic).
  if (ev.kind === "destroyed") {
    // A destroyed wonder reads as "lost": a faded copy of the wonder icon with
    // a burning raze badge. The wonder image goes on a CHILD div so its
    // fade/grayscale doesn't bleed onto the badge; the badge image is a constant in CSS.
    mk.classList.add("demographics-line-wonder-marker--destroyed");
    const icon = document.createElement("div");
    icon.className = "demographics-line-wonder-destroyed-icon";
    icon.style.backgroundImage = "url('" + ev.iconUrl + "')";
    mk.appendChild(icon);
    const badge = document.createElement("div");
    badge.className = "demographics-line-wonder-raze-badge";
    mk.appendChild(badge);
  } else {
    mk.style.backgroundImage = "url('" + ev.iconUrl + "')";
  }
  // Custom hover tooltip - native `title` doesn't render in Coherent. Anchor
  // the tip to the icon's position read at hover time (the marker may have
  // been repositioned since this listener was attached).
  mk.addEventListener("mouseenter", () => {
    showWonderTip({
      state: tipState,
      wrap,
      ev,
      civLabel,
      iconLeft: mk.offsetLeft,
      iconTop: mk.offsetTop,
      iconSize: WONDER_ICON_SIZE
    });
  });
  mk.addEventListener("mouseleave", () => hideWonderTip(tipState));
  return mk;
}

/**
 * Render/update markers for one dataset's wonder events, tracking rendered
 * keys for later garbage collection.
 * @param {Record<string, *>} ctx Shared marker pass context.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {WonderEvent[]} events The dataset civ's events.
 * @param {number} pid The civ pid.
 */
function renderDatasetWonderMarkers(ctx, ds, events, pid) {
  const { wrap, xScale, yScale, offX, offY, wonderMarkerEls, renderedKeys, tipState } = ctx;
  for (const ev of events) {
    if (ev.turn < xScale.min || ev.turn > xScale.max) continue;
    const dp = findEventDataPoint(ds, ev.turn);
    if (!dp) continue;
    const x = xScale.getPixelForValue(ev.turn);
    const y = yScale.getPixelForValue(dp.y);
    const leftPx = offX + x - WONDER_ICON_SIZE / 2;
    const topPx = offY + y - WONDER_ICON_SIZE / 2;
    const key = pid + ":" + (ev.kind === "destroyed" ? "d" : "b") + ":" + ev.turn;
    renderedKeys.add(key);
    const mk = getOrCreateWonderMarker({
      wonderMarkerEls,
      key,
      tipState,
      wrap,
      ev,
      dsLabel: ds.label
    });
    // Update position only - rewriting the entire style string would
    // invalidate the browser's hover state and cause a blink.
    if (mk.style.left !== leftPx + "px") mk.style.left = leftPx + "px";
    if (mk.style.top !== topPx + "px") mk.style.top = topPx + "px";
  }
}

/**
 * Reuse the cached marker for a key, recreating it when its DOM was wiped.
 * @param {{
 *   wonderMarkerEls: Map<string, HTMLElement>,
 *   key: string,
 *   tipState: WonderTipState,
 *   wrap: HTMLElement,
 *   ev: WonderEvent,
 *   dsLabel: string|*,
 * }} params Marker inputs.
 * @returns {HTMLElement} The (existing or created) marker element.
 */
function getOrCreateWonderMarker(params) {
  const { wonderMarkerEls, key, tipState, wrap, ev, dsLabel } = params;
  /** @type {HTMLElement|null|undefined} */
  let mk = wonderMarkerEls.get(key);
  if (mk && !mk.isConnected) {
    // DOM was wiped by something external (panel reattach); drop our
    // reference and recreate below.
    wonderMarkerEls.delete(key);
    mk = null;
  }
  if (!mk) {
    mk = createWonderMarker(tipState, wrap, ev, dsLabel || t("LOC_DEMOGRAPHICS_CIV_UNKNOWN"));
    wrap.appendChild(mk);
    wonderMarkerEls.set(key, mk);
  }
  return mk;
}

/**
 * Garbage-collect markers no longer rendered this pass.
 * @param {Map<string, HTMLElement>} wonderMarkerEls key → marker element.
 * @param {Set<string>} renderedKeys Keys rendered this pass.
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
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events.
 * @param {Map<string, HTMLElement>} wonderMarkerEls key → marker element.
 * @param {WonderTipState} tipState The wonder tooltip state.
 * @returns {Record<string, *>} The Chart.js plugin object.
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
     * @param {*} c The Chart instance.
     */
    afterDatasetsDraw(c) {
      const wrap = c.canvas.parentNode;
      if (!wrap) return;
      const xScale = c.scales.x;
      const yScale = c.scales.y;
      if (!xScale || !yScale) return;
      const datasets = c.data.datasets || [];
      // Track which keys we render this pass; anything in the map but not in
      // this set at the end gets removed.
      const renderedKeys = new Set();
      const passCtx = {
        wrap,
        xScale,
        yScale,
        offX: c.canvas.offsetLeft,
        offY: c.canvas.offsetTop,
        wonderMarkerEls,
        renderedKeys,
        tipState
      };
      for (let di = 0; di < datasets.length; di++) {
        renderOneDatasetWonders(passCtx, datasets[di], allSeries, wonderEventsByPid);
      }
      // Garbage-collect any markers that no longer correspond to a visible
      // event (e.g. dataset hidden by user click, or scale panned to exclude
      // the turn).
      gcWonderMarkers(wonderMarkerEls, renderedKeys);
    }
  };
}

/**
 * Render wonder markers for a single dataset (resolving its pid + events).
 * @param {Record<string, *>} passCtx Shared marker pass context.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {Array<{ leaderType: *, pid?: number }>} allSeries The series list (for pid lookup).
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events.
 */
function renderOneDatasetWonders(passCtx, ds, allSeries, wonderEventsByPid) {
  if (!ds || ds.hidden) return;
  const series = allSeries.find((s) => s.leaderType === ds.leaderType);
  const pid = series?.pid;
  if (typeof pid !== "number") return;
  const events =
    wonderEventsByPid.get(String(pid)) || wonderEventsByPid.get(/** @type {*} */ (pid));
  if (!events || events.length === 0) return;
  renderDatasetWonderMarkers(passCtx, ds, events, pid);
}
