// Dev-only ESLint flat config. Enforces the modularization gate (function length +
// cyclomatic complexity) and catches real bugs. Not shipped; release.sh excludes it.

const ENGINE_GLOBALS = {
  // Civ7 true globals used without importing (see civ7-modding-docs/06).
  Game: "readonly",
  GameContext: "readonly",
  Players: "readonly",
  GameInfo: "readonly",
  GameplayMap: "readonly",
  RevealedStates: "readonly",
  Configuration: "readonly",
  Network: "readonly",
  Locale: "readonly",
  engine: "readonly",
  Database: "readonly",
  Controls: "readonly",
  Units: "readonly",
  Cities: "readonly",
  Constructibles: "readonly",
  Districts: "readonly",
  GrowthTypes: "readonly",
  ProductionKind: "readonly",
  Modding: "readonly",
  UI: "readonly",
  Input: "readonly",
  WorldUI: "readonly",
  Camera: "readonly",
  InterpolationFunc: "readonly",
  KeyframeFlag: "readonly",
  PlacementMode: "readonly",
  UniqueQuarterTypes: "readonly",
  InterfaceMode: "readonly",
  Audio: "readonly",
  GameTutorial: "readonly",
  Chart: "readonly",
  HallofFame: "readonly",
  Loading: "readonly",
  Coherent: "readonly",
  Component: "readonly",
  DiplomacyActionTypes: "readonly",
  YieldTypes: "readonly",
  ProgressionTreeNodeState: "readonly",
  UIViewExperience: "readonly",
  VictoryManager: "readonly",
  SerialBase: "readonly",
  DiplomacyPlayerRelationships: "readonly"
};

const BROWSER_GLOBALS = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  HTMLElement: "readonly",
  URL: "readonly",
  navigator: "readonly",
  Proxy: "readonly",
  globalThis: "readonly",
  structuredClone: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  MutationObserver: "readonly",
  ResizeObserver: "readonly",
  getComputedStyle: "readonly",
  performance: "readonly",
  requestIdleCallback: "readonly",
  Blob: "readonly",
  FileReader: "readonly",
  DOMParser: "readonly",
  Node: "readonly",
  SVGElement: "readonly",
  btoa: "readonly",
  atob: "readonly"
};

export default [
  {
    files: ["ui/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...ENGINE_GLOBALS, ...BROWSER_GLOBALS }
    },
    rules: {
      // The modularization gate.
      complexity: ["error", 10],
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true }
      ],
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true }
      ],
      // Enforced hard ceiling (120). Strings / templates / regex / urls are exempt so data and
      // localized copy aren't penalized; everything else, including comments, must wrap.
      "max-len": [
        "error",
        {
          code: 120,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true
        }
      ],
      "max-params": ["error", 5],
      "max-depth": ["error", 4],
      "max-statements": ["error", 18],
      // Correctness checks.
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      // Match the engine's own `== null` undefined-check idiom.
      eqeqeq: ["error", "always", { null: "ignore" }]
    }
  }
];
