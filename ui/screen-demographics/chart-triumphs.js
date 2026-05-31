// chart-triumphs.js
//
// The triumph (Legacy) views: renderTriumphRace, renderTriumphCompletion,
// collectTriumphCivOptions, and renderTriumphStack, plus their private
// localization, progress-query, and card / section builders. The stack view
// reuses renderResourcesStack with the triumph band set. Migrated verbatim
// from demographics-chart.js.

import {
  dlog,
  PALETTE,
  appendEmptyNotice,
  civOptionLabel
} from "/demographics/ui/screen-demographics/chart-shared.js";
import { renderResourcesStack } from "/demographics/ui/screen-demographics/chart-resources.js";

/**
 * @typedef {import("/demographics/ui/screen-demographics/chart-resources.js").StackOptions} StackOptions
 */

// Triumph data helpers — shared by the Race / Completion / Stack renderers.

// Map LegacySubtype → human attribute label + stripe color. Colors borrowed
// from base-standard/ui-next/screens/legacies/legacies-support.js so our
// surfaces look at home next to the in-game Triumphs panel.
const TRIUMPH_ATTR_META = [
  { key: "LEGACY_CULTURAL", label: "Cultural", color: "#AC088E" },
  { key: "LEGACY_DIPLOMATIC", label: "Diplomatic", color: "#255BE4" },
  { key: "LEGACY_ECONOMIC", label: "Economic", color: "#C05D16" },
  { key: "LEGACY_SCIENTIFIC", label: "Scientific", color: "#356F8F" },
  { key: "LEGACY_MILITARISTIC", label: "Militaristic", color: "#B31515" },
  { key: "LEGACY_EXPANSIONIST", label: "Expansionist", color: "#00A717" }
];

/**
 * Resolve the attribute metadata (label + color) for a LegacySubtype, with a
 * neutral "Other" fallback.
 * @param {*} subtype The LegacySubtype string.
 * @returns {{ key: string, label: string, color: string }} The metadata.
 */
function attrMetaFor(subtype) {
  return (
    TRIUMPH_ATTR_META.find((a) => a.key === subtype) || {
      key: "LEGACY_WILDCARD",
      label: "Other",
      color: "#888888"
    }
  );
}

// Localize a LOC_* key with a defensive fallback. Locale.compose can return
// the raw key when the string table for that age isn't loaded, OR when the
// key references another LOC_ token internally that doesn't resolve. We
// detect those cases and produce a humanized fallback from the key itself
// (e.g. "LOC_LEGACY_ANTIQUITY_CULTURAL_1_NAME" → "Antiquity Cultural 1 Name")
// so the user never sees raw LOC_ tokens in the UI.
/**
 * Humanize a raw `LOC_*` token into Title-Case words (e.g.
 * "LOC_LEGACY_ANTIQUITY_CULTURAL_1_NAME" → "Antiquity Cultural 1").
 * @param {*} token The LOC token.
 * @returns {string} The humanized string.
 */
