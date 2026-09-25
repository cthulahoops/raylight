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

// A debugging light that follows the pointer; off unless turned up in the controls.
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
// towards the brightest light shining on it while veering away from other
// enemies ahead of it. If they touch anyway, they bounce off each other.
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
// Set from the controls below.
let enemyLightThreshold = 0; // brightness that attracts an enemy
let enemyAvoidRange = 0; // gap between enemies at which they start to veer apart
let enemyAvoidStrength = 0; // weight of veering apart against the pull of a light

/**
 * Steer towards the brightest light above the threshold (or keep going
 * straight) plus away from enemies ahead, then step forward.
 */
function moveEnemy(enemy: Enemy, dt: number, lights: Light[]): void {
  const { body } = enemy;
  const [x, y] = body.position;
  let target: Light | null = null;
  let best = enemyLightThreshold;
  for (const light of lights) {
    const b = renderer.brightnessAt(light, body.position);
    if (b > best) [best, target] = [b, light];
  }
  let hx = Math.cos(enemy.heading);
  let hy = Math.sin(enemy.heading);
  let [wantX, wantY] = [hx, hy];
  if (target) {
    const tx = target.position[0] - x;
    const ty = target.position[1] - y;
    const len = Math.hypot(tx, ty) || 1;
    [wantX, wantY] = [tx / len, ty / len];
  }
  // Only enemies in front count, so it looks where it's going rather than
  // being shoved from behind. Closer and more directly ahead pushes harder.
  for (const other of enemies) {
    if (other === enemy || enemyAvoidRange <= 0) continue;
    const ox = other.body.position[0] - x;
    const oy = other.body.position[1] - y;
    const d = Math.hypot(ox, oy);
    if (d === 0) continue;
    const ahead = (hx * ox + hy * oy) / d;
    const closeness = 1 - (d - body.radius - other.body.radius) / enemyAvoidRange;
    if (ahead <= 0 || closeness <= 0) continue;
    const push = (enemyAvoidStrength * ahead * Math.min(closeness, 1)) / d;
    wantX -= ox * push;
    wantY -= oy * push;
  }
  if (wantX !== 0 || wantY !== 0) {
    const want = Math.atan2(wantY, wantX);
    const diff = Math.atan2(Math.sin(want - enemy.heading), Math.cos(want - enemy.heading)); // shortest way round
    const maxTurn = ENEMY_TURN_RATE * dt;
    enemy.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  // Bounce off the arena edge, walls and other enemies, but only when heading
  // into them, so an enemy can escape a wall drawn on top of it or separate
  // from another it overlaps.
  hx = Math.cos(enemy.heading);
  hy = Math.sin(enemy.heading);
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
  for (const light of [pointerLight, playerLight]) {
    light.triangles = visibilityTriangles(light.position, walls);
  }
  playerGlow.triangles = playerLight.triangles;
  for (const flare of flares) flare.light.triangles = visibilityTriangles(flare.light.position, walls);
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
  if (e.code === "Space") {
    if (!e.repeat) throwFlare();
    e.preventDefault();
  }
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

/** Whether segment pq crosses or touches the wall. */
function crosses(p: Point, q: Point, { start: a, end: b }: Segment): boolean {
  const side = (o: Point, u: Point, v: Point) => Math.sign((u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]));
  return side(p, q, a) !== side(p, q, b) && side(a, b, p) !== side(a, b, q);
}

// Space throws a flare towards the pointer, or as far as it can reach
// towards it. It arcs up and first lands after the flight time for that
// distance, bouncing off walls on the way and off the floor a few times before
// settling, and burns with a sputtering light that fades
// out at the end. Enemies are drawn to it like any other light.
interface Flare {
  position: Point;
  velocity: Point; // world units per second across the floor; zero once landed
  z: number; // height above the floor
  vz: number; // upward speed
  age: number; // seconds
  seed: number; // keeps flares' flicker out of step
  light: Light;
}
const flares: Flare[] = [];
const FLARE_RADIUS = 6;
const FLARE_LIGHT_HEIGHT = 30; // above the flare itself, so it lights the floor around it once landed
const FLARE_HEIGHT_SCALE = 150; // height at which the flare is drawn twice its size, to show the arc
const FLARE_COLOR: Color = [1, 0.3, 0.15]; // scaled by the brightness slider
const FLARE_FADE = 1; // seconds of fading out at the end of the burn
const FLARE_SETTLE_SPEED = 50; // upward speed off the floor below which a flare stops bouncing
// Set from the controls below.
let flareBrightness = 0;
let flareBurnTime = 0; // seconds
let flareRange = 0; // world units
let flareSpeed = 0; // world units per second across the floor
let flareGravity = 0; // world units per second squared
let flareBounce = 0; // fraction of speed into a wall kept bouncing off it
let flareFloorBounce = 0; // fraction of downward speed kept bouncing off the floor
let flareFloorGrip = 0; // fraction of speed across the floor kept through a floor bounce

function throwFlare(): void {
  const dx = pointerLight.position[0] - player.position[0];
  const dy = pointerLight.position[1] - player.position[1];
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || flareSpeed === 0) return;
  // Launched upwards just fast enough to land after covering the distance.
  const flightTime = Math.min(distance, flareRange) / flareSpeed;
  const velocity: Point = [(dx / distance) * flareSpeed, (dy / distance) * flareSpeed];
  const light: Light = { ...sweptLight(playerLight.position, [0, 0, 0]), height: FLARE_LIGHT_HEIGHT, falloffRate: 0.01 };
  const vz = (flareGravity * flightTime) / 2;
  flares.push({ position: player.position, velocity, z: 0, vz, age: 0, seed: Math.random() * 100, light });
}

