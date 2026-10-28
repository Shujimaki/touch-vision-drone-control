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

**Drone connection**:
The boundary inside the Python command bridge between the bridge's own logic and whatever moves the drones. A mock drone connection stands in for the swarm during development, and the Crazyswarm2 drone connection drives the real swarm.
_Avoid_: Driver, adapter, backend

**Swarm**:
The three Crazyflie drones flown in a trial, each with its own radio address.
_Avoid_: Fleet, team (for the drones)

**Motion capture machine**:
A separate computer that runs the lab's motion capture software and publishes measured drone positions to the flight host.
_Avoid_: Mocap server, tracking host

## Map

**Target marker**:
The map symbol for where a drone is heading: the target the Python command bridge holds for it. It differs from the [drone entity](CONTEXT.md#shared-glossary), which shows the measured position.
_Avoid_: Ghost, cursor, setpoint marker
