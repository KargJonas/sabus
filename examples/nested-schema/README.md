# Nested Schema Example

Demonstrates nested object fields in a typed shared schema.

The idea is that a field of a schema may be a structured schema itself. This allows the construction of more complex schemas and mapping of whole objects into linear memory.

## Files

- `main.ts`: writes nested `position` and `velocity` plus `mass`.
- `reader.worker.ts`: subscribes and reads the nested values.
- `particle-schema.ts`: defines the nested layout.
