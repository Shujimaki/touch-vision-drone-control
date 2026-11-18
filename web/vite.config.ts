import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// mkcert writes these files (see web/README.md). They stay in the ignored /.local/ folder. Without them the dev server
// runs on plain HTTP, which is enough on the laptop but not for the tablet's camera.
const CERTS = join(import.meta.dirname, "..", ".local", "certs");
const CERT = join(CERTS, "dev.pem"), KEY = join(CERTS, "dev-key.pem");
const BRIDGE = "http://127.0.0.1:8765";

// MediaPipe sends usage stats to Google every minute. The tablet runs offline, so point that at a
// data: URL instead. The build fails if the address moves in a newer @mediapipe/tasks-vision.
const MEDIAPIPE_LOG = "https://odml.pa.googleapis.com/v1/log";
const noMediapipeLog = (): Plugin => ({
  name: "no-mediapipe-log",
  transform(code, id) {
    if (!id.includes("@mediapipe/tasks-vision")) return null;
    if (!code.includes(MEDIAPIPE_LOG)) this.error(`${MEDIAPIPE_LOG} not found in ${id}; check the logging off switch`);
    return code.replaceAll(MEDIAPIPE_LOG, "data:,");
  },
});

// base "./" keeps asset paths relative, so the build opens from any folder or sub-path.
export default defineConfig({
  base: "./",
  plugins: [noMediapipeLog()],
  worker: { plugins: () => [noMediapipeLog()] }, // the recognizer runs in a worker
  build: {
    target: "es2022",
    rolldownOptions: { input: { main: join(import.meta.dirname, "index.html"), flightTest: join(import.meta.dirname, "flight-test.html") } },
  },
  server: {
    host: true,
    https: existsSync(CERT) && existsSync(KEY) ? { cert: readFileSync(CERT), key: readFileSync(KEY) } : undefined,
    proxy: { "/ws": { target: BRIDGE, ws: true } },
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
