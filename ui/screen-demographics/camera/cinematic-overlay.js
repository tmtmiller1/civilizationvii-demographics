import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { div, iconEl, fmtPop } from "/demographics/ui/core/ui-helpers.js";

/** @type {Record<number, string>} */
export const OVERLAY_LAUREL = {
  1: "blp:popup_gold_laurels",
  2: "blp:popup_silver_laurels",
  3: "blp:popup_bronze_laurels"
};

export const ORDINAL_WORDS = [
  "", "single", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
  "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third",
  "twenty-fourth", "twenty-fifth"
];

/** @type {Record<string, Record<string, string>>} */
export const QUARTER_ARTICLE = {
  en: {
    QUARTER_ACROPOLIS: "the ", QUARTER_FORUM: "the ", QUARTER_MATHA: "the ", QUARTER_NECROPOLIS: "the ",
    QUARTER_UWAYBIL_KUH: "the ", QUARTER_INDUSTRIAL_PARK: "the ", QUARTER_AVENUE: "the ", QUARTER_ZAIBATSU: "the ",
    QUARTER_ZOCALO: "the ", QUARTER_HUIGUAN: "the ", QUARTER_DONJON: "the ", QUARTER_ULEMA: "the ",
    QUARTER_PLAZA: "the ", QUARTER_PURA: "the ", QUARTER_FIVE_HUNDRED_LORDS: "the "
  },
  de: {
    QUARTER_ACROPOLIS: "die ", QUARTER_FORUM: "das ", QUARTER_MATHA: "die ", QUARTER_NECROPOLIS: "die ",
    QUARTER_UWAYBIL_KUH: "den ", QUARTER_INDUSTRIAL_PARK: "das ", QUARTER_AVENUE: "die ", QUARTER_ZAIBATSU: "den ",
    QUARTER_ZOCALO: "den ", QUARTER_HUIGUAN: "die ", QUARTER_DONJON: "den ", QUARTER_ULEMA: "den ",
    QUARTER_PLAZA: "den ", QUARTER_PURA: "die ", QUARTER_FIVE_HUNDRED_LORDS: "die "
  },
  es: {
    QUARTER_ACROPOLIS: "la ", QUARTER_FORUM: "el ", QUARTER_MATHA: "el ", QUARTER_NECROPOLIS: "la ",
    QUARTER_UWAYBIL_KUH: "el ", QUARTER_INDUSTRIAL_PARK: "el ", QUARTER_AVENUE: "la ", QUARTER_ZAIBATSU: "el ",
    QUARTER_ZOCALO: "el ", QUARTER_HUIGUAN: "el ", QUARTER_DONJON: "la ", QUARTER_ULEMA: "el ",
    QUARTER_PLAZA: "la ", QUARTER_PURA: "el ", QUARTER_FIVE_HUNDRED_LORDS: "los "
  },
  fr: {
    QUARTER_ACROPOLIS: "l'", QUARTER_FORUM: "le ", QUARTER_MATHA: "le ", QUARTER_NECROPOLIS: "la ",
    QUARTER_UWAYBIL_KUH: "l'", QUARTER_INDUSTRIAL_PARK: "le ", QUARTER_AVENUE: "l'", QUARTER_ZAIBATSU: "le ",
    QUARTER_ZOCALO: "le ", QUARTER_HUIGUAN: "le ", QUARTER_DONJON: "le ", QUARTER_ULEMA: "l'",
    QUARTER_PLAZA: "la ", QUARTER_PURA: "le ", QUARTER_FIVE_HUNDRED_LORDS: "les "
  },
  it: {
    QUARTER_ACROPOLIS: "l'", QUARTER_FORUM: "il ", QUARTER_MATHA: "il ", QUARTER_NECROPOLIS: "la ",
    QUARTER_UWAYBIL_KUH: "l'", QUARTER_INDUSTRIAL_PARK: "il ", QUARTER_AVENUE: "l'", QUARTER_ZAIBATSU: "la ",
    QUARTER_ZOCALO: "la ", QUARTER_HUIGUAN: "la ", QUARTER_DONJON: "il ", QUARTER_ULEMA: "l'",
    QUARTER_PLAZA: "la ", QUARTER_PURA: "la ", QUARTER_FIVE_HUNDRED_LORDS: "i "
  },
  pt: {
    QUARTER_ACROPOLIS: "a ", QUARTER_FORUM: "o ", QUARTER_MATHA: "o ", QUARTER_NECROPOLIS: "a ",
    QUARTER_UWAYBIL_KUH: "o ", QUARTER_INDUSTRIAL_PARK: "o ", QUARTER_AVENUE: "a ", QUARTER_ZAIBATSU: "o ",
    QUARTER_ZOCALO: "o ", QUARTER_HUIGUAN: "o ", QUARTER_DONJON: "o ", QUARTER_ULEMA: "o ",
    QUARTER_PLAZA: "a ", QUARTER_PURA: "o ", QUARTER_FIVE_HUNDRED_LORDS: "os "
  }
};

