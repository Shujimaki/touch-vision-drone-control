import pytest
from touch_vision_drone_control.mocap import motive_to_map 
@pytest.mark.parametrize("motive, expected", [
    ((1.0, 0, 0), (1.0, 0.0, 0.0)),
    ((0, 1.3, 0), (0.0, 0.0, 1.3)),
    ((0, 0, -2.0), (0.0, 2.0, 0.0)),
    ((0.5, 0.2, 0.5), (0.5, -0.5, 0.2)),
])
def test_motive_to_map(motive, expected):
    result = motive_to_map(*motive)
    assert result == pytest.approx(expected)