import assert from "node:assert/strict";
import test from "node:test";

import { Type, computeLayout } from "../test-dist/schema.js";
import { SharedObject, TypedSharedObject } from "../test-dist/shared-object.js";
import { cleanupSharedObject, createDeferred } from "./helpers.mjs";

let objectCounter = 0;

function createSharedObject(byteLength = 16) {
  objectCounter += 1;
  return SharedObject.create(`test-shared-object-${objectCounter}`, { byteLength });
}

test("SharedObject validates byteLength", () => {
  assert.throws(
    () => SharedObject.create("bad-a", { byteLength: 0 }),
    /byteLength must be a positive integer/,
  );
  assert.throws(
    () => SharedObject.create("bad-b", { byteLength: 1.5 }),
    /byteLength must be a positive integer/,
  );
});

test("SharedObject publishes latest write and sequence numbers", async (t) => {
  const obj = createSharedObject(8);
  t.after(() => cleanupSharedObject(obj));

  assert.equal(obj.readLatest(), null);

  await obj.requestWrite(({ dataView, seq }) => {
    assert.equal(seq, 1);
    dataView.setInt32(0, 123, true);
  });

  const first = obj.readLatest();
  assert.ok(first);
  assert.equal(first.seq, 1);
  assert.equal(first.dataView.getInt32(0, true), 123);

  await obj.requestWrite(({ dataView, seq }) => {
    assert.equal(seq, 2);
    dataView.setInt32(0, 456, true);
  });

  const second = obj.readLatest();
  assert.ok(second);
  assert.equal(second.seq, 2);
  assert.equal(second.dataView.getInt32(0, true), 456);
});

test("SharedObject rejects overlapping writes from the same thread", async (t) => {
  const obj = createSharedObject(8);
  t.after(() => cleanupSharedObject(obj));

  const hold = createDeferred();
  const firstStarted = createDeferred();

  const firstWrite = obj.requestWrite(async ({ dataView }) => {
    firstStarted.resolve();
    dataView.setInt32(0, 1, true);
    await hold.promise;
  });

  await firstStarted.promise;

  await assert.rejects(
    obj.requestWrite(() => undefined),
    /Reentrant writes are not supported/,
  );

  hold.resolve();
  await firstWrite;

  const latest = obj.readLatest();
  assert.ok(latest);
  assert.equal(latest.seq, 1);
  assert.equal(latest.dataView.getInt32(0, true), 1);
});

test("SharedObject rejects reentrant writes and recovers lock afterward", async (t) => {
  const obj = createSharedObject(8);
  t.after(() => cleanupSharedObject(obj));

  await obj.requestWrite(async () => {
    await assert.rejects(
      obj.requestWrite(() => undefined),
      /Reentrant writes are not supported/,
    );
  });

  await obj.requestWrite(({ dataView }) => {
    dataView.setInt8(0, 7);
  });

  const latest = obj.readLatest();
  assert.ok(latest);
  assert.equal(latest.seq, 2);
  assert.equal(latest.dataView.getInt8(0), 7);
});

test("SharedObject subscription receives write notifications", async (t) => {
  const obj = createSharedObject(8);
  t.after(() => cleanupSharedObject(obj));

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for subscription event"));
    }, 500);

    const unsubscribe = obj.subscribe(() => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(undefined);
    });

    obj.requestWrite(({ dataView }) => {
      dataView.setInt8(0, 1);
    }).catch((error) => {
      clearTimeout(timeout);
      unsubscribe();
      reject(error);
    });
  });
});

test("TypedSharedObject writes and reads schema values", async (t) => {
  const schema = {
    count: Type.Int32,
    vector: [Type.Uint16, 3],
    meta: {
      active: Type.Uint8,
      temperature: Type.Float32,
    },
  };

  const byteLength = computeLayout(schema).byteLength;
  const obj = createSharedObject(byteLength);
  t.after(() => cleanupSharedObject(obj));

  const typed = new TypedSharedObject(obj, schema);

  await typed.write({
    count: 4,
    vector: [10, 20, 30],
    meta: {
      active: 1,
      temperature: 19.5,
    },
  });

  const first = typed.read();
  assert.ok(first);
  assert.equal(first.count, 4);
  assert.deepEqual(Array.from(first.vector), [10, 20, 30]);
  assert.equal(first.meta.active, 1);
  assert.equal(first.meta.temperature, 19.5);

  await typed.write({
    count: 9,
    vector: [11, 21, 31],
    meta: {
      active: 0,
      temperature: 21.25,
    },
  });

  const second = typed.read();
  assert.ok(second);
  assert.equal(second.count, 9);
  assert.deepEqual(Array.from(second.vector), [11, 21, 31]);
  assert.equal(second.meta.active, 0);
  assert.equal(second.meta.temperature, 21.25);
});
