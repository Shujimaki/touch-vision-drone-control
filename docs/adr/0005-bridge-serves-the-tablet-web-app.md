---
status: accepted
---

# The bridge serves the tablet web app

Issue #21 runs the tablet web app on the Galaxy Tab S9 with no internet. The tablet needs HTTPS for the camera and a trusted secure WebSocket.

- **One server on the flight host.** With `--web-app`, the Python command bridge serves the built tablet web app at `/` and its files beside `/ws`. The page and the socket then share one origin, so the tablet trusts one certificate and the page needs no host address in its code. Vite stays a development tool.
- **HTTPS only on request.** The bridge serves HTTPS only when it gets both `--cert` and `--key`. It does not look for certificates in `.local/certs/` by itself. In development, Vite serves HTTPS with those files and forwards `/ws` to the bridge over plain HTTP, so a bridge that switched to HTTPS on its own would break that forwarding.
- **The build carries every asset.** A Vitest check builds the tablet web app and fails if a built file names an address on another origin. The only allowed absolute URLs are XML namespace names, which the browser never fetches.

## Consequences

- The gesture model and its WASM files must be bundled into the build or served by the bridge. Loading them from a CDN fails the check.
- Whether Chrome on the Tab S9 trusts a user-installed mkcert root certificate is not tested yet. If it does not, the lab needs another certificate source.
