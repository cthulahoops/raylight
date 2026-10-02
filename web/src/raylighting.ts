/**
 * 2D visibility from a point light by angular sweep.
 *
 * Walls are line segments with integer endpoints. Given a light position, the
 * result is a list of segments tracing the boundary of the lit region, one per
 * angular wedge between consecutive wall endpoints. Fanning each of these out
 * from the light gives the visibility polygon as triangles.
 *
 * Coordinates stay as integers until the final ray casting, so the ordering of
 * sweep events is exact and collinear endpoints tie deterministically.
 */

export type Point = readonly [number, number];

export interface Segment {
  readonly start: Point;
  readonly end: Point;
}

export const segment = (start: Point, end: Point): Segment => ({ start, end });

/** Order matters: at equal angles a wall must end before another starts. */
const EventKind = { End: 0, Start: 1 } as const;
type EventKind = (typeof EventKind)[keyof typeof EventKind];

interface Event {
  angle: number;
  kind: EventKind;
  direction: Point;
  wall: Segment | null;
}

// --- Angles -----------------------------------------------------------------

/**
 * Monotonic stand-in for atan2 over [-1, 3), cheap and tie-safe.
 *
 * Two collinear integer vectors have the same exact quotient, and IEEE
 * division is correctly rounded, so they map to the same double.
 */
export function pseudoAngle(x: number, y: number): number {
  const p = y / (Math.abs(x) + Math.abs(y));
  return x < 0 ? 2 - p : p;
}

/** Flip the segment if it runs clockwise around the origin. Exact: integer cross product. */
function orientedCcw(s: Segment): Segment {
  const cross = s.start[0] * s.end[1] - s.start[1] * s.end[0];
  return cross < 0 ? segment(s.end, s.start) : s;
}

// --- Ray casting ------------------------------------------------------------

/**
 * Where a ray from the origin along `direction` crosses `wall`, if it does.
 *
 * Solved parametrically: origin + t * direction == start + u * (end - start),
 * accepting t >= 0 (in front of the light) and 0 <= u <= 1 (within the wall).
 */
function rayHit(direction: Point, wall: Segment): Point | null {
  const [dx, dy] = direction;
  const [sx, sy] = wall.start;
  const wx = wall.end[0] - sx;
  const wy = wall.end[1] - sy;

  const det = dx * wy - dy * wx;
  if (det === 0) return null; // parallel

  const t = (sx * wy - sy * wx) / det;
  const u = (sx * dy - sy * dx) / det;
  if (t < 0 || u < 0 || u > 1) return null;
  return [t * dx, t * dy];
}

/** Closest intersection along the ray. Falls back to the origin if none. */
function nearestHit(direction: Point, walls: Segment[]): Point {
  let best: Point | null = null;
  let bestDist = Infinity;
  let bestAlign = Infinity;
  for (const wall of walls) {
    const hit = rayHit(direction, wall);
    if (hit === null) continue;
    const [hx, hy] = hit;
    const dist = hx * hx + hy * hy;
    // Tie-break on alignment with the wall so shared corners are stable.
    const align = hx * (wall.end[0] - wall.start[0]) + hy * (wall.end[1] - wall.start[1]);
    if (dist < bestDist || (dist === bestDist && align < bestAlign)) {
      best = hit;
      bestDist = dist;
      bestAlign = align;
    }
  }
  return best ?? [0, 0];
}

// --- The sweep --------------------------------------------------------------

const SWEEP_START: Point = [0, -1]; // straight down

function sweepEvents(walls: Segment[]): Event[] {
  const events: Event[] = [];
  for (const wall of walls) {
    const { start, end } = wall;
    if ((start[0] === 0 && start[1] === 0) || (end[0] === 0 && end[1] === 0)) {
      continue; // degenerate: an endpoint sits on the light
    }
    events.push({ angle: pseudoAngle(start[0], start[1]), kind: EventKind.Start, direction: start, wall });
    events.push({ angle: pseudoAngle(end[0], end[1]), kind: EventKind.End, direction: end, wall });
  }
  events.sort((a, b) => a.angle - b.angle || a.kind - b.kind);
  return events;
}

/**
 * Boundary of the region visible from the origin.
 *
 * Walls must already be translated so the light is at (0, 0) and oriented
 * counter-clockwise (see `wallsAround`). Returns one segment per wedge
 * between consecutive endpoint angles.
 */
export function litSegments(walls: Segment[]): Segment[] {
  // Walls the initial downward ray already passes through are live at the start.
  let active = walls.filter((w) => rayHit(SWEEP_START, w) !== null);
  let previous = SWEEP_START;

  const events = sweepEvents(walls);
  events.push({ angle: pseudoAngle(0, -1), kind: EventKind.End, direction: SWEEP_START, wall: null });

  const out: Segment[] = [];
  for (const event of events) {
    // Cast against the walls live *before* this event: a wall that ends
    // here still bounds the wedge leading up to its endpoint.
    out.push(segment(nearestHit(previous, active), nearestHit(event.direction, active)));
    previous = event.direction;

    if (event.kind === EventKind.Start) {
      active.push(event.wall!);
    } else if (event.wall !== null) {
      active = active.filter((w) => w !== event.wall);
    }
  }
  return out;
}

const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

// --- Crossing walls ---------------------------------------------------------

/**
 * Cut walls wherever they cross, so crossings become sweep events.
 *
 * The sweep assumes the nearest wall is constant within a wedge, which fails
 * where two walls cross mid-wedge. Crossing points are rounded to integers
 * and both walls are cut at the same rounded point, so the pieces still meet
 * exactly and integer coordinates are preserved.
 */
