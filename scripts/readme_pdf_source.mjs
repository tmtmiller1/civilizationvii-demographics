// readme_pdf_source.mjs
//
// Turn README.md into the markdown the PDF is built from. The README shows its pictures through
// HTML (a hero shot and a two-column gallery table), which pandoc's LaTeX writer drops, so each one
// becomes a markdown image with its caption. Remote badge images are dropped: the PDF build has no
// network. Screenshots are copied at PDF width so the file stays a few megabytes instead of tens.
//
// Usage: node scripts/readme_pdf_source.mjs <out-dir>   (writes <out-dir>/README.pdf.md + images/)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const outDir = process.argv[2];
if (!outDir) throw new Error("usage: readme_pdf_source.mjs <out-dir>");
const imgDir = path.join(outDir, "img");
fs.mkdirSync(imgDir, { recursive: true });

/** Longest edge of a picture in the PDF, in pixels. */
const IMAGE_WIDTH = 1400;

/**
 * Copy a picture into the build directory, scaled down for print.
 * @param {string} src Path relative to the repository root.
 * @returns {string} Path relative to the build directory.
 */
function stage(src) {
  const from = path.join(ROOT, src);
  if (!fs.existsSync(from)) throw new Error("missing image: " + src);
  const name = src.replace(/[^\w.-]+/g, "-");
  const to = path.join(imgDir, name);
  if (!fs.existsSync(to)) {
    execFileSync("sips", ["-Z", String(IMAGE_WIDTH), from, "--out", to], { stdio: "ignore" });
  }
  return path.posix.join("img", name);
}

/**
 * Escape the characters pandoc reads as markup inside a caption.
 * @param {string} s Caption text.
 * @returns {string} Caption.
 */
function caption(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/([[\]*_])/g, "\\$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The gallery table as one image per line, each with its caption.
 * @param {string} table The `<table>...</table>` block.
 * @returns {string} Markdown.
 */
function gallery(table) {
  const cells = [...table.matchAll(/<td[^>]*>(.*?)<\/td>/gs)];
  const out = [];
  for (const [, cell] of cells) {
    const img = cell.match(/<img src="([^"]+)"/);
    if (!img || img[1].startsWith("http")) continue;
    const sub = cell.match(/<sub>(.*?)<\/sub>/s);
    const alt = cell.match(/alt="([^"]*)"/);
    out.push("![" + caption(sub?.[1] || alt?.[1] || "") + "](" + stage(img[1]) + ")");
  }
  return out.join("\n\n");
}

let md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

// The gallery tables.
md = md.replace(/<table>.*?<\/table>/gs, (t) => gallery(t));

// The hero shot and the logo; badges and any other remote picture go.
md = md.replace(/<p align="center">.*?<\/p>/gs, (block) => {
  const local = [...block.matchAll(/<img src="(?!http)([^"]+)"[^>]*alt="([^"]*)"/g)];
  return local.map(([, src, alt]) => "![" + caption(alt) + "](" + stage(src) + ")").join("\n\n");
});

// Anything still HTML (spacers, anchors) is not for print.
md = md.replace(/^\s*<[^>]+>\s*$/gm, "");

fs.writeFileSync(path.join(outDir, "README.pdf.md"), md);
console.log("staged", fs.readdirSync(imgDir).length, "images");
