// Dev-only ESLint flat config. Enforces the modularization gate (function length +
// cyclomatic complexity) on ui/ and catches real bugs everywhere. Not shipped; release.sh excludes it.

// @eslint/js ships with eslint itself, so it needs no entry of its own in package.json.
import js from "@eslint/js";

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
  // The save list, which names the user folder the Hall of Fame file lives in.
  GameStateStorage: "readonly",
  SaveLocationCategories: "readonly",
  SaveLocationOptions: "readonly",
  SaveLocations: "readonly",
  SaveTypes: "readonly",
  SaveFileTypes: "readonly",
  Loading: "readonly",
  Coherent: "readonly",
  Component: "readonly",
  DiplomacyActionTypes: "readonly",
  YieldTypes: "readonly",
  ProgressionTreeNodeState: "readonly",
  UIViewExperience: "readonly",
  VictoryManager: "readonly",
  SerialBase: "readonly",
  DiplomacyPlayerRelationships: "readonly",
  InputActionStatuses: "readonly"
};

const BROWSER_GLOBALS = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
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

const NODE_GLOBALS = {
  process: "readonly",
  console: "readonly",
  globalThis: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  structuredClone: "readonly",
  performance: "readonly"
};

// Engine globals the dev probes use beyond what ui/ needs: lobby setup and the events
// they fire to drive a game from a script.
const PROBE_GLOBALS = {
  GameModeTypes: "readonly",
  ServerType: "readonly",
  SlotStatus: "readonly",
  GameSetup: "readonly",
  MouseEvent: "readonly"
};

// Test and tool code: correctness rules only. The size limits are for the shipped modules; a test
// file is a list of scenarios, and splitting one up to satisfy a statement count hides the story.
const TOOL_RULES = {
  ...js.configs.recommended.rules,
  "max-len": [
    "warn",
    {
      code: 120,
      ignoreUrls: true,
      ignoreRegExpLiterals: true
    }
  ],
  "no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" }
  ],
  eqeqeq: ["error", "always", { null: "ignore" }]
};

export default [
  // Tower Settings Keeper, copied unchanged from its own repo; it is linted and tested there.
  { ignores: ["ui/core/settings-keeper.js"] },
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
  },
  {
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "devtools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // Tests stand in for the browser and the engine, so they read and assign those globals too.
      globals: { ...NODE_GLOBALS, ...ENGINE_GLOBALS, ...BROWSER_GLOBALS }
    },
    rules: TOOL_RULES
  },
  {
    // In-game code outside the shipped mod: the dev probes and the unmounted options view.
    files: ["devtools/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...ENGINE_GLOBALS, ...BROWSER_GLOBALS, ...PROBE_GLOBALS }
    },
    rules: TOOL_RULES
  }
];
