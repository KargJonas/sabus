import SharedRuntime from "../../shared-runtime.js";

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;

const VERTEX_SHADER_SOURCE = `#version 300 es
const vec2 positions[4] = vec2[4](
  vec2(-1.0, -1.0),
  vec2(1.0, -1.0),
  vec2(-1.0, 1.0),
  vec2(1.0, 1.0)
);
out vec2 vUv;
void main() {
  vec2 p = positions[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

const mustGetCanvas = (): HTMLCanvasElement => {
  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing canvas element");
  return canvas;
};

const mustGetWebGL2 = (canvas: HTMLCanvasElement): WebGL2RenderingContext => {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 is required");
  return gl;
};

const createShader = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compilation failed");
  }
  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create WebGL program");

  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
  }
  return program;
};

const bindFullscreenQuad = (gl: WebGL2RenderingContext): void => {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Failed to create vertex array");
  gl.bindVertexArray(vao);
};

const createTexture = (gl: WebGL2RenderingContext, program: WebGLProgram): WebGLTexture => {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to create texture");

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const textureUniform = gl.getUniformLocation(program, "uTex");
  if (!textureUniform) throw new Error("Missing uTex uniform");
  gl.uniform1i(textureUniform, 0);

  return texture;
};

const canvas = mustGetCanvas();
const gl = mustGetWebGL2(canvas);

// Set up a minimal renderer that draws one fullscreen quad from a texture.
const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
gl.useProgram(program);
bindFullscreenQuad(gl);
const texture = createTexture(gl, program);

const resize = (): void => {
  const width = Math.max(1, Math.floor(window.innerWidth));
  const height = Math.max(1, Math.floor(window.innerHeight));
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
};

window.addEventListener("resize", resize);
resize();

// Set everything up:
//  - Create shared runtime
//  - Create raw byte buffer for RGBA pixels
//  - Spawn worker that writes frames into the shared buffer
const rt = SharedRuntime.host();
// One frame = width * height pixels, RGBA8 = 4 bytes per pixel.
// We allocate exactly one frame worth of bytes in each shared slot.
const pixels = rt.createSharedObject("pixels", { byteLength: FRAME_WIDTH * FRAME_HEIGHT * 4 });

await rt.spawnWorker(new URL("./pixel-writer.worker.js", import.meta.url).href, "pixel-writer");

// Render whenever a new frame is published.
const renderLatestFrame = (): void => {
  const snap = pixels.readLatest();
  if (!snap) return;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    snap.bytes,
  );
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

pixels.subscribe(renderLatestFrame);
