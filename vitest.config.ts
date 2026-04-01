import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "msw/node": path.resolve(__dirname, "node_modules/msw/lib/node/index.mjs"),
      "msw": path.resolve(__dirname, "node_modules/msw/lib/core/index.mjs"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "dist", ".cache"],
    setupFiles: ["./client/src/test/setup.ts"],
    environmentMatchGlobs: [
      ["client/**", "jsdom"],
    ],
    pool: "forks",
    maxWorkers: 1,
    server: {
      deps: {
        inline: ["@testing-library/jest-dom", "msw"],
      },
    },
  },
});
