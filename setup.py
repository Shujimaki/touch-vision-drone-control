from setuptools import find_packages, setup

package_name = 'touch_vision_drone_control'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['web', 'test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Ron John B. Galvez',
    maintainer_email='ron_galvez@dlsu.edu.ph',
    description='ROS 2 multi-Crazyflie interface package bridging touch and MediaPipe inputs',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'check_repo = scripts.check:main',
            'backend_server = scripts.backend_server:main',
        ],
    },
)