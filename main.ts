import SharedRuntime from "./shared-runtime.js";
import { Type } from "./schema.js";

const CounterSchema = {
  value: Type.Int32,
} as const;

const rt = SharedRuntime.host();

const counter = rt.createSharedObject("counter", CounterSchema);

await rt.spawnWorker("./reader-fast.worker.js", "reader-fast");
await rt.spawnWorker("./reader-slow.worker.js", "reader-slow");
await rt.spawnWorker("./reader-subscribed.worker.js", "reader-subscribed");

let current = 0;
const writeIntervalMs = 100;
const maxWrites = 40;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

while (current < maxWrites) {
  await counter.write({ value: current });
  console.log(`[main:writer] value=${current}`);
  current += 1;
  await sleep(writeIntervalMs);
}

setTimeout(() => process.exit(0), 1200);
