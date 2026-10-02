/** WebGL2 rendering of light visibility polygons over walls. */

import { type Point, type Segment } from "./raylighting";

export type Color = readonly [number, number, number];

/** Restricts a light to a wedge of directions, like a torch beam. */
export interface Cone {
  /** Unit vector the beam points along. */
  direction: Point;
  /** Angle from the centre line to the beam edge, in radians. */
  halfAngle: number;
}

export interface Light {
  position: Point;
  color: Color;
  /** Visibility triangles from the sweep; the caller keeps them in step with position and walls. */
  triangles: Float32Array;
  /** Omitted for an omnidirectional light. */
  cone?: Cone;
  /** Overrides LightingParams.lightHeight for this light. */
  height?: number;
  /** Overrides LightingParams.falloffRate for this light. */
  falloffRate?: number;
}

/** Fraction of the cone's half-angle over which the beam edge fades. */
const CONE_EDGE_SOFTNESS = 0.15;

/** Walls are white, but a little below 1 so bright lights don't flatten them. */
const WALL_ALBEDO = 0.8;

/** How much of the grid shows over the scene. */
const GRID_OPACITY = 0.2;

const SURFACE_FLOOR = 0;
const SURFACE_WALL = 1;
const SURFACE_DISC = 2;

// Floor lighting follows the Haskell scene shader: each light sits above the
// plane, falls off with distance and shades the normal-mapped texture. Walls
// use the same lighting on a plain white vertical face, turned towards the
// light and taken at the light's height; only the side the light can see is
// ever drawn lit. Lit discs are shaded as domes rising out of the floor, or
// as flat-topped boxes with bevelled edges.
const LIT_VERTEX_SHADER = `#version 300 es
in vec2 in_pos;
in vec2 in_normal;
uniform float scale;
uniform float depth;
out vec2 world_pos;
flat out vec2 wall_normal;
void main() {
  world_pos = in_pos;
  wall_normal = in_normal;
  gl_Position = vec4(in_pos * scale, depth, 1.0);
}`;

const LIT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 world_pos;
flat in vec2 wall_normal;
uniform sampler2D albedo;
uniform sampler2D normal_map;
uniform float tile_size;
uniform vec3 light_pos;
uniform vec3 light_color;
uniform vec3 ambient;
uniform float falloff_rate;
uniform int surface;
uniform vec3 disc; // centre and radius of a lit disc
uniform vec2 disc_box; // half-size of a box, or zero for a dome
uniform vec3 disc_albedo;
uniform vec3 disc_emission; // added once, in the ambient pass, dimming towards the rim
// Beam cone: cos of the half-angle where the beam is full, and where it has
// faded to nothing. cone_outer <= -1 means omnidirectional.
uniform vec2 cone_dir;
uniform float cone_inner;
uniform float cone_outer;
out vec4 frag_color;
void main() {
  vec2 uv = world_pos / tile_size;
  vec3 d = light_pos - vec3(world_pos, 0.0);
  float beam = 1.0;
  if (cone_outer > -1.0) {
    float c = dot(normalize(-d.xy), cone_dir);
    beam = smoothstep(cone_outer, cone_inner, c);
  }
  vec3 base;
  vec3 n;
  if (surface == ${SURFACE_WALL}) {
    base = vec3(${WALL_ALBEDO});
    n = vec3(dot(wall_normal, d.xy) < 0.0 ? -wall_normal : wall_normal, 0.0);
    // Shade the wall where it faces the light head-on, level with it; at
    // floor level a close light would only graze the face and it would darken.
    d.z = 0.0;
  } else if (surface == ${SURFACE_DISC}) {
    base = disc_albedo;
    if (disc_box.x > 0.0) {
      vec2 o = (world_pos - disc.xy) / disc_box;
      n = normalize(vec3(sign(o) * smoothstep(0.7, 1.0, abs(o)), 1.0));
    } else {
      vec2 o = (world_pos - disc.xy) / disc.z;
      n = vec3(o, sqrt(max(0.0, 1.0 - dot(o, o))));
    }
  } else {
    base = texture(albedo, uv).rgb;
    n = normalize(2.0 * texture(normal_map, uv).rgb - 1.0);
  }
  float falloff = 1.0 / (1.0 + falloff_rate * length(d));
  float lambert = max(dot(normalize(d), n), 0.0);
  vec3 emission = surface == ${SURFACE_DISC} ? disc_emission * (0.5 + 0.5 * n.z) : vec3(0.0);
  frag_color = vec4(base * (ambient + beam * falloff * lambert * light_color) + emission, 1.0);
}`;

const FLAT_VERTEX_SHADER = `#version 300 es
in vec2 in_pos;
uniform float scale;
void main() {
  gl_Position = vec4(in_pos * scale, 0.0, 1.0);
}`;

const FLAT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec3 color;
out vec4 frag_color;
void main() {
  frag_color = vec4(color, 1.0);
}`;