function humanizeLocToken(token) {
  let s = String(token).replace(/^LOC_/, "");
  s = s.replace(/_(NAME|DESCRIPTION|DESC|TRIGGER_DESCRIPTION|TRIGGER|TITLE|TOOLTIP)$/, "");
  s = s.replace(
    /^(LEGACY|TRIUMPH|VICTORY|CRISIS|MODIFIER|BONUS|AGE|PROJECT|UNIT|BUILDING|CIVIC|TECH)_/,
    ""
  );
  return s
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * `Locale.compose(key)` returning a usable string, or the raw `key` when
 * compose is unavailable, throws, or yields nothing.
 * @param {string} key The localization key.
 * @returns {string} The composed string, or `key`.
 */
function tryComposeKey(key) {
  try {
    if (typeof Locale?.compose === "function") {
      const composed = Locale.compose(key);
      if (typeof composed === "string" && composed.length > 0) return composed;
    }
  } catch (_) {
    /* */
  }
  return key;
}

/**
 * Localize a `LOC_*` key with a defensive fallback: humanize a raw-key echo,
 * scrub embedded unresolved tokens, and strip leftover stylize tags. So the
 * user never sees raw LOC_ tokens.
 * @param {*} key The localization key.
 * @returns {string} The localized (or humanized) text.
 */
function localizeText(key) {
  if (typeof key !== "string" || key.length === 0) return "";
  let out = tryComposeKey(key);
  if (typeof out !== "string") return "";
  // Case 1: Locale.compose echoed back the raw key (or stripped wrapping).
  if (out.startsWith("LOC_")) return humanizeLocToken(out);
  // Case 2: composed text contains embedded unresolved LOC_ tokens (Civ7
  // sometimes returns "Build {LOC_TERM_WONDER} wonders" when the inner token
  // isn't in the loaded string table). Scrub each one in place.
  if (out.indexOf("LOC_") !== -1) {
    out = out.replace(/\{?LOC_[A-Z0-9_]+\}?/g, (m) => humanizeLocToken(m.replace(/[{}]/g, "")));
  }
  // Strip any remaining stylize tags Civ7 didn't expand.
  out = out
    .replace(/\[(N|B|\/B|LIST|\/LIST|LI)\]/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out;
}

// Current age string for filtering legacies (matches GameInfo.Legacies.Age).
/**
 * Resolve the current age type string for filtering legacies.
 * @returns {string|null} The AgeType string, or `null`.
 */
function currentAgeType() {
  try {
    if (typeof Game !== "undefined" && Game.age != null) {
      const row =
        typeof GameInfo !== "undefined" && GameInfo.Ages?.lookup
          ? GameInfo.Ages.lookup(Game.age)
          : null;
      if (row?.AgeType) return row.AgeType;
      return String(Game.age);
    }
  } catch (_) {}
  return null;
}

// Get all major civs in the order they should be listed (by pid). Reads
// from the latest sample if Players.getAliveMajorIds isn't available.
/**
 * List the major civ pids, preferring the live engine `getAliveMajorIds`,
 * else scanning the history samples newest-first.
 * @param {DemoHistory|*} history The history blob.
 * @returns {number[]} The major civ pids.
 */
function alliveMajorsFromHistory(history) {
  try {
    if (typeof Players?.getAliveMajorIds === "function") {
      return Array.from(Players.getAliveMajorIds());
    }
  } catch (_) {
    /* */
  }
  return majorsFromSamples(history?.samples || []);
}

/**
 * Collect distinct numeric pids from the samples, newest-first.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {number[]} The distinct pids.
 */
function majorsFromSamples(samples) {
  /** @type {number[]} */
  const out = [];
  const seen = new Set();
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const n = Number(pid);
      if (!Number.isNaN(n) && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

// Display "Leader (Civ)" / fallback to "Player N", reading from latest sample.
/**
 * Resolve a civ's display name ("Leader (Civ)") from the latest sample.
 * @param {DemoHistory|*} history The history blob.
 * @param {number} pid Player id.
 * @returns {string} The display name.
 */
function civDisplayName(history, pid) {
  const samples = history?.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[String(pid)];
    if (!ps) continue;
    if (ps.leaderName) {
      return ps.civName ? ps.leaderName + " (" + ps.civName + ")" : ps.leaderName;
    }
  }
  return "Player " + pid;
}

/**
 * Resolve a civ's primary color from the latest sample, falling back to the
 * rotating palette.
 * @param {DemoHistory|*} history The history blob.
 * @param {number} pid Player id.
 * @returns {string} The color.
 */
function civColor(history, pid) {
  const samples = history?.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[String(pid)];
    if (ps?.primaryColor) return ps.primaryColor;
  }
  return PALETTE[pid % PALETTE.length];
}

/**
 * Whether the Test-of-Time Legacies player API is available for the triumph
 * views.
 * @returns {boolean} True when GameInfo.Legacies + Players.get exist.
 */
function triumphApiAvailable() {
  return (
    typeof GameInfo !== "undefined" && !!GameInfo.Legacies && typeof Players?.get === "function"
  );
}

/**
 * Collect the triumph (Legacy) rows for an age that have a subtype.
 * @param {string|null} age The current age type, or null.
 * @returns {*[]} The legacy rows.
 */
function collectTriumphRows(age) {
  const races = [];
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacyType) continue;
      if (age && row.Age && row.Age !== age) continue;
      // Skip the wildcard / catch-all row (no attribute color).
      if (!row.LegacySubtype) continue;
      races.push(row);
    }
  } catch (_) {
    /* */
  }
  return races;
}

/**
 * One civ's progress on a legacy.
 * @typedef {Object} TriumphProgress
 * @property {number} current Current progress.
 * @property {number} total Total required.
 * @property {boolean} triggered Whether the legacy is triggered.
 * @property {number} raceWinner The winning pid, or -1.
 */

/**
 * Query one civ's live progress on a legacy via `player.Legacies`.
 * @param {number} pid Player id.
 * @param {*} legacyType The legacy type.
 * @returns {TriumphProgress|null} The progress, or `null`.
 */
function triumphProgressFor(pid, legacyType) {
  try {
    const player = Players.get(pid);
    const pl = player?.Legacies;
    if (!pl) return null;
    const p = pl.getProgress ? pl.getProgress(legacyType) : null;
    return readTriumphProgress(pl, p, legacyType);
  } catch (_) {
    return null;
  }
}

/**
 * Read a {@link TriumphProgress} from a `getProgress` result + Legacies handle.
 * @param {*} pl The player's Legacies accessor.
 * @param {*} p The `getProgress(legacyType)` result (may be null).
 * @param {*} legacyType The legacy type.
 * @returns {TriumphProgress} The progress.
 */
function readTriumphProgress(pl, p, legacyType) {
  const slot = p && p.progress ? p.progress[0] : null;
  const raceWinner = p && typeof p.raceWinner === "number" ? p.raceWinner : -1;
  return {
    current: (slot && slot.current) ?? 0,
    total: (slot && slot.total) ?? 0,
    triggered: !!(pl.isTriggered && pl.isTriggered(legacyType)),
    raceWinner
  };
}

/**
 * One race row's resolved data (per-civ progress, winner, total).
 * @typedef {Object} RaceDatum
 * @property {*} row The legacy row.
 * @property {(TriumphProgress & { pid: number })[]} civs Per-civ progress.
 * @property {number} winner The winning pid, or -1.
 * @property {number} total Total required.
 */

/**
 * Build the per-race data: each civ's progress, the race winner, and the total.
 * @param {*[]} races The legacy rows.
 * @param {number[]} majors The major civ pids.
 * @returns {RaceDatum[]} The race data.
 */
function buildRaceData(races, majors) {
  return races.map((row) => {
    const civs = majors.map((pid) => ({
      pid,
      ...(triumphProgressFor(pid, row.LegacyType) || {
        current: 0,
        total: 0,
        triggered: false,
        raceWinner: -1
      })
    }));
    // Race winner is reported on every civ's progress equally; grab any one.
    let winner = -1;
    for (const c of civs) {
      if (c.raceWinner !== -1) {
        winner = c.raceWinner;
        break;
      }
    }
    // Total available is whichever non-zero we saw (same for a given legacy).
    let total = 0;
    for (const c of civs) {
      if (c.total > total) total = c.total;
    }
    // Sort civs by progress, with the winner first.
    civs.sort((a, b) => {
      if (a.pid === winner && b.pid !== winner) return -1;
      if (b.pid === winner && a.pid !== winner) return 1;
      return b.current - a.current;
    });
    return { row, civs, winner, total };
  });
}

