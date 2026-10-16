// Covers: demographics-font-ladder.js (scale math, small-screen layout), the small-screen block of
//         screen-demographics-density.css, and the name tooltips on the boards.
//
// The screen is drawn at a scale taken from the viewport height, floored at 0.7, with text floored
// higher at 0.82. Below 1920x1080 the frame can also carry the small-screen class, which makes room
// on the boards that run out of width. 1920x1080 and every larger window must look exactly as
// before: same scale, same frame size, same type boost, no class and no new tooltips.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeDocument } from "./_dom-stub.mjs";
import { installMemoryLocalStorage, makeSettings } from "./_engine-stubs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { document } = createFakeDocument();
const viewport = { clientWidth: 1920, clientHeight: 1080, classList: { add: () => {} } };
document.documentElement = viewport;
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, ""), getCurrentDisplayLocale: () => "en_US" };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Configuration = { getGame: () => ({ getValue: () => "full", startSeed: "seed1" }) };
globalThis.Audio = { playSound: () => {} };
globalThis.UI = { getIconURL: () => "blp:test" };
globalThis.Constructibles = { getAt: () => null };
globalThis.GameplayMap = { getPlotByIndex: () => null, getSize: () => ({ width: 60, height: 40 }) };
installMemoryLocalStorage();

const ladder = await import("/demographics/ui/core/demographics-font-ladder.js");
const {
  scaleForHeight,
  frameLayoutSize,
  isCompactViewport,
  isCompactLayout,
  applyVisualScale,
  applyCompactTooltip,
  typeBoost,
  COMPACT_CLASS
} = ladder;

// The scale as it was computed before the small-screen layout, kept here as the reference.
const legacyScale = (h) => Math.max(0.7, Math.min(1.3, h / 1800));
const legacyFrameStyle = (h) => {
  const s = legacyScale(h);
  return {
    width: (96 / s).toFixed(4) + "vw",
    height: (94 / s).toFixed(4) + "vh",
    transform: "translate(-50%, -50%) scale(" + s.toFixed(4) + ")"
  };
};

/** @param {number} w @param {number} h */
function setViewport(w, h) {
  viewport.clientWidth = w;
  viewport.clientHeight = h;
}

/** @param {number} w @param {number} h */
function applyAt(w, h) {
  setViewport(w, h);
  const frame = document.createElement("div");
  applyVisualScale(frame);
  return frame;
}

// Scale table: every resolution the README names, plus Steam Deck and ultrawides.
// scale / boost / frame (local px) / small-screen layout
const TABLE = [
  { w: 1280, h: 720, scale: 0.7, frameW: 1755, frameH: 967, compact: true },
  { w: 1280, h: 800, scale: 0.7, frameW: 1755, frameH: 1074, compact: true },
  { w: 1366, h: 768, scale: 0.7, frameW: 1873, frameH: 1031, compact: true },
  { w: 1600, h: 900, scale: 0.7, frameW: 2194, frameH: 1209, compact: false },
  { w: 1920, h: 1080, scale: 0.7, frameW: 2633, frameH: 1450, compact: false },
  { w: 1920, h: 1200, scale: 0.7, frameW: 2633, frameH: 1611, compact: false },
  { w: 2560, h: 1080, scale: 0.7, frameW: 3511, frameH: 1450, compact: false },
  { w: 2560, h: 1440, scale: 0.8, frameW: 3072, frameH: 1692, compact: false },
  { w: 3440, h: 1440, scale: 0.8, frameW: 4128, frameH: 1692, compact: false },
  { w: 2880, h: 1800, scale: 1, frameW: 2765, frameH: 1692, compact: false },
  { w: 3840, h: 2160, scale: 1.2, frameW: 3072, frameH: 1692, compact: false },
  { w: 5120, h: 2160, scale: 1.2, frameW: 4096, frameH: 1692, compact: false }
];

for (const row of TABLE) {
  const label = row.w + "x" + row.h;
  assert.equal(scaleForHeight(row.h), row.scale, label + ": scale");
  assert.equal(scaleForHeight(row.h), legacyScale(row.h), label + ": scale matches the old formula");
  const size = frameLayoutSize(row.w, row.h);
  assert.equal(Math.round(size.width), row.frameW, label + ": frame width (local px)");
  assert.equal(Math.round(size.height), row.frameH, label + ": frame height (local px)");
  assert.equal(isCompactViewport(row.w, row.h), row.compact, label + ": small-screen layout");

  const frame = applyAt(row.w, row.h);
  const want = legacyFrameStyle(row.h);
  assert.equal(frame.style.width, want.width, label + ": frame width style");
  assert.equal(frame.style.height, want.height, label + ": frame height style");
  assert.equal(frame.style.transform, want.transform, label + ": frame transform");
  assert.equal(frame.classList.contains(COMPACT_CLASS), row.compact, label + ": frame class");
  assert.equal(isCompactLayout(), row.compact, label + ": isCompactLayout");
  assert.equal(typeBoost(), Math.max(1, 0.82 / row.scale), label + ": type boost");
}