/**
 * Build a laurel medal crest for top-3 ranks.
 * @param {number} place The 1-based rank.
 * @returns {HTMLElement} The medal element.
 */
export function buildOverlayMedal(place) {
  const medal = div(
    "demographics-settle-medal demographics-settle-medal-" +
      place +
      " demographics-map-overlay-medal"
  );
  medal.style.backgroundImage = "url('" + OVERLAY_LAUREL[place] + "')";
  medal.appendChild(div("demographics-settle-medal-num", String(place)));
  return medal;
}

/**
 * Resolve settlement owner display name for overlay header.
 * @param {*} settlement Settlement record.
 * @returns {string} Owner display name.
 */
function overlayOwnerName(settlement) {
  if (!settlement || !settlement.owner) return "";
  return settlement.owner.leaderName || settlement.owner.civName || "";
}

/**
 * Build the overlay's identity header.
 * @param {*} settlement The settlement record.
 * @returns {HTMLElement} The header element.
 */
export function buildOverlayHeader(settlement) {
  const head = div("demographics-map-overlay-head");
  const rank = settlement.ranks ? settlement.ranks.composite : 0;
  if (rank >= 1 && rank <= 3) head.appendChild(buildOverlayMedal(rank));
  else head.appendChild(div("demographics-map-overlay-rank", "#" + (rank || "—")));
  const text = div("demographics-map-overlay-text");
  text.appendChild(div("demographics-map-overlay-name", settlement.name || "—"));
  const typeKey = settlement.isTown
    ? "LOC_DEMOGRAPHICS_SETTLEMENTS_TOWN"
    : "LOC_DEMOGRAPHICS_SETTLEMENTS_CITY";
  text.appendChild(div("demographics-map-overlay-type", "(" + t(typeKey) + ")"));
  const owner = overlayOwnerName(settlement);
  if (owner) text.appendChild(div("demographics-map-overlay-owner", owner));
  head.appendChild(text);
  return head;
}

/**
 * Build the overlay's population and wonders line.
 * @param {*} settlement The settlement record.
 * @returns {HTMLElement} The meta element.
 */
function buildOverlayMeta(settlement) {
  const meta = div("demographics-map-overlay-meta");
  const pop = div("demographics-map-overlay-pop");
  pop.appendChild(iconEl("blp:Yield_Population", "demographics-settle-yield-icon"));
  pop.appendChild(
    div("demographics-map-overlay-pop-val", fmtPop(settlement.populationEstimate))
  );
  meta.appendChild(pop);
  const wonders = Array.isArray(settlement.wonders) ? settlement.wonders : [];
  if (wonders.length) {
    const row = div("demographics-settle-wonders");
    for (const wonder of wonders) {
      if (!wonder || !wonder.icon) continue;
      const icon = iconEl(wonder.icon, "demographics-settle-wonder-icon");
      if (wonder.nameKey) icon.setAttribute("data-tooltip-content", wonder.nameKey);
      row.appendChild(icon);
    }
    if (row.firstChild) meta.appendChild(row);
  }
  return meta;
}

/**
 * Build the transient flyby progress badge.
 * @param {*} flowState The active flow state.
 * @returns {HTMLElement} The progress element.
 */
export function buildFlybyProgress(flowState) {
  const wrap = div("demographics-map-overlay-flyby");
  wrap.appendChild(
    div(
      "demographics-map-overlay-flyby-label",
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_FLYBY_LABEL")
    )
  );
  const dots = div("demographics-map-overlay-flyby-dots", "");
  wrap.appendChild(dots);
  if (flowState) flowState.dots = dots;
  return wrap;
}

/**
 * Update the flyby shot counter.
 * @param {*} flowState The active flow state.
 * @param {number} index Current shot (1-based).
 * @param {number} total Total shots.
 */
