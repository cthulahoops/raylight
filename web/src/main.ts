import { EXAMPLE_WALLS, type Point, type Segment, segment, splitCrossings, visibilityTriangles } from "./raylighting";
import { type Color, type Light, Renderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = await Renderer.create(canvas);

const drawnWalls: Segment[] = [...EXAMPLE_WALLS];
// The sweep needs crossings as endpoints; recomputed only when walls change.
let walls: Segment[] = splitCrossings(drawnWalls);

/** A light swept against the current walls; re-sweep whenever its position or the walls change. */
function sweptLight(position: Point, color: Color): Light {
  return { position, color, triangles: visibilityTriangles(position, walls) };
}

// Colours exceed 1 because the textured floor is dark and falls off with distance.
const staticLights: Light[] = [
  sweptLight([-500, -500], [1.6, 0.4, 0.4]),
  sweptLight([650, 650], [0.4, 1.6, 0.4]),
  sweptLight([-600, 600], [1.4, 1.1, 0.2]),
];
const pointerLight = sweptLight([0, 0], [0, 0, 0]); // colour set from the controls below

function updateWalls(): void {
  walls = splitCrossings(drawnWalls);
  for (const light of [...staticLights, pointerLight]) light.triangles = visibilityTriangles(light.position, walls);
}

let wallStart: Point | null = null; // set after the first click of a new wall

function toWorld(e: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((e.clientY - rect.top) / rect.height) * 2;
  return [Math.round(x * 1000), Math.round(y * 1000)];
}

canvas.addEventListener("pointermove", (e) => {
  pointerLight.position = toWorld(e);
  pointerLight.triangles = visibilityTriangles(pointerLight.position, walls);
});

// Click once to start a wall, again to finish it. Escape abandons it.
canvas.addEventListener("click", (e) => {
  const p = toWorld(e);
  if (wallStart === null) {
    wallStart = p;
  } else {
    if (p[0] !== wallStart[0] || p[1] !== wallStart[1]) {
      drawnWalls.push(segment(wallStart, p));
      updateWalls();
    }
    wallStart = null;
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") wallStart = null;
});

let flickerAmount = 0; // set from the controls below
const staticBrightness = staticLights.map(() => 1); // per-light multipliers, set from the sliders

/** Brightness multiplier around 1; incommensurate sines so the flicker never visibly repeats. */
function flicker(seconds: number, seed: number): number {
  const s = seed * 2.39996; // golden angle, so lights stay out of step
  const wobble =
    (Math.sin(seconds * 2.9 + s) + 0.6 * Math.sin(seconds * 5.3 + 2 * s) + 0.3 * Math.sin(seconds * 9.7 + 3 * s)) / 1.9;
  return Math.max(0, 1 + flickerAmount * wobble);
}

// Flicker changes every frame, so render continuously rather than on input.
function draw(time: DOMHighResTimeStamp): void {
  const seconds = time / 1000;
  const flickering = staticLights.map((light, i): Light => {
    const k = flicker(seconds, i) * staticBrightness[i];
    return { ...light, color: [light.color[0] * k, light.color[1] * k, light.color[2] * k] };
  });
  const pending = wallStart ? segment(wallStart, pointerLight.position) : null;
  renderer.render(walls, [...flickering, pointerLight], pending);
  requestAnimationFrame(draw);
}

function input(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${id}`)!;
}

/** Wires a slider to a setter, echoing its value into the matching <output>. */
function slider(id: string, set: (value: number) => void): void {
  const el = input(id);
  const out = document.querySelector<HTMLOutputElement>(`output[for=${id}]`)!;
  const update = () => {
    set(el.valueAsNumber);
    out.value = el.value;
  };
  el.addEventListener("input", update);
  update();
}

slider("light-height", (v) => (renderer.lighting.lightHeight = v));
slider("falloff-rate", (v) => (renderer.lighting.falloffRate = v));
slider("flicker", (v) => (flickerAmount = v));
staticLights.forEach((_, i) => slider(`fixed-light-${i + 1}`, (v) => (staticBrightness[i] = v)));

// A colour picker can't exceed 1, so brightness comes from a separate intensity.
function updatePointerColor(): void {
  const hex = parseInt(input("pointer-color").value.slice(1), 16);
  const k = input("pointer-intensity").valueAsNumber / 255;
  pointerLight.color = [((hex >> 16) & 255) * k, ((hex >> 8) & 255) * k, (hex & 255) * k];
}
input("pointer-color").addEventListener("input", updatePointerColor);
slider("pointer-intensity", updatePointerColor);

requestAnimationFrame(draw);
