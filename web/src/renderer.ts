/** WebGL2 rendering of light visibility polygons over walls. */

import { type Point, type Segment, visibilityTriangles } from "./raylighting";

export type Color = readonly [number, number, number];

export interface Light {
  position: Point;
  color: Color;
  /** Precomputed visibility triangles; skips the sweep for lights that don't move. */
  triangles?: Float32Array;
}

// Floor lighting follows the Haskell scene shader: each light sits above the
// plane, falls off with distance and shades the normal-mapped texture.
const LIT_VERTEX_SHADER = `#version 300 es
in vec2 in_pos;
uniform float scale;
out vec2 world_pos;
void main() {
  world_pos = in_pos;
  gl_Position = vec4(in_pos * scale, 0.0, 1.0);
}`;

const LIT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 world_pos;
uniform sampler2D albedo;
uniform sampler2D normal_map;
uniform float tile_size;
uniform vec3 light_pos;
uniform vec3 light_color;
uniform vec3 ambient;
uniform float falloff_rate;
out vec4 frag_color;
void main() {
  vec2 uv = world_pos / tile_size;
  vec3 base = texture(albedo, uv).rgb;
  vec3 n = normalize(2.0 * texture(normal_map, uv).rgb - 1.0);
  vec3 d = light_pos - vec3(world_pos, 0.0);
  float falloff = 1.0 / (1.0 + falloff_rate * length(d));
  float lambert = max(dot(normalize(d), n), 0.0);
  frag_color = vec4(base * (ambient + falloff * lambert * light_color), 1.0);
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

const AMBIENT: Color = [0.02, 0.02, 0.05];
/** Height of lights above the floor, in world units. */
const LIGHT_HEIGHT = 200;
/** Distance falloff per world unit: 1 / (1 + rate * distance). */
const FALLOFF_RATE = 0.005;
/** World units covered by one repeat of the floor texture. */
const TILE_SIZE = 400;
const POS_LOC = 0;

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

/** Evenly bright colour with the given hue in [0, 1). Saturation and lightness fixed. */
function hueColor(hue: number, saturation = 0.8, lightness = 0.6): Color {
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Deterministic pseudo-random hue per wall index, so colours are stable across frames. */
function wallHue(index: number): number {
  let h = (index + 1) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly lit: WebGLProgram;
  private readonly flat: WebGLProgram;
  private readonly litLocs: Record<"scale" | "lightPos" | "lightColor" | "ambient", WebGLUniformLocation>;
  private readonly flatLocs: Record<"scale" | "color", WebGLUniformLocation>;
  private readonly buffer: WebGLBuffer;
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
    };
    gl.useProgram(this.lit);
    gl.uniform1f(litLoc("tile_size"), TILE_SIZE);
    gl.uniform1f(litLoc("falloff_rate"), FALLOFF_RATE);
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

    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(POS_LOC);
    gl.vertexAttribPointer(POS_LOC, 2, gl.FLOAT, false, 0, 0);
  }

  static async create(canvas: HTMLCanvasElement, worldExtent = 1000): Promise<Renderer> {
    const gl = canvas.getContext("webgl2", { antialias: false });
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

  render(walls: Segment[], lights: Light[], pending: Segment | null = null): void {
    const gl = this.gl;
    const scale = 1 / this.worldExtent;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Ambient pass covers the whole floor; each light then adds its own
    // contribution over just the triangles it can see.
    gl.useProgram(this.lit);
    gl.uniform1f(this.litLocs.scale, scale);
    gl.uniform3f(this.litLocs.ambient, ...AMBIENT);
    gl.uniform3f(this.litLocs.lightColor, 0, 0, 0);
    this.draw(this.floor);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform3f(this.litLocs.ambient, 0, 0, 0);
    for (const { position, color, triangles } of lights) {
      gl.uniform3f(this.litLocs.lightPos, position[0], position[1], LIGHT_HEIGHT);
      gl.uniform3f(this.litLocs.lightColor, ...color);
      this.draw(triangles ?? visibilityTriangles(position, walls));
    }
    gl.disable(gl.BLEND);

    gl.useProgram(this.flat);
    gl.uniform1f(this.flatLocs.scale, scale);
    walls.forEach((wall, i) => {
      gl.uniform3f(this.flatLocs.color, ...hueColor(wallHue(i)));
      this.draw(wallQuads([wall]));
    });
    if (pending) {
      gl.uniform3f(this.flatLocs.color, 0.5, 0.5, 0.5);
      this.draw(wallQuads([pending]));
    }
  }
}