/**
 * Sort race data by attribute order, then activity, then localized name.
 * @param {RaceDatum[]} raceData The race data (sorted in place).
 * @returns {void}
 */
function sortRaceData(raceData) {
  const ATTR_ORDER = TRIUMPH_ATTR_META.map((a) => a.key);
  raceData.sort((a, b) => {
    const ai = ATTR_ORDER.indexOf(a.row.LegacySubtype);
    const bi = ATTR_ORDER.indexOf(b.row.LegacySubtype);
    if (ai !== bi) return ai - bi;
    const aActive = a.civs.some((c) => c.current > 0) ? 1 : 0;
    const bActive = b.civs.some((c) => c.current > 0) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const an = localizeText(a.row.Name) || a.row.LegacyType || "";
    const bn = localizeText(b.row.Name) || b.row.LegacyType || "";
    return an.localeCompare(bn);
  });
}

const TRIUMPH_CARD_CORNER_BLP = "blp:mp_player_detail";
const TRIUMPH_CARD_FILIGREE_L = "blp:base_top-filigree_left";
const TRIUMPH_CARD_FILIGREE_R = "blp:base_top-filigree_right";
const TRIUMPH_CARD_RING_BLP = "blp:base_triumph_ring";

/**
 * Append one rotated corner adornment to a triumph card.
 * @param {HTMLElement} card The card element.
 * @param {string} rotate The CSS rotation (e.g. "180deg").
 * @param {string} position The CSS position fragment.
 * @returns {void}
 */
function addCardCorner(card, rotate, position) {
  const c = document.createElement("div");
  c.style.cssText = [
    "position:absolute",
    "width:1.5rem",
    "height:1.5rem",
    "background-image:url('" + TRIUMPH_CARD_CORNER_BLP + "')",
    "background-size:contain",
    "background-repeat:no-repeat",
    "background-position:center",
    "transform:rotate(" + rotate + ")",
    position
  ].join(";");
  card.appendChild(c);
}

/**
 * Append the four corner adornments to a triumph card.
 * @param {HTMLElement} card The card element.
 * @returns {void}
 */
function addCardCorners(card) {
  addCardCorner(card, "180deg", "top:0.5rem;left:0.4rem");
  addCardCorner(card, "-90deg", "top:0.5rem;right:0.4rem");
  addCardCorner(card, "90deg", "bottom:0.4rem;left:0.4rem");
  addCardCorner(card, "0deg", "bottom:0.4rem;right:0.4rem");
}

/**
 * Append the top filigree pair (tinted by attribute color) to a card.
 * @param {HTMLElement} card The card element.
 * @param {{ color: string }} a The attribute metadata.
 * @returns {void}
 */
function addCardFiligree(card, a) {
  const filigreeRow = document.createElement("div");
  filigreeRow.style.cssText =
    "position:absolute;top:0;left:0;right:0;height:2.5rem;pointer-events:none;";
  if (a.color) filigreeRow.style.background = a.color + "22"; // very subtle tint
  const filL = document.createElement("div");
  filL.style.cssText =
    "position:absolute;width:7rem;height:2.5rem;left:1rem;top:-0.2rem;" +
    "background-image:url('" +
    TRIUMPH_CARD_FILIGREE_L +
    "');background-size:contain;" +
    "background-repeat:no-repeat;background-position:center;opacity:0.4;";
  const filR = document.createElement("div");
  filR.style.cssText =
    "position:absolute;width:7rem;height:2.5rem;right:1rem;top:-0.2rem;" +
    "background-image:url('" +
    TRIUMPH_CARD_FILIGREE_R +
    "');background-size:contain;" +
    "background-repeat:no-repeat;background-position:center;opacity:0.4;";
  filigreeRow.appendChild(filL);
  filigreeRow.appendChild(filR);
  card.appendChild(filigreeRow);
}

/**
 * Append the top ring (attribute initial, or ✓ when triggered) to a card.
 * @param {HTMLElement} card The card element.
 * @param {{ color: string, label: string }} a The attribute metadata.
 * @param {boolean} isTriggered Whether any civ triggered this triumph.
 * @returns {void}
 */
function addCardRing(card, a, isTriggered) {
  const ringWrap = document.createElement("div");
  ringWrap.style.cssText = [
    "position:absolute",
    "top:-1.6rem",
    "left:50%",
    "transform:translateX(-50%)",
    "width:4.4rem",
    "height:4.4rem",
    "background-image:url('" + TRIUMPH_CARD_RING_BLP + "')",
    "background-size:contain",
    "background-repeat:no-repeat",
    "background-position:center",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "pointer-events:none"
  ].join(";");
  const ringInner = document.createElement("div");
  ringInner.style.cssText = [
    "width:2.8rem",
    "height:2.8rem",
    "border-radius:50%",
    "background:" + a.color,
    "border:2px solid #e5d2ac",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "color:#ffffff",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:1.2rem",
    "font-weight:800",
    "box-shadow:0 0 0.5rem rgba(0,0,0,0.6)"
  ].join(";");
  ringInner.textContent = a.label.charAt(0);
  if (isTriggered) {
    ringInner.textContent = "✓";
    ringInner.style.background = "#f3c34c";
    ringInner.style.color = "#1c1408";
  }
  ringWrap.appendChild(ringInner);
  card.appendChild(ringWrap);
}

