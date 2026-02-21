import assert from "node:assert/strict";
import test from "node:test";

import { Type, computeLayout, readSnapshot, writeFields } from "../test-dist/schema.js";

test("computeLayout aligns scalar, array, and nested fields", () => {
  const schema = {
    flag: Type.Uint8,
    vector: [Type.Float32, 3],
    nested: {
      count: Type.Uint16,
      energy: Type.Float64,
    },
  };

  const layout = computeLayout(schema);

  assert.equal(layout.byteLength, 32);
  assert.equal(layout.fields.flag.kind, "scalar");
  assert.equal(layout.fields.flag.offset, 0);
  assert.equal(layout.fields.vector.kind, "array");
  assert.equal(layout.fields.vector.offset, 4);
  assert.equal(layout.fields.nested.kind, "nested");
  assert.equal(layout.fields.nested.offset, 16);

  assert.equal(layout.fields.nested.layout.fields.count.kind, "scalar");
  assert.equal(layout.fields.nested.layout.fields.count.offset, 0);
  assert.equal(layout.fields.nested.layout.fields.energy.kind, "scalar");
  assert.equal(layout.fields.nested.layout.fields.energy.offset, 8);
});

test("writeFields and readSnapshot round-trip nested values and partial updates", () => {
  const schema = {
    flag: Type.Uint8,
    vector: [Type.Float32, 3],
    nested: {
      count: Type.Uint16,
      energy: Type.Float64,
    },
  };
  const layout = computeLayout(schema);
  const dataView = new DataView(new SharedArrayBuffer(layout.byteLength));

  writeFields(layout, dataView, {
    flag: 3,
    vector: [1.5, 2.5, 3.5],
    nested: {
      count: 7,
      energy: 9.25,
    },
  });

  const first = readSnapshot(layout, dataView);
  assert.equal(first.flag, 3);
  assert.deepEqual(Array.from(first.vector), [1.5, 2.5, 3.5]);
  assert.equal(first.nested.count, 7);
  assert.equal(first.nested.energy, 9.25);

  writeFields(layout, dataView, {
    nested: {
      count: 11,
    },
  });

  const second = readSnapshot(layout, dataView);
  assert.equal(second.nested.count, 11);
  assert.equal(second.nested.energy, 9.25);
});
