import js from "@eslint/js";
import globals from "globals";
import security from "eslint-plugin-security";

export default [
  js.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "security/detect-bidi-characters": "error",
      "security/detect-buffer-noassert": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-object-injection": "off",
    },
  },
  {
    // These modules use small anchored filename/path parsers that safe-regex flags
    // conservatively. Keep the rule strict elsewhere so new unsafe regexes fail lint.
    files: [
      "src/structure/structure-inference.js",
      "src/sync/importer.js",
      "src/sync/sync.js",
    ],
    rules: {
      "security/detect-unsafe-regex": "off",
    },
  },
  {
    // Test files — relax some rules
    files: ["test/**/*.mjs", "scripts/manual/test-scenarios.mjs"],
    rules: {
      "no-unused-vars": "warn",
    },
  },
];