/**
 * Append the triumph name to a card.
 * @param {HTMLElement} card The card element.
 * @param {*} row The legacy row.
 * @returns {void}
 */
function addCardName(card, row) {
  const name = document.createElement("div");
  name.style.cssText = [
    "margin-top:2.6rem",
    "color:#e5d2ac",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:1rem",
    "font-weight:800",
    "text-transform:uppercase",
    "letter-spacing:0.08em",
    "text-align:center",
    "text-shadow:0 0 0.3rem rgba(0,0,0,0.7)",
    "line-height:1.2",
    "padding:0 0.4rem"
  ].join(";");
  name.textContent = localizeText(row.Name) || row.LegacyType || "Triumph";
  card.appendChild(name);
}

/**
 * Append the Commemorative/Instant dedication pill (with dividers) to a card.
 * @param {HTMLElement} card The card element.
 * @param {{ color: string, label: string }} a The attribute metadata.
 * @param {boolean} isMajor Whether the legacy is a major (commemorative) one.
 * @returns {void}
 */
function addCardPill(card, a, isMajor) {
  const pillRow = document.createElement("div");
  pillRow.style.cssText =
    "display:flex;align-items:center;justify-content:center;margin-top:0.4rem;gap:0.4rem;width:100%;";
  const divL = document.createElement("div");
  divL.style.cssText =
    "flex:0 0 3.5rem;height:1px;background:linear-gradient(to right, rgba(81,78,84,0), rgba(81,78,84,0.9));";
  const pill = document.createElement("div");
  pill.className = "dedication-pill";
  pill.style.cssText = [
    "padding:0.05rem 0.6rem",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:0.72rem",
    "color:" + (isMajor ? a.color : "#85878c"),
    "text-transform:uppercase",
    "letter-spacing:0.12em",
    "font-weight:700",
    "white-space:nowrap"
  ].join(";");
  pill.textContent = isMajor ? "Commemorative · " + a.label : "Instant · " + a.label;
  const divR = document.createElement("div");
  divR.style.cssText =
    "flex:0 0 3.5rem;height:1px;background:linear-gradient(to left, rgba(81,78,84,0), rgba(81,78,84,0.9));";
  pillRow.appendChild(divL);
  pillRow.appendChild(pill);
  pillRow.appendChild(divR);
  card.appendChild(pillRow);
}

/**
 * Append the requirements + reward text rows to a card (when present).
 * @param {HTMLElement} card The card element.
 * @param {*} row The legacy row.
 * @returns {void}
 */
function addCardRequirementsAndReward(card, row) {
  if (row.TriggerDescription) {
    const req = document.createElement("div");
    req.style.cssText = [
      "margin-top:0.6rem",
      "font-size:0.78rem",
      "color:#c2c4cc",
      "text-align:center",
      "line-height:1.3",
      "padding:0 0.3rem",
      "font-style:italic"
    ].join(";");
    req.textContent = localizeText(row.TriggerDescription);
    card.appendChild(req);
  }
  const rewardText = row.Description || row.RewardDescription || null;
  if (rewardText) {
    const rwd = document.createElement("div");
    rwd.style.cssText = [
      "margin-top:0.45rem",
      "font-size:0.78rem",
      "color:#c2c4cc",
      "text-align:center",
      "line-height:1.3",
      "padding:0 0.3rem"
    ].join(";");
    const rwdLabel = document.createElement("span");
    rwdLabel.style.cssText =
      "color:#e5d2ac;font-family:TitleFont, BodyFont, sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;";
    rwdLabel.textContent = "Reward: ";
    rwd.appendChild(rwdLabel);
    const rwdBody = document.createElement("span");
    rwdBody.textContent = localizeText(rewardText);
    rwd.appendChild(rwdBody);
    card.appendChild(rwd);
  }
}

/**
 * Append the winner trophy line to a card when the race has a winner.
 * @param {HTMLElement} card The card element.
 * @param {RaceDatum} rd The race datum.
 * @param {DemoHistory|*} history The history blob (for the name).
 * @returns {void}
 */
function addCardTrophy(card, rd, history) {
  if (rd.winner === -1) return;
  const trophy = document.createElement("div");
  trophy.style.cssText = [
    "margin-top:0.55rem",
    "color:#f3c34c",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:0.82rem",
    "font-weight:700",
    "text-transform:uppercase",
    "letter-spacing:0.08em",
    "text-align:center"
  ].join(";");
  trophy.textContent = "🏆 " + civDisplayName(history, rd.winner);
  card.appendChild(trophy);
}

/**
 * Append the spacer + per-civ progress bars (or a "No progress yet." note) to
 * a card.
 * @param {HTMLElement} card The card element.
 * @param {RaceDatum} rd The race datum.
 * @param {{ color: string }} a The attribute metadata.
 * @param {DemoHistory|*} history The history blob (for names/colors).
 * @returns {void}
 */
function addCardProgressBars(card, rd, a, history) {
  // Spacer that pushes the bars to the bottom of the card.
  const spacer = document.createElement("div");
  spacer.style.flex = "1 1 auto";
  spacer.style.minHeight = "0.6rem";
  card.appendChild(spacer);

  // Small per-civ progress bars — ONLY for civs with current > 0 (winner
  // included). This is the user-requested addition.
  const active = rd.civs.filter((c) => c.current > 0 || c.pid === rd.winner);
  const barsBox = document.createElement("div");
  barsBox.style.cssText = "width:100%;display:flex;flex-direction:column;gap:0.18rem;";
  if (active.length === 0) {
    const noneMsg = document.createElement("div");
    noneMsg.style.cssText = "font-size:0.72rem;color:#85878c;font-style:italic;text-align:center;";
    noneMsg.textContent = "No progress yet.";
    barsBox.appendChild(noneMsg);
  } else {
    for (const c of active) {
      barsBox.appendChild(buildCivProgressRow(c, rd, a, history));
    }
  }
  card.appendChild(barsBox);
}

