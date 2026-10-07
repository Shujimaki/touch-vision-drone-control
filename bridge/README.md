# Command bridge: live motion-capture positions

This folder holds the first part of the Python command bridge. It reads drone, obstacle, and hoop positions from OptiTrack Motive and streams them to the tablet web app over WebSocket, using [protocol version 1](../protocol/README.md).

It has no flight link. It does not command, arm, or fly any drone.

## What it does

- Reads Motive's NatNet stream through [`motioncapture`](https://pypi.org/project/motioncapture/) 1.1 (2026-07-17), the Python binding of libmotioncapture. The ROS package motion_capture_tracking uses the same library. [[1]](https://github.com/IMRCLab/libmotioncapture)
- Converts each rigid body to the course frame, with `z` up and yaw in degrees. The `up_axis`, `rotation`, and `offset` settings in [bridge.toml](bridge.toml) set the conversion.
- Answers `hello` with `welcome`, then sends `telemetry` 30 times a second. Telemetry carries each drone's measured pose, each obstacle's measured pose in `obstacles`, and each hoop's measured pose in `hoops`.
- Applies these checks: one JSON object per message, version 1, `hello` first, one operator, and increasing `seq`.

## What it does not do yet

- It sends no setpoints. Each drone reports `state: grounded`, `link: lost`, and a `cmd` equal to its measured position, or its pad before the first pose.
- It sends `null` for Multi-ranger readings, defensive hover, and battery.
- It does not check `input`, `event`, or `command` fields. It answers every command with `not_allowed`.
- It does not keep trial records.

## Lab setup

The checks below come from the OptiTrack and libmotioncapture documentation. The project has not tested them in the lab.

1. **Rigid bodies.** In Motive, make one rigid body for each drone, obstacle, and hoop. Name them as in `[mocap.bodies]` in [bridge.toml](bridge.toml): `cf1`, `cf2`, `cf3`, `O1`, `O2`, `H1`, `H2`, and `H3`. Remove a line from `[mocap.bodies]` for a body that you do not track. The tablet then draws it faded at its configured place. A rigid body needs at least three markers. OptiTrack recommends four or more. [[2]](https://docs.optitrack.com/motive/rigid-body-tracking)
2. **Pivot.** Move each pivot point to the footprint centre of the body. The tablet draws each obstacle's configured footprint around the measured `x` and `y`. For a hoop, move the pivot to the ring centre and turn the rigid body so that its +x lies along the ring's horizontal diameter. The tablet draws a vertical hoop along that direction.
3. **Streaming.** In Motive, turn on data streaming. Send rigid bodies, and choose the network interface that the bridge computer can reach.
4. **Up axis.** libmotioncapture passes NatNet coordinates through unchanged. [[3]](https://github.com/IMRCLab/libmotioncapture/blob/main/src/optitrack.cpp) Set Motive's streaming up axis to Z Up and keep `up_axis = "z"`. If Motive streams Y Up, set `up_axis = "y"`.
5. **Floor axes.** The course frame has +x along the 5.31 m wall and +y along the 3.55 m wall. If Motive's +x does not lie along the 5.31 m wall, set `rotation` to the angle from course +x to Motive +x, in degrees counterclockwise as seen from above. For example, use `90` when Motive's +x lies along the 3.55 m wall, toward course +y.
6. **Origin.** Set `offset` to the course-frame position of Motive's origin. Then place one marker on a known course point, for example a room corner, and compare its position on the map. Move the marker along one wall. Its dot must move along the same wall on the map. If it moves along the other wall, correct `rotation`.
7. **Obstacle surfaces.** Cover shiny surfaces with non-reflective material, because they add false markers. [[4]](https://docs.optitrack.com/motive/markers)

## Run it

Install [uv](https://docs.astral.sh/uv/) 0.12 and Python 3.12. Run the commands from this folder.

With synthetic positions, away from the lab:

```bash
uv run bridge --mock
```

With OptiTrack, after you set `hostname` in `bridge.toml` to the Motive computer's IP address:

```bash
uv run bridge
```

The bridge listens on port 8765 at `/ws`. To connect the tablet web app, see [web/README.md](../web/README.md#live-positions). To serve `wss://`, pass `--cert` and `--key`, for example from mkcert.

Run the tests:

```bash
uv run pytest
```

## References

Sources were checked on 30 September 2026.

1. [libmotioncapture, IMRCLab, undated](https://github.com/IMRCLab/libmotioncapture). The Python example and the supported systems.
2. [OptiTrack rigid body tracking, undated](https://docs.optitrack.com/motive/rigid-body-tracking).
3. [libmotioncapture OptiTrack backend source, undated](https://github.com/IMRCLab/libmotioncapture/blob/main/src/optitrack.cpp).
4. [OptiTrack markers, undated](https://docs.optitrack.com/motive/markers).