// Text lands at the same on-screen size at every small screen as at 1080p (the type floor).
applyAt(1280, 720);
const boost720 = typeBoost();
applyAt(1920, 1080);
assert.equal(boost720, typeBoost(), "720p and 1080p draw text at the same size");
assert.ok(Math.abs(0.7 * boost720 - 0.82) < 1e-9, "text sits at its 0.82 floor on screen");

// 1920x1080 and up, swept: never the small-screen layout, and the frame is styled exactly as before.
for (let w = 1920; w <= 5120; w += 80) {
  for (let h = 1080; h <= 2880; h += 60) {
    assert.equal(isCompactViewport(w, h), false, w + "x" + h + " must keep the full layout");
    const frame = applyAt(w, h);
    const want = legacyFrameStyle(h);
    assert.equal(frame.style.transform, want.transform, w + "x" + h + ": transform unchanged");
    assert.equal(frame.style.width, want.width, w + "x" + h + ": width unchanged");
    assert.equal(frame.className, "", w + "x" + h + ": no class added");
  }
}

// Narrower windows: the class follows the frame's own width, not the resolution name.
assert.equal(isCompactViewport(1440, 900), true, "1440x900 (1975 local px) is small");
assert.equal(isCompactViewport(1680, 1050), false, "1680x1050 (2304 local px) is not");
assert.equal(isCompactViewport(1024, 768), true, "1024x768 is small");
assert.equal(isCompactViewport(1080, 1920), true, "a portrait window narrower than 1920 is small");
// A tall window just under 1920 wide has a 1842 px frame at scale 1, so it's small; at 1920 wide the
// full-layout guarantee wins. Only near-square windows taller than 1260 px see that step.
assert.equal(isCompactViewport(1919, 1800), true, "1919x1800 is small");
assert.equal(isCompactViewport(1920, 1800), false, "1920x1800 keeps the full layout");

// Unreadable viewports stay on the full layout.
for (const bad of [[0, 720], [1280, 0], [NaN, 720], [undefined, undefined], ["1280", "720"], [-1, -1]]) {
  assert.equal(isCompactViewport(bad[0], bad[1]), false, "unreadable viewport " + String(bad));
}
setViewport(undefined, undefined);
const unreadable = document.createElement("div");
assert.equal(applyVisualScale(unreadable), 1, "no viewport: scale 1");
assert.equal(isCompactLayout(), false, "no viewport: full layout");

// Leaving a small window for a large one takes the class off again.
const resized = document.createElement("div");
setViewport(1280, 720);
applyVisualScale(resized);
assert.equal(resized.classList.contains(COMPACT_CLASS), true);
setViewport(1920, 1080);
applyVisualScale(resized);
assert.equal(resized.classList.contains(COMPACT_CLASS), false, "class removed on a resize to 1080p");

// Name tooltips: only in the small-screen layout, and only for real text.
applyAt(1920, 1080);
const big = document.createElement("div");
applyCompactTooltip(big, "Achaemenid Persia");
assert.equal(big.getAttribute("data-tooltip-content"), undefined, "1080p: no tooltip added");
applyAt(1280, 720);
const small = document.createElement("div");
applyCompactTooltip(small, "Achaemenid Persia");
assert.equal(small.getAttribute("data-tooltip-content"), "Achaemenid Persia", "720p: full name as tooltip");
const empty = document.createElement("div");
applyCompactTooltip(empty, "");
applyCompactTooltip(empty, undefined);
applyCompactTooltip(null, "x");
assert.equal(empty.getAttribute("data-tooltip-content"), undefined, "no tooltip for empty text");