/**
 * Build one civ's progress row (name + bar + count) for a triumph card.
 * @param {TriumphProgress & { pid: number }} c The civ progress.
 * @param {RaceDatum} rd The race datum.
 * @param {{ color: string }} a The attribute metadata.
 * @param {DemoHistory|*} history The history blob (for name/color).
 * @returns {HTMLElement} The row element.
 */
function buildCivProgressRow(c, rd, a, history) {
  const isWinner = c.pid === rd.winner;
  const row = document.createElement("div");
  row.style.cssText =
    "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(2.4rem,auto);gap:0.4rem;align-items:center;";
  row.appendChild(buildCivProgressNameCell(c, isWinner, history));
  row.appendChild(buildCivProgressBar(c, rd, a));
  const num = document.createElement("div");
  num.style.cssText =
    "font-family:monospace, ui-monospace;font-size:0.7rem;color:" +
    (isWinner ? "#f3c34c" : "#c2c4cc") +
    ";text-align:right;font-weight:" +
    (c.triggered ? "700" : "500") +
    ";";
  num.textContent = c.current + "/" + rd.total + (c.triggered ? " ✓" : "");
  row.appendChild(num);
  return row;
}

/**
 * Build the name cell (dot + civ name) for a civ progress row.
 * @param {TriumphProgress & { pid: number }} c The civ progress.
 * @param {boolean} isWinner Whether this civ won the race.
 * @param {DemoHistory|*} history The history blob (for name/color).
 * @returns {HTMLElement} The name cell.
 */
function buildCivProgressNameCell(c, isWinner, history) {
  const nameCell = document.createElement("div");
  nameCell.style.cssText = "display:flex;align-items:center;gap:0.3rem;min-width:0;";
  const dot = document.createElement("span");
  dot.style.cssText =
    "width:0.45rem;height:0.45rem;border-radius:50%;flex-shrink:0;background:" +
    civColor(history, c.pid) +
    ";";
  nameCell.appendChild(dot);
  const nm = document.createElement("span");
  nm.style.cssText =
    "font-size:0.72rem;color:" +
    (isWinner ? "#f3c34c" : "#e5d2ac") +
    ";font-weight:" +
    (isWinner ? "700" : "500") +
    ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
  nm.textContent = civDisplayName(history, c.pid);
  nameCell.appendChild(nm);
  return nameCell;
}

/**
 * Build the progress bar (track + optional fill) for a civ progress row.
 * @param {TriumphProgress & { pid: number }} c The civ progress.
 * @param {RaceDatum} rd The race datum.
 * @param {{ color: string }} a The attribute metadata.
 * @returns {HTMLElement} The bar element.
 */
function buildCivProgressBar(c, rd, a) {
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:relative;height:0.3rem;background:rgba(20,16,10,0.7);border:1px solid rgba(168,132,90,0.4);border-radius:0.1rem;overflow:hidden;";
  if (rd.total > 0 && c.current > 0) {
    const fill = document.createElement("div");
    const pct = Math.min(100, (c.current / rd.total) * 100);
    fill.style.cssText =
      "position:absolute;left:0;top:0;bottom:0;width:" +
      pct +
      "%;background:" +
      (c.triggered ? "#f3c34c" : a.color) +
      ";opacity:" +
      (c.triggered ? "0.95" : "0.85") +
      ";";
    bar.appendChild(fill);
  }
  return bar;
}

/**
 * Build one full triumph card (ornate chrome + ring + name + pill +
 * requirements + reward + trophy + per-civ progress bars).
 * @param {RaceDatum} rd The race datum.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The card element.
 */
function buildTriumphCard(rd, history) {
  const a = attrMetaFor(rd.row.LegacySubtype);
  const isMajor = rd.row.MajorLegacy !== false;
  const isTriggered = rd.civs.some((c) => c.triggered);

  const card = document.createElement("div");
  card.className = "ornate-card-bg triumph-card";
  card.style.cssText = [
    "position:relative",
    "width:22rem",
    "min-height:24rem",
    "padding:1.5rem 1rem 1rem",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "pointer-events:auto"
  ].join(";");

  addCardCorners(card);
  addCardFiligree(card, a);
  addCardRing(card, a, isTriggered);
  addCardName(card, rd.row);
  addCardPill(card, a, isMajor);
  addCardRequirementsAndReward(card, rd.row);
  addCardTrophy(card, rd, history);
  addCardProgressBars(card, rd, a, history);
  return card;
}

// Triumph Race — per-civ progress on each first-come-first-served triumph
// (those marked FirstPlayerOnly in GameInfo.Legacies). Reads
// Players.get(pid).Legacies.getProgress(legacyType) live each render so the
// `raceWinner` field surfaces immediately when a civ claims a race.
/**
 * Render the Triumph Race view: one ornate card per triumph for the current
 * age, with small per-civ progress bars. Reads `player.Legacies` live.
 * @param {HTMLElement} host The view host (cleared and repopulated).
 * @param {{ history?: DemoHistory|* }} [options] Render options.
 * @returns {null} Always `null` (the view has no chart handle).
 */
