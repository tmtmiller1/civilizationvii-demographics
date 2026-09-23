import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { div, iconEl, fmtPop } from "/demographics/ui/core/ui-helpers.js";
import { publishFontLadder } from "/demographics/ui/core/demographics-font-ladder.js";

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

// Ranks 1..25 have dedicated per-rank localization tags (LOC_DEMOGRAPHICS_SETTLEMENTS_ORDINAL_N),
// so languages that need grammatical inflection can supply a declined ordinal word.
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
// English article choice for proper place names is lexical ("the Parthenon" vs. "Petra"), so
// every named entity defaults to "the " and a curated set of toponyms subtracts it.
// NO_ARTICLE_TYPES (stable type ids) is checked first; NO_ARTICLE_NAMES matches on the
// normalized display name, which is what reaches us for natural wonders and entities without
// a clean type id. To fix a mis-articled entity, add it to one of those sets.

/** @type {Set<string>} */
export const NO_ARTICLE_TYPES = new Set([
  // Verified against the installed game (Civilization VII 1.5.0 with all released packs): every
  // WONDER_* / FEATURE_* below was read from GameInfo, so these ids are what the engine actually
  // reports. Matching on the id rather than the display name is what keeps this correct when a
  // name is spelled differently than expected - "Machu Pikchu", not "Machu Picchu", is the game's
  // own spelling, and the name-only list missed it and produced "the Machu Pikchu".
  //
  // To refresh after a pack adds wonders: in a running game, list
  // `GameInfo.Constructibles` where `ConstructibleClass === "WONDER"` and the null-class
  // `GameInfo.Features`, then add any new toponym here. Anything absent merely gets "the".

  // Wonders that are proper place-names (reject "the").
  "WONDER_ANGKOR_WAT", "WONDER_BOROBUDUR", "WONDER_BUSEOKSA", "WONDER_DUR_SHARRUKIN",
  "WONDER_EL_ESCORIAL", "WONDER_ERDENE_ZUU", "WONDER_HALE_O_KEAWE", "WONDER_HAVANA_HARBOR",
  "WONDER_HA_AMONGA_A_MAUI", "WONDER_HIMEJI_CASTLE", "WONDER_MACHU_PIKCHU", "WONDER_MIREUKSA",
  "WONDER_MONKS_MOUND", "WONDER_MUNDO_PERDIDO", "WONDER_NALANDA", "WONDER_NAN_MADOL",
  "WONDER_NOTRE_DAME", "WONDER_PETRA", "WONDER_REYKHOLT", "WONDER_SERPENT_MOUND",
  "WONDER_SHWEDAGON_ZEDI_DAW", "WONDER_THANH_HUE", "WONDER_WAT_XIENG_THONG",
  "WONDER_WEIYANG_PALACE",

  // Natural wonders that are proper place-names (reject "the"). The ones that keep "the" are
  // deliberately absent: the Bermuda Triangle, the Grand Canyon, the Great Blue Hole, the
  // Valley of Flowers.
  "FEATURE_GULLFOSS", "FEATURE_HOERIKWAGGO", "FEATURE_IGUAZU_FALLS", "FEATURE_KILIMANJARO",
  "FEATURE_MACHAPUCHARE", "FEATURE_MAPU_A_VAEA_BLOWHOLES", "FEATURE_MOUNT_EVEREST",
  "FEATURE_MOUNT_FUJI", "FEATURE_NACHI_FALLS", "FEATURE_SEONGSAN_ILCHULBONG", "FEATURE_THERA",
  "FEATURE_TORRES_DEL_PAINE", "FEATURE_ULURU", "FEATURE_VIHREN", "FEATURE_VINICUNCA"
]);

/** @type {Set<string>} */
export const NO_ARTICLE_NAMES = new Set([
  // Fallback for entities that reach us without a clean type id. NO_ARTICLE_TYPES above is the
  // authoritative list for anything the engine gives an id for; these are kept so a renamed or
  // third-party entity still reads correctly, and include names from packs that may not be
  // installed here.
  // Wonders that are proper place-names (reject "the").
  "machu picchu", "machu pikchu", "angkor wat", "petra", "chichen itza", "nalanda",
  "mundo perdido", "hagia sophia", "mont saint michel", "notre dame",
  "borobudur", "sigiriya", "mesa verde", "great zimbabwe", "meidan emam",
  "chand baori", "buseoksa", "dur sharrukin", "el escorial", "erdene zuu",
  "hale o keawe", "havana harbor", "haamonga a maui", "himeji castle",
  "mireuksa", "monks mound", "nan madol", "reykjaholt", "serpent mound",
  "shwedagon zedi daw", "thanh hue", "wat xieng thong", "weiyang palace",
  // Natural wonders that are proper place-names (reject "the").
  "uluru", "kilimanjaro", "mount kilimanjaro", "mount everest", "everest",
  "vesuvius", "mount vesuvius", "zhangye danxia", "ha long bay",
  "lake victoria", "mount kailash", "gullfoss", "hoerikwaggo", "iguazu falls",
  "machapuchare", "mapu a vaea blowholes", "mount fuji", "nachi falls",
  "seongsan ilchulbong", "thera", "torres del paine", "vihren", "vinicunca"
]);

/**
 * Normalize a display name for article-exception matching: strip diacritics and apostrophes,
 * fold hyphens to spaces, collapse whitespace, lowercase.
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
 * locales use the per-quarter QUARTER_ARTICLE table.
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
 * Resolve the ordinal insert for a settlement's rank in the cinematic sentences: the per-rank
 * localization tag (ranks 1..25) when it resolves, else the English ordinal word for English
 * locales or the bare number otherwise.
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
  // Input shield: a transparent full-viewport layer under the card, so that for the duration of
  // the flyby the only things reachable are Back (the card sits above this) and Escape. Without
  // it the game's HUD stays live behind the cinematic - a leader portrait opens diplomacy, a tile
  // hover raises its tooltip - because disabling WORLD input does not disable the HUD's own DOM.
  const shield = div("demographics-map-shield");
  try {
    for (const type of ["mousedown", "mouseup", "click", "mousemove", "mouseover", "wheel", "contextmenu"]) {
      shield.addEventListener(type, (e) => { e.stopPropagation(); e.preventDefault(); }, true);
    }
  } catch (_) {
    // addEventListener may be absent in headless hosts; the shield still covers the HUD visually.
  }
  document.body.appendChild(shield);
  if (flowState) flowState.shield = shield;

  // The overlay lives on document.body, so it inherits none of the screen's size tokens. The
  // stylesheet gives it the reference-size defaults; this publishes the resolution-scaled values
  // onto the element itself, so the plate tracks the display like every other surface.
  try {
    publishFontLadder(overlay);
  } catch (_) {
    // A failed publish leaves the stylesheet defaults in place, which render at reference size.
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
    if (flowState.shield && flowState.shield.parentNode) {
      flowState.shield.parentNode.removeChild(flowState.shield);
    }
    flowState.shield = null;
  } catch (_) {
    // A shield that cannot be removed must not stop the overlay teardown below.
  }
  try {
    if (flowState.overlay && flowState.overlay.parentNode) {
      flowState.overlay.parentNode.removeChild(flowState.overlay);
    }
  } catch (_) {
    // node may already be detached.
  }
}
