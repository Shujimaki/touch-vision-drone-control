import { defineConfig } from "vitest/config";

// base "./" keeps asset paths relative, so the build opens from any folder or sub-path.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  // npm run dev, then open the page with ?live: the dev server passes /ws to the command bridge on port 8765.
  server: { proxy: { "/ws": { target: "ws://localhost:8765", ws: true } } },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