export function renderTriumphRace(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  host.style.overflowY = "auto";
  host.style.padding = "0.6rem 0.8rem";

  if (!triumphApiAvailable()) {
    appendEmptyNotice(host, "Test-of-Time Legacies API unavailable.");
    return null;
  }

  const age = currentAgeType();
  const majors = alliveMajorsFromHistory(opts.history);
  if (majors.length === 0) {
    appendEmptyNotice(host, "No civs sampled yet.");
    return null;
  }

  // Collect ALL triumphs (major + minor, race + non-race) for this age — every
  // triumph appears card-style like the Completion screen, with progress bars
  // only for civs actively making progress.
  const races = collectTriumphRows(age);
  if (races.length === 0) {
    appendEmptyNotice(
      host,
      age ? "No triumphs available in " + age + "." : "No triumphs available."
    );
    return null;
  }

  const raceData = buildRaceData(races, majors);
  // Order: by attribute then by activity, alphabetical tiebreak.
  sortRaceData(raceData);

  // Render — direct clone of the native triumph-card chrome (ornate-card-bg,
  // corner adornments, top filigrees, attribute ring, name, dedication pill,
  // requirements) PLUS small per-civ progress bars. Laid out as a wrapping
  // flex grid like the native triumphs tab.
  const grid = document.createElement("div");
  grid.style.display = "flex";
  grid.style.flexWrap = "wrap";
  grid.style.gap = "1.2rem 1rem";
  grid.style.justifyContent = "center";
  grid.style.padding = "0.5rem 0.3rem";
  for (const rd of raceData) {
    grid.appendChild(buildTriumphCard(rd, opts.history));
  }
  host.appendChild(grid);

  dlog("triumph race rendered; races=", raceData.length);
  return null;
}

/**
 * Count the available triumphs per attribute for an age.
 * @param {string|null} age The current age type, or null.
 * @returns {Record<string, number>} Per-attribute totals.
 */
function computeTriumphTotals(age) {
  /** @type {Record<string, number>} */
  const totals = {};
  for (const a of TRIUMPH_ATTR_META) totals[a.key] = 0;
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacySubtype) continue;
      if (age && row.Age && row.Age !== age) continue;
      if (totals[row.LegacySubtype] !== undefined) totals[row.LegacySubtype]++;
    }
  } catch (_) {
    /* */
  }
  return totals;
}

/**
 * Whether a civ has triggered a given legacy (defensive).
 * @param {*} pl The player's Legacies accessor.
 * @param {*} legacyType The legacy type.
 * @returns {boolean} True when triggered.
 */
function isLegacyTriggered(pl, legacyType) {
  try {
    return !!pl.isTriggered?.(legacyType);
  } catch (_) {
    return false;
  }
}

/**
 * Tally one civ's triggered triumphs per attribute for an age.
 * @param {*} pl The player's Legacies accessor (may be null).
 * @param {string|null} age The current age type, or null.
 * @returns {Record<string, number>} Per-attribute triggered counts.
 */
function tallyCivCounts(pl, age) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const a of TRIUMPH_ATTR_META) counts[a.key] = 0;
  if (!pl) return counts;
  try {
    for (const row of GameInfo.Legacies) {
      if (!legacyCountsForAge(row, age) || counts[row.LegacySubtype] === undefined) continue;
      if (isLegacyTriggered(pl, row.LegacyType)) counts[row.LegacySubtype]++;
    }
  } catch (_) {
    /* */
  }
  return counts;
}

/**
 * Whether a Legacies row has a subtype and belongs to the active age.
 * @param {*} row A GameInfo.Legacies row.
 * @param {string|null} age The current age type, or null.
 * @returns {boolean} True when the row counts for this age.
 */
function legacyCountsForAge(row, age) {
  if (!row || !row.LegacySubtype) return false;
  if (age && row.Age && row.Age !== age) return false;
  return true;
}

/**
 * One civ's completion row data.
 * @typedef {Object} CivCompletion
 * @property {number} pid Player id.
 * @property {Record<string, number>} counts Per-attribute triggered counts.
 * @property {number} sumTriggered Total triggered across attributes.
 */

/**
 * Build the per-civ triggered-count rows (live API), sorted by total desc.
 * @param {number[]} majors The major civ pids.
 * @param {string|null} age The current age type, or null.
 * @returns {CivCompletion[]} The civ completion rows.
 */
function computeCivCompletions(majors, age) {
  const civRows = majors.map((pid) => {
    const pl = Players.get(pid)?.Legacies;
    const counts = tallyCivCounts(pl, age);
    const sumTriggered = Object.values(counts).reduce((s, n) => s + n, 0);
    return { pid, counts, sumTriggered };
  });
  civRows.sort((a, b) => b.sumTriggered - a.sumTriggered);
  return civRows;
}

/**
 * Build the completion view header line.
 * @param {string|null} age The current age type, or null.
 * @returns {HTMLElement} The header element.
 */
function buildCompletionHeader(age) {
  const header = document.createElement("div");
  header.style.fontSize = "0.85rem";
  header.style.color = "#c9b88c";
  header.style.marginBottom = "0.5rem";
  header.textContent =
    "Current age: " +
    (age || "unknown") +
    ". Cells show triggered / total available; bar is filled percent.";
  return header;
}

/**
 * Build one attribute section's header (title + available count).
 * @param {{ color: string, label: string }} a The attribute metadata.
 * @param {number} tot The available-triumph count.
 * @returns {HTMLElement} The section header element.
 */
