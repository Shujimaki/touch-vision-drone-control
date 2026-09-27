import { defineConfig } from "vitest/config";

// base "./" keeps every asset path relative, so the build runs from any folder or sub-path.
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: true },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
