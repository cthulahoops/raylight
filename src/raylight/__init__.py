"""Demo: render a simple arrangement of walls lit by a few point lights."""

import argparse

from .raylighting import EXAMPLE_WALLS
from .render import Renderer

# Lights blend additively, so keep each dim enough that overlaps don't clip.
DEMO_LIGHTS = [
    ((0, 0), (0.45, 0.40, 0.25)),
    ((-500, -500), (0.10, 0.15, 0.45)),
    ((650, 650), (0.45, 0.10, 0.10)),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-o", "--output", default="out.png")
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()

    image = Renderer(size=args.size).render(EXAMPLE_WALLS, DEMO_LIGHTS)
    image.save(args.output)
    print(f"wrote {args.output}")