function buildAttrSectionHead(a, tot) {
  const sectionHead = document.createElement("div");
  sectionHead.style.display = "flex";
  sectionHead.style.alignItems = "baseline";
  sectionHead.style.justifyContent = "space-between";
  sectionHead.style.marginBottom = "0.5rem";
  const sectionTitle = document.createElement("div");
  // Engine fxs-header style: TitleFont uppercase tracking-150 in path color.
  sectionTitle.style.color = a.color;
  sectionTitle.style.fontFamily = "TitleFont, BodyFont, sans-serif";
  sectionTitle.style.fontSize = "1.1rem";
  sectionTitle.style.fontWeight = "800";
  sectionTitle.style.textTransform = "uppercase";
  sectionTitle.style.letterSpacing = "0.15em";
  sectionTitle.style.textShadow = "0 0 0.3rem rgba(0,0,0,0.6)";
  sectionTitle.textContent = a.label;
  sectionHead.appendChild(sectionTitle);
  const sectionCount = document.createElement("div");
  sectionCount.style.fontSize = "0.78rem";
  sectionCount.style.color = "#c9b88c";
  sectionCount.style.fontFamily = "monospace, ui-monospace";
  sectionCount.textContent = tot + " triumph" + (tot === 1 ? "" : "s") + " available";
  sectionHead.appendChild(sectionCount);
  return sectionHead;
}

/**
 * Build a completion row's name cell (dot + civ name).
 * @param {number} pid Player id.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The name cell.
 */
function buildCompletionNameCell(pid, history) {
  const nameCell = document.createElement("div");
  nameCell.style.display = "flex";
  nameCell.style.alignItems = "center";
  nameCell.style.gap = "0.4rem";
  const dot = document.createElement("span");
  dot.style.width = "0.6rem";
  dot.style.height = "0.6rem";
  dot.style.borderRadius = "50%";
  dot.style.background = civColor(history, pid);
  dot.style.flexShrink = "0";
  nameCell.appendChild(dot);
  const nm = document.createElement("span");
  nm.style.color = "#f3e7c4";
  nm.style.fontSize = "0.85rem";
  nm.style.overflow = "hidden";
  nm.style.textOverflow = "ellipsis";
  nm.style.whiteSpace = "nowrap";
  nm.textContent = civDisplayName(history, pid);
  nameCell.appendChild(nm);
  return nameCell;
}

/**
 * Build a completion row's pipped progress bar (track + fill + pips).
 * @param {{ color: string }} a The attribute metadata.
 * @param {number} tot The available count.
 * @param {number} got The triggered count.
 * @returns {HTMLElement} The bar wrapper element.
 */
function buildCompletionBar(a, tot, got) {
  const barWrap = document.createElement("div");
  barWrap.style.position = "relative";
  barWrap.style.height = "1.1rem";
  barWrap.style.display = "flex";
  barWrap.style.alignItems = "center";
  // Track behind the pips.
  const track = document.createElement("div");
  track.style.position = "absolute";
  track.style.left = "0";
  track.style.right = "0";
  track.style.height = "0.32rem";
  track.style.background = "rgba(20, 16, 10, 0.7)";
  track.style.border = "1px solid rgba(201, 162, 76, 0.25)";
  track.style.borderRadius = "0.15rem";
  barWrap.appendChild(track);
  // Filled portion of the track up to the triggered count.
  if (tot > 0 && got > 0) {
    const fill = document.createElement("div");
    fill.style.position = "absolute";
    fill.style.left = "0";
    fill.style.height = "0.32rem";
    fill.style.width = (got / tot) * 100 + "%";
    fill.style.background = a.color;
    fill.style.opacity = "0.85";
    fill.style.borderRadius = "0.15rem";
    barWrap.appendChild(fill);
  }
  barWrap.appendChild(buildCompletionPips(a, tot, got));
  return barWrap;
}

/**
 * Build the evenly-spaced pip row: filled pips up to `got`, hollow beyond.
 * @param {{ color: string }} a The attribute metadata.
 * @param {number} tot The available count.
 * @param {number} got The triggered count.
 * @returns {HTMLElement} The pip row element.
 */
function buildCompletionPips(a, tot, got) {
  const pipRow = document.createElement("div");
  pipRow.style.position = "relative";
  pipRow.style.width = "100%";
  pipRow.style.display = "flex";
  pipRow.style.justifyContent = "space-between";
  pipRow.style.alignItems = "center";
  // Pad ends slightly so first/last pips don't get clipped.
  pipRow.style.padding = "0 0.18rem";
  pipRow.style.boxSizing = "border-box";
  const pipCount = Math.max(1, tot);
  for (let i = 0; i < pipCount; i++) {
    const pip = document.createElement("div");
    pip.style.width = "0.72rem";
    pip.style.height = "0.72rem";
    pip.style.borderRadius = "50%";
    pip.style.flexShrink = "0";
    if (i < got) {
      pip.style.background = a.color;
      pip.style.border = "2px solid #f3c34c";
      pip.style.boxShadow = "0 0 4px " + a.color;
    } else {
      pip.style.background = "rgba(20, 16, 10, 0.85)";
      pip.style.border = "2px solid rgba(201, 162, 76, 0.55)";
    }
    pipRow.appendChild(pip);
  }
  return pipRow;
}

/**
 * Build one completion row (name cell + pipped bar + count) for a civ.
 * @param {{ pid: number, got: number }} cr The civ row data.
 * @param {{ color: string }} a The attribute metadata.
 * @param {number} tot The available count.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The row element.
 */
