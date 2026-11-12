# Tablet web app: mockup

This folder holds a mockup of the tablet interface. It shows how the operator sees and uses the system: the map, the hand-camera panel, the altitude bars, the video feed, the flight controls, the Telemetry tab, and Settings. Its layout and look come from the design mockup at [jaz-villanueva/Thesis-UI-Mockup](https://github.com/jaz-villanueva/Thesis-UI-Mockup).

Components in `src/components/` draw fixed sample data from `src/sample.ts`: one moment of a trial, with DRONE 1 held and climbing next to obstacle O1, DRONE 2 flying toward a target, and DRONE 3 on its pad.

## What responds

The interface responds to the operator, but only on screen. It is online at <https://shujimaki.github.io/touch-vision-drone-control/>.

- **Map:** hold a drone with a finger and drag it. The finger sets the drone's target. Without a bridge, the drone glides there on screen with a short trail. While connected, the tablet sends the target to the bridge in `input` 30 times a second. The target marker follows the finger, and telemetry places the drone entity as the drone flies there. Only a flying drone can be held while connected, and a released drone holds the position where it was released. Without a bridge, several fingers can hold several drones, a released drone stays at its last target, and a grounded drone can be held but not moved. A held drone is drawn filled.
- **Restricted zone:** the sample moment is during a trial, so a drag into the zone or its margin is rejected (REQ-08). The drone stops at the edge, a red trace points at the finger, and the event log and the Trial card count the rejection.
- **Video:** the feed follows the drone touched most recently while it is held. The buttons 1, 2 and 3 also choose it, and show each drone's battery and signal.
- **Selected drone:** the Take off / Land button, the held-altitude list, the altitude bars, and the Telemetry tables follow what the operator holds and moves.
- **Telemetry tab:** the event log filters by participant session, then by trial.
- **Take off and Land:** while connected, the selected drone's button sends `takeoff` or `land` for that drone. Take off all and Land all send nothing yet. The video header and the Telemetry table show each drone's flight state from telemetry. Only a flying drone can be dragged.
- **E-STOP:** press and hold for 1 s to see it arm and fire. Take off all resets it.
- **Hand camera:** the camera icon shows a plain preview of the front camera.
- **Settings:** the flight-value steppers, Light mode, Left-handed layout, and Fullscreen.

## What it does not do

The tablet simulates nothing itself. The only messages are the connection handshake, takeoff and land commands, input, and telemetry:

- no altitude change, sensor readings, collisions, or defensive hover;
- no gesture recognition, and no trials that start or end. The input's altitude channel always reports `idle` with rate 0;
- no events, and no trial commands. The main page sends no stop command. The flight test page does. The page shows the connection state in the map's top-right corner. It draws each drone entity at its measured position from telemetry. The other panels still show the sample data.

Without a bridge, a dragged drone moves only on the map. Its sample sensor readings belong to its starting spot, so they clear once it moves.

## Flight test page

`flight-test.html` is a second page for flying cf1 in the takeoff frame ([ADR 0007](../docs/adr/0007-fly-one-drone-without-motive.md)). Start the bridge with `--config takeoff`, then open `/flight-test.html`. It is for test flights, not trials.

- **Box:** the page draws `welcome.config.course.capture_volume` with +x up the screen and +y to the left. A label above the box is for the wall that the taped floor arrow points to. The page does not know the lab's wall names yet, so the label says "the wall the floor arrow points to".
- **Buttons:** Take off and Land send `takeoff` and `land` for cf1. Stop sends `stop`, which has no drone list. The page shows the bridge's reply to the last command, with the reason when the bridge refuses it.
- **Drag:** hold the drone circle with one finger once cf1 is flying, and drag. The page sends one held entry on the connection's 30 Hz input timer, with the altitude channel at `idle`. A finger outside the box sends no new target. When the finger lifts, the bridge holds the drone where it is ([ADR 0004](../docs/adr/0004-held-targets-and-release.md)).
- **Telemetry:** the panel shows flight state, measured position, target, position age, radio link, and battery voltage. A dashed target marker shows the target.
- **Loss:** when the page is hidden, it releases the finger and sends a final `input` at once. On bridge loss the badge reads "Bridge lost, retrying", and the buttons are disabled until the page reconnects.

`src/takeoffView.ts` maps a screen point to a takeoff-frame point and back.

## Run it

Node.js 24 or later. From this folder:

```bash
npm ci
```

```bash
npm run dev
```

Open the address that Vite prints. `npm run build` writes a static copy to `dist/`, and `npm test` checks the components, the connection module, that the page and the script stay in step, and that the build names no address on another origin.

The page connects to the Python command bridge on `/ws` through `src/connection.ts`. The badge on the map reads "Connecting" on the first attempt and "Connected" once the bridge answers. After a failure it reads "Connection failed" with the cause (bridge lost, no bridge, operator busy, version mismatch, or rejected) and whether the page retries. It retries every second, except after a version mismatch or a rejected `hello`. The map draws no drone entities until the first telemetry and dims them while their data is old. The online copy has no bridge, so it always shows "No bridge, retrying". The [root README](../README.md#run-the-bridge-and-the-tablet-web-app) explains how to start the bridge and serve the page over HTTPS, and [how the bridge serves the built tablet web app](../README.md#run-on-the-tablet-without-internet).

## Online copy

The mockup is published at <https://shujimaki.github.io/touch-vision-drone-control/> by the [Pages workflow](../.github/workflows/pages.yml).

- **When it updates:** after every push to `main` that changes `web/` or the workflow. The workflow runs `npm ci`, `npm test` and `npm run build`, then publishes `dist/`. If a test fails, the site keeps the previous version.
- **Republish by hand:** in GitHub, open Actions → Pages → Run workflow, on `main`. Or run `gh workflow run pages.yml -R Shujimaki/touch-vision-drone-control --ref main`.
- **Repository setting:** Settings → Pages → Source must be **GitHub Actions**. With "Deploy from a branch", GitHub publishes the repository's root README instead of the mockup. After changing this setting, republish once.
- **Publish the build, not the source:** the workflow uploads `web/dist`. This `index.html` loads TypeScript that only Vite can run, so publishing `web/` itself gives a blank page.
