// Stub for engine-served `/core/*` and `/base-standard/*` modules the mod
// imports by absolute path but which don't live in the mod folder. Routed here
// via tsconfig `paths`. Everything is `any` — this is the untyped engine boundary.
declare const _default: any;
export default _default;
export const ContextManager: any;
export const DisplayQueueManager: any;
// Options model (`/core/ui/options/model-options.js`): named exports used by the mod's options
// registration (demographics-options.js, mod-options.js). The real engine module exports these; the
// stub just needs to declare them so `tsc --noEmit` resolves the named imports.
export const CategoryType: any;
export const CategoryData: any;
export const OptionType: any;
export const Options: any;
