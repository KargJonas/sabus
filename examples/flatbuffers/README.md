# FlatBuffers Playground

This folder contains:

- a control-message encode/decode example
- a SAB-backed shared-object metadata example using FlatBuffers `struct`s

## Files

- `schema/control.fbs`: FlatBuffers schema
- `schema/shared-object.fbs`: shared-object metadata schema
- `demo.ts`: encode/decode example
- `shared-object-layout.ts`: high-level shared object API (`writer.write` / `reader.readLatest`)
- `demo-shared-object.ts`: writes and reads a shared frame object without ring terminology
- `generated/`: generated TypeScript files (created by `flatc`)

## Prerequisites

1. Node.js 20+ (or any recent version with ESM support)
2. `flatc` available either:
   - as an in-folder build at `./flatbuffers/flatc` (auto-detected), or
   - as a local build at `../../build/flatc` (auto-detected), or
   - installed globally in `PATH`

## Run

```bash
cd examples/flatbuffers
npm install
npm run gen
npm run demo
```

Shared-object + SAB mapping demo:

```bash
npm run start:shared
```

## Expected output (shape)

You should see:

- encoded buffer size
- decoded object containing:
  - `kind: "feed_added"`
  - feed descriptor fields (`width`, `height`, `bytesPerRow`, etc.)
  - producer + consumer worker names

## Notes

- `npm run gen` uses `--gen-mutable`, so generated TS includes `mutate_*`
  methods. Those setters are used by `shared-object-layout.ts`.
- For synchronization in production (single writer / many readers), still pair
  this with `Atomics` for publish/read ownership rules.
