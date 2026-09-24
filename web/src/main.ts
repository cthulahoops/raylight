import { EXAMPLE_WALLS, type Point, type Segment, segment, splitCrossings, visibilityTriangles } from "./raylighting";
import { type Color, type Disc, type Light, Renderer } from "./renderer";

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

// Arrow keys or WASD drive the player, who carries a warm torch aimed at the pointer.
const player: Disc = { position: [0, -300], radius: 25, color: [1, 1, 1] };
const playerLight: Light = {
  ...sweptLight(player.position, [1.2, 1.0, 0.7]),
  cone: { direction: [0, 1], halfAngle: (15 * Math.PI) / 180 },
};
// A dim, low glow with quick falloff that lights just the player's
// surroundings. It shares the torch's position and sweep; colour, height and
// falloff are set from the controls below.
const playerGlow: Light = { ...playerLight, cone: undefined };
const PLAYER_GLOW_COLOR: Color = [1, 0.85, 0.6];

/** The point of the segment nearest to p. */
function closestPoint([px, py]: Point, { start: [x1, y1], end: [x2, y2] }: Segment): Point {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return [x1 + t * dx, y1 + t * dy];
}

function distanceToSegment(p: Point, s: Segment): number {
  const [cx, cy] = closestPoint(p, s);
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/**
 * Moves p the least distance needed to be `clearance` from every wall, so a
 * disc pressed into a wall slides along it. Repeated to settle into corners.
 */
function pushOutOfWalls(p: Point, clearance: number): Point {
  let [x, y] = p;
  for (let pass = 0; pass < 3; pass++) {
    for (const wall of walls) {
      const [cx, cy] = closestPoint([x, y], wall);
      const d = Math.hypot(x - cx, y - cy);
      if (d > 0 && d < clearance) {
        x = cx + ((x - cx) * clearance) / d;
        y = cy + ((y - cy) * clearance) / d;
      }
    }
  }
  return [x, y];
}

/** A random point at least `clearance` from every wall, the arena edge, the player and the other discs. */
function randomClearPoint(clearance: number, others: Disc[] = []): Point {
  const limit = 1000 - clearance;
  for (;;) {
    const p: Point = [(Math.random() * 2 - 1) * limit, (Math.random() * 2 - 1) * limit];
    const nearPlayer = Math.hypot(p[0] - player.position[0], p[1] - player.position[1]) < 4 * player.radius;
    const nearOther = others.some((d) => Math.hypot(p[0] - d.position[0], p[1] - d.position[1]) < clearance + d.radius);
    if (!nearPlayer && !nearOther && walls.every((w) => distanceToSegment(p, w) >= clearance)) return p;
  }
}

// Enemies are lit by the scene so they hide in the dark: dark grey bodies
// with red eyes. Each walks straight ahead, bouncing off walls, and steers
// towards the brightest light shining on it. They bounce off each other too.
interface Enemy {
  body: Disc;
  heading: number; // radians
}

const enemies: Enemy[] = []; // filled from the controls below

/** Adds or removes enemies to reach `count`; new ones spawn clear of walls, the player and each other. */
function setEnemyCount(count: number): void {
  enemies.length = Math.min(enemies.length, count);
  while (enemies.length < count) {
    const position = randomClearPoint(2 * player.radius, enemies.map((e) => e.body));
    const body: Disc = { position, radius: player.radius, color: [0.4, 0.4, 0.4], lit: true };
    enemies.push({ body, heading: Math.random() * 2 * Math.PI });
  }
}
const ENEMY_SPEED = 150; // world units per second
const ENEMY_TURN_RATE = Math.PI; // radians per second
let enemyLightThreshold = 0; // brightness that attracts the enemy, set from the controls below

/** Turn towards the brightest light above the threshold, then step forward. */
function moveEnemy(enemy: Enemy, dt: number, lights: Light[]): void {
  const { body } = enemy;
  const [x, y] = body.position;
  let target: Light | null = null;
  let best = enemyLightThreshold;
  for (const light of lights) {
    const b = renderer.brightnessAt(light, body.position);
    if (b > best) [best, target] = [b, light];
  }
  if (target) {
    const want = Math.atan2(target.position[1] - y, target.position[0] - x);
    const diff = Math.atan2(Math.sin(want - enemy.heading), Math.cos(want - enemy.heading)); // shortest way round
    const maxTurn = ENEMY_TURN_RATE * dt;
    enemy.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  // Bounce off the arena edge, walls and other enemies, but only when heading
  // into them, so an enemy can escape a wall drawn on top of it or separate
  // from another it overlaps.
  let hx = Math.cos(enemy.heading);
  let hy = Math.sin(enemy.heading);
  const next: Point = [x + hx * ENEMY_SPEED * dt, y + hy * ENEMY_SPEED * dt];
  const r = body.radius;
  const limit = 1000 - r;
  let blocked = false;
  if (Math.abs(next[0]) > limit && hx * next[0] > 0) [hx, blocked] = [-hx, true];
  if (Math.abs(next[1]) > limit && hy * next[1] > 0) [hy, blocked] = [-hy, true];
  const bounce = ([cx, cy]: Point, clearance: number) => {
    const nx = next[0] - cx;
    const ny = next[1] - cy;
    const dot = hx * nx + hy * ny;
    if (Math.hypot(nx, ny) < clearance && dot < 0) {
      const k = (2 * dot) / (nx * nx + ny * ny); // reflect the heading off the obstacle
      hx -= k * nx;
      hy -= k * ny;
      blocked = true;
    }
  };
  for (const wall of walls) bounce(closestPoint(next, wall), r);
  for (const other of enemies) {
    if (other !== enemy) bounce(other.body.position, r + other.body.radius);
  }
  enemy.heading = Math.atan2(hy, hx);
  if (!blocked) body.position = next;
}

// Albedo above 1 so even dim light pushes the eyes to full red.
const EYE_COLOR: Color = [3, 0.2, 0.2];

/** The enemy's body plus two eyes set forward of its centre, facing its heading. */
function enemyDiscs({ body, heading }: Enemy): Disc[] {
  const [ex, ey] = body.position;
  const [fx, fy] = [Math.cos(heading), Math.sin(heading)];
  const r = body.radius;
  const eye = (side: number): Disc => ({
    position: [ex + fx * 0.45 * r - fy * side * 0.4 * r, ey + fy * 0.45 * r + fx * side * 0.4 * r],
    radius: 0.2 * r,
    color: EYE_COLOR,
    lit: true,
  });
  return [body, eye(1), eye(-1)];
}

/** Point the torch at the pointer; keeps its last heading if the pointer is on the player. */
function aimTorch(): void {
  const dx = pointerLight.position[0] - player.position[0];
  const dy = pointerLight.position[1] - player.position[1];
  const len = Math.hypot(dx, dy);
  if (len > 0) playerLight.cone!.direction = [dx / len, dy / len];
}

function updateWalls(): void {
  walls = splitCrossings(drawnWalls);
  for (const light of [...staticLights, pointerLight, playerLight]) {
    light.triangles = visibilityTriangles(light.position, walls);
  }
  playerGlow.triangles = playerLight.triangles;
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
  aimTorch();
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

// Held keys are tracked so movement is per frame, not per key repeat. They
// are physical key codes, so WASD stays in the same place on any layout.
const PLAYER_SPEED = 500; // world units per second
const MOVE_KEYS: Record<string, Point> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};
const heldKeys = new Set<string>();

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") wallStart = null;
  if (e.code in MOVE_KEYS && !e.ctrlKey && !e.metaKey && !e.altKey) {
    heldKeys.add(e.code);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => heldKeys.delete(e.code));
window.addEventListener("blur", () => heldKeys.clear());

function movePlayer(dt: number): void {
  let dx = 0;
  let dy = 0;
  for (const code of heldKeys) [dx, dy] = [dx + MOVE_KEYS[code][0], dy + MOVE_KEYS[code][1]];
  // Holding W and Up together shouldn't skew a diagonal.
  [dx, dy] = [Math.sign(dx), Math.sign(dy)];
  if (dx === 0 && dy === 0) return;
  const distance = PLAYER_SPEED * dt;
  // Walls are only lines, so move in steps short enough that the player
  // can't pass through one between checks.
  const steps = Math.ceil(distance / (player.radius / 2));
  const k = distance / steps / Math.hypot(dx, dy); // diagonal moves at the same speed
  const limit = 1000 - player.radius;
  for (let i = 0; i < steps; i++) {
    const [x, y] = pushOutOfWalls([player.position[0] + dx * k, player.position[1] + dy * k], player.radius);
    player.position = [Math.max(-limit, Math.min(limit, x)), Math.max(-limit, Math.min(limit, y))];
  }
  // The sweep relies on integer coordinates for exact tie-breaking, so round
  // the light's position; the disc itself keeps its fractional position.
  playerLight.position = [Math.round(player.position[0]), Math.round(player.position[1])];
  playerLight.triangles = visibilityTriangles(playerLight.position, walls);
  playerGlow.position = playerLight.position;
  playerGlow.triangles = playerLight.triangles;
  aimTorch();
}

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
let lastTime: DOMHighResTimeStamp | null = null;
function draw(time: DOMHighResTimeStamp): void {
  const seconds = time / 1000;
  const dt = lastTime === null ? 0 : Math.min(seconds - lastTime / 1000, 0.1); // cap after a paused tab
  movePlayer(dt);
  lastTime = time;
  const flickering = staticLights.map((light, i): Light => {
    const k = flicker(seconds, i) * staticBrightness[i];
    return { ...light, color: [light.color[0] * k, light.color[1] * k, light.color[2] * k] };
  });
  const lights = [...flickering, pointerLight, playerLight, playerGlow];
  for (const enemy of enemies) moveEnemy(enemy, dt, lights);
  const pending = wallStart ? segment(wallStart, pointerLight.position) : null;
  renderer.render(walls, lights, pending, [player, ...enemies.flatMap(enemyDiscs)]);
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
slider("glow-brightness", (v) => {
  const [r, g, b] = PLAYER_GLOW_COLOR;
  playerGlow.color = [r * v, g * v, b * v];
});
slider("glow-height", (v) => (playerGlow.height = v));
slider("glow-falloff", (v) => (playerGlow.falloffRate = v));
slider("enemy-count", setEnemyCount);
slider("enemy-threshold", (v) => (enemyLightThreshold = v));
staticLights.forEach((_, i) => slider(`fixed-light-${i + 1}`, (v) => (staticBrightness[i] = v)));

// A colour picker can't exceed 1, so brightness comes from a separate intensity.
function updatePointerColor(): void {
  const hex = parseInt(input("pointer-color").value.slice(1), 16);
  const k = input("pointer-intensity").valueAsNumber / 255;
  pointerLight.color = [((hex >> 16) & 255) * k, ((hex >> 8) & 255) * k, (hex & 255) * k];
}
input("pointer-color").addEventListener("input", updatePointerColor);
slider("pointer-intensity", updatePointerColor);

/** Copies text, falling back to a hidden textarea where the Clipboard API is missing (plain http). */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("copy failed");
}

// Copies every control's value as JSON, keyed by input id.
const copyButton = document.querySelector<HTMLButtonElement>("#copy-settings")!;
copyButton.addEventListener("click", async () => {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("#controls input")];
  const settings = Object.fromEntries(inputs.map((el) => [el.id, el.type === "range" ? el.valueAsNumber : el.value]));
  let result;
  try {
    await copyText(JSON.stringify(settings, null, 2));
    result = "Copied";
  } catch {
    result = "Copy failed";
  }
  copyButton.textContent = result;
  setTimeout(() => (copyButton.textContent = "Copy settings"), 1500);
});

requestAnimationFrame(draw);
