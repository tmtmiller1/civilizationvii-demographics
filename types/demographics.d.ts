// Dev-only shared data-shape typedefs for the Demographics mod. Declared global
// so any ui/*.js file can reference {Snapshot}, {History}, etc. in JSDoc without
// importing. Fields the mod reads off engine objects are kept loose (index
// signatures) — that is the untyped engine boundary; the mod's own structural
// fields are typed. Not shipped (release.sh excludes types/).

export {};

declare global {
  /** Player/Civilization id (alias of the engine's numeric id). */
  type Pid = number;

  /** One civilization's metrics within a per-turn {@link Snapshot}. */
  interface CivSample {
    civ?: string;
    leader?: string;
    isMajor?: boolean;
    isIndependent?: boolean;
    eliminated?: boolean;
    /** Per-metric numeric values, keyed by metric id. */
    [metric: string]: any;
  }

  /** A single per-turn sample (one row of {@link History.samples}). */
  interface Snapshot {
    /** Absolute game turn. */
    turn?: number;
    /** Age-local turn (resets each age). */
    localTurn?: number;
    /** Age type string (e.g. "AGE_ANTIQUITY"). */
    age?: string;
    /** Per-civ metrics keyed by player id. */
    players?: Record<string, CivSample>;
    crisisEventType?: string;
    [key: string]: any;
  }

  /** Marks where one age handed off to the next, for axis dividers. */
  interface AgeBoundary {
    turn: number;
    age?: string;
    [key: string]: any;
  }

  /**
   * The full persisted history blob round-tripped through storage.
   * Named `DemoHistory` (not `History`) to avoid merging with the DOM's
   * built-in global `History` interface.
   */
  interface DemoHistory {
    version: number;
    seed: string | number;
    samples: Snapshot[];
    ageBoundaries: AgeBoundary[];
    eliminated: Record<string, any>;
  }

  /** Result of resolving the active sample cap. */
  interface EffectiveCap {
    cap: number;
    source: string;
  }

  /** A read/write handle over a persistence tier (player or global bag). */
  interface PersistStore {
    pid: Pid;
    read(key: string): string | null;
    write(key: string, value: string): void;
  }

  /** A metric definition in the METRICS catalog. */
  interface MetricDef {
    id: string;
    label: string;
    page?: string;
    format?: (n: number) => string;
    /** Extract this metric's value from a {@link CivSample}. */
    get?: (sample: CivSample, ctx?: any) => number;
    [key: string]: any;
  }
}