export function updateFlybyProgress(flowState, index, total) {
  if (flowState && flowState.dots) flowState.dots.textContent = index + "/" + total;
}

/**
 * Build a POI caption label.
 * @param {*} caption The {nameKey, year} caption.
 * @returns {string} The caption text.
 */
export function captionText(caption) {
  if (!caption) return "";
  if (caption.text) return caption.text;
  if (caption.foundedYear) {
    return t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_FOUNDED", caption.foundedYear);
  }
  if (typeof caption.standingRank === "number") {
    const rank = caption.standingRank;
    const ord = isEnglishLocale() ? ordinalWord(rank) : String(rank);
    return t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_PLAIN", ord);
  }
  if (caption.touringCity) {
    return t("LOC_DEMOGRAPHICS_SETTLEMENTS_FLYBY_TOURING", caption.touringCity);
  }
  if (caption.textKey) return t(caption.textKey);
  if (!caption.nameKey) return "";
  const name = t(caption.nameKey);
  return caption.year
    ? name + " · " + t("LOC_DEMOGRAPHICS_SETTLEMENTS_WONDER_BUILT", caption.year)
    : name;
}

/**
 * Build the secondary "flavor" sub-line shown beneath the caption (a quarter's
 * description, a wonder's lore, etc.). Empty when the caption carries no flavor.
 * @param {*} caption The caption object (may carry `flavor` raw text / `flavorKey`).
 * @returns {string} The flavor text, or "".
 */
export function flavorText(caption) {
  if (!caption) return "";
  if (caption.flavor) return caption.flavor;
  if (caption.flavorKey) return t(caption.flavorKey);
  return "";
}

/**
 * Return the active language code.
 * @returns {string} The two-letter language code.
 */
export function localeCode() {
  try {
    const locale =
      typeof Locale !== "undefined" && Locale.getCurrentLocale
        ? Locale.getCurrentLocale()
        : "en";
    return String(locale || "en").slice(0, 2).toLowerCase();
  } catch (_) {
    return "en";
  }
}

/**
 * Build a district name with locale-specific article where required.
 * @param {{name: string, quarterType?: string}} district The district record.
 * @returns {string} The articled district phrase.
 */
export function districtPhrase(district) {
  if (!district || !district.name) return "";
  const table = QUARTER_ARTICLE[localeCode()];
  if (!table) return district.name;
  const quarterType = district.quarterType || "";
  if (Object.prototype.hasOwnProperty.call(table, quarterType)) {
    return table[quarterType] + district.name;
  }
  return district.name;
}

/**
 * Return the localized highlight names for the overlay sentence.
 * @param {*} settlement The settlement record.
 * @returns {string[]} The names.
 */
export function highlightNames(settlement) {
  const out = [];
  for (const wonder of Array.isArray(settlement.wonders) ? settlement.wonders : []) {
    if (wonder && wonder.nameKey) out.push(t(wonder.nameKey));
  }
  for (const district of Array.isArray(settlement.districts) ? settlement.districts : []) {
    if (district && district.name) out.push(districtPhrase(district));
  }
  return out;
}

/**
 * Return ordinal words for English ranks.
 * @param {number} rank The rank number.
 * @returns {string} The ordinal text.
 */
export function ordinalWord(rank) {
  return rank >= 1 && rank < ORDINAL_WORDS.length ? ORDINAL_WORDS[rank] : "#" + rank;
}

/**
 * Join names into locale-aware list text.
 * @param {string[]} names The names.
 * @returns {string} The joined list.
 */
export function joinNames(names) {
  const andText = t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_AND");
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return names[0] + " " + andText + " " + names[1];
  return (
    names.slice(0, -1).join(", ") +
    ", " +
    andText +
    " " +
    names[names.length - 1]
  );
}

/**
 * Return a compose result or fallback text.
 * @param {string} result The compose output.
 * @param {string} fallback The fallback text.
 * @returns {string} The resolved text.
 */
export function composeOr(result, fallback) {
  return result && result.indexOf("LOC_") !== 0 ? result : fallback;
}

/**
 * Whether the current locale is English.
 * @returns {boolean} True for English locale.
 */
export function isEnglishLocale() {
  try {
    const locale =
      typeof Locale !== "undefined" && Locale.getCurrentLocale
        ? Locale.getCurrentLocale()
        : "en";
    return typeof locale === "string" && locale.toLowerCase().indexOf("en") === 0;
  } catch (_) {
    return true;
  }
}

