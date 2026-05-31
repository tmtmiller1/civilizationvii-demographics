// Dev-only ESLint flat config. Enforces the modularization gate (function length +
// cyclomatic complexity) and catches real bugs. Not shipped — release.sh excludes it.

const ENGINE_GLOBALS = {
  // Civ7 true globals used without importing (see civ7-modding-docs/06).
  Game: "readonly",
  GameContext: "readonly",
  Players: "readonly",
  GameInfo: "readonly",
  GameplayMap: "readonly",
  Configuration: "readonly",
  Locale: "readonly",
  engine: "readonly",
  Database: "readonly",
  Controls: "readonly",
  Units: "readonly",
  Cities: "readonly",
  Constructibles: "readonly",
  Modding: "readonly",
  UI: "readonly",
  Input: "readonly",
  WorldUI: "readonly",
  InterfaceMode: "readonly",
  Audio: "readonly"
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
  navigator: "readonly"
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
      // Correctness checks.
      "no-undef": "error",
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      // Match the engine's own `== null` undefined-check idiom.
      eqeqeq: ["error", "always", { null: "ignore" }]
    }
  },
  {
    // Declarative data catalogs are data, not logic — exempt from the length gate.
    files: ["ui/demographics-metrics.js"],
    rules: { "max-lines-per-function": "off" }
  }
];
