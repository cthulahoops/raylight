# raylight

Python port of the 2D ray-lighting experiment. `raylighting.py` holds the
angular-sweep visibility algorithm; `render.py` draws the result headlessly
with moderngl.

Requires a Mesa EGL stack for headless rendering:

    sudo apt install libegl1 libegl-mesa0 libgl1-mesa-dri libgbm1 libgl1

Run the demo:

    uv run raylight -o out.png
