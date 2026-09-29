import { defineConfig } from "vitest/config";

// base "./" keeps asset paths relative, so the build opens from any folder or sub-path.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
