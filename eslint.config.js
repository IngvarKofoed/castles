import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "node_modules/", "mockups/", "src/version.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", console: "readonly", process: "readonly" } },
  },
  {
    // The one hard boundary (docs/ARCHITECTURE.md): src/sim is pure —
    // no three.js, no DOM, no consumers, no ambient nondeterminism.
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["three", "three/*"],
              message: "src/sim must not import three.js (docs/ARCHITECTURE.md, 'The one hard boundary').",
            },
            {
              group: ["**/render/**", "**/ui/**", "**/app/**"],
              message: "src/sim must not import its consumers (render/ui/app).",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use the sim's seeded PRNG (sim/world/rng.ts); Math.random breaks determinism.",
        },
        {
          object: "Date",
          property: "now",
          message: "Sim time is the tick counter; Date.now breaks determinism.",
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "document", message: "No DOM inside src/sim." },
        { name: "window", message: "No browser APIs inside src/sim." },
        { name: "navigator", message: "No browser APIs inside src/sim." },
      ],
    },
  },
);
