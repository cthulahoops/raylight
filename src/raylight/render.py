"""Headless moderngl rendering of a light's visibility polygon over some walls."""

from __future__ import annotations

import math

import moderngl
import numpy as np
from PIL import Image

from .raylighting import Point, Segment, visibility_triangles

VERTEX_SHADER = """
#version 330
in vec2 in_pos;
uniform float scale;
void main() {
    gl_Position = vec4(in_pos * scale, 0.0, 1.0);
}
"""

FRAGMENT_SHADER = """
#version 330
uniform vec3 color;
out vec4 frag_color;
void main() {
    frag_color = vec4(color, 1.0);
}
"""


def wall_quads(walls: list[Segment], thickness: float = 6.0) -> np.ndarray:
    """Two triangles per wall, thickened perpendicular to its direction."""
    verts = []
    for wall in walls:
        (x1, y1), (x2, y2) = wall.start, wall.end
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length * thickness, dx / length * thickness
        a, b = (x1 + nx, y1 + ny), (x2 + nx, y2 + ny)
        c, d = (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)
        verts += [a, b, c, a, c, d]
    return np.array(verts, dtype="f4")


def light_fan(light: Point, walls: list[Segment]) -> np.ndarray:
    flat = np.array(visibility_triangles(light, walls), dtype="f4")
    return flat.reshape(-1, 3)[:, :2].copy()


class Renderer:
    def __init__(self, size: int = 1024, world_extent: float = 1000.0):
        self.size = size
        self.scale = 1.0 / world_extent
        self.ctx = moderngl.create_standalone_context(backend="egl")
        self.prog = self.ctx.program(
            vertex_shader=VERTEX_SHADER, fragment_shader=FRAGMENT_SHADER
        )
        self.prog["scale"].value = self.scale
        self.fbo = self.ctx.simple_framebuffer((size, size))

    def _draw(self, verts: np.ndarray, color: tuple[float, float, float]) -> None:
        if len(verts) == 0:
            return
        vbo = self.ctx.buffer(verts.tobytes())
        vao = self.ctx.simple_vertex_array(self.prog, vbo, "in_pos")
        self.prog["color"].value = color
        vao.render(moderngl.TRIANGLES)
        vao.release()
        vbo.release()

    def render(
        self,
        walls: list[Segment],
        lights: list[tuple[Point, tuple[float, float, float]]],
    ) -> Image.Image:
        self.fbo.use()
        self.ctx.viewport = (0, 0, self.size, self.size)
        self.ctx.clear(0.0, 0.0, 0.0)

        # Lights add together where their visibility polygons overlap.
        self.ctx.enable(moderngl.BLEND)
        self.ctx.blend_func = moderngl.ONE, moderngl.ONE
        for position, color in lights:
            self._draw(light_fan(position, walls), color)

        self.ctx.disable(moderngl.BLEND)
        self._draw(wall_quads(walls), (1.0, 1.0, 1.0))

        data = self.fbo.read(components=3)
        image = Image.frombytes("RGB", (self.size, self.size), data)
        return image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)  # GL is y-up
