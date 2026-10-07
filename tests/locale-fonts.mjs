import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Locale font lists. BodyFont and TitleFont have no Hangul, kana or Han glyphs, and a canvas draws
// with the first family only, so for Chinese, Japanese and Korean the locale's CJK face must lead
// (Korean chart titles, axis titles and toolbar labels used to render as missing-glyph boxes).
// The order mirrors the game's global-scaling.js getOrderedFontFamily.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedLocale = globalThis.Locale;
const savedDocument = globalThis.document;
let locale = "en_US";
globalThis.Locale = { getCurrentDisplayLocale: () => locale, compose: (k) => k };
const { localeFontFamily, applyLocaleFontClass } = await import("/demographics/ui/core/demographics-i18n.js");

const expectFirst = {
  en_US: "BodyFont", de_DE: "BodyFont", es_ES: "BodyFont", fr_FR: "BodyFont", it_IT: "BodyFont",
  pl_PL: "BodyFont", pt_BR: "BodyFont", ru_RU: "BodyFont",
  zh_Hans_CN: "BodyFont-SC", zh_Hant_HK: "BodyFont-TC", ja_JP: "BodyFont-JP", ko_KR: "BodyFont-KR"
};
const expectClass = { zh_Hans_CN: "dg-lang-sc", zh_Hant_HK: "dg-lang-tc", ja_JP: "dg-lang-jp", ko_KR: "dg-lang-kr" };

try {
  for (const [loc, first] of Object.entries(expectFirst)) {
    locale = loc;
    const body = localeFontFamily("body").split(", ");
    const title = localeFontFamily("title").split(", ");
    assert.equal(body[0], first, `${loc}: body list must lead with ${first}`);
    assert.equal(title[0], first.replace("BodyFont", "TitleFont"), `${loc}: title list`);
    assert.equal(new Set(body).size, 6, `${loc}: every face listed once plus sans-serif`);
    assert.equal(body[body.length - 1], "sans-serif");

    const added = [];
    globalThis.document = { documentElement: { classList: { add: (c) => added.push(c) } } };
    applyLocaleFontClass();
    assert.deepEqual(added, expectClass[loc] ? [expectClass[loc]] : [], `${loc}: <html> class`);
  }
  globalThis.document = undefined;
  locale = "ko_KR";
  assert.doesNotThrow(() => applyLocaleFontClass(), "no document: no throw");

  // No script names a game face directly: every font list comes from localeFontFamily(), so a new
  // chart, tooltip or inline style cannot reintroduce a Latin-only list. Stylesheets are covered by the
  // generated locale stylesheet below.
  const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p) : /\.(js|html)$/.test(d.name) ? [p] : [];
  });
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/<!--[\s\S]*?-->/g, "");
  const named = listFiles(path.join(ROOT, "ui"))
    .filter((f) => !f.endsWith(path.join("core", "demographics-i18n.js")))
    .filter((f) => /\b(BodyFont|TitleFont|TitilliumWeb)\b/.test(strip(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(named, [], "scripts naming a game font face instead of using localeFontFamily()");

  // The generated stylesheet must match the other stylesheets (a new font rule needs a regenerate).
  execFileSync(process.execPath, [path.join(ROOT, "scripts/gen-locale-fonts.mjs"), "--check"], { stdio: "pipe" });
  console.log("locale-fonts harness passed");
} finally {
  globalThis.Locale = savedLocale;
  globalThis.document = savedDocument;
}
