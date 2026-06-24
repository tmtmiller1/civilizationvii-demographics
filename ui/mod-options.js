// mod-options.js
//
// Shared Mods category bootstrap for the Civ VII Options screen.
// Safe to load alongside other mods that define the same category.

import { CategoryType } from "/core/ui/options/model-options.js";
import { CategoryData } from "/core/ui/options/options-helpers.js";

// This module runs at SHELL scope (the main menu), so an exception thrown here
// bubbles into the FrontEnd UI context and can take the whole main menu down —
// i.e. "the game won't load." The writes below mutate engine-owned objects
// imported from /core/ui/options; a future game patch could reshape or freeze
// them (ES modules are strict-mode, so writing a frozen object throws). Guard
// every assumption and swallow any failure: the worst case of this bootstrap
// not running is the mod's options simply not appearing under a "Mods"
// category — never a broken menu.
try {
  if (
    typeof CategoryType !== "undefined" &&
    CategoryType &&
    !CategoryType.Mods
  ) {
    CategoryType["Mods"] = "mods";
  }
  const modsKey =
    typeof CategoryType !== "undefined" && CategoryType
      ? CategoryType.Mods
      : "mods";
  if (
    typeof CategoryData !== "undefined" &&
    CategoryData &&
    modsKey &&
    !CategoryData[modsKey]
  ) {
    CategoryData[modsKey] = {
      title: "LOC_UI_CONTENT_MGR_SUBTITLE",
      description: "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION"
    };
  }
} catch (e) {
  console.warn("[Demographics.mod-options] Mods-category bootstrap skipped:", e);
}
