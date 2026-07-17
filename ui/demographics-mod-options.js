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
// them (ES modules are strict-mode, so writing a frozen object throws), or make
// either object null/undefined. The try/catch swallows any write that throws
// (frozen object, missing property), and the explicit `else` reports the case
// where the Options model itself is absent — either way the worst outcome is the
// mod's options simply not appearing under a "Mods" category, never a broken menu.
try {
  if (!CategoryType || !CategoryData) {
    console.warn(
      "[Demographics.mod-options] Options model unavailable; Mods category not registered."
    );
  } else {
    if (!CategoryType.Mods) {
      CategoryType.Mods = "mods";
    }
    if (!CategoryData[CategoryType.Mods]) {
      CategoryData[CategoryType.Mods] = {
        // Base-game LOC tags (engine-owned; not in our ModText.xml) — see
        // BASE_GAME_LOC_KEYS in ui/core/demographics-i18n.js.
        title: "LOC_UI_CONTENT_MGR_SUBTITLE",
        description: "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION"
      };
    }
  }
} catch (e) {
  console.warn("[Demographics.mod-options] Mods-category bootstrap skipped:", e);
}
