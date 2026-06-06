// chart-line-wonder-markers.js
//
// Wonder-built event detection, icon/name resolution, hover tooltip, and the
// Chart.js HTML-overlay marker plugin used by chart-line.js. Extracted from
// chart-line.js (remediation #26) with no behavior changes; the chart module
// remains the only caller.

import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";
import { t } from "/demographics/ui/demographics-i18n.js";
import { escapeHtml } from "/demographics/ui/screen-demographics/chart-shared.js";

/**
 * A detected wonder event on a civ's line.
 * @typedef {Object} WonderEvent
 * @property {number|*} turn Chart-X position (or raw turn fallback).
 * @property {string} year Game-year string ("" when unknown).
 * @property {string} wonderType Engine constructible type.
 * @property {"built"|"destroyed"} [kind] Event kind; "built" when omitted.
 * @property {string} [iconUrl] Resolved icon URL.
 * @property {string} [wonderName] Resolved wonder display name.
 * @property {string} [wonderDescription] Resolved flavor description.
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
      // "First sample for this civ" must be based on whether we've ever
      // sampled THIS CIV at all - NOT on whether we've ever seen a
      // wonderTypes array for them. A civ that starts the game wonderless
      // and builds their very first wonder mid-run otherwise gets its real
      // new-wonder event silently dropped (because `seen` didn't exist yet,
      // so it was treated as a "seed").
      const isFirstSample = !sampledPids.has(pid);
      sampledPids.add(pid);
      if (types && types.length > 0) {
        foldWonderTypes(
          wonderEventsByPid,
          seenTypesByPid,
          pid,
          s,
          types,
          isFirstSample,
          ageOffsets,
          boundaries,
          sampleX
        );
      }
    }
  }
  return wonderEventsByPid;
}

/**
 * Fold one sample's wonder-type list into the running seen-set + event map.
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events (mutated).
 * @param {Map<string, Set<string>>} seenTypesByPid pid → seen types (mutated).
 * @param {string} pid Player id key.
 * @param {Snapshot} s The current sample.
 * @param {string[]} types Wonder-type list on this sample.
 * @param {boolean} isFirstSample Whether this is the civ's first sample.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @param {(s: Snapshot, off: Map<string, number>, b: AgeBoundary[]) => (number|undefined)} sampleX
 *   Sample → chart-X position resolver.
 */