/** World units covered by one repeat of the floor texture. */
const TILE_SIZE = 400;
const POS_LOC = 0;
const NORMAL_LOC = 1;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, POS_LOC, "in_pos");
  gl.bindAttribLocation(program, NORMAL_LOC, "in_normal");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

async function loadTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function insideTriangles([px, py]: Point, triangles: Float32Array): boolean {
  const edge = (ax: number, ay: number, bx: number, by: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  for (let i = 0; i < triangles.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = triangles.subarray(i, i + 6);
    const e1 = edge(ax, ay, bx, by);
    const e2 = edge(bx, by, cx, cy);
    const e3 = edge(cx, cy, ax, ay);
    if ((e1 >= 0 && e2 >= 0 && e3 >= 0) || (e1 <= 0 && e2 <= 0 && e3 <= 0)) return true;
  }
  return false;
}

/** Two triangles per wall, thickened perpendicular to its direction. */
export function wallQuads(walls: Segment[], thickness = 6): Float32Array {
  const verts: number[] = [];
  for (const { start: [x1, y1], end: [x2, y2] } of walls) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * thickness;
    const ny = (dx / len) * thickness;
    verts.push(
      x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny,
      x1 + nx, y1 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny,
    );
  }
  return Float32Array.from(verts);
}

/** A triangle fan around the centre, flattened into independent triangles. */
export function circleFan(center: Point, radius: number, sides = 32): Float32Array {
  const verts: number[] = [];
  const [cx, cy] = center;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * 2 * Math.PI;
    const a1 = ((i + 1) / sides) * 2 * Math.PI;
    verts.push(cx, cy, cx + radius * Math.cos(a0), cy + radius * Math.sin(a0), cx + radius * Math.cos(a1), cy + radius * Math.sin(a1));
  }
  return Float32Array.from(verts);
}

/** An axis-aligned rectangle as two triangles. */
function rectangle([cx, cy]: Point, [hx, hy]: Point): Float32Array {
  const [x0, y0, x1, y1] = [cx - hx, cy - hy, cx + hx, cy + hy];
  return Float32Array.from([x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1]);
}

/** Unit perpendicular of each wall, repeated for the six vertices of its quad. */
function wallNormals(walls: Segment[]): Float32Array {
  const normals: number[] = [];
  for (const { start: [x1, y1], end: [x2, y2] } of walls) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = 0; i < 6; i++) normals.push(-(y2 - y1) / len, (x2 - x1) / len);
  }
  return Float32Array.from(normals);
}

// Stencil bits: WALL marks wall and lit disc pixels for the whole frame; SEEN
// marks those pixels inside the current light's visibility triangles.
const WALL = 1;
const SEEN = 2;

export interface Disc {
  position: Point;
  radius: number;
  color: Color;
  /** Shade the disc with the scene's lights, using `color` as its albedo; otherwise draw it flat on top. */
  lit?: boolean;
  /** Light a lit disc gives off itself, on top of what the scene's lights show of it. */
  emission?: Color;
  /**
   * Half-width and half-height: draws an axis-aligned box instead of a
   * circle, lit ones flat-topped with bevelled edges. `radius` still serves
   * for collisions.
   */
  box?: Point;
}

export interface LightingParams {
  /** Height of lights above the floor, in world units. */
  lightHeight: number;
  /** Distance falloff per world unit: 1 / (1 + rate * distance). */
  falloffRate: number;
  /** Light reaching everywhere, shadowed or not. */
  ambient: Color;
}

export class Renderer {
  /** Read on every render, so changes take effect on the next frame. */
  readonly lighting: LightingParams = { lightHeight: 200, falloffRate: 0.005, ambient: [0.02, 0.02, 0.05] };
  private readonly gl: WebGL2RenderingContext;
  private readonly lit: WebGLProgram;
  private readonly flat: WebGLProgram;
  private readonly litLocs: Record<
    "scale" | "lightPos" | "lightColor" | "ambient" | "falloffRate" | "depth" | "surface" | "disc" | "discBox" | "discAlbedo" | "discEmission" | "coneDir" | "coneInner" | "coneOuter",
    WebGLUniformLocation
  >;
  private readonly flatLocs: Record<"scale" | "color", WebGLUniformLocation>;
  private readonly buffer: WebGLBuffer;
  private readonly normalBuffer: WebGLBuffer;
  private readonly canvas: HTMLCanvasElement;
  private readonly worldExtent: number;
  private readonly floor: Float32Array;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    albedo: WebGLTexture,
    normalMap: WebGLTexture,
    worldExtent: number,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.worldExtent = worldExtent;
    const e = worldExtent;
    this.floor = Float32Array.from([-e, -e, e, -e, e, e, -e, -e, e, e, -e, e]);

