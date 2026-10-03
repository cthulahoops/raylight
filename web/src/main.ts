import { ARENA_EDGES, EXAMPLE_WALLS, type Point, type Segment, segment, splitCrossings, visibilityTriangles } from "./raylighting";
import { type Color, type Disc, type Light, type Mark, Renderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = await Renderer.create(canvas);

// The walls and the settings are kept in local storage, so a level being
// edited survives a reload.
const WALLS_KEY = "raylight.walls";
const SETTINGS_KEY = "raylight.settings";

/** The stored value, or the fallback if there's none or it can't be read. */
function loadStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch {
    return fallback;
  }
}

// The arena edges are always there, so only the walls drawn inside them are
// kept and edited. Levels stored with the edges among them have them dropped.
const isArenaEdge = ({ start, end }: Segment) =>
  ARENA_EDGES.some((edge) => [edge.start, edge.end].every((p) => [start, end].some((q) => p[0] === q[0] && p[1] === q[1])));
const drawnWalls: Segment[] = loadStored(WALLS_KEY, [...EXAMPLE_WALLS]).filter((w) => !isArenaEdge(w));
// The sweep needs crossings as endpoints; recomputed only when walls change.
let walls: Segment[] = splitCrossings([...ARENA_EDGES, ...drawnWalls]);


/** A light swept against the current walls; re-sweep whenever its position or the walls change. */
function sweptLight(position: Point, color: Color): Light {
  return { position, color, triangles: visibilityTriangles(position, walls) };
}

// A debugging light that follows the pointer; off unless turned up in the controls.
const pointerLight = sweptLight([0, 0], [0, 0, 0]); // colour set from the controls below

// Clicking or tapping sends the player towards that point, and arrow keys or
// WASD drive them too. They carry a warm torch pointing the way they face.
const PLAYER_START: Point = [0, 0];
const player: Disc = { position: PLAYER_START, radius: 25, color: [0.75, 0.75, 0.75], lit: true };
// An enemy touching the player destroys them. Their torch and glow stay
// where they fell, sputtering out, the flares they held spill out lit, and
// they shatter.
let playerAlive = true;
let deathAge = 0; // seconds since the player died
const TORCH_DEATH_TIME = 1.5; // seconds for the torch to sputter out
const playerLight: Light = {
  ...sweptLight(player.position, [0, 0, 0]), // colour set each frame from torchColor
  cone: { direction: [0, 1], halfAngle: 0 }, // width set each frame from beamHalfAngle
};
// A dim, low glow with quick falloff that lights just the player's
// surroundings. It shares the torch's position and sweep; height and falloff
// are set from the controls below, and colour each frame from glowColor.
const playerGlow: Light = { ...playerLight, cone: undefined };
const PLAYER_GLOW_COLOR: Color = [1, 0.85, 0.6];
// Set from the controls below.
let torchColor: Color = [0, 0, 0];
let glowColor: Color = [0, 0, 0];
let beamHalfAngle = 0; // radians
// Collecting a coin flares the glow bright gold, fading back to normal.
const COIN_GLOW_COLOR: Color = [7, 5, 1.4];
const COIN_GLOW_TIME = 0.6; // seconds to fade back
let coinGlowAge = Infinity; // seconds since the last coin was collected

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

/**
 * A random point at least `clearance` from every wall, the arena edge and
 * the other discs, and away from the player: further than four of their
 * radii, and outside the square of half-size `playerKeepOut` centred on them.
 */
