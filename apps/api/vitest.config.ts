import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC keeps decorator metadata, which NestJS dependency injection needs.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: { include: ["test/**/*.test.ts"] },
});
