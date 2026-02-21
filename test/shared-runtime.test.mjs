import assert from "node:assert/strict";
import test from "node:test";

import { Type } from "../test-dist/schema.js";
import { SharedObject, TypedSharedObject } from "../test-dist/shared-object.js";
import SharedRuntime from "../test-dist/shared-runtime.js";
import { cleanupRuntime } from "./helpers.mjs";

function createLinkedNodeEndpoints() {
  const leftListeners = new Set();
  const rightListeners = new Set();

  const left = {
    postMessage(message) {
      queueMicrotask(() => {
        for (const listener of rightListeners) {
          listener(message);
        }
      });
    },
    on(event, listener) {
      if (event === "message") {
        leftListeners.add(listener);
      }
    },
    off(event, listener) {
      if (event === "message") {
        leftListeners.delete(listener);
      }
    },
  };

  const right = {
    postMessage(message) {
      queueMicrotask(() => {
        for (const listener of leftListeners) {
          listener(message);
        }
      });
    },
    on(event, listener) {
      if (event === "message") {
        rightListeners.add(listener);
      }
    },
    off(event, listener) {
      if (event === "message") {
        rightListeners.delete(listener);
      }
    },
  };

  return { left, right };
}

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

test("SharedRuntime host/worker handshake works with attached endpoints", async (t) => {
  const schema = { count: Type.Int32 };
  const host = SharedRuntime.host();
  t.after(() => cleanupRuntime(host));

  const counterOnHost = host.createSharedObject("counter", schema);
  const { left: hostEndpoint, right: workerEndpoint } = createLinkedNodeEndpoints();

  const workerRuntimePromise = SharedRuntime.worker(workerEndpoint);
  await host.attachWorker("reader-1", hostEndpoint, { role: "reader" });
  const worker = await workerRuntimePromise;
  t.after(() => cleanupRuntime(worker));

  const setupData = worker.getWorkerSetupData();
  assert.deepEqual(setupData, { role: "reader" });

  const counterOnWorker = worker.openSharedObject("counter", schema);
  await counterOnHost.write({ count: 7 });
  const snap = counterOnWorker.read();
  assert.ok(snap);
  assert.equal(snap.count, 7);

  host.createSharedObject("later", { byteLength: 8 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const openedLater = worker.openSharedObject("later");
  assert.ok(openedLater instanceof SharedObject);
});

test("SharedRuntime validates attachWorker constraints", async () => {
  const host = SharedRuntime.host();
  const { left: endpointA } = createLinkedNodeEndpoints();

  const workerRuntime = new SharedRuntime("worker", null);
  await assert.rejects(
    workerRuntime.attachWorker("x", endpointA),
    /attachWorker is only available on host runtime/,
  );

  const { left: endpointB, right: endpointC } = createLinkedNodeEndpoints();
  const readyPromise = SharedRuntime.worker(endpointC);
  await host.attachWorker("dup", endpointB);
  await readyPromise;

  await assert.rejects(
    host.attachWorker("dup", endpointA),
    /already attached/,
  );
});