export function splitCrossings(walls: Segment[]): Segment[] {
  const cuts: { t: number; point: Point }[][] = walls.map(() => []);
  for (let i = 0; i < walls.length; i++) {
    const [px, py] = walls[i].start;
    const rx = walls[i].end[0] - px;
    const ry = walls[i].end[1] - py;
    for (let j = i + 1; j < walls.length; j++) {
      const [qx, qy] = walls[j].start;
      const sx = walls[j].end[0] - qx;
      const sy = walls[j].end[1] - qy;
      const det = rx * sy - ry * sx;
      if (det === 0) continue; // parallel or collinear
      const t = ((qx - px) * sy - (qy - py) * sx) / det;
      const u = ((qx - px) * ry - (qy - py) * rx) / det;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const point: Point = [Math.round(px + t * rx), Math.round(py + t * ry)];
      if (t > 0 && t < 1) cuts[i].push({ t, point });
      if (u > 0 && u < 1) cuts[j].push({ t: u, point });
    }
  }

  const out: Segment[] = [];
  walls.forEach((wall, i) => {
    let prev = wall.start;
    for (const { point } of cuts[i].sort((a, b) => a.t - b.t)) {
      if (!samePoint(point, prev)) {
        out.push(segment(prev, point));
        prev = point;
      }
    }
    if (!samePoint(prev, wall.end)) out.push(segment(prev, wall.end));
  });
  return out;
}

// --- Public entry point -----------------------------------------------------

/** Re-express walls relative to the light and orient them for the sweep. */
export function wallsAround(light: Point, walls: Iterable<Segment>): Segment[] {
  const [lx, ly] = light;
  const out: Segment[] = [];
  for (const w of walls) {
    out.push(
      orientedCcw(segment([w.start[0] - lx, w.start[1] - ly], [w.end[0] - lx, w.end[1] - ly])),
    );
  }
  return out;
}

const dist2 = (p: Point) => p[0] * p[0] + p[1] * p[1];

/**
 * Flat [x, y, ...] vertex list of triangles covering the lit region.
 *
 * Consecutive wedges meet along a ray from the light. Where one wedge's
 * corner is nearer than its neighbour's on the same ray (a shadow edge),
 * the farther wedge's radial edge is split at the nearer corner. Without
 * that, the two triangles form a T-junction and rasterisers leave a
 * hairline gap along the shadow edge.
 */
export function visibilityTriangles(light: Point, walls: Iterable<Segment>): Float32Array {
  const [lx, ly] = light;
  const wedges = litSegments(wallsAround(light, walls));
  const n = wedges.length;
  if (n === 0) return new Float32Array(0);

  // Points lying on the ray between wedge i and wedge i+1 (cyclic). Zero-width
  // wedges sit on a single ray, so their neighbours' corners join the same set.
  const rayPoints: Point[][] = wedges.map(() => []);
  const addPoint = (list: Point[], p: Point) => {
    if (!list.some((q) => samePoint(p, q))) list.push(p);
  };
  wedges.forEach((w, i) => {
    addPoint(rayPoints[(i + n - 1) % n], w.start);
    addPoint(rayPoints[i], w.end);
  });
  wedges.forEach((w, i) => {
    if (samePoint(w.start, w.end)) {
      const prev = (i + n - 1) % n;
      const merged = [...rayPoints[prev]];
      rayPoints[i].forEach((p) => addPoint(merged, p));
      rayPoints[prev] = rayPoints[i] = merged;
    }
  });

  const nearer = (points: Point[], corner: Point): Point[] => {
    const d = dist2(corner);
    return points.filter((p) => dist2(p) > 0 && dist2(p) < d).sort((a, b) => dist2(a) - dist2(b));
  };

  const verts: number[] = [];
  const origin: Point = [0, 0];
  wedges.forEach((w, i) => {
    if (samePoint(w.start, w.end)) return;
    // Polygon around the wedge: light, splits along the start ray (near to
    // far), start corner, end corner, splits along the end ray (far to near).
    const ring: Point[] = [
      origin,
      ...nearer(rayPoints[(i + n - 1) % n], w.start),
      w.start,
      w.end,
      ...nearer(rayPoints[i], w.end).reverse(),
    ];
    // Fan from the first non-light vertex so every radial edge is exact.
    const apex = ring[1];
    for (let k = 2; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      verts.push(apex[0] + lx, apex[1] + ly, a[0] + lx, a[1] + ly, b[0] + lx, b[1] + ly);
    }
  });
  return Float32Array.from(verts);
}

/** The edge of the arena, enclosing every light so the sweep always has a wall to hit. */
export const ARENA_EDGES: Segment[] = [
  segment([-1000, 1000], [1000, 1000]),
  segment([-1000, -1000], [1000, -1000]),
  segment([1000, -1000], [1000, 1000]),
  segment([-1000, -1000], [-1000, 1000]),
];

/** Walls inside the arena. */
export const EXAMPLE_WALLS: Segment[] = [
  segment([0, -200], [0, -600]),
  segment([0, 600], [0, 200]),
  segment([200, 0], [600, 0]),
  segment([-200, 0], [-600, 0]),
  segment([600, 600], [600, 200]),
  segment([600, -200], [600, -600]),
  segment([600, -200], [1000, -200]),
  segment([600, 200], [1000, 200]),
  segment([-600, 200], [-1000, 200]),
  segment([-600, -200], [-1000, -200]),
  segment([-600, 600], [-600, 200]),
  segment([-600, -600], [-600, -200]),
  segment([-200, 0], [0, -200]),
  segment([0, 200], [200, 0]),
];
