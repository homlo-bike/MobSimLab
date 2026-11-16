// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "apps/web/dist-static/**",
      "**/node_modules/**",
      "target/**",
      "**/*.d.ts",
      "worker/**",
      "crates/**",
      "apps/web/src/wasm/**",
      "apps/api/wasm/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Command-line scripts run by Node.js (the static viewer's build and add-projects tools).
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly" } },
    rules: { "no-console": "off" },
  },
);