function foldWonderTypes(
  wonderEventsByPid,
  seenTypesByPid,
  pid,
  s,
  types,
  isFirstSample,
  ageOffsets,
  boundaries,
  sampleX
) {
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
 * Detect wonder DESTRUCTIONS by the inverse of the build diff: a wonder is
 * destroyed when its type disappears PERMANENTLY from every civ's sampled
 * `wonderTypes`. Permanence is what distinguishes a real razing from the two
 * benign reasons a type leaves a single civ's list:
 *   - Damage: the collector excludes `con.damaged` wonders, so a war-damaged
 *     (later repaired) wonder drops out and returns - its last-seen sample is
 *     therefore the repaired one, not the damaged gap, so it is never flagged.
 *   - Capture: wonders are globally unique (one per game), so a captured wonder
 *     simply moves to the captor's list - it stays present in the final sample
 *     and is never flagged.
 * Only a type that is present at some sample yet absent from the FINAL sample's
 * global set is treated as destroyed, marked at the last turn it was seen
 * standing and attributed to the civ that last held it (the builder, unless the
 * wonder was captured before being razed).
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
 * Resolve the longest composable flavor description from a Constructibles row.
 * @param {*} info The Constructibles lookup row (or null).
 * @returns {string} The best description, or "" when none compose.
 */
function bestWonderDescription(info) {
  const candidates = [info?.Description, info?.Tooltip].filter(Boolean);
  let best = "";
  for (const tag of candidates) {
    let composed = tag;
    try {
      if (typeof Locale?.compose === "function") composed = Locale.compose(tag);
    } catch (_) {
      // Locale.compose may throw on a malformed tag; keep the raw tag (skipped below).
    }
    // Skip if compose returned the raw tag (no string in the localization
    // DB for the active language).
    if (composed && composed !== tag && composed.length > best.length) {
      best = composed;
    }
  }
  return best;
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
    if (best) ev.wonderDescription = best;
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
      // We previously also dropped events whose URL matched the generic
      // "blp:ntf_wonder_completed" notification, but UI.getIconURL never
      // returns that URL for real wonders - filtering on it was just
      // suppressing real wonders whose specific BLPs the engine happens to
      // resolve to a similarly-named fallback.
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
 * @param {WonderTipState} state The tip state wrapper.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {WonderEvent} ev The hovered event.
 * @param {string} civLabel The civ display label.
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} iconTop Icon top offset (px).
 * @param {number} iconSize Icon edge length (px).
 */
function showWonderTip(state, wrap, ev, civLabel, iconLeft, iconTop, iconSize) {
  const tip = ensureWonderTip(state, wrap);
  const yearStr = ev.year ? " · " + ev.year : "";
  const descHtml = ev.wonderDescription
    ? '<div style="margin-top:0.4rem;color:rgb(160,146,120);font-style:italic;">' +
      escapeHtml(ev.wonderDescription) +
      "</div>"
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
  positionWonderTip(state, iconLeft, iconTop, iconSize);
}

/**
 * Compute the tooltip's left/top placement relative to the icon, clamped
 * inside the chart wrap.
 * @param {HTMLElement} wonderTip The visible tip element.
 * @param {HTMLElement|*} wrap The chart wrap (for clamping).
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} iconTop Icon top offset (px).
 * @param {number} iconSize Icon edge length (px).
 * @returns {{ left: number, top: number, tipW: number, tipH: number }}
 *   The placement and measured tip size.
 */
function computeWonderTipPlacement(wonderTip, wrap, iconLeft, iconTop, iconSize) {
  const GAP_X = 18;
  // Measure after the tip is visible so offsetWidth/Height are real.
  const tipW = wonderTip.offsetWidth;
  const tipH = wonderTip.offsetHeight;
  // Default: place above and to the right of the icon, so the cursor never
  // overlaps the tip.
  let left = iconLeft + iconSize + GAP_X;
  let top = iconTop - tipH / 2 + iconSize / 2;
  // If not enough room to the right, try left side.
  if (wrap && left + tipW > wrap.clientWidth - 4) {
    left = iconLeft - tipW - GAP_X;
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
  return { left, top, tipW, tipH };
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
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} iconTop Icon top offset (px).
 * @param {number} iconSize Icon edge length (px).
 */
function positionWonderTip(state, iconLeft, iconTop, iconSize) {
  const wonderTip = state.wonderTip;
  if (!wonderTip) return;
  const wrap = wonderTip.parentNode;
  const { left, top, tipW, tipH } = computeWonderTipPlacement(
    wonderTip,
    wrap,
    iconLeft,
    iconTop,
    iconSize
  );
  wonderTip.style.left = left + "px";
  wonderTip.style.top = top + "px";
  // Add a small arrow to visually connect the tip to the icon.
  applyWonderTipArrow(wonderTip, left, iconLeft, tipW, tipH);
}

/**
 * Hide the wonder hover-tooltip.
 * @param {WonderTipState} state The tip state wrapper.
 */
function hideWonderTip(state) {
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
    // A destroyed wonder reads as "lost": a faded/desaturated copy of the
    // wonder icon with a burning raze badge in its lower-right corner. The
    // wonder image goes on a CHILD div (not the container's background) so its
    // fade/grayscale doesn't bleed onto the badge - CSS opacity/filter applies
    // to the whole subtree, so the badge must live OUTSIDE the dimmed element
    // to stay vivid. The badge image (the same fi_plot_burning icon the
    // war-cost chart uses for razed settlements) is a constant, so it lives in
    // CSS rather than inline.
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
  // Custom hover tooltip - native `title` doesn't render in Coherent.
  // Anchor the tip to the icon's current position (not the cursor) so it
  // sits in a predictable spot and doesn't jitter. Read the icon's offset
  // at hover time, because the marker may have been repositioned since this
  // listener was attached (pan, resize, filter change).
  mk.addEventListener("mouseenter", () => {
    showWonderTip(tipState, wrap, ev, civLabel, mk.offsetLeft, mk.offsetTop, WONDER_ICON_SIZE);
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
    const mk = getOrCreateWonderMarker(wonderMarkerEls, key, tipState, wrap, ev, ds.label);
    // Update position only - don't rewrite the entire style string, which
    // would invalidate the browser's hover state and cause the blink the
    // user saw.
    if (mk.style.left !== leftPx + "px") mk.style.left = leftPx + "px";
    if (mk.style.top !== topPx + "px") mk.style.top = topPx + "px";
  }
}

/**
 * Reuse the cached marker for a key, recreating it when its DOM was wiped.
 * @param {Map<string, HTMLElement>} wonderMarkerEls key → marker element.
 * @param {string} key The "pid:turn" key.
 * @param {WonderTipState} tipState The wonder tooltip state.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {WonderEvent} ev The event.
 * @param {string|*} dsLabel The dataset label (civ name).
 * @returns {HTMLElement} The (existing or created) marker element.
 */
function getOrCreateWonderMarker(wonderMarkerEls, key, tipState, wrap, ev, dsLabel) {
  /** @type {HTMLElement|null|undefined} */
  let mk = wonderMarkerEls.get(key);
  if (mk && !mk.isConnected) {
    // DOM was wiped by something external (panel reattach); drop our
    // reference and recreate below.
    wonderMarkerEls.delete(key);
    mk = null;
  }
  if (!mk) {
    mk = createWonderMarker(tipState, wrap, ev, dsLabel || "Unknown");
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
 * sources is unreliable in Coherent). Updates are differential to avoid the
 * hover flicker a full teardown caused.
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
