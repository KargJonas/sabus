# WebGL Canvas Example

Worker-generated pixel data displayed with WebGL.

All pixel data is generated *in JavaScript* in a dedicated worker, and only displayed using the help of WebGL. This way we:
- Generate the data *once*.
- Data is available in the main thread *without copying* between threads.
- Data is transferred from CPU to GPU memory only once using `gl.texImage2D(...)`

## Files

- `pixel-writer.worker.ts`: generates RGBA frames and writes bytes into the shared `pixels` object.
- `main.ts`: reads the latest frame from shared memory and uploads it to a WebGL texture for fullscreen drawing.
