# Tablet web app: static mockup

This folder holds a static mockup of the tablet interface. It shows how the operator sees the system: the map, the hand-camera panel, the altitude bars, the video feed, the flight controls, the Telemetry tab, and Settings.

The page is one captured state of the screen:

- DRONE 1 is held and climbing next to obstacle O1, and its proximity ring shows the obstacle on that side.
- DRONE 2 is flying toward a target.
- DRONE 3 is on its start pad.
- A trial is running, and the Telemetry tab shows sample values.

The screen comes from the interactive design mockup at [jaz-villanueva/Thesis-UI-Mockup](https://github.com/jaz-villanueva/Thesis-UI-Mockup), without changes to its layout or look.

## What responds

Only the controls that change what is shown respond:

- the Map and Telemetry tabs, and the event ticker, which opens Telemetry
- the Settings drawer
- the collapsible Hand camera and Video panels
- the video source buttons 1, 2 and 3
- Settings → Light mode, and Fullscreen

Every other control is part of the picture only. Nothing moves, nothing is simulated, and the page sends no messages. It does not use the message format in [`protocol/`](../protocol/).

## Run it

Node.js 24 or later. From this folder:

```bash
npm ci
```

```bash
npm run dev
```

Open the address that Vite prints. `npm run build` writes a static copy to `dist/`, and `npm test` checks that the markup and the UI script stay in step.
