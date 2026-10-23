import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// mkcert writes these files (see web/README.md). They stay in the ignored /.local/ folder. Without them the dev server
// runs on plain HTTP, which is enough on the laptop but not for the tablet's camera.
const CERTS = join(import.meta.dirname, "..", ".local", "certs");
const CERT = join(CERTS, "dev.pem"), KEY = join(CERTS, "dev-key.pem");
const BRIDGE = "http://127.0.0.1:8765";

// base "./" keeps asset paths relative, so the build opens from any folder or sub-path.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  server: {
    host: true,
    https: existsSync(CERT) && existsSync(KEY) ? { cert: readFileSync(CERT), key: readFileSync(KEY) } : undefined,
    proxy: { "/ws": { target: BRIDGE, ws: true } },
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