// The boards: Top 25 Settlements rows carry their names as tooltips only on a small screen.
const { render: renderSettlements } = await import(
  "/demographics/ui/screen-demographics/views/settlements/view-settlements.js"
);
globalThis.Game = { age: "AGE_EXPLORATION", turn: 5 };
globalThis.GameInfo = { Ages: { lookup: (a) => ({ AgeType: a, Name: "LOC_" + a + "_NAME" }) } };
const LONG = "Persepolis of the Achaemenid Kings";
/** @returns {HTMLElement} the first ranked row after picking the archived age */
function renderArchivedRow() {
  const settings = makeSettings();
  settings.setSetting("settlementsSubTab", "showcase");
  const host = document.createElement("div");
  host._rect.width = 1200;
  host._rect.height = 900;
  renderSettlements(host, {
    history: {
      samples: [],
      settleAges: {
        AGE_ANTIQUITY: {
          turn: 90,
          year: "400 CE",
          top: [{ name: LONG, composite: 42, populationEstimate: 12000, owner: { pid: 2, civName: "Persia" } }]
        }
      }
    },
    settings,
    requestReload: () => {}
  });
  host.querySelectorAll(".demographics-chart-time-filter-pill")[1].dispatch("click");
  return host.querySelectorAll(".demographics-settle-list-row")[0];
}
applyAt(1920, 1080);
const rowBig = renderArchivedRow();
assert.equal(rowBig.querySelector(".demographics-settle-list-name").getAttribute("data-tooltip-content"), undefined,
  "1080p: the Top 25 row is as before");
applyAt(1280, 720);
const rowSmall = renderArchivedRow();
assert.equal(rowSmall.querySelector(".demographics-settle-list-name").getAttribute("data-tooltip-content"), LONG,
  "720p: the settlement name carries its full text");
assert.equal(rowSmall.querySelector(".demographics-settle-list-civ").getAttribute("data-tooltip-content"), "Persia",
  "720p: the civilization line carries its full text");
delete globalThis.Game;
delete globalThis.GameInfo;

// Civilization Rank by Yield (matrix headers) and its table branch.
const render = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js"
);
const profile = { pid: 2, civName: "Achaemenid Persia", leaderName: "Xerxes, King of Kings", civNames: [] };
applyAt(1920, 1080);
let header = render.buildCivHeader(profile, false, false);
assert.equal(header.querySelector(".demographics-worldrankings-allcivs-civ-header-leader")
  .getAttribute("data-tooltip-content"), undefined, "1080p: matrix header as before");
applyAt(1280, 720);
header = render.buildCivHeader(profile, false, false);
assert.equal(header.querySelector(".demographics-worldrankings-allcivs-civ-header-leader")
  .getAttribute("data-tooltip-content"), "Achaemenid Persia", "720p: civilization name as tooltip");
assert.equal(header.querySelector(".demographics-worldrankings-allcivs-civ-header-civ")
  .getAttribute("data-tooltip-content"), "Xerxes, King of Kings", "720p: leader name as tooltip");

// The small-screen stylesheet block.
const densityCss = fs.readFileSync(
  path.join(ROOT, "ui/screen-demographics/styles/screen-demographics-density.css"), "utf8");
const MARKER = "/* Small screens: the frame carries .dg-compact";
const at = densityCss.indexOf(MARKER);
assert.ok(at > 0, "the small-screen block exists");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const before = stripComments(densityCss.slice(0, at));
const block = stripComments(densityCss.slice(at));
assert.ok(!before.includes("dg-compact"), "no small-screen rule outside its block");
const rules = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)];
assert.ok(rules.length >= 8, "the block holds its rules, found " + rules.length);
const LADDER_MIN = 0.85;
for (const [, selectorText, body] of rules) {
  for (const selector of selectorText.split(",").map((s) => s.trim()).filter(Boolean)) {
    assert.match(selector, /^\.demographics-screen \.dg-compact /, "scoped to the small-screen class: " + selector);
  }
  assert.ok(!/font-family\s*:/.test(body), "no font-family in the small-screen block (CJK lists): " + selectorText);
  for (const m of body.matchAll(/font-size\s*:\s*([^;]+);/g)) {
    const step = /^var\(--dg-fs-(\d+)\)$/.exec(m[1].trim());
    assert.ok(step, "font sizes come off the type ladder: " + m[1]);
    assert.ok(Number(step[1]) / 100 >= LADDER_MIN, "names step down, never below body text: " + m[1]);
  }
}
// Every other stylesheet leaves the class alone.
const stylesDir = path.join(ROOT, "ui/screen-demographics/styles");
for (const file of fs.readdirSync(stylesDir).filter((f) => f.endsWith(".css"))) {
  if (file === "screen-demographics-density.css") continue;
  assert.ok(!stripComments(fs.readFileSync(path.join(stylesDir, file), "utf8")).includes("dg-compact"), file);
}

console.log("compact-layout: ok");
