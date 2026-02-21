# WebGL Canvas Example

Worker-generated pixel data displayed with WebGL.

All pixel data is generated *in JavaScript* in a dedicated worker, and only displayed using the help of WebGL. This way we:
- Generate the data *once*.
- Data is available in the main thread *without copying* between threads.
- Data is transferred from CPU to GPU memory only once using `gl.texImage2D(...)`

## Files

- `video-schema.ts`: defines the shared framebuffer with `[Type.Rgba8, width * height]`.
- `pixel-writer.worker.ts`: generates RGBA frames and writes directly into the shared schema field.
- `main.ts`: reads the latest typed snapshot and uploads `feed` to a WebGL texture for fullscreen drawing.