/**
 * Build the main recognized sentence.
 * @param {*} settlement The settlement record.
 * @returns {string} The sentence.
 */
export function recognizedSentence(settlement) {
  const rank =
    settlement.ranks && typeof settlement.ranks.composite === "number"
      ? settlement.ranks.composite
      : 0;
  const ordinal = isEnglishLocale() ? ordinalWord(rank) : String(rank);
  const lead = composeOr(
    t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_PLAIN", ordinal),
    "Recognized as the " + ordinal + " greatest settlement in the world."
  );
  const names = highlightNames(settlement);
  if (!names.length) return lead;
  const list = joinNames(names);
  const housed = composeOr(
    t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_HOUSES_LIST", list),
    "It houses " + list + "."
  );
  return lead + " " + housed;
}

/**
 * Build the overlay congratulations block.
 * @param {*} settlement The settlement record.
 * @returns {HTMLElement} The congratulation element.
 */
export function buildCongrats(settlement) {
  const wrap = div("demographics-map-overlay-congrats");
  wrap.appendChild(
    div("demographics-map-overlay-acclaim", recognizedSentence(settlement))
  );
  if (settlement.founded && settlement.founded.year) {
    wrap.appendChild(
      div(
        "demographics-map-overlay-congrats-line",
        t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_FOUNDED", settlement.founded.year)
      )
    );
  }
  return wrap;
}

/**
 * Append the flyby caption + flavor sub-line elements to the card and stash them
 * on the flow state so the tour can update them per shot.
 * @param {HTMLElement} card The overlay card.
 * @param {*} flowState The active flow state (may be undefined).
 */
function appendFlybyCaption(card, flowState) {
  const caption = div("demographics-map-overlay-caption", "");
  if (flowState) flowState.caption = caption;
  card.appendChild(caption);
  const flavor = div("demographics-map-overlay-flavor", "");
  if (flowState) flowState.flavor = flavor;
  card.appendChild(flavor);
}

/**
 * Build the full overlay card.
 * @param {*} settlement The settlement record.
 * @param {string} mode The camera mode.
 * @param {{flowState: *, onBack: () => void}} options Runtime options.
 * @returns {HTMLElement} The card element.
 */
export function buildOverlayCard(settlement, mode, options) {
  const card = div("demographics-map-overlay-card");
  const accent = settlement.owner && (settlement.owner.readable || settlement.owner.primary);
  if (accent) card.style.borderColor = accent;
  card.appendChild(buildOverlayHeader(settlement));
  card.appendChild(buildCongrats(settlement));
  card.appendChild(buildOverlayMeta(settlement));
  if (mode === "flyby") {
    card.appendChild(buildFlybyProgress(options.flowState));
    appendFlybyCaption(card, options.flowState);
  }
  const back = div("demographics-map-overlay-back demographics-settle-clickable");
  back.textContent = t("LOC_DEMOGRAPHICS_SETTLEMENTS_BACK");
  back.addEventListener("click", () => {
    safePlaySound("data-audio-activate");
    options.onBack();
  });
  card.appendChild(back);
  return card;
}

/**
 * Mount the cinematic overlay on document body.
 * @param {*} flowState The active flow state.
 * @param {*} settlement The settlement record.
 * @param {string} mode The camera mode.
 * @param {{onBack: () => void, nowMs: () => number}} options Runtime options.
 */
export function mountOverlay(flowState, settlement, mode, options) {
  const overlay = div("demographics-map-overlay");
  overlay.appendChild(
    buildOverlayCard(settlement, mode, {
      flowState,
      onBack: options.onBack
    })
  );
  try {
    overlay.addEventListener(
      "mousedown",
      () => {
        if (flowState) flowState.uiClickAt = options.nowMs();
      },
      true
    );
  } catch (_) {
    // addEventListener may be absent in headless hosts.
  }
  document.body.appendChild(overlay);
  if (flowState) flowState.overlay = overlay;
}

/**
 * Remove the cinematic overlay from the document.
 * @param {*} flowState The active flow state.
 */
export function removeOverlay(flowState) {
  try {
    if (flowState.overlay && flowState.overlay.parentNode) {
      flowState.overlay.parentNode.removeChild(flowState.overlay);
    }
  } catch (_) {
    // node may already be detached.
  }
}
