# Multiple Writers Lock Example

Shows FIFO write-lock behavior when multiple workers write the same shared object.

There are multiple workers that want to write to the same memory region. Each instance requests a write-lock, writes metadata, waits, then releases.

## Files

- `main.ts`: creates the shared lock-state buffer, spawns 3 writers, and logs observed writes.
- `writer.worker.ts`: Definition of the write-worker. Instantiated multiple times.
