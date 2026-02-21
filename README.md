# sabus

Minimal SharedArrayBuffer worker bus for low-overhead cross-worker data sharing.

> Check the `examples/` directory. Each example has a focused `README` with context and usage notes.

## Install

Install from command line:

```bash
npm install @kargjonas/sabus
```

## Quick start

Host:

```ts
import { SharedRuntime, Type } from "sabus";

const schema = {
  count: Type.Int32,
} as const;

const host = SharedRuntime.host();
const counter = host.createSharedObject("counter", schema);
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

await host.attachWorker("reader", worker);

await counter.write({ count: 1 });
console.log(counter.read()?.count); // 1
```

Worker (`worker.ts`):

```ts
import { SharedRuntime, Type } from "sabus";

const schema = {
  count: Type.Int32,
} as const;

const runtime = await SharedRuntime.worker();
const counter = runtime.openSharedObject("counter", schema);

counter.subscribe(() => {
  const latest = counter.read();
  if (latest) console.log("count:", latest.count, "seq:", latest.seq);
});
```

For worker-side usage and more complete patterns, check `examples/`.

## What it provides

- `SharedRuntime` to coordinate shared objects across host and workers.
- `SharedObject` with FIFO write lock and atomic latest-read behavior.
- `TypedSharedObject` for schema-based typed reads and writes.
- `schema` helpers (`Type`, `computeLayout`, `readSnapshot`, `writeFields`).

## Requirements

- Environment with `SharedArrayBuffer` support.
- Browser usage needs cross-origin isolation headers (`COOP`/`COEP`).

## Development

```bash
npm run typecheck
npm test
npm run build
```

Example app:

```bash
npm run dev
```
