import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(process.env.MOBSIMLAB_BUILD ?? "dev"),
  },
  server: { proxy: { "/api": "http://localhost:8080" } },
  test: { environment: "jsdom", include: ["test/**/*.test.tsx"] },
});
