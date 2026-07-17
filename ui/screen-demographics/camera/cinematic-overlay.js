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

// The cinematic can showcase settlements from the Top-25 ranking, so ranks 1..25
// have dedicated per-rank localization tags
// (LOC_DEMOGRAPHICS_SETTLEMENTS_ORDINAL_1..25). This lets languages that need
// grammatical inflection (e.g. Polish) supply a properly declined ordinal word
// instead of the bare number.
export const ORDINAL_TAG_MAX = 25;

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

// ── English article system ──────────────────────────────────────────
// English article choice for proper monument/place names is lexical, not
// derivable from surface form ("the Parthenon" vs. "Petra" are both single
// capitalized proper nouns). So we default every named entity to "the " — the
// correct choice for the large majority of wonders, quarters and natural
// wonders, and safe for unknown/DLC entities read from GameInfo at runtime —
// and subtract "the" only for a curated set of toponyms.
//
// NO_ARTICLE_TYPES is checked first (stable ConstructibleType / UniqueQuarterType
// ids). It is the authoritative override once you have verified ids; seed it from
// an in-game GameInfo dump (see the dev snippet shipped alongside this change).
// NO_ARTICLE_NAMES is the working fallback that matches on the normalized display
// name, which is what actually reaches us for natural wonders and any entity
// without a clean type id.
//
// To fix a mis-articled entity: add its type id to NO_ARTICLE_TYPES (preferred)
// or its display name to NO_ARTICLE_NAMES. A not-yet-listed toponym merely gets a
// wrong "the " — a one-line fix, never a crash.

/** @type {Set<string>} */
export const NO_ARTICLE_TYPES = new Set([
  // Fill with verified ConstructibleType / UniqueQuarterType ids for toponyms.
  // e.g. "BUILDING_MACHU_PICCHU", "BUILDING_PETRA", "FEATURE_ULURU".
]);

/** @type {Set<string>} */
export const NO_ARTICLE_NAMES = new Set([
  // Wonders that are proper place-names (reject "the").
  "machu picchu", "angkor wat", "petra", "chichen itza", "nalanda",
  "mundo perdido", "hagia sophia", "mont saint michel", "notre dame",
  "borobudur", "sigiriya", "mesa verde", "great zimbabwe", "meidan emam",
  "chand baori",
  // Natural wonders that are proper place-names (reject "the").
  "uluru", "kilimanjaro", "mount kilimanjaro", "mount everest", "everest",
  "vesuvius", "mount vesuvius", "zhangye danxia", "ha long bay",
  "lake victoria", "mount kailash"
]);

/**
 * Normalize a display name for article-exception matching: strip diacritics and
 * apostrophes, fold hyphens to spaces, collapse whitespace, lowercase. Keeps the
 * NO_ARTICLE_NAMES keys robust against accents ("Chichén Itzá") and punctuation
 * ("Mont-Saint-Michel").
 * @param {string} name The display name.
 * @returns {string} The normalized key.
 */
export function normalizeArticleName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a name already carries a leading English article, so we must not
 * prepend another (avoids "the the Forbidden City").
 * @param {string} name The display name.
 * @returns {boolean} True when already articled.
 */
export function startsWithArticle(name) {
  return /^(the|an?)\s/i.test(String(name || ""));
}

/**
 * English article decision for a single named entity.
 * @param {string} name The composed display name.
 * @param {string} typeId The stable type id, or "".
 * @returns {string} The articled name.
 */
export function englishArticled(name, typeId) {
  if (startsWithArticle(name)) return name;
  if (typeId && NO_ARTICLE_TYPES.has(typeId)) return name;
  if (NO_ARTICLE_NAMES.has(normalizeArticleName(name))) return name;
  return "the " + name;
}

/**
 * Apply a locale-appropriate article to a named entity (wonder, quarter, natural
 * wonder). English uses the default-"the" + toponym-exception system; other
 * locales preserve the prior per-quarter QUARTER_ARTICLE behavior.
 * @param {{name: string, typeId?: string}} entity The entity descriptor.
 * @returns {string} The articled name.
 */
export function articledName(entity) {
  const name = entity && entity.name ? String(entity.name) : "";
  if (!name) return "";
  const typeId = entity && entity.typeId ? String(entity.typeId) : "";
  const lang = localeCode();
  if (lang === "en") return englishArticled(name, typeId);
  const table = QUARTER_ARTICLE[lang];
  if (table && Object.prototype.hasOwnProperty.call(table, typeId)) {
    return table[typeId] + name;
  }
  return name;
}

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
    const ord = ordinalText(caption.standingRank);
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
  return articledName({ name: district.name, typeId: district.quarterType || "" });
}

/**
 * Return the localized highlight names for the overlay sentence.
 * @param {*} settlement The settlement record.
 * @returns {string[]} The names.
 */
export function highlightNames(settlement) {
  const out = [];
  for (const wonder of Array.isArray(settlement.wonders) ? settlement.wonders : []) {
    if (wonder && wonder.nameKey) {
      out.push(articledName({ name: t(wonder.nameKey), typeId: wonder.type || "" }));
    }
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
 * Resolve the ordinal insert for a settlement's rank in the cinematic sentences.
 *
 * Prefers the per-rank localization tag (ranks 1..25) so translators can supply a
 * grammatically-inflected form. Falls back to the prior behavior when the tag is
 * unresolved or the rank is outside the Top-25: the English ordinal word for
 * English locales, or the bare number every other sentence frame is built around.
 * @param {number} rank The 1-based rank.
 * @returns {string} The ordinal display text.
 */
export function ordinalText(rank) {
  const fallback = isEnglishLocale() ? ordinalWord(rank) : String(rank);
  if (rank >= 1 && rank <= ORDINAL_TAG_MAX) {
    return composeOr(t("LOC_DEMOGRAPHICS_SETTLEMENTS_ORDINAL_" + rank), fallback);
  }
  return fallback;
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
  const ordinal = ordinalText(rank);
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
