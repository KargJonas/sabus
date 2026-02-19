# Counter Prototype (Main + 2 Workers)

Minimal prototype for the shared-object runtime:

- main thread writes an incrementing counter
- two worker threads read the latest value at different speeds
- readers do not receive per-write events; they poll `readLatest()`
- source is TypeScript and compiled to `dist/` before run

## Run

```bash
cd examples/counter-workers
npm install
npm run start
```

## API Shape Used

The demo follows the current prototype style:

- `SharedRuntime.host(...)`
- `rt.spawnWorker(path, name)`
- `rt.createSharedObject(id, config)`
- `rt.openSharedObject(id)`
- `writer.write(cb)`
- `reader.readLatest()`
