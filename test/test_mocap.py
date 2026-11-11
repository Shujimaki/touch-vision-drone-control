import pytest

from touch_vision_drone_control.drone_connection import Position
from touch_vision_drone_control.mocap import motive_to_map, tracked_pose_from_motive


@pytest.mark.parametrize(("motive", "expected"), [
    ((1.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
    ((0.0, 1.3, 0.0), (0.0, 0.0, 1.3)),
    ((0.0, 0.0, -2.0), (0.0, 2.0, 0.0)),
    ((0.5, 0.2, 0.5), (0.5, -0.5, 0.2)),
])
def test_motive_to_map(motive: tuple[float, float, float], expected: tuple[float, float, float]) -> None:
    result = motive_to_map(*motive)
    assert (result.x, result.y, result.z) == pytest.approx(expected)


def test_tracked_pose_keeps_the_measurement_time() -> None:
    result = tracked_pose_from_motive(0.5, 0.2, 0.5, measured_at=12.34)
    assert result.position == Position(x=0.5, y=-0.5, z=0.2)
    assert result.measured_at == 12.34
