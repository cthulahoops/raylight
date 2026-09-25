# original

The 2015 Haskell/OpenGL project this one grew out of, kept for reference.
It isn't built. Its dependency bounds pin a 2013-era GHC (`base <4.7`).

- `RayLighting.hs`: the angular-sweep visibility algorithm.
- `Visible.hs`: the executable. GLFW window, lights, and a player you can move.
- `Shaders.hs`, `*.vert`, `*.frag`: shadow-mask and scene shaders.
- `Dungeon.hs`, `Walls.hs`: later work that was never committed upstream.
- `raylighting.py`: the first attempt at porting `RayLighting.hs` to Python.

`git log original/` shows the original commit history.
