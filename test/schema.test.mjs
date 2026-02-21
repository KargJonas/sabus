import assert from "node:assert/strict";
import test from "node:test";

import { Type, computeLayout, readSnapshot, writeFields } from "../test-dist/schema.js";

test("computeLayout aligns scalar, array, and nested fields", () => {
  const schema = {
    flag: Type.Uint8,
    label: [Type.Utf8, 10],
    vector: [Type.Float32, 3],
    nested: {
      count: Type.Uint16,
      energy: Type.Float64,
    },
  };

  const layout = computeLayout(schema);

  assert.equal(layout.byteLength, 40);
  assert.equal(layout.fields.flag.kind, "scalar");
  assert.equal(layout.fields.flag.offset, 0);
  assert.equal(layout.fields.label.kind, "utf8");
  assert.equal(layout.fields.label.offset, 1);
  assert.equal(layout.fields.vector.kind, "array");
  assert.equal(layout.fields.vector.offset, 12);
  assert.equal(layout.fields.nested.kind, "nested");
  assert.equal(layout.fields.nested.offset, 24);

  assert.equal(layout.fields.nested.layout.fields.count.kind, "scalar");
  assert.equal(layout.fields.nested.layout.fields.count.offset, 0);
  assert.equal(layout.fields.nested.layout.fields.energy.kind, "scalar");
  assert.equal(layout.fields.nested.layout.fields.energy.offset, 8);
});

test("writeFields and readSnapshot round-trip nested values and partial updates", () => {
  const schema = {
    flag: Type.Uint8,
    label: [Type.Utf8, 12],
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
    label: "sensor-a",
    vector: new Float32Array([1.5, 2.5, 3.5]),
    nested: {
      count: 7,
      energy: 9.25,
    },
  });

  const first = readSnapshot(layout, dataView);
  assert.equal(first.flag, 3);
  assert.equal(first.label, "sensor-a");
  assert.deepEqual(Array.from(first.vector), [1.5, 2.5, 3.5]);
  assert.equal(first.nested.count, 7);
  assert.equal(first.nested.energy, 9.25);

  writeFields(layout, dataView, {
    label: "b",
    nested: {
      count: 11,
    },
  });

  const second = readSnapshot(layout, dataView);
  assert.equal(second.label, "b");
  assert.equal(second.nested.count, 11);
  assert.equal(second.nested.energy, 9.25);
});

test("utf8 fields use byte length, not JS string length", () => {
  const schema = {
    value: [Type.Utf8, 3],
  };
  const layout = computeLayout(schema);
  const dataView = new DataView(new SharedArrayBuffer(layout.byteLength));

  writeFields(layout, dataView, { value: "\u00E4" });
  assert.equal(readSnapshot(layout, dataView).value, "\u00E4");

  assert.throws(
    () => writeFields(layout, dataView, { value: "\u00E4\u00E4" }),
    /exceeds byteLength/,
  );
});

test("Rgba8 fields map pixels to a Uint8Array byte view", () => {
  const schema = {
    width: Type.Uint32,
    height: Type.Uint32,
    feed: [Type.Rgba8, 6],
  };
  const layout = computeLayout(schema);
  const dataView = new DataView(new SharedArrayBuffer(layout.byteLength));

  assert.equal(layout.byteLength, 32);

  writeFields(layout, dataView, {
    width: 3,
    height: 2,
    feed: new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 0, 255,
      0, 255, 255, 255,
      255, 0, 255, 255,
    ]),
  });

  const snap = readSnapshot(layout, dataView);
  assert.equal(snap.width, 3);
  assert.equal(snap.height, 2);
  assert.ok(snap.feed instanceof Uint8Array);
  assert.equal(snap.feed.length, 24);
  assert.deepEqual(Array.from(snap.feed.subarray(0, 8)), [255, 0, 0, 255, 0, 255, 0, 255]);
});

test("writeFields enforces typed-array writes for array fields", () => {
  const schema = {
    vector: [Type.Float32, 3],
    feed: [Type.Rgba8, 2],
  };
  const layout = computeLayout(schema);
  const dataView = new DataView(new SharedArrayBuffer(layout.byteLength));

  assert.throws(
    () => writeFields(layout, dataView, { vector: [1, 2, 3] }),
    /Expected Float32Array/,
  );

  assert.throws(
    () => writeFields(layout, dataView, { feed: new Uint8Array(4) }),
    /length mismatch/,
  );
});
