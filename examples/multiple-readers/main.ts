import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

const log = (text: string) => {
  document.body.innerHTML += `${text}<br>`;
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Set everything up:
//  - Create shared runtime
//  - Create shared object based on schema definition
//  - Spawn workers and attach them to runtime
const rt = SharedRuntime.host();
const counter = rt.createSharedObject("counter", CounterSchema);
const fastReader = new Worker(new URL("./reader-fast.worker.js", import.meta.url), { type: "module" });
await rt.attachWorker("reader-fast", fastReader);
const slowReader = new Worker(new URL("./reader-slow.worker.js", import.meta.url), { type: "module" });
await rt.attachWorker("reader-slow", slowReader);
const subscribedReader = new Worker(new URL("./reader-subscribed.worker.js", import.meta.url), {
  type: "module",
});
await rt.attachWorker("reader-subscribed", subscribedReader);

for (const worker of [fastReader, slowReader, subscribedReader]) {
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data === "string") log(event.data);
  });
}

log("[setup] writer updates value every 100ms");
log("[setup] reader-fast polls every 140ms");
log("[setup] reader-slow polls every 350ms");
log("[setup] reader-subscribed receives change notifications");
log("[setup] demo runs continuously");
log("");

// Write a counter value every 100ms.
// The workers are just observers and never mutate shared data.
for (let value = 0; ; value += 1) {
  await counter.write({ value });
  log(`[writer] value=${value}`);
  await sleep(100);
}