    this.lit = link(gl, LIT_VERTEX_SHADER, LIT_FRAGMENT_SHADER);
    const litLoc = (name: string) => gl.getUniformLocation(this.lit, name)!;
    this.litLocs = {
      scale: litLoc("scale"),
      lightPos: litLoc("light_pos"),
      lightColor: litLoc("light_color"),
      ambient: litLoc("ambient"),
      falloffRate: litLoc("falloff_rate"),
      depth: litLoc("depth"),
      surface: litLoc("surface"),
      disc: litLoc("disc"),
      discBox: litLoc("disc_box"),
      discAlbedo: litLoc("disc_albedo"),
      discEmission: litLoc("disc_emission"),
      coneDir: litLoc("cone_dir"),
      coneInner: litLoc("cone_inner"),
      coneOuter: litLoc("cone_outer"),
    };
    gl.useProgram(this.lit);
    gl.uniform1f(litLoc("tile_size"), TILE_SIZE);
    gl.uniform1i(litLoc("albedo"), 0);
    gl.uniform1i(litLoc("normal_map"), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, albedo);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, normalMap);

    this.flat = link(gl, FLAT_VERTEX_SHADER, FLAT_FRAGMENT_SHADER);
    this.flatLocs = {
      scale: gl.getUniformLocation(this.flat, "scale")!,
      color: gl.getUniformLocation(this.flat, "color")!,
    };

    this.normalBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.vertexAttribPointer(NORMAL_LOC, 2, gl.FLOAT, false, 0, 0);

    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(POS_LOC);
    gl.vertexAttribPointer(POS_LOC, 2, gl.FLOAT, false, 0, 0);
  }

  static async create(canvas: HTMLCanvasElement, worldExtent = 1000): Promise<Renderer> {
    const gl = canvas.getContext("webgl2", { antialias: false, stencil: true, depth: true });
    if (!gl) throw new Error("WebGL2 is not available");
    const base = import.meta.env.BASE_URL;
    const [albedo, normalMap] = await Promise.all([
      loadTexture(gl, `${base}textures/floor.png`),
      loadTexture(gl, `${base}textures/floor_norm.png`),
    ]);
    return new Renderer(canvas, gl, albedo, normalMap, worldExtent);
  }

  private draw(verts: Float32Array): void {
    if (verts.length === 0) return;
    const gl = this.gl;
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
  }

  private drawWalls(verts: Float32Array): void {
    this.gl.enableVertexAttribArray(NORMAL_LOC);
    this.draw(verts);
    this.gl.disableVertexAttribArray(NORMAL_LOC);
  }

  /**
   * Later discs sit in front of earlier ones. The ambient pass draws with
   * LESS to record the front-most disc at each pixel; light passes draw with
   * EQUAL so only that disc is lit (and clears SEEN), not those behind it.
   */
  /**
   * How brightly a light shows on a white surface at the point turned to face
   * it, following the shader; 0 where the light can't see the point. Facing
   * the light matters: a distant light grazes the flat floor, but still
   * fully lights the near side of a dome or a bump in the floor texture.
   */
  brightnessAt({ position, color, triangles, cone, height, falloffRate }: Light, point: Point): number {
    if (!insideTriangles(point, triangles)) return 0;
    const dx = point[0] - position[0];
    const dy = point[1] - position[1];
    const h = height ?? this.lighting.lightHeight;
    const distance = Math.hypot(dx, dy, h);
    let beam = 1;
    if (cone) {
      const flat = Math.hypot(dx, dy);
      const c = flat > 0 ? (dx * cone.direction[0] + dy * cone.direction[1]) / flat : 1;
      beam = smoothstep(Math.cos(cone.halfAngle), Math.cos(cone.halfAngle * (1 - CONE_EDGE_SOFTNESS)), c);
    }
    const falloff = 1 / (1 + (falloffRate ?? this.lighting.falloffRate) * distance);
    return Math.max(...color) * beam * falloff;
  }

  /** Emission goes in only with the ambient pass, so the light passes don't add it again. */
  private drawLitDiscs(discs: Disc[], depthFunc: GLenum, emit: boolean): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(depthFunc);
    gl.uniform1i(this.litLocs.surface, SURFACE_DISC);
    discs.forEach(({ position, radius, color, emission, box }, i) => {
      gl.uniform1f(this.litLocs.depth, -(i + 1) / (discs.length + 1));
      gl.uniform3f(this.litLocs.disc, position[0], position[1], radius);
      gl.uniform2f(this.litLocs.discBox, ...(box ?? [0, 0]));
      gl.uniform3f(this.litLocs.discAlbedo, ...color);
      gl.uniform3f(this.litLocs.discEmission, ...(emit && emission ? emission : ([0, 0, 0] as Color)));
      this.draw(box ? rectangle(position, box) : circleFan(position, radius));
    });
    gl.uniform1f(this.litLocs.depth, 0);
    gl.disable(gl.DEPTH_TEST);
  }

  /** `grid` lines are drawn faintly over the scene, beneath the wall being drawn and the unlit discs. */
  render(walls: Segment[], lights: Light[], pending: Segment | null = null, discs: Disc[] = [], grid: Segment[] = []): void {
    const gl = this.gl;
    const scale = 1 / this.worldExtent;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const wallVerts = wallQuads(walls);
    const litDiscs = discs.filter((d) => d.lit);
    // Wall normals don't change between light passes, so upload them once.
    // Only the wall draws enable the attribute; the floor ignores it.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, wallNormals(walls), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    // Ambient pass covers the whole floor, then the walls and lit discs over
    // it, marking their pixels so the floor lighting below leaves them alone.
    gl.useProgram(this.lit);
    gl.uniform1f(this.litLocs.scale, scale);
    gl.uniform1f(this.litLocs.falloffRate, this.lighting.falloffRate);
    gl.uniform3f(this.litLocs.ambient, ...this.lighting.ambient);
    gl.uniform3f(this.litLocs.lightColor, 0, 0, 0);
    gl.uniform1i(this.litLocs.surface, SURFACE_FLOOR);
    this.draw(this.floor);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, WALL, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.uniform1i(this.litLocs.surface, SURFACE_WALL);
    this.drawWalls(wallVerts);
    this.drawLitDiscs(litDiscs, gl.LESS, true);

    // Each light adds its contribution over just the triangles it can see.
    // The sweep stops at wall centre lines, so the triangles reach over the
    // near half of each visible wall: those pixels fail the floor's stencil
    // test and get marked SEEN instead, then the wall pass lights and clears
    // them. Lit discs don't block light; they are lit and cleared the same way.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform3f(this.litLocs.ambient, 0, 0, 0);
    gl.stencilMask(SEEN);
    for (const { position, color, triangles, cone, height, falloffRate } of lights) {
      if (Math.max(...color) <= 0) continue; // a light turned off costs nothing
      gl.uniform3f(this.litLocs.lightPos, position[0], position[1], height ?? this.lighting.lightHeight);
      gl.uniform1f(this.litLocs.falloffRate, falloffRate ?? this.lighting.falloffRate);
      gl.uniform3f(this.litLocs.lightColor, ...color);
      if (cone) {
        gl.uniform2f(this.litLocs.coneDir, cone.direction[0], cone.direction[1]);
        gl.uniform1f(this.litLocs.coneInner, Math.cos(cone.halfAngle * (1 - CONE_EDGE_SOFTNESS)));
        gl.uniform1f(this.litLocs.coneOuter, Math.cos(cone.halfAngle));
      } else {
        gl.uniform1f(this.litLocs.coneOuter, -1);
      }
      gl.uniform1i(this.litLocs.surface, SURFACE_FLOOR);
      gl.stencilFunc(gl.EQUAL, SEEN, WALL);
      gl.stencilOp(gl.REPLACE, gl.KEEP, gl.KEEP);
      this.draw(triangles);
      gl.uniform1i(this.litLocs.surface, SURFACE_WALL);
      gl.stencilFunc(gl.EQUAL, WALL | SEEN, WALL | SEEN);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
      this.drawWalls(wallVerts);
      this.drawLitDiscs(litDiscs, gl.EQUAL, false);
    }
    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);

    gl.useProgram(this.flat);
    gl.uniform1f(this.flatLocs.scale, scale);
    if (grid.length > 0) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, GRID_OPACITY);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      gl.uniform3f(this.flatLocs.color, 1, 1, 1);
      this.draw(wallQuads(grid, 1));
      gl.disable(gl.BLEND);
    }
    if (pending) {
      gl.uniform3f(this.flatLocs.color, 0.5, 0.5, 0.5);
      this.draw(wallQuads([pending]));
    }
    for (const { position, radius, color, lit, box } of discs) {
      if (lit) continue;
      gl.uniform3f(this.flatLocs.color, ...color);
      this.draw(box ? rectangle(position, box) : circleFan(position, radius));
    }
  }
}
