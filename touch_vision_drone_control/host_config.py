from touch_vision_drone_control.messages import Course, Hoop, HostConfig, Obstacle, Pad, Rect

PLACEHOLDER_CONFIG = HostConfig(
    id="course-draft-0.1",
    drones=["cf1", "cf2", "cf3"],
    input_hz=30,
    telemetry_hz=30,
    input_timeout_ms=300,
    telemetry_timeout_ms=500,
    stale_position_ms=250,
    rate_max=0.2,
    zone_margin=0.06,
    z_min=0.3,
    z_max=1.6,
    course=Course(
        room=Rect(x_min=0.0, x_max=5.31, y_min=0.0, y_max=3.55),
        capture_volume=Rect(x_min=0.25, x_max=5.06, y_min=0.25, y_max=3.3),
        restricted_zone=Rect(x_min=2.065, x_max=3.245, y_min=1.185, y_max=2.365),
        obstacles=[
            Obstacle(id="O1", x_min=3.6, x_max=3.9, y_min=0.6, y_max=0.9, height=1.02),
            Obstacle(id="O2", x_min=1.1, x_max=1.4, y_min=2.5, y_max=2.8, height=1.53),
        ],
        hoops=[
            Hoop(id="H1", x=1.0, y=1.8, z=1.0, diameter=0.4, plane="horizontal", yaw=0.0),
            Hoop(id="H2", x=4.3, y=1.8, z=0.5, diameter=0.4, plane="vertical", yaw=90.0),
            Hoop(id="H3", x=2.65, y=3.0, z=1.5, diameter=0.4, plane="vertical", yaw=0.0),
        ],
        pads=[Pad(id="cf1", x=2.35, y=0.6), Pad(id="cf2", x=2.65, y=0.6), Pad(id="cf3", x=2.95, y=0.6)],
    ),
)
