import assert from "node:assert/strict";
import test from "node:test";

import { Type } from "../test-dist/schema.js";
import { SharedObject, TypedSharedObject } from "../test-dist/shared-object.js";
import SharedRuntime from "../test-dist/shared-runtime.js";
import { cleanupRuntime } from "./helpers.mjs";

test("SharedRuntime creates, opens, and validates shared objects", async (t) => {
  const runtime = SharedRuntime.host();
  t.after(() => cleanupRuntime(runtime));

  const schema = {
    count: Type.Int32,
  };

  const raw = runtime.createSharedObject("raw", { byteLength: 8 });
  assert.ok(raw instanceof SharedObject);

  const typed = runtime.createSharedObject("typed", schema);
  assert.ok(typed instanceof TypedSharedObject);

  const openedRaw = runtime.openSharedObject("raw");
  assert.ok(openedRaw instanceof SharedObject);

  const openedTyped = runtime.openSharedObject("typed", schema);
  assert.ok(openedTyped instanceof TypedSharedObject);

  await typed.write({ count: 5 });
  const typedSnapshot = openedTyped.read();
  assert.ok(typedSnapshot);
  assert.equal(typedSnapshot.count, 5);

  assert.throws(
    () => runtime.createSharedObject("raw", { byteLength: 8 }),
    /already exists/,
  );
  assert.throws(
    () => runtime.openSharedObject("missing"),
    /not found/,
  );
});

test("SharedRuntime rejects spawnWorker outside host mode", async () => {
  const runtime = new SharedRuntime("worker", null);

  await assert.rejects(
    runtime.spawnWorker("./worker.js", "example"),
    /spawnWorker is only available on host runtime/,
  );
});
