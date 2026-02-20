# Multiple Readers Example

One writer, three different readers.

- `main.ts`: writes a counter value and spawns all reader workers.
- `reader-fast.worker.ts`: polls frequently.
- `reader-slow.worker.ts`: polls slowly.
- `reader-subscribed.worker.ts`: reacts via `subscribe()`.
- `counter-schema.ts`: defines the counter shape.
