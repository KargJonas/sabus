import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

const rt = SharedRuntime.host();

const counter = rt.createSharedObject("counter", CounterSchema);

await rt.spawnWorker(new URL("./reader-fast.worker.js", import.meta.url).href, "reader-fast");
await rt.spawnWorker(new URL("./reader-slow.worker.js", import.meta.url).href, "reader-slow");
await rt.spawnWorker(new URL("./reader-subscribed.worker.js", import.meta.url).href, "reader-subscribed");

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
