"""2D visibility from a point light by angular sweep.

Walls are line segments with integer endpoints. Given a light position, the
result is a list of segments tracing the boundary of the lit region, one per
angular wedge between consecutive wall endpoints. Fanning each of these out
from the light gives the visibility polygon as triangles.

Coordinates stay as integers until the final ray casting, so the ordering of
sweep events is exact and collinear endpoints tie deterministically.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Iterable, Iterator


Point = tuple[int, int]


@dataclass(frozen=True)
class Segment:
    start: Point
    end: Point

    @property
    def direction(self) -> Point:
        return (self.end[0] - self.start[0], self.end[1] - self.start[1])

    def flipped(self) -> Segment:
        return Segment(self.end, self.start)

    def translated(self, dx: int, dy: int) -> Segment:
        return Segment(
            (self.start[0] + dx, self.start[1] + dy),
            (self.end[0] + dx, self.end[1] + dy),
        )


class EventKind(IntEnum):
    """Order matters: at equal angles a wall must end before another starts."""

    END = 0
    START = 1


@dataclass(frozen=True)
class Event:
    angle: float
    kind: EventKind
    direction: Point
    wall: Segment


# --- Angles -----------------------------------------------------------------


def pseudo_angle(x: int, y: int) -> float:
    """Monotonic stand-in for atan2 over [-1, 3), cheap and tie-safe.

    Two collinear integer vectors have the same exact quotient, and IEEE
    division is correctly rounded, so they map to the same float.
    """
    p = y / (abs(x) + abs(y))
    return 2 - p if x < 0 else p


def visible_angle(segment: Segment) -> float:
    """Counter-clockwise angle swept from start to end as seen from origin."""
    import math

    raw = math.atan2(*reversed(segment.end)) - math.atan2(*reversed(segment.start))
    return raw + 2 * math.pi if raw < 0 else raw


def oriented_ccw(segment: Segment) -> Segment:
    """Flip the segment if it runs clockwise around the origin."""
    import math

    return segment.flipped() if visible_angle(segment) > math.pi else segment


# --- Ray casting --------------------------------------------------------------


def ray_hit(direction: Point, wall: Segment) -> tuple[float, float] | None:
    """Where a ray from the origin along `direction` crosses `wall`, if it does.

    Solved parametrically: origin + t * direction == start + u * (end - start),
    accepting t >= 0 (in front of the light) and 0 <= u <= 1 (within the wall).
    """
    dx, dy = direction
    (sx, sy), (ex, ey) = wall.start, wall.end
    wx, wy = ex - sx, ey - sy

    det = dx * wy - dy * wx
    if det == 0:
        return None  # parallel

    t = (sx * wy - sy * wx) / det
    u = (sx * dy - sy * dx) / det
    if t < 0 or not 0 <= u <= 1:
        return None
    return (t * dx, t * dy)


def nearest_hit(direction: Point, walls: Iterable[Segment]) -> tuple[float, float]:
    """Closest intersection along the ray. Falls back to the origin if none."""
    best = None
    best_key = None
    for wall in walls:
        hit = ray_hit(direction, wall)
        if hit is None:
            continue
        hx, hy = hit
        # Tie-break on alignment with the wall so shared corners are stable.
        wx, wy = wall.direction
        key = (hx * hx + hy * hy, hx * wx + hy * wy)
        if best_key is None or key < best_key:
            best, best_key = hit, key
    return best if best is not None else (0.0, 0.0)


# --- The sweep ----------------------------------------------------------------

SWEEP_START: Point = (0, -1)  # straight down


def sweep_events(walls: Iterable[Segment]) -> list[Event]:
    events = []
    for wall in walls:
        if wall.start == (0, 0) or wall.end == (0, 0):
            continue  # degenerate: an endpoint sits on the light
        events.append(Event(pseudo_angle(*wall.start), EventKind.START, wall.start, wall))
        events.append(Event(pseudo_angle(*wall.end), EventKind.END, wall.end, wall))
    events.sort(key=lambda e: (e.angle, e.kind))
    return events


def lit_segments(walls: list[Segment]) -> Iterator[Segment]:
    """Boundary of the region visible from the origin.

    Walls must already be translated so the light is at (0, 0) and oriented
    counter-clockwise (see `walls_around`). Yields one segment per wedge
    between consecutive endpoint angles.
    """
    # Walls the initial downward ray already passes through are live at the start.
    active = [w for w in walls if ray_hit(SWEEP_START, w) is not None]
    previous = SWEEP_START

    events = sweep_events(walls)
    closing = Event(pseudo_angle(*SWEEP_START), EventKind.END, SWEEP_START, None)

    for event in events + [closing]:
        if event.kind is EventKind.START:
            active.append(event.wall)
        elif event.wall is not None:
            active = [w for w in active if w != event.wall]

        p1 = nearest_hit(previous, active)
        p2 = nearest_hit(event.direction, active)
        yield Segment(p1, p2)  # type: ignore[arg-type]  # float endpoints here
        previous = event.direction


# --- Public entry point -------------------------------------------------------


def walls_around(light: Point, walls: Iterable[Segment]) -> list[Segment]:
    """Re-express walls relative to the light and orient them for the sweep."""
    lx, ly = light
    return [oriented_ccw(w.translated(-lx, -ly)) for w in walls]


def visibility_triangles(light: Point, walls: Iterable[Segment]) -> list[float]:
    """Flat [x, y, z, ...] vertex list of triangles fanning out from the light."""
    lx, ly = light
    verts: list[float] = []
    for seg in lit_segments(walls_around(light, walls)):
        (x1, y1), (x2, y2) = seg.start, seg.end
        verts += [lx, ly, 0.0, x1 + lx, y1 + ly, 0.0, x2 + lx, y2 + ly, 0.0]
    return verts


EXAMPLE_WALLS = [
    Segment((-1000, 1000), (1000, 1000)),
    Segment((-1000, -1000), (1000, -1000)),
    Segment((1000, -1000), (1000, 1000)),
    Segment((-1000, -1000), (-1000, 1000)),
    Segment((-800, 800), (800, 800)),
    Segment((800, 800), (800, -800)),
    Segment((-45, 500), (500, 500)),
    Segment((100, 300), (100, 500)),
    Segment((200, 100), (300, 400)),
    Segment((600, 200), (600, -200)),
    Segment((65, -700), (-300, -800)),
    Segment((-700, 700), (-700, -200)),
    Segment((-700, 700), (-700, 200)),
    Segment((-300, 5), (-300, 50)),
]