function buildCompletionRow(cr, a, tot, history) {
  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "minmax(10rem, 14rem) 1fr minmax(3rem, auto)";
  row.style.gap = "0.6rem";
  row.style.alignItems = "center";
  row.appendChild(buildCompletionNameCell(cr.pid, history));
  row.appendChild(buildCompletionBar(a, tot, cr.got));
  const num = document.createElement("div");
  num.style.fontFamily = "monospace, ui-monospace";
  num.style.fontSize = "0.8rem";
  num.style.color = cr.got > 0 ? "#f3c34c" : "#9a8c5c";
  num.style.textAlign = "right";
  num.style.fontWeight = cr.got === tot && tot > 0 ? "700" : "500";
  num.textContent = cr.got + "/" + tot;
  row.appendChild(num);
  return row;
}

/**
 * Build one attribute section (header + per-civ pipped rows sorted by progress).
 * @param {{ key: string, color: string, label: string }} a The attribute meta.
 * @param {Record<string, number>} totals Per-attribute available counts.
 * @param {CivCompletion[]} civRows The civ completion rows.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The section element.
 */
function buildAttrSection(a, totals, civRows, history) {
  const tot = totals[a.key] || 0;
  const section = document.createElement("div");
  section.style.background = "rgba(20, 16, 10, 0.55)";
  section.style.border = "1px solid rgba(201, 162, 76, 0.25)";
  section.style.borderTop = "0.18rem solid " + a.color;
  section.style.borderRadius = "0.2rem";
  section.style.padding = "0.55rem 0.8rem 0.7rem";
  section.appendChild(buildAttrSectionHead(a, tot));
  // Per-civ rows, sorted by progress in THIS attribute (desc).
  const rowsForAttr = civRows
    .map((cr) => ({ pid: cr.pid, got: cr.counts[a.key] || 0 }))
    .sort((x, y) => y.got - x.got);
  const rowsContainer = document.createElement("div");
  rowsContainer.style.display = "flex";
  rowsContainer.style.flexDirection = "column";
  rowsContainer.style.gap = "0.3rem";
  for (const cr of rowsForAttr) {
    rowsContainer.appendChild(buildCompletionRow(cr, a, tot, history));
  }
  section.appendChild(rowsContainer);
  return section;
}

// Triumph Completion — per-civ × per-attribute grid for the current age.
// Cell shows triggered count / total available + bar.
/**
 * Render the Triumph Completion view: one section per attribute, each with a
 * pipped progress row per civ (live `player.Legacies` triggered counts).
 * @param {HTMLElement} host The view host (cleared and repopulated).
 * @param {{ history?: DemoHistory|* }} [options] Render options.
 * @returns {null} Always `null` (the view has no chart handle).
 */
export function renderTriumphCompletion(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  host.style.overflowY = "auto";
  host.style.padding = "0.6rem 0.8rem";

  if (!triumphApiAvailable()) {
    appendEmptyNotice(host, "Test-of-Time Legacies API unavailable.");
    return null;
  }

  const age = currentAgeType();
  const majors = alliveMajorsFromHistory(opts.history);
  const totals = computeTriumphTotals(age);
  const civRows = computeCivCompletions(majors, age);

  host.appendChild(buildCompletionHeader(age));

  // Sections organized by ATTRIBUTE (mirrors the base-game Victors panel).
  // Each civ gets a pipped progress bar — one pip per legacy in that path,
  // filled-gold for triggered and hollow for not.
  const stack = document.createElement("div");
  stack.style.display = "flex";
  stack.style.flexDirection = "column";
  stack.style.gap = "0.9rem";
  for (const a of TRIUMPH_ATTR_META) {
    stack.appendChild(buildAttrSection(a, totals, civRows, opts.history));
  }
  host.appendChild(stack);
  dlog("triumph completion rendered; civs=", civRows.length, "age=", age);
  return null;
}

// Triumph Stack Over Time — per-civ stacked-area chart of cumulative triumph
// counts over the sample history, stacked by attribute.
/**
 * List every sampled civ (with display labels), for the triumph-stack viewer
 * dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: string, label: string }[]} The civ options.
 */
export function collectTriumphCivOptions(history) {
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  /** @type {Map<string, { pid: string, label: string }>} */
  const seen = new Map();
  for (const s of samps) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      if (seen.has(pid)) continue;
      const ps = s.players[pid];
      seen.set(pid, { pid, label: civOptionLabel(ps, pid) });
    }
  }
  return Array.from(seen.values());
}

const TRIUMPH_BANDS = [
  { id: "triumphs_cultural", label: "Cultural", color: "#AC088E" },
  { id: "triumphs_diplomatic", label: "Diplomatic", color: "#255BE4" },
  { id: "triumphs_economic", label: "Economic", color: "#C05D16" },
  { id: "triumphs_scientific", label: "Scientific", color: "#356F8F" },
  { id: "triumphs_militaristic", label: "Militaristic", color: "#B31515" },
  { id: "triumphs_expansionist", label: "Expansionist", color: "#00A717" }
];

/**
 * Render the Triumph Stack: per-civ stacked-area of cumulative triumph counts
 * over time, stacked by attribute. Reuses {@link renderResourcesStack}.
 * @param {StackOptions} [options] Render options.
 * @param {HTMLElement} host The view host element.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderTriumphStack(host, options) {
  // Reuse the SVG stacked-area renderer with the triumph band set.
  // `yAxisLabel` lets the host override the hardcoded "Resources Assigned"
  // axis title that the shared renderer otherwise paints.
  return renderResourcesStack(
    host,
    Object.assign({}, options || {}, {
      bands: TRIUMPH_BANDS,
      yAxisLabel: "Triumphs (count)"
    })
  );
}
