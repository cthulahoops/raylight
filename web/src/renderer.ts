/** WebGL2 rendering of light visibility polygons over walls. */

import { type Point, type Segment, visibilityTriangles } from "./raylighting";

export type Color = readonly [number, number, number];

export interface Light {
  position: Point;
  color: Color;
}

const VERTEX_SHADER = `#version 300 es
in vec2 in_pos;
uniform float scale;
void main() {
  gl_Position = vec4(in_pos * scale, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec3 color;
out vec4 frag_color;
void main() {
  frag_color = vec4(color, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
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

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly colorLoc: WebGLUniformLocation;
  private readonly scaleLoc: WebGLUniformLocation;
  private readonly buffer: WebGLBuffer;
  private readonly canvas: HTMLCanvasElement;
  private readonly worldExtent: number;

  constructor(canvas: HTMLCanvasElement, worldExtent = 1000) {
    this.canvas = canvas;
    this.worldExtent = worldExtent;
    const gl = canvas.getContext("webgl2", { antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    this.colorLoc = gl.getUniformLocation(program, "color")!;
    this.scaleLoc = gl.getUniformLocation(program, "scale")!;

    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const posLoc = gl.getAttribLocation(program, "in_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  }

  private draw(verts: Float32Array, color: Color): void {
    if (verts.length === 0) return;
    const gl = this.gl;
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.uniform3f(this.colorLoc, color[0], color[1], color[2]);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
  }

  render(walls: Segment[], lights: Light[], pending: Segment | null = null): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.uniform1f(this.scaleLoc, 1 / this.worldExtent);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Lights add together where their visibility polygons overlap.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const { position, color } of lights) {
      this.draw(visibilityTriangles(position, walls), color);
    }

    gl.disable(gl.BLEND);
    this.draw(wallQuads(walls), [1, 1, 1]);
    if (pending) this.draw(wallQuads([pending]), [0.5, 0.5, 0.5]);
  }
}
