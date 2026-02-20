import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

const log = (text: string) => {
  document.body.innerHTML += `${text}<br>`;
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Set everything up:
//  - Create shared runtime
//  - Create shared object based on schema definition
//  - Spawn workers that read using different strategies
const rt = SharedRuntime.host();
const counter = rt.createSharedObject("counter", CounterSchema);
const fastReader = await rt.spawnWorker(
  new URL("./reader-fast.worker.js", import.meta.url).href, "reader-fast");
const slowReader = await rt.spawnWorker(
  new URL("./reader-slow.worker.js", import.meta.url).href, "reader-slow");
const subscribedReader = await rt.spawnWorker(
  new URL("./reader-subscribed.worker.js", import.meta.url).href, "reader-subscribed");

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
