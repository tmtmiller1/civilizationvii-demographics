// Stub for engine-served `/core/*` and `/base-standard/*` modules the mod
// imports by absolute path but which don't live in the mod folder. Routed here
// via tsconfig `paths`. Everything is `any` — this is the untyped engine boundary.
declare const _default: any;
export default _default;
export const ContextManager: any;
