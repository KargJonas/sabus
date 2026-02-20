# Arrays Example

Demonstrates typed array fields in a shared schema.

- `main.ts`: creates `sensor-frame`, writes `samples` (`Float32Array`), `flags` (`Uint8Array`/array), and `gain`.
- `reader.worker.ts`: subscribes to updates and reads the latest frame.
- `sensor-frame-schema.ts`: defines the shared layout.