function randomClearPoint(clearance: number, others: Disc[] = [], playerKeepOut = 0): Point {
  const limit = 1000 - clearance;
  for (;;) {
    const p: Point = [(Math.random() * 2 - 1) * limit, (Math.random() * 2 - 1) * limit];
    const [dx, dy] = [p[0] - player.position[0], p[1] - player.position[1]];
    const nearPlayer = Math.hypot(dx, dy) < 4 * player.radius || Math.max(Math.abs(dx), Math.abs(dy)) < playerKeepOut;
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

// Enemies never spawn within an 800 by 800 square centred on the player.
const ENEMY_SPAWN_KEEP_OUT = 400; // half the square's side

/** Adds or removes enemies to reach `count`; new ones spawn clear of walls, the player and each other. */
function setEnemyCount(count: number): void {
  enemies.length = Math.min(enemies.length, count);
  while (enemies.length < count) {
    const position = randomClearPoint(2 * player.radius, enemies.map((e) => e.body), ENEMY_SPAWN_KEEP_OUT);
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

// Gold coins to collect by walking over them. Each shines with a shimmer of
// its own (emission), so it shows in the dark, but lights nothing else: a
// light per coin cost a whole light pass each.
interface Coin {
  body: Disc;
  seed: number; // keeps coins' shimmer out of step
}
const coins: Coin[] = []; // filled from the controls below
const COIN_RADIUS = 12;
// Set from the controls below and applied to every coin each frame.
let coinColor: Color = [0, 0, 0];
let coinEmission: Color = [0, 0, 0];
let coinShimmer = 0; // fraction the shine swings by
let coinsCollected = 0;
// Collecting the last coin wins: the player can no longer be killed, the
// glow stays gold, and a warm golden ambient light fades up across the arena.
let won = false;
let wonAge = 0; // seconds since winning
const NIGHT_AMBIENT: Color = [0.02, 0.02, 0.05];
const VICTORY_AMBIENT: Color = [0.35, 0.27, 0.12];
const VICTORY_FADE_TIME = 3; // seconds for the ambient light to come up

/** Adds or removes coins to reach `count`; new ones spawn clear of walls, the player, enemies, crates and each other. */
function setCoinCount(count: number): void {
  coins.length = Math.min(coins.length, count);
  while (coins.length < count) {
    const others = [...enemies.map((e) => e.body), ...coins.map((c) => c.body), ...crates.map((c) => c.body)];
    const clear = randomClearPoint(3 * COIN_RADIUS, others);
    coins.push({ body: { position: clear, radius: COIN_RADIUS, color: coinColor, lit: true }, seed: Math.random() * 100 });
  }
}

/** Collects the coins the player touches and sets the rest shimmering with the current settings. */
function updateCoins(seconds: number): void {
  for (let i = coins.length - 1; i >= 0 && playerAlive; i--) {
    if (touchesPlayer(coins[i].body)) {
      coins.splice(i, 1);
      coinsCollected++;
      coinGlowAge = 0;
      if (coins.length === 0) won = true;
    }
  }
  for (const { body, seed } of coins) {
    const k = 1 + coinShimmer * Math.sin(seconds * 2.5 + seed);
    body.color = coinColor;
    body.emission = [coinEmission[0] * k, coinEmission[1] * k, coinEmission[2] * k];
  }
}

// Crates of flares lying in the arena, picked up by walking over them. A
// brown box with the heads of its flares poking out, lit by the scene so it
// has to be found with the torch.
interface Crate {
  body: Disc;
}
const crates: Crate[] = []; // filled from the controls below
const CRATE_HALF_SIZE: Point = [16, 10];
const CRATE_RADIUS = 14; // for pickup and spacing
const CRATE_COLOR: Color = [0.55, 0.35, 0.18];
// Albedo above 1 so any light on the crate shows its flares red.
const CRATE_FLARE_COLOR: Color = [2.5, 0.4, 0.2];

/** Adds or removes crates to reach `count`; new ones spawn clear of walls, the player, enemies, coins and each other. */
function setCrateCount(count: number): void {
  crates.length = Math.min(crates.length, count);
  while (crates.length < count) {
    const others = [...enemies.map((e) => e.body), ...coins.map((c) => c.body), ...crates.map((c) => c.body)];
    const position = randomClearPoint(2 * CRATE_RADIUS, others);
    crates.push({ body: { position, radius: CRATE_RADIUS, box: CRATE_HALF_SIZE, color: CRATE_COLOR, lit: true } });
  }
}

/** Picks up the crates the player touches. */
function updateCrates(): void {
  for (let i = crates.length - 1; i >= 0 && playerAlive; i--) {
    if (touchesPlayer(crates[i].body)) {
      crates.splice(i, 1);
      flaresHeld += FLARES_PER_CRATE;
    }
  }
}

/** The crate plus the heads of its flares, in a row across the middle. */
function crateDiscs({ body }: Crate): Disc[] {
  const [x, y] = body.position;
  const head = (dx: number): Disc => ({ position: [x + dx, y], radius: 0.3 * CRATE_HALF_SIZE[1], color: CRATE_FLARE_COLOR, lit: true });
  return [body, ...[-0.5, 0, 0.5].map((k) => head(k * CRATE_HALF_SIZE[0]))];
}

function touchesPlayer({ position: [x, y], radius }: Disc): boolean {
  return Math.hypot(player.position[0] - x, player.position[1] - y) < player.radius + radius;
}

function killPlayer(): void {
  playerAlive = false;
  deathAge = 0;
  spillFlares();
  shatterPlayer();
}

/**
 * Sets the torch and glow from the controls, the glow flashing gold after a
 * coin is collected, or, once the player has died, dims them over
 * TORCH_DEATH_TIME with ever more frequent dropouts and narrows the beam as
 * it goes. Returns whether they're still giving light.
 */
function updateTorch(dt: number, seconds: number): boolean {
  let k = 1;
  let beam = 1;
  if (!playerAlive) {
    deathAge += dt;
    const left = 1 - deathAge / TORCH_DEATH_TIME;
    if (left <= 0) return false;
    const dropout = Math.random() < 0.6 * (1 - left) ? 0.15 : 1;
    k = left * sputter(seconds, 0) * dropout;
    beam = 0.4 + 0.6 * left;
  }
  playerLight.color = [torchColor[0] * k, torchColor[1] * k, torchColor[2] * k];
  coinGlowAge += dt;
  const gold = won ? 1 : Math.max(0, 1 - coinGlowAge / COIN_GLOW_TIME) ** 2; // quick at first, easing back to normal
  const glow = (i: number) => (glowColor[i] + (COIN_GLOW_COLOR[i] - glowColor[i]) * gold) * k;
  playerGlow.color = [glow(0), glow(1), glow(2)];
  playerLight.cone!.halfAngle = beamHalfAngle * beam;
  return true;
}

// The level editor lights everything up so the layout can be seen.
const EDITOR_AMBIENT: Color = [0.5, 0.5, 0.55];

/** Fades the ambient light up to gold after winning, easing in and out. */
function updateAmbient(dt: number): void {
  if (won) wonAge += dt;
  const t = Math.min(1, wonAge / VICTORY_FADE_TIME);
  const k = t * t * (3 - 2 * t);
  const mix = (i: number) => NIGHT_AMBIENT[i] + (VICTORY_AMBIENT[i] - NIGHT_AMBIENT[i]) * k;
  renderer.lighting.ambient = levelEditor.checked ? EDITOR_AMBIENT : [mix(0), mix(1), mix(2)];
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

/** The player's dome plus a white lens near its rim where the torch shines out. */
function playerDiscs(): Disc[] {
  const [px, py] = player.position;
  const r = player.radius;
  const lens: Disc = {
    position: [px + Math.cos(playerFacing) * 0.6 * r, py + Math.sin(playerFacing) * 0.6 * r],
    radius: 0.3 * r,
    color: [1, 1, 1],
  };
  return [player, lens];
}

/** Point the torch the way the player faces. */
function aimTorch(): void {
  playerLight.cone!.direction = [Math.cos(playerFacing), Math.sin(playerFacing)];
}

function updateWalls(): void {
  walls = splitCrossings([...ARENA_EDGES, ...drawnWalls]);
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

const controls = document.querySelector<HTMLFormElement>("#controls")!;

// With the level editor off, pressing on the canvas sets where the player
// heads, and dragging while pressed steers them.
const levelEditor = input("level-editor");
levelEditor.addEventListener("change", () => {
  wallStart = null;
  moveTarget = null;
  levelEditor.blur(); // so Space throws a flare rather than toggling it
});

canvas.addEventListener("pointerdown", (e) => {
  if (levelEditor.checked || !controls.hidden) return; // nowhere to head while paused
  moveTarget = toWorld(e);
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  pointerLight.position = toWorld(e);
  pointerLight.triangles = visibilityTriangles(pointerLight.position, walls);
  if (canvas.hasPointerCapture(e.pointerId)) moveTarget = pointerLight.position;
});

// Walls snap to a grid, on by default. Its sizes divide the arena evenly, so
// the edges lie on it; the slider picks one of them.
const GRID_SIZES = [10, 20, 25, 50, 100, 125, 200, 250];
const snapToGrid = input("snap-to-grid");
let gridSize = 0; // set from the controls below
snapToGrid.addEventListener("change", () => snapToGrid.blur()); // so Space throws a flare rather than toggling it

/** The nearest grid point to p, if snapping is on. */
function snapped([x, y]: Point): Point {
  if (!snapToGrid.checked) return [x, y];
  return [Math.round(x / gridSize) * gridSize, Math.round(y / gridSize) * gridSize];
}

/** The grid's lines across the whole arena. */
function gridLines(): Segment[] {
  const lines: Segment[] = [];
  for (let k = -1000; k <= 1000; k += gridSize) lines.push(segment([k, -1000], [k, 1000]), segment([-1000, k], [1000, k]));
  return lines;
}

// In the level editor, click once to start a wall, again to finish it.
// Escape abandons it. Hovering over a wall picks it out, and right-clicking
// or pressing Delete removes it.
canvas.addEventListener("click", (e) => {
  if (!levelEditor.checked) return;
  const p = snapped(toWorld(e));
  if (wallStart === null) {
    wallStart = p;
  } else {
    const start = wallStart;
    if (p[0] !== start[0] || p[1] !== start[1]) editWalls(() => drawnWalls.push(segment(start, p)));
    wallStart = null;
  }
});

canvas.addEventListener("contextmenu", (e) => {
  if (!levelEditor.checked) return;
  e.preventDefault();
  deleteHoveredWall();
});

let pointerOnCanvas = false;
canvas.addEventListener("pointerenter", () => (pointerOnCanvas = true));
canvas.addEventListener("pointerleave", () => (pointerOnCanvas = false));

const PENDING_WALL_COLOR: Color = [0.5, 0.5, 0.5];
const HOVERED_WALL_COLOR: Color = [1, 0.25, 0.2];
const HOVER_RANGE = 20; // world units from the pointer within which a wall is picked out

/** The drawn wall nearest the pointer, if it's close enough, in the level editor and not mid-wall. */
function hoveredWall(): Segment | null {
  if (!levelEditor.checked || !pointerOnCanvas || wallStart) return null;
  let nearest: Segment | null = null;
  let best = HOVER_RANGE;
  for (const wall of drawnWalls) {
    const d = distanceToSegment(pointerLight.position, wall);
    if (d < best) [best, nearest] = [d, wall];
  }
  return nearest;
}

function deleteHoveredWall(): void {
  const wall = hoveredWall();
  if (wall) editWalls(() => drawnWalls.splice(drawnWalls.indexOf(wall), 1));
}

// Each edit stores the walls as they were before, for Undo. Kept only until
// the page is reloaded.
const wallHistory: Segment[][] = [];

/** Makes a change to the drawn walls that Undo can take back. */
function editWalls(change: () => void): void {
  wallHistory.push([...drawnWalls]);
  change();
  wallsChanged();
}

/** Stores the drawn walls and brings everything that depends on them up to date. */
function wallsChanged(): void {
  localStorage.setItem(WALLS_KEY, JSON.stringify(drawnWalls));
  updateWalls();
}

/** Abandons the wall being drawn, if there is one, otherwise takes back the last edit. */
function undoWall(): void {
  if (wallStart) {
    wallStart = null;
    return;
  }
  const previous = wallHistory.pop();
  if (!previous) return;
  drawnWalls.splice(0, drawnWalls.length, ...previous);
  wallsChanged();
}

const undoWallButton = document.querySelector<HTMLButtonElement>("#undo-wall")!;
undoWallButton.addEventListener("click", () => {
  undoWall();
  undoWallButton.blur(); // so Space throws a flare rather than pressing it again
});

const clearWallsButton = document.querySelector<HTMLButtonElement>("#clear-walls")!;
clearWallsButton.addEventListener("click", () => {
  wallStart = null;
  if (drawnWalls.length > 0) editWalls(() => (drawnWalls.length = 0));
  clearWallsButton.blur();
});

// Held keys are tracked so movement is per frame, not per key repeat. They
// are physical key codes, so WASD stays in the same place on any layout.
const PLAYER_SPEED = 500; // world units per second
const PLAYER_TURN_RATE = 2 * Math.PI; // radians per second
let playerFacing = Math.PI / 2; // radians; the torch points this way
let moveTarget: Point | null = null; // where a click or tap sent the player
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
  if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey) && levelEditor.checked) {
    undoWall();
    e.preventDefault();
  }
  if ((e.key === "Delete" || e.key === "Backspace") && levelEditor.checked) {
    deleteHoveredWall();
    e.preventDefault();
  }
  if (e.code === "Space") {
    if (!e.repeat) {
      if (!welcomeNotice.hidden) start();
      else if (isGameOver() || won) restart();
      else if (controls.hidden) throwFlare(); // not while paused
    }
    e.preventDefault();
  }
  if (e.code in MOVE_KEYS && !e.ctrlKey && !e.metaKey && !e.altKey) {
    heldKeys.add(e.code);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => heldKeys.delete(e.code));
window.addEventListener("blur", () => heldKeys.clear());

/** The distance from the player to the point. */
function distanceFromPlayer([x, y]: Point): number {
  return Math.hypot(x - player.position[0], y - player.position[1]);
}

/**
 * Turns the player towards the way the keys or the move target want to go.
 * The keys move them that way at once, so the torch swings round after them;
 * towards a target they walk slower the further they still have to turn, so a
 * sharp turn happens mostly on the spot.
 */
function movePlayer(dt: number): void {
  if (!playerAlive) return;
  let dx = 0;
  let dy = 0;
  for (const code of heldKeys) [dx, dy] = [dx + MOVE_KEYS[code][0], dy + MOVE_KEYS[code][1]];
  // Holding W and Up together shouldn't skew a diagonal.
  [dx, dy] = [Math.sign(dx), Math.sign(dy)];
  let remaining = Infinity;
  if (dx !== 0 || dy !== 0) {
    moveTarget = null; // the keys take over
  } else if (moveTarget) {
    remaining = distanceFromPlayer(moveTarget);
    if (remaining < 1) {
      moveTarget = null;
      return;
    }
    [dx, dy] = [moveTarget[0] - player.position[0], moveTarget[1] - player.position[1]];
  } else {
    return;
  }
  const want = Math.atan2(dy, dx);
  const turn = Math.atan2(Math.sin(want - playerFacing), Math.cos(want - playerFacing)); // shortest way round
  const maxTurn = PLAYER_TURN_RATE * dt;
  playerFacing += Math.max(-maxTurn, Math.min(maxTurn, turn));
  const slowdown = moveTarget ? Math.max(0, Math.cos(want - playerFacing)) : 1;
  const distance = Math.min(remaining, PLAYER_SPEED * dt * slowdown);
  // Walls are only lines, so move in steps short enough that the player
  // can't pass through one between checks.
  const steps = Math.ceil(distance / (player.radius / 2));
  const k = distance / steps / Math.hypot(dx, dy);
  const limit = 1000 - player.radius;
  for (let i = 0; i < steps; i++) {
    const [x, y] = pushOutOfWalls([player.position[0] + dx * k, player.position[1] + dy * k], player.radius);
    player.position = [Math.max(-limit, Math.min(limit, x)), Math.max(-limit, Math.min(limit, y))];
  }
  // Give up on a target a wall or the arena edge keeps the player from reaching.
  if (moveTarget && distance > 0 && remaining - distanceFromPlayer(moveTarget) < distance / 4) moveTarget = null;
  followPlayer();
}

/** Brings the torch and glow to the player's position. */
function followPlayer(): void {
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

// Space throws a flare as far as it can reach the way the player faces, if
// they have one left and the last throw has cooled down. It arcs up and first
// lands after the flight time for that distance, bouncing off walls on the way
// and off the floor a few times before settling, and burns with a sputtering
// light that fades out at the end. Enemies are drawn to it like any other light.
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
const FLARE_FADE = 1; // seconds of fading out at the end of the burn
const FLARE_SETTLE_SPEED = 50; // upward speed off the floor below which a flare stops bouncing
// Set from the controls below.
let flareColor: Color = [0, 0, 0];
let flareBurnTime = 0; // seconds
let flareRange = 0; // world units
let flareSpeed = 0; // world units per second across the floor
let flareGravity = 0; // world units per second squared
let flareBounce = 0; // fraction of speed into a wall kept bouncing off it
let flareFloorBounce = 0; // fraction of downward speed kept bouncing off the floor
let flareFloorGrip = 0; // fraction of speed across the floor kept through a floor bounce
let flareCooldown = 0; // seconds between throws

const FLARES_AT_START = 3;
const FLARES_PER_CRATE = 3;
let flaresHeld = FLARES_AT_START;
let flareCooldownLeft = 0; // seconds until the next throw

function throwFlare(): void {
  if (!playerAlive || flareSpeed === 0 || flaresHeld === 0 || flareCooldownLeft > 0) return;
  flaresHeld--;
  flareCooldownLeft = flareCooldown;
  launchFlare(playerFacing, flareRange);
}

/** Dying scatters the flares the player held, lit, short distances every which way. */
function spillFlares(): void {
  if (flareSpeed === 0) return;
  for (; flaresHeld > 0; flaresHeld--) launchFlare(Math.random() * 2 * Math.PI, (0.15 + 0.35 * Math.random()) * flareRange);
}

/** Sends a lit flare from the player the given way, arcing up just enough to first land `range` away. */
function launchFlare(angle: number, range: number): void {
  const flightTime = range / flareSpeed;
  const velocity: Point = [Math.cos(angle) * flareSpeed, Math.sin(angle) * flareSpeed];
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
  flareCooldownLeft = Math.max(0, flareCooldownLeft - dt);
  for (const flare of flares) {
    flare.age += dt;
    if (flare.z > 0 || flare.vz > 0) {
      flyFlare(flare, dt);
      flare.light.position = [Math.round(flare.position[0]), Math.round(flare.position[1])];
      flare.light.triangles = visibilityTriangles(flare.light.position, walls);
      flare.light.height = FLARE_LIGHT_HEIGHT + flare.z;
    }
    const fade = Math.min(1, (flareBurnTime - flare.age) / FLARE_FADE);
    const k = sputter(seconds, flare.seed) * Math.max(0, fade);
    flare.light.color = [flareColor[0] * k, flareColor[1] * k, flareColor[2] * k];
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

// Dying shatters the player into shards that scatter and skid to a halt. They
// glow white hot at first, cooling to plain bodies lit by the scene, so once
// the torch is out they show only in the light of flares.
interface Shard {
  body: Disc;
  velocity: Point; // world units per second
}
const shards: Shard[] = [];
const SHARD_COUNT = 14;
const SHARD_FRICTION = 4; // per second: the fraction of speed lost is 1 - e^(-friction * t)
const SHARD_COOL_TIME = 0.6; // seconds of glowing
const SHARD_COLOR: Color = [0.9, 0.9, 0.9];

function shatterPlayer(): void {
  const [px, py] = player.position;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    const offset = Math.random() * 0.6 * player.radius;
    const speed = 150 + 300 * Math.random();
    const body: Disc = { position: [px + dx * offset, py + dy * offset], radius: 3 + 5 * Math.random(), color: SHARD_COLOR, lit: true };
    shards.push({ body, velocity: [dx * speed, dy * speed] });
  }
}

/** Slides the shards on, stopping any that would cross a wall or the arena edge, and cools their glow. */
function updateShards(dt: number): void {
  const heat = Math.max(0, 1 - deathAge / SHARD_COOL_TIME);
  const slow = Math.exp(-SHARD_FRICTION * dt);
  for (const shard of shards) {
    const { body } = shard;
    const [vx, vy] = shard.velocity;
    const next: Point = [body.position[0] + vx * dt, body.position[1] + vy * dt];
    const limit = 1000 - body.radius;
    const outside = Math.abs(next[0]) > limit || Math.abs(next[1]) > limit;
    if (outside || walls.some((w) => crosses(body.position, next, w))) {
      shard.velocity = [0, 0];
    } else {
      body.position = next;
      shard.velocity = [vx * slow, vy * slow];
    }
    body.emission = [3 * heat, 3 * heat, 3 * heat];
  }
}

// Frame rate, and the average time our code took per frame, over each half
// second. The frame rate tops out at the display's refresh rate; the time is
// only what the CPU spends, as the GPU draws after the frame is handed over.
const fpsOutput = document.querySelector<HTMLOutputElement>("#fps")!;
let fpsSince = performance.now();
let fpsFrames = 0;
let fpsBusy = 0; // ms
function countFrame(start: DOMHighResTimeStamp): void {
  const now = performance.now();
  fpsFrames++;
  fpsBusy += now - start;
  if (now - fpsSince < 500) return;
  fpsOutput.value = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} fps · ${(fpsBusy / fpsFrames).toFixed(1)} ms`;
  [fpsSince, fpsFrames, fpsBusy] = [now, 0, 0];
}

// The HUD counts flares held, greyed while cooling down between throws, and
// coins collected out of all there were. Only changed text is written.
const flaresHeldOutput = document.querySelector<HTMLOutputElement>("#flares-held")!;
const coinsCollectedOutput = document.querySelector<HTMLOutputElement>("#coins-collected")!;
function updateHud(): void {
  const flaresText = String(flaresHeld);
  if (flaresHeldOutput.value !== flaresText) flaresHeldOutput.value = flaresText;
  flaresHeldOutput.classList.toggle("empty", flaresHeld === 0);
  flaresHeldOutput.classList.toggle("cooling", flaresHeld > 0 && flareCooldownLeft > 0);
  const coinsText = `${coinsCollected}/${coinsCollected + coins.length}`;
  if (coinsCollectedOutput.value !== coinsText) coinsCollectedOutput.value = coinsText;
  gameOverNotice.hidden = !isGameOver();
  levelClearedNotice.hidden = !won;
}

// Once the dead player's torch has sputtered out, the game is over until
// Space, or a tap on the notice, starts it again.
const gameOverNotice = document.querySelector<HTMLDivElement>("#game-over")!;
function isGameOver(): boolean {
  return !playerAlive && deathAge >= TORCH_DEATH_TIME;
}
gameOverNotice.addEventListener("click", restart);

// Once the level is won, play carries on until Space, or a tap on the
// notice, starts it again.
const levelClearedNotice = document.querySelector<HTMLDivElement>("#level-cleared")!;
levelClearedNotice.addEventListener("click", restart);

// The game waits, paused, behind the welcome notice until Space, or a tap on
// the notice, starts it.
const welcomeNotice = document.querySelector<HTMLDivElement>("#welcome")!;
function start(): void {
  welcomeNotice.hidden = true;
}
welcomeNotice.addEventListener("click", start);

// Flares sputter and things move every frame, so render continuously rather
// than on input. The game is paused while the welcome notice or the settings are up: its clock
// stands still, but it still renders so walls being drawn show up.
let lastTime: DOMHighResTimeStamp | null = null;
let seconds = 0; // game time, which doesn't run while paused
function draw(time: DOMHighResTimeStamp): void {
  const start = performance.now();
  const paused = !controls.hidden || !welcomeNotice.hidden;
  const dt = lastTime === null || paused ? 0 : Math.min((time - lastTime) / 1000, 0.1); // cap after a paused tab
  seconds += dt;
  movePlayer(dt);
  const torchLit = updateTorch(dt, seconds);
  updateFlares(dt, seconds);
  updateShards(dt);
  updateCoins(seconds);
  updateCrates();
  updateAmbient(dt);
  lastTime = time;
  const lights = [pointerLight, ...(torchLit ? [playerLight, playerGlow] : []), ...flares.map((f) => f.light)];
  for (const enemy of enemies) moveEnemy(enemy, dt, lights);
  if (playerAlive && !won && enemies.some((e) => touchesPlayer(e.body))) killPlayer();
  const hovered = hoveredWall();
  const marks: Mark[] = [
    ...(wallStart ? [{ segment: segment(wallStart, snapped(pointerLight.position)), color: PENDING_WALL_COLOR }] : []),
    ...(hovered ? [{ segment: hovered, color: HOVERED_WALL_COLOR }] : []),
  ];
  const grid = levelEditor.checked && snapToGrid.checked ? gridLines() : [];
  const discs = [
    ...coins.map((c) => c.body),
    ...crates.flatMap(crateDiscs),
    ...(playerAlive ? playerDiscs() : []),
    ...shards.map((s) => s.body),
    ...enemies.flatMap(enemyDiscs),
    ...flares.map(flareDisc),
  ];
  renderer.render(walls, lights, marks, discs, grid);
  updateHud();
  countFrame(start);
  requestAnimationFrame(draw);
}

function input(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${id}`)!;
}

/**
 * Wires a slider to a setter, echoing its value into the matching <output>,
 * or what `show` makes of it.
 */
function slider(id: string, set: (value: number) => void, show: (value: number) => string = String): void {
  const el = input(id);
  const out = document.querySelector<HTMLOutputElement>(`output[for=${id}]`)!;
  const update = () => {
    set(el.valueAsNumber);
    out.value = show(el.valueAsNumber);
  };
  el.addEventListener("input", update);
  update();
}

// Settings start from their stored values, so restore those before wiring
// them up, and store them again whenever one changes. The level editor
// itself is left out, so the game always starts in play.
const settingInputs = [...controls.querySelectorAll<HTMLInputElement>("input:not(#level-editor)")];
const settingValue = (el: HTMLInputElement) => (el.type === "checkbox" ? el.checked : el.value);
const storedSettings = loadStored<Record<string, string | boolean>>(SETTINGS_KEY, {});
for (const el of settingInputs) {
  const stored = storedSettings[el.id];
  if (typeof stored === "boolean") el.checked = stored;
  else if (stored !== undefined) el.value = stored;
}
controls.addEventListener("input", () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(settingInputs.map((el) => [el.id, settingValue(el)]))));
});

slider("light-height", (v) => (renderer.lighting.lightHeight = v));
slider("falloff-rate", (v) => (renderer.lighting.falloffRate = v));
slider("glow-brightness", (v) => {
  const [r, g, b] = PLAYER_GLOW_COLOR;
  glowColor = [r * v, g * v, b * v];
});
slider("glow-height", (v) => (playerGlow.height = v));
slider("glow-falloff", (v) => (playerGlow.falloffRate = v));
slider("beam-width", (v) => (beamHalfAngle = (v / 2) * (Math.PI / 180))); // degrees, edge to edge
slider("flare-burn-time", (v) => (flareBurnTime = v));
slider("flare-range", (v) => (flareRange = v));
slider("flare-speed", (v) => (flareSpeed = v));
slider("flare-gravity", (v) => (flareGravity = v));
slider("flare-bounce", (v) => (flareBounce = v));
slider("flare-floor-bounce", (v) => (flareFloorBounce = v));
slider("flare-floor-grip", (v) => (flareFloorGrip = v));
slider("flare-cooldown", (v) => (flareCooldown = v));
slider("enemy-count", setEnemyCount);
slider("enemy-avoid-range", (v) => (enemyAvoidRange = v));
slider("enemy-avoid-strength", (v) => (enemyAvoidStrength = v));
slider("enemy-threshold", (v) => (enemyLightThreshold = v));
slider("coin-count", setCoinCount);
slider("coin-shimmer", (v) => (coinShimmer = v));
slider("crate-count", setCrateCount);
slider("grid-size", (v) => (gridSize = GRID_SIZES[v]), (v) => String(GRID_SIZES[v]));

/** A colour picker's value, scaled by k (a picker can't exceed 1). */
function pickedColor(id: string, k = 1): Color {
  const hex = parseInt(input(id).value.slice(1), 16);
  return [(((hex >> 16) & 255) / 255) * k, (((hex >> 8) & 255) / 255) * k, ((hex & 255) / 255) * k];
}

/** Wires a colour picker alone to a colour setter. */
function colorPicker(id: string, set: (color: Color) => void): void {
  const update = () => set(pickedColor(id));
  input(id).addEventListener("input", update);
  update();
}

/**
 * Wires a colour picker and a brightness slider to a light colour setter. A
 * colour picker can't exceed 1, so brightness comes from the slider.
 */
function colorControl(colorId: string, brightnessId: string, set: (color: Color) => void): void {
  const update = () => set(pickedColor(colorId, input(brightnessId).valueAsNumber));
  input(colorId).addEventListener("input", update);
  slider(brightnessId, update);
}

colorControl("pointer-color", "pointer-intensity", (c) => (pointerLight.color = c));
colorControl("torch-color", "torch-brightness", (c) => (torchColor = c));
colorControl("flare-color", "flare-brightness", (c) => (flareColor = c));
colorControl("coin-emission-color", "coin-emission", (c) => (coinEmission = c));
colorPicker("coin-color", (c) => (coinColor = c));

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

/** Wires a button to copy the text `text` gives, showing on the button whether it worked. */
function copyButton(button: HTMLButtonElement, text: () => string): void {
  const label = button.textContent;
  button.addEventListener("click", async (e) => {
    e.preventDefault(); // don't open or close the section
    let result;
    try {
      await copyText(text());
      result = "Copied";
    } catch {
      result = "Copy failed";
    }
    button.textContent = result;
    setTimeout(() => (button.textContent = label), 1500);
    button.blur(); // so Space throws a flare rather than pressing it again
  });
}

// Each section's Copy button copies its controls' values as JSON, keyed by
// input id; the one below all the sections copies every control.
for (const button of document.querySelectorAll<HTMLButtonElement>("#controls .copy")) {
  const scope = button.closest("details") ?? document.querySelector("#controls")!;
  copyButton(button, () => {
    const inputs = [...scope.querySelectorAll<HTMLInputElement>("input")];
    return JSON.stringify(Object.fromEntries(inputs.map((el) => [el.id, el.type === "range" ? el.valueAsNumber : el.value])), null, 2);
  });
}

// Copies the drawn walls as JSON, one wall to a line, in the form they're stored in.
copyButton(document.querySelector<HTMLButtonElement>("#copy-walls")!, () => `[\n${drawnWalls.map((w) => `  ${JSON.stringify(w)}`).join(",\n")}\n]`);

/**
 * Brings the player back at the start with a fresh stock of flares, clears
 * the thrown ones and any shards, and deals fresh enemies, coins and crates.
 * Walls stay as drawn.
 */
function restart(): void {
  playerAlive = true;
  playerFacing = Math.PI / 2;
  moveTarget = null;
  player.position = pushOutOfWalls(PLAYER_START, player.radius);
  followPlayer();
  flares.length = 0;
  shards.length = 0;
  flaresHeld = FLARES_AT_START;
  flareCooldownLeft = 0;
  // Counts come from the sliders, as collecting coins and crates leaves fewer than set.
  enemies.length = 0;
  coins.length = 0;
  crates.length = 0;
  setEnemyCount(input("enemy-count").valueAsNumber);
  setCoinCount(input("coin-count").valueAsNumber);
  setCrateCount(input("crate-count").valueAsNumber);
  coinsCollected = 0;
  coinGlowAge = Infinity;
  won = false;
  wonAge = 0;
}

const settingsToggle = document.querySelector<HTMLButtonElement>("#settings-toggle")!;
settingsToggle.addEventListener("click", () => {
  controls.hidden = !controls.hidden;
  // The level editor is only for while paused, so play resumes out of it.
  if (controls.hidden && levelEditor.checked) {
    levelEditor.checked = false;
    levelEditor.dispatchEvent(new Event("change"));
  }
  settingsToggle.blur(); // so Space throws a flare rather than pressing it again
});

// Puts every setting back to its value in the page, as if nothing were stored.
const resetSettingsButton = document.querySelector<HTMLButtonElement>("#reset-settings")!;
resetSettingsButton.addEventListener("click", () => {
  for (const el of settingInputs) {
    el.value = el.defaultValue;
    el.checked = el.defaultChecked;
    el.dispatchEvent(new Event("input", { bubbles: true })); // applies and stores it
  }
  resetSettingsButton.blur();
});

const restartButton = document.querySelector<HTMLButtonElement>("#restart")!;
restartButton.addEventListener("click", () => {
  restart();
  restartButton.blur(); // so Space throws a flare rather than pressing it again
});

requestAnimationFrame(draw);
