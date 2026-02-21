# UTF-8 Strings Example

Demonstrates fixed-size string fields with `[Type.Utf8, N]` and compares that path with direct `postMessage`.

- `main.ts`: writes shared UTF-8 fields and also posts the same payload directly to the worker.
- `reader.worker.ts`: prints both shared-object updates and direct-message updates.
- `status-schema.ts`: defines a fixed layout with `channel` and `text` UTF-8 fields.

## Overhead model (this example)

Schema fields:

- `channel: [Type.Utf8, 16]`
- `text: [Type.Utf8, 96]`

Implications:

- Memory: fixed UTF-8 capacity is `16 + 96 = 112` bytes per record, plus numeric fields and alignment.
- Shared object data memory: `layout.byteLength * 3` (triple buffering).
- Write CPU: `TextEncoder` + zero-fill all UTF-8 bytes + copy encoded bytes.
- Read CPU: scan until `0x00` (or full field) + `TextDecoder` allocation of JS strings.

`N` is a byte capacity, not character count.

## When this can still beat message passing

1. Many readers need the same latest state: writer updates once, all readers observe from shared memory without per-reader payload copies.
2. High-frequency status/telemetry snapshots with small text metadata (labels/state strings) where fixed-size records are acceptable.
