# Touch and vision multi-drone control: build terms

Terms that came up while building the software. The proposal terms live in [CONTEXT.md "Shared glossary"](CONTEXT.md#shared-glossary). This file links to them instead of redefining them.

## Systems

The software runs across four systems: the tablet, the flight host, the motion capture machine, and the swarm.

**Tablet**:
The Galaxy Tab S9 ([DEC-01](CONTEXT.md#accepted-decisions-made-after-the-proposal)) that runs the tablet web app in Chrome and supplies the hand camera.
_Avoid_: Client, device

**Flight host**:
The computer that runs the Python command bridge and ROS 2, with the Crazyradio attached. It is a machine, not a program.
_Avoid_: Ground station, backend server (for the machine)

**Python command bridge**:
The program on the flight host that connects the tablet web app to the swarm. It speaks message format v1 to the tablet and drives the drones through Crazyswarm2.
_Avoid_: Backend server, host server, ground station

**Message log**:
The file of JSON lines the Python command bridge writes when it starts with `--log`. It holds each received `input` and each target sent to the drone connection, so a test flight can show its command rate. It is not the trial recorder ([REQ-18](CONTEXT.md#evaluation-method-and-numerical-targets)).
_Avoid_: Trial log, flight record

**Drone connection**:
The boundary inside the Python command bridge between the bridge's own logic and whatever moves the drones. A mock drone connection stands in for the swarm during development, and the Crazyswarm2 drone connection drives the real swarm.
_Avoid_: Driver, adapter, backend

**Crazyswarm2 client**:
The boundary between the Crazyswarm2 drone connection and Crazyswarm2. It sends takeoff, land, notify setpoints stop, `cmd_position`, and set parameter, and it delivers poses, status, and stream ticks back. The real Crazyswarm2 client wraps `crazyflie_py` and is the only module that imports `rclpy`. The fake Crazyswarm2 client simulates drones in tests.
_Avoid_: Client (alone), ROS wrapper

**Swarm**:
The three Crazyflie drones flown in a trial, each with its own radio address.
_Avoid_: Fleet, team (for the drones)

**Flow deck**:
The Bitcraze Flow deck v2 mounted under each Crazyflie. It measures height and motion over the floor, so the drone can estimate its own position without motion capture.
_Avoid_: Flow sensor, bottom deck

**Motion capture machine**:
A separate computer that runs the lab's motion capture software and publishes measured drone positions to the flight host.
_Avoid_: Mocap server, tracking host

## Flight

**Stop**:
The command that halts every airborne drone where it is. A stopped drone holds its place and accepts only land. Grounded drones are unaffected.
_Avoid_: Emergency stop, kill, halt

**Emergency cut**:
Cutting a drone's motors at once. The drone falls, and it must be restarted before it can fly again. The Python command bridge never sends it. It is a last resort for a person at the flight host.
_Avoid_: Stop, emergency stop, kill switch

## Map

**Map frame**:
The frame for drone positions in the Python command bridge and on the tablet map: x and y on the floor, z up, in meters. Motion capture positions are converted into it. Its origin and rotation relative to the lab are not measured yet.
_Avoid_: Motion capture frame (for converted positions)

**Takeoff frame**:
The frame for drone positions when the drone flies on its own Flow deck estimate, without motion capture. It has x and y on the floor and z up, in meters. Its origin is the spot where the drone took off. It is not tied to the room, so the course does not apply in it.
_Avoid_: Local frame, body frame, odometry frame

**Flight test page**:
A second page of the tablet web app for flying one drone in the takeoff frame. It shows one drone circle that starts at the center and follows one finger, plus takeoff, land, and stop buttons. It is for test flights, not trials.
_Avoid_: Joystick page, debug page, drag page

**Target marker**:
The map symbol for where a drone is heading: the target the Python command bridge holds for it. It differs from the [drone entity](CONTEXT.md#shared-glossary), which shows the measured position.
_Avoid_: Ghost, cursor, setpoint marker
