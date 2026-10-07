# Tablet web app: mockup

This folder holds a mockup of the tablet interface. It shows how the operator sees and uses the system: the map, the hand-camera panel, the altitude bars, the video feed, the flight controls, the Telemetry tab, and Settings. Its layout and look come from the design mockup at [jaz-villanueva/Thesis-UI-Mockup](https://github.com/jaz-villanueva/Thesis-UI-Mockup).

Components in `src/components/` draw fixed sample data from `src/sample.ts`: one moment of a trial, with DRONE 1 held and climbing next to obstacle O1, DRONE 2 flying toward a target, and DRONE 3 on its pad.

## What responds

The interface responds to the operator, but only on screen. It is online at <https://shujimaki.github.io/touch-vision-drone-control/>.

- **Map:** hold a drone with a finger and drag it. The finger sets the drone's target, and the drone glides there on screen with a short trail. Several fingers can hold several drones. A released drone stays at its last target. A grounded drone can be held but not moved. A held drone is drawn filled.
- **Restricted zone:** the sample moment is during a trial, so a drag into the zone or its margin is rejected (REQ-08). The drone stops at the edge, a red trace points at the finger, and the event log and the Trial card count the rejection.
- **Video:** the feed follows the drone touched most recently while it is held. The buttons 1, 2 and 3 also choose it, and show each drone's battery and signal.
- **Selected drone:** the Take off / Land button, the held-altitude list, the altitude bars, and the Telemetry tables follow what the operator holds and moves.
- **Telemetry tab:** the event log filters by participant session, then by trial.
- **E-STOP:** press and hold for 1 s to see it arm and fire. Take off all resets it.
- **Hand camera:** the camera icon shows a plain preview of the front camera.
- **Settings:** the flight-value steppers, Light mode, Left-handed layout, and Fullscreen.

## What it does not do

Nothing is simulated:

- no flight, altitude change, sensor readings, collisions, or defensive hover;
- no gesture recognition, and no trials that start or end;
- no connection to a host, unless the page address asks for [live positions](#live-positions).

A dragged drone moves only on the map. Its sample sensor readings belong to its starting spot, so they clear once it moves.

## Live positions

With `?live` in the page address, the map shows the positions that the [command bridge](../bridge/README.md) measures with motion capture.
The page sends `hello` and reads `welcome` and `telemetry` from [protocol version 1](../protocol/README.md). It sends no `input`, `event`, or `command` yet.

- Drones move to their measured position, height, and heading. A drag sets only the target, so a drone moves on the map only when motion capture says it moved.
- Obstacles move to their measured centre. Hoops move to their measured centre, height, and direction.
- A drone, obstacle, or hoop without a fresh pose is drawn faded. A faded obstacle or hoop is drawn at its configured place.
- The chip under the map shows the link: connecting, live, no data, or host lost. The page reconnects every 2 s.
- Every other value stays sample data, including battery, link, Multi-ranger readings, the gesture, and the trial.

For development, start the bridge with `uv run bridge --mock` in `bridge/`. Then run `npm run dev` here and open the page with `?live`. The dev server passes `/ws` to the bridge on port 8765.
To connect straight to a bridge, give its address: `?live=ws://<bridge-ip>:8765/ws`. A page served over HTTPS, such as the GitHub Pages copy, needs a `wss://` address. Start the bridge with `--cert` and `--key` for that.

## Run it

Node.js 24 or later. From this folder:

```bash
npm ci
```

```bash
npm run dev
```

Open the address that Vite prints. `npm run build` writes a static copy to `dist/`, and `npm test` checks the components and that the page and the script stay in step.
