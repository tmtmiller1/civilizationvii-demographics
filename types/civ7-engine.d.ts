// Dev-only ambient typings for the Civ VII UI runtime globals the mod calls.
// There is no official Civ7 .d.ts; these are hand-authored from
// civ7-modding-docs/06-ui-scripts-runtime.md plus the mod's real call sites.
// Opaque engine returns are typed `any` on purpose — the engine boundary is
// untyped; the mod's OWN data shapes (see demographics.d.ts) are typed strictly.
// This file ships to no one (release.sh excludes types/).

export {};

// Engine-served `/core/*` and `/base-standard/*` imports are routed to
// types/engine-core-stub.d.ts via tsconfig `paths` (leading-slash specifiers
// bypass ambient `declare module`, so path-mapping is the reliable approach).

declare global {
  /** Player/Civilization id. */
  type PlayerId = number;
  /** Catch-all for an engine handle whose shape the engine does not document. */
  type EngineHandle = any;

  /** A live player library handle (`Players.get(id)`). Partially typed. */
  interface PlayerLibrary {
    id: PlayerId;
    isAlive?: boolean;
    isMajor?: boolean;
    isIndependent?: boolean;
    civilizationType?: string;
    leaderType?: string;
    Diplomacy?: EngineHandle;
    Legacies?: EngineHandle;
    Stats?: EngineHandle;
    Cities?: EngineHandle;
    Treasury?: EngineHandle;
    Techs?: EngineHandle;
    Culture?: EngineHandle;
    Happiness?: EngineHandle;
    [key: string]: any;
  }

  const Players: {
    get(id: PlayerId): PlayerLibrary | null;
    getAlive(): PlayerLibrary[];
    getAliveIds(): PlayerId[];
    getAliveMajorIds(): PlayerId[];
    [key: string]: any;
  };

  const Game: {
    turn: number;
    age: string | number;
    gameSpeed: string | number;
    getTurnDate(turn?: number): EngineHandle;
    getGameSpeedType(): EngineHandle;
    Diplomacy: EngineHandle;
    ProgressionTrees: EngineHandle;
    CityStates: EngineHandle;
    CrisisManager: EngineHandle;
    [key: string]: any;
  };

  const GameContext: {
    localPlayerID: PlayerId;
    localObserverID: PlayerId;
    [key: string]: any;
  };

  const GameInfo: {
    Legacies: EngineHandle;
    Leaders: EngineHandle;
    Civilizations: EngineHandle;
    Constructibles: EngineHandle;
    CityStateBonuses: EngineHandle;
    Ages: EngineHandle;
    Independents: EngineHandle;
    Resources: EngineHandle;
    GameSpeeds: EngineHandle;
    Victories: EngineHandle;
    Units: EngineHandle;
    Unit: EngineHandle;
    ProgressionTrees: EngineHandle;
    [key: string]: any;
  };

  const Locale: {
    compose(key: string, ...args: any[]): string;
    [key: string]: any;
  };

  const UI: {
    Player: EngineHandle;
    getIconURL(type: string, context?: string): string;
    setClipboardText(text: string): void;
    getClipboardText(): string;
    isClipboardAvailable(): boolean;
    getViewExperience(): EngineHandle;
    log(...args: any[]): void;
    [key: string]: any;
  };

  const Configuration: {
    getGame(): EngineHandle;
    getMap(): EngineHandle;
    [key: string]: any;
  };

  const Database: {
    makeHash(text: string): number;
    query(domain: string, sql: string): any;
    [key: string]: any;
  };

  const Controls: {
    define(tag: string, definition: any): void;
    decorate(tag: string, factory: (...args: any[]) => any): void;
    getDefinition(tag: string): any;
    [key: string]: any;
  };

  const Units: { get(id: any): EngineHandle; getUnitIds(player: PlayerId): any[]; [key: string]: any };
  const Cities: { [key: string]: any };
  const ProductionKind: { UNIT: any; CONSTRUCTIBLE: any; PROJECT: any; [key: string]: any };
  const Constructibles: { getByComponentID(id: any): EngineHandle; [key: string]: any };
  const Districts: { getFreeConstructible(location: any, playerId: number): any; [key: string]: any };
  const GrowthTypes: { EXPAND: any; [key: string]: any };
  const GameplayMap: { [key: string]: any };
  const RevealedStates: { [key: string]: any };
  const Modding: {
    getModProperty(key: string): string | null;
    setModProperty(key: string, value: string): void;
    [key: string]: any;
  };
  const Input: { [key: string]: any };
  const WorldUI: { [key: string]: any };

  /** World-camera control surface (see base-standard city-zoomer.js). */
  const Camera: {
    lookAtPlot(location: { x: number; y: number }, options?: { zoom?: number; tilt?: number; instantaneous?: boolean }): void;
    lookAt(x: number, y: number, options?: any): void;
    saveCameraZoom(): void;
    restoreCameraZoom(): void;
    restoreDefaults(): void;
    clearAnimation(): void;
    addKeyframe(frame: any): void;
    calculateCameraFocusAndZoom(plots: any, angle: number, options?: any): any;
    getState(): any;
    rotate(x: number, isDragging: boolean): void;
    zoom(amount: number): void;
    pushDynamicCamera(plot: { x: number; y: number }, params: any): void;
    pushFlyoverCamera(plot: { x: number; y: number }, params: any): void;
    popCamera(): void;
    [key: string]: any;
  };

  /** Camera-keyframe interpolation functions (e.g. EaseOutSin, Linear). */
  const InterpolationFunc: { [key: string]: any };
  /** Camera-keyframe write-mask flags (e.g. FLAG_ALL). */
  const KeyframeFlag: { [key: string]: any };
  /** World-model placement modes (DEFAULT / FIXED / TERRAIN / WATER). */
  const PlacementMode: { [key: string]: any };
  /** Unique-quarter type enum (NO_QUARTER + each unique quarter). */
  const UniqueQuarterTypes: { [key: string]: any };
  const InterfaceMode: { addHandler(...args: any[]): any; [key: string]: any };

  /** Chart.js, loaded as a global by the engine (not imported). */
  const Chart: any;
  /** Hall of Fame DB surface. */
  const HallofFame: { [key: string]: any };
  /** Loading/age-transition lifecycle surface. */
  const Loading: { [key: string]: any };
  /** GameFace host bridge. */
  const Coherent: { [key: string]: any };
  /** Base class for engine UI components. */
  const Component: any;
  // Engine enum / type-hash tables used by name.
  const DiplomacyActionTypes: { [key: string]: any };
  const YieldTypes: { [key: string]: any };
  const ProgressionTreeNodeState: { [key: string]: any };
  const UIViewExperience: { [key: string]: any };
  const VictoryManager: { [key: string]: any };
  const SerialBase: { [key: string]: any };
  const DiplomacyPlayerRelationships: { [key: string]: any };

  /** Global tutorial property bag (wiped at age transition; fallback tier). */
  const GameTutorial: {
    getProperty(hash: number): any;
    setProperty(hash: number, value: any): void;
    [key: string]: any;
  };

  /** Coherent GameFace engine bridge. */
  const engine: {
    whenReady: Promise<void>;
    on(event: string, handler: (...args: any[]) => void, context?: any): void;
    off(event: string, handler: (...args: any[]) => void, context?: any): void;
    call(name: string, ...args: any[]): Promise<any>;
    [key: string]: any;
  };
}
