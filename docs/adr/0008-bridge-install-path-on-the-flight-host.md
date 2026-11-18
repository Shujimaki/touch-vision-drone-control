---
status: accepted
---

# The bridge runs from a uv venv that sees the ROS 2 Python packages

On the flight host, the Python command bridge runs from a uv venv built on the system interpreter `/usr/bin/python3.12` with `--system-site-packages`, after sourcing ROS 2. Decided 2026-11-13. This settles the install path that [ADR 0001](0001-bridge-inside-ros2-package.md) left open.

The bridge needs two sets of packages that come from different places:
- From ROS 2: `rclpy`, `crazyflie_py`, and `crazyflie_interfaces` come from `PYTHONPATH`, which `setup.bash` sets [[1]](#references). `crazyflie_py` also needs numpy and transforms3d, which come from Ubuntu's apt packages in the system site directory [[2]](#references)[[3]](#references).
- From `uv.lock`: `aiohttp==3.14.3` and `pydantic==2.13.5` come from the uv lockfile.

```bash
source /opt/ros/jazzy/setup.bash && source ~/ros2_ws/install/setup.bash
```

```bash
uv venv --python /usr/bin/python3.12 --system-site-packages
```

```bash
uv sync
```

## Considered options

- **The system Python alone (`colcon build`, then `ros2 run`)**: rejected. Ubuntu 24.04 ships `python3-pydantic` 1.10.14 and `python3-aiohttp` 3.9.1 [[3]](#references), and the bridge needs pydantic 2 and aiohttp 3.14.
- **A plain uv venv**: rejected. It sees ROS 2 through `PYTHONPATH`, but it hides numpy and transforms3d, so `crazyflie_py` fails to import. uv may also pick its own downloaded Python instead of the system interpreter that ROS 2 was built for [[4]](#references)[[5]](#references).

## Consequences

- The interpreter is pinned to `/usr/bin/python3.12`, not chosen by uv.
- After `uv sync`, `.venv/pyvenv.cfg` must still say `include-system-site-packages = true`. Check this on the flight host the first time.
- `uv.lock` must not add numpy. A numpy 2 there would hide Ubuntu's numpy 1.26, which the ROS 2 packages were built against.
- Laptops keep the plain `uv run` setup from README.md. The mock needs no ROS 2.

## References

1. [ament_package, `pythonpath.sh.in` (jazzy)](https://github.com/ament/ament_package/blob/jazzy/ament_package/template/environment_hook/pythonpath.sh.in), read 2026-11-13.
2. [Crazyswarm2 1.0.7, `crazyflie_py/crazyflie_py/crazyflie.py` lines 21 and 29](https://github.com/IMRCLab/crazyswarm2/blob/fcf51e27fe675bbdb564a40f4ca1ee4336c062ea/crazyflie_py/crazyflie_py/crazyflie.py), read 2026-11-13.
3. Ubuntu noble packages [python3-numpy](https://packages.ubuntu.com/noble/python3-numpy), [python3-transforms3d](https://packages.ubuntu.com/noble/python3-transforms3d), [python3-pydantic](https://packages.ubuntu.com/noble/python3-pydantic), [python3-aiohttp](https://packages.ubuntu.com/noble/python3-aiohttp), read 2026-11-13.
4. [ROS 2 Jazzy, Using Python Packages with ROS 2](https://github.com/ros2/ros2_documentation/blob/jazzy/source/How-To-Guides/Using-Python-Packages.rst), read 2026-11-13.
5. [uv, Python versions (`python-preference`)](https://github.com/astral-sh/uv/blob/main/docs/concepts/python-versions.md), read 2026-11-13.
