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
}

console.log(`i18n parity harness passed (${SRC.length} keys × ${FOLDERS.length} locales = ${checked})`);
