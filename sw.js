/* Service worker: offline app shell + cached MediaPipe Gesture Recognizer files and model.
   Bump VERSION whenever index.html or the icons change, so installed copies update. */
const VERSION="v29";
const SHELL = `shell-${VERSION}`;
const RUNTIME = "runtime-mediapipe";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/favicon-64.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Page: network first so updates show up right away, cached copy when offline
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(SHELL).then(c => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // MediaPipe package, wasm and model: versioned URLs, so cache first
  if ((url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/@mediapipe/")) ||
      (url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/mediapipe-models/"))) {
    e.respondWith(
      caches.open(RUNTIME).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === "opaque") c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  // Other same-origin files (manifest, icons): cache first, fall back to network
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  }
});
