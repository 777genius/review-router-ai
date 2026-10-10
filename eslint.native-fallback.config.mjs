import baseline from "./eslint.config.mjs";

// Candidate only: enable alongside the qualified native profile, never alone.
// All other effective rules, TS-only exceptions, globals and ignores stay owned
// by the existing baseline rather than a second copy of recommended configs.
export default [
  ...baseline,
  {
    rules: {
      "no-debugger": "off",
      "no-compare-neg-zero": "off",
      "no-empty-character-class": "off",
      "no-invalid-regexp": "off",
      "no-regex-spaces": "off",
      "no-sparse-arrays": "off",
      "use-isnan": "off",
    },
  },
];
