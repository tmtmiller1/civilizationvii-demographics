// mod-options.js
//
// Shared Mods category bootstrap for the Civ VII Options screen.
// Safe to load alongside other mods that define the same category.

import { CategoryType } from "/core/ui/options/model-options.js";
import { CategoryData } from "/core/ui/options/options-helpers.js";

if (!CategoryType.Mods) CategoryType["Mods"] = "mods";
if (!CategoryData[CategoryType.Mods]) {
  CategoryData[CategoryType.Mods] = {
    title: "LOC_UI_CONTENT_MGR_SUBTITLE",
    description: "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION"
  };
}
