// sampler-collectors.js
//
// One import point for the collector helpers; they are defined in sampler-collectors-core.js.

export {
  canonicalTypeString,
  composeLocaleTag,
  newPlayerCtx,
  prettifyType,
  buildMinorMilitaryCtx,
  buildPlayerCtx,
  getCurrentAgeType,
  lookupInfoRow,
  netYield,
  resolveCivName,
  resolveDisplayName,
  resetAgeCaches,
  yieldEnum
} from "/demographics/ui/sampler/sampler-collectors-core.js";
