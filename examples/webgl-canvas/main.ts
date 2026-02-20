import SharedRuntime from "../../shared-runtime.js";

const WIDTH = 320;
const HEIGHT = 180;

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing canvas element");
const gl = canvas.getContext("webgl2");
if (!gl) throw new Error("WebGL2 is required");

const createShader = (type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compilation failed");
  }
  return shader;
};

const program = gl.createProgram();
if (!program) {
  throw new Error("Failed to create WebGL program");
}

gl.attachShader(
  program,
  createShader(
    gl.VERTEX_SHADER,
    `#version 300 es
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
}`,
  ),
);

gl.attachShader(
  program,
  createShader(
    gl.FRAGMENT_SHADER,
    `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`,
  ),
);

gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
}

gl.useProgram(program);

const vao = gl.createVertexArray();
if (!vao) {
  throw new Error("Failed to create vertex array");
}
gl.bindVertexArray(vao);

const texture = gl.createTexture();
if (!texture) {
  throw new Error("Failed to create texture");
}
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);

const resize = (): void => {
  const width = Math.max(1, Math.floor(window.innerWidth));
  const height = Math.max(1, Math.floor(window.innerHeight));
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
};

window.addEventListener("resize", resize);
resize();

const rt = SharedRuntime.host();
const pixels = rt.createSharedObject("pixels", { byteLength: WIDTH * HEIGHT * 4 });

await rt.spawnWorker(new URL("./pixel-writer.worker.js", import.meta.url).href, "pixel-writer");

const render = (): void => {
  const snap = pixels.readLatest();
  if (!snap) return;

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    WIDTH,
    HEIGHT,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    snap.bytes,
  );
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

pixels.subscribe(render);
