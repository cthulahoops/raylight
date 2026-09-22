import { EXAMPLE_WALLS, type Point, type Segment, segment, splitCrossings } from "./raylighting";
import { Renderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new Renderer(canvas);

const LIGHT_COLOR = [0.4, 0.6, 1.0] as const;

const drawnWalls: Segment[] = [...EXAMPLE_WALLS];
// The sweep needs crossings as endpoints; recomputed only when walls change.
let walls = splitCrossings(drawnWalls);
let pointer: Point = [0, 0];
let wallStart: Point | null = null; // set after the first click of a new wall

function toWorld(e: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((e.clientY - rect.top) / rect.height) * 2;
  return [Math.round(x * 1000), Math.round(y * 1000)];
}

canvas.addEventListener("pointermove", (e) => {
  pointer = toWorld(e);
  draw();
});

// Click once to start a wall, again to finish it. Escape abandons it.
canvas.addEventListener("click", (e) => {
  const p = toWorld(e);
  if (wallStart === null) {
    wallStart = p;
  } else {
    if (p[0] !== wallStart[0] || p[1] !== wallStart[1]) {
      drawnWalls.push(segment(wallStart, p));
      walls = splitCrossings(drawnWalls);
    }
    wallStart = null;
  }
  draw();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    wallStart = null;
    draw();
  }
});

function draw(): void {
  const pending = wallStart ? segment(wallStart, pointer) : null;
  renderer.render(walls, [{ position: pointer, color: LIGHT_COLOR }], pending);
}
draw();