/** Moves an airborne flare for dt, bouncing it off the floor, arena edge and walls. */
function flyFlare(flare: Flare, dt: number): void {
  flare.vz -= flareGravity * dt;
  flare.z += flare.vz * dt;
  let [vx, vy] = flare.velocity;
  if (flare.z <= 0) {
    // Hit the floor where it was at the start of the frame. Bounce back up,
    // losing speed, until the bounces are too small to see.
    flare.z = 0;
    flare.vz = -flareFloorBounce * flare.vz;
    flare.velocity = [vx * flareFloorGrip, vy * flareFloorGrip];
    if (flare.vz < FLARE_SETTLE_SPEED) [flare.vz, flare.velocity] = [0, [0, 0]];
    return;
  }
  const [x, y] = flare.position;
  const next: Point = [x + vx * dt, y + vy * dt];
  const limit = 1000 - FLARE_RADIUS;
  let blocked = false;
  if (Math.abs(next[0]) > limit && vx * next[0] > 0) [vx, blocked] = [-flareBounce * vx, true];
  if (Math.abs(next[1]) > limit && vy * next[1] > 0) [vy, blocked] = [-flareBounce * vy, true];
  const hit = walls.find((w) => crosses(flare.position, next, w));
  if (hit) {
    // Reverse and damp the speed into the wall, keeping the speed along it.
    const wx = hit.end[0] - hit.start[0];
    const wy = hit.end[1] - hit.start[1];
    const len = Math.hypot(wx, wy) || 1;
    const [nx, ny] = [-wy / len, wx / len];
    const into = vx * nx + vy * ny;
    vx -= (1 + flareBounce) * into * nx;
    vy -= (1 + flareBounce) * into * ny;
    blocked = true;
  }
  flare.velocity = [vx, vy];
  if (!blocked) flare.position = pushOutOfWalls(next, FLARE_RADIUS); // otherwise stays put this frame, heading away
}

/** Fast, deep flicker, so flares sputter. */
function sputter(seconds: number, seed: number): number {
  const wobble =
    (Math.sin(seconds * 17 + seed) + 0.7 * Math.sin(seconds * 31 + 2 * seed) + 0.5 * Math.sin(seconds * 53 + 3 * seed)) / 2.2;
  return 1 + 0.4 * wobble;
}

function updateFlares(dt: number, seconds: number): void {
  for (const flare of flares) {
    flare.age += dt;
    if (flare.z > 0 || flare.vz > 0) {
      flyFlare(flare, dt);
      flare.light.position = [Math.round(flare.position[0]), Math.round(flare.position[1])];
      flare.light.triangles = visibilityTriangles(flare.light.position, walls);
      flare.light.height = FLARE_LIGHT_HEIGHT + flare.z;
    }
    const fade = Math.min(1, (flareBurnTime - flare.age) / FLARE_FADE);
    const k = flareBrightness * sputter(seconds, flare.seed) * Math.max(0, fade);
    flare.light.color = [FLARE_COLOR[0] * k, FLARE_COLOR[1] * k, FLARE_COLOR[2] * k];
  }
  for (let i = flares.length - 1; i >= 0; i--) {
    if (flares[i].age >= flareBurnTime) flares.splice(i, 1);
  }
}

/** A flare's burning head, drawn flat so it glows whatever the lighting, and bigger the higher it is. */
function flareDisc(flare: Flare): Disc {
  const k = Math.min(1, Math.max(...flare.light.color));
  const radius = FLARE_RADIUS * (1 + flare.z / FLARE_HEIGHT_SCALE);
  return { position: flare.position, radius, color: [1, 0.3 + 0.6 * k, 0.2 + 0.5 * k] };
}

// Flares sputter and things move every frame, so render continuously rather than on input.
let lastTime: DOMHighResTimeStamp | null = null;
function draw(time: DOMHighResTimeStamp): void {
  const seconds = time / 1000;
  const dt = lastTime === null ? 0 : Math.min(seconds - lastTime / 1000, 0.1); // cap after a paused tab
  movePlayer(dt);
  updateFlares(dt, seconds);
  lastTime = time;
  const lights = [pointerLight, playerLight, playerGlow, ...flares.map((f) => f.light)];
  for (const enemy of enemies) moveEnemy(enemy, dt, lights);
  const pending = wallStart ? segment(wallStart, pointerLight.position) : null;
  renderer.render(walls, lights, pending, [player, ...enemies.flatMap(enemyDiscs), ...flares.map(flareDisc)]);
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
slider("glow-brightness", (v) => {
  const [r, g, b] = PLAYER_GLOW_COLOR;
  playerGlow.color = [r * v, g * v, b * v];
});
slider("glow-height", (v) => (playerGlow.height = v));
slider("glow-falloff", (v) => (playerGlow.falloffRate = v));
slider("flare-brightness", (v) => (flareBrightness = v));
slider("flare-burn-time", (v) => (flareBurnTime = v));
slider("flare-range", (v) => (flareRange = v));
slider("flare-speed", (v) => (flareSpeed = v));
slider("flare-gravity", (v) => (flareGravity = v));
slider("flare-bounce", (v) => (flareBounce = v));
slider("flare-floor-bounce", (v) => (flareFloorBounce = v));
slider("flare-floor-grip", (v) => (flareFloorGrip = v));
slider("enemy-count", setEnemyCount);
slider("enemy-avoid-range", (v) => (enemyAvoidRange = v));
slider("enemy-avoid-strength", (v) => (enemyAvoidStrength = v));
slider("enemy-threshold", (v) => (enemyLightThreshold = v));

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
