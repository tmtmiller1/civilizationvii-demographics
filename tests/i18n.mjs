import assert from "node:assert/strict";
import fs from "node:fs";

// Locale parity gate: every LOC key in en_us must exist in all ten non-English ModText.xml files,
// so no string silently falls back to English (or shows a raw tag) for non-English players. The
// demographics locale ModText is hand-maintained, so this guards against the drift that goes
// uncaught otherwise — add a key to en_us and you must add it to every locale. Reads the key set
// straight from en_us so the gate needs no generated file.

const enXml = fs.readFileSync("text/en_us/ModText.xml", "utf8");
const SRC = [...enXml.matchAll(/Tag="(LOC_[A-Z0-9_]+)"/g)].map((m) => m[1]);
const FOLDERS = ["de_de", "es_es", "fr_fr", "it_it", "ja_jp", "ko_kr", "pl_pl", "pt_br", "ru_ru", "zh_cn"];

// Duplicate tags are fatal in game: the second INSERT hits the LocalizedText unique key and the
// loader rolls back the WHOLE file, so every string in that language falls back to raw tags.
for (const f of ["en_us", ...FOLDERS]) {
  const xml = fs.readFileSync(`text/${f}/ModText.xml`, "utf8");
  const tags = [...xml.matchAll(/Tag="(LOC_[A-Z0-9_]+)"/g)].map((m) => m[1]);
  const dupes = tags.filter((k, i) => tags.indexOf(k) !== i);
  assert.equal(dupes.length, 0, `${f} defines ${dupes.length} tag(s) twice: ${dupes.slice(0, 4).join(", ")}`);
}

/** Folder → the engine Language attribute its rows must carry (demographics.modinfo locale="…"). */
const LANGUAGE_OF = /** @type {Record<string, string>} */ ({
  de_de: "de_DE", es_es: "es_ES", fr_fr: "fr_FR", it_it: "it_IT", ja_jp: "ja_JP", ko_kr: "ko_KR",
  pl_pl: "pl_PL", pt_br: "pt_BR", ru_ru: "ru_RU", zh_cn: "zh_Hans_CN"
});

let checked = 0;
for (const f of FOLDERS) {
  const xml = fs.readFileSync(`text/${f}/ModText.xml`, "utf8");
  const have = new Set([...xml.matchAll(/Tag="(LOC_[A-Z0-9_]+)"/g)].map((m) => m[1]));
  const missing = SRC.filter((k) => !have.has(k));
  assert.equal(
    missing.length,
    0,
    `${f} is missing ${missing.length} key(s): ${missing.slice(0, 4).join(", ")}`
  );
  checked += SRC.length;
  // Every row carries this folder's engine language. A row tagged with another code (zh_CN instead of
  // zh_Hans_CN) loads under a locale no session uses, so the tag shows raw in game (watched 2026-10-01:
  // the policy banner and the per-turn unit in Simplified Chinese).
  const langs = new Set([...xml.matchAll(/Language="([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...langs], [LANGUAGE_OF[f]], `${f}: rows tagged ${[...langs].join(", ")}`);
}

console.log(`i18n parity harness passed (${SRC.length} keys × ${FOLDERS.length} locales = ${checked})`);
