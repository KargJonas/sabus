import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

const out = document.createElement("pre");
out.style.font = "14px/1.4 monospace";
out.style.margin = "16px";
document.body.append(out);

const log = (line: string): void => {
  out.textContent += `${line}\n`;
};

const rt = SharedRuntime.host();
const counter = rt.createSharedObject("counter", CounterSchema);

const workers = await Promise.all([
  rt.spawnWorker(new URL("./reader-fast.worker.js", import.meta.url).href, "reader-fast"),
  rt.spawnWorker(new URL("./reader-slow.worker.js", import.meta.url).href, "reader-slow"),
  rt.spawnWorker(
    new URL("./reader-subscribed.worker.js", import.meta.url).href,
    "reader-subscribed",
  ),
]);

for (const entry of workers) {
  entry.worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data === "string") {
      log(event.data);
    }
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

for (let current = 0; current < 40; current += 1) {
  await counter.write({ value: current });
  log(`[main:writer] value=${current}`);
  await sleep(100);
}
