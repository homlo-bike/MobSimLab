import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

/**
 * The version the About dialog shows: the release's version when a release is built (`MOBSIMLAB_VERSION`, or a
 * version tag such as v2026.11.2-alpha in `MOBSIMLAB_BUILD`), else the package's version for development builds.
 */
const build = process.env.MOBSIMLAB_BUILD ?? "dev";
const tagged = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(build) ? build.slice(1) : null;
const version = process.env.MOBSIMLAB_VERSION?.replace(/^v/, "") || tagged || pkg.version;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(build),
  },
  server: { proxy: { "/api": "http://localhost:8080" } },
  // The railway editor tests run the WebAssembly engine many times: 2 to 4 s locally, over 5 s on CI runners.
  test: { environment: "jsdom", include: ["test/**/*.test.tsx"], testTimeout: 20_000 },
});
