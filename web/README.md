# Tablet web app: mockup

This folder holds a mockup of the tablet interface. It shows how the operator sees and uses the system: the map, the hand-camera panel, the altitude bars, the video feed, the flight controls, the Telemetry tab, and Settings. Its layout and look come from the design mockup at [jaz-villanueva/Thesis-UI-Mockup](https://github.com/jaz-villanueva/Thesis-UI-Mockup).

Components in `src/components/` draw fixed sample data from `src/sample.ts`: one moment of a trial, with DRONE 1 held and climbing next to obstacle O1, DRONE 2 flying toward a target, and DRONE 3 on its pad.

## What responds

The interface responds to the operator, but only on screen. It is online at <https://shujimaki.github.io/touch-vision-drone-control/>.

- **Map:** hold a drone with a finger and drag it. The finger sets the drone's target. Without a bridge, the drone glides there on screen with a short trail. While connected, only the target marker follows the finger, and telemetry places the drone entity. Several fingers can hold several drones. A released drone stays at its last target. A grounded drone can be held but not moved. A held drone is drawn filled.
- **Restricted zone:** the sample moment is during a trial, so a drag into the zone or its margin is rejected (REQ-08). The drone stops at the edge, a red trace points at the finger, and the event log and the Trial card count the rejection.
- **Video:** the feed follows the drone touched most recently while it is held. The buttons 1, 2 and 3 also choose it, and show each drone's battery and signal.
- **Selected drone:** the Take off / Land button, the held-altitude list, the altitude bars, and the Telemetry tables follow what the operator holds and moves.
- **Telemetry tab:** the event log filters by participant session, then by trial.
- **E-STOP:** press and hold for 1 s to see it arm and fire. Take off all resets it.
- **Hand camera:** the camera icon shows a plain preview of the front camera.
- **Settings:** the flight-value steppers, Light mode, Left-handed layout, and Fullscreen.

## What it does not do

Nothing is simulated. The only messages are the connection handshake and telemetry:

- no flight, altitude change, sensor readings, collisions, or defensive hover;
- no gesture recognition, and no trials that start or end;
- no input or commands yet. The page shows the connection state in the map's top-right corner. It draws each drone entity at its measured position from telemetry. The other panels still show the sample data.

Without a bridge, a dragged drone moves only on the map. Its sample sensor readings belong to its starting spot, so they clear once it moves.

## Run it

Node.js 24 or later. From this folder:

```bash
npm ci
```

```bash
npm run dev
```

Open the address that Vite prints. `npm run build` writes a static copy to `dist/`, and `npm test` checks the components, the connection module, and that the page and the script stay in step.

The page connects to the Python command bridge on `/ws` through `src/connection.ts`. The badge on the map reads "Connecting" on the first attempt and "Connected" once the bridge answers. After a failure it reads "Connection failed" with the cause (bridge lost, no bridge, operator busy, version mismatch, or rejected) and whether the page retries. It retries every second, except after a version mismatch or a rejected `hello`. The map draws no drone entities until the first telemetry and dims them while their data is old. The online copy has no bridge, so it always shows "No bridge, retrying". The [root README](../README.md#run-the-bridge-and-the-tablet-web-app) explains how to start the bridge and serve the page over HTTPS.

## Online copy

The mockup is published at <https://shujimaki.github.io/touch-vision-drone-control/> by the [Pages workflow](../.github/workflows/pages.yml).

- **When it updates:** after every push to `main` that changes `web/` or the workflow. The workflow runs `npm ci`, `npm test` and `npm run build`, then publishes `dist/`. If a test fails, the site keeps the previous version.
- **Republish by hand:** in GitHub, open Actions → Pages → Run workflow, on `main`. Or run `gh workflow run pages.yml -R Shujimaki/touch-vision-drone-control --ref main`.
- **Repository setting:** Settings → Pages → Source must be **GitHub Actions**. With "Deploy from a branch", GitHub publishes the repository's root README instead of the mockup. After changing this setting, republish once.
- **Publish the build, not the source:** the workflow uploads `web/dist`. This `index.html` loads TypeScript that only Vite can run, so publishing `web/` itself gives a blank page.
