import SharedRuntime from "./shared-runtime.js";

const rt = SharedRuntime.host();

rt.createSharedObject("counter", {
  byteLength: Int32Array.BYTES_PER_ELEMENT,
});

await rt.spawnWorker("./reader-fast.worker.js", "reader-fast");
await rt.spawnWorker("./reader-slow.worker.js", "reader-slow");
await rt.spawnWorker("./reader-subscribed.worker.js", "reader-subscribed");

const counter = rt.openSharedObject("counter");

let value = 0;
const writeIntervalMs = 100;
const maxWrites = 40;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

while (value < maxWrites) {
  await counter.requestWrite(({ dataView }) => {
    dataView.setInt32(0, value, true);
  });

  console.log(`[main:writer] value=${value}`);
  value += 1;
  await sleep(writeIntervalMs);
}

setTimeout(() => process.exit(0), 1200);
