import SharedRuntime from "./shared-runtime.js";
const rt = SharedRuntime.host(globalThis, null);
rt.createSharedObject("counter", {
    byteLength: Int32Array.BYTES_PER_ELEMENT,
});
await rt.spawnWorker(new URL("./reader.worker.js", import.meta.url), "reader-fast");
await rt.spawnWorker(new URL("./reader.worker.js", import.meta.url), "reader-slow");
const counter = rt.openSharedObject("counter");
const writer = counter.writer();
let value = 0;
const writeIntervalMs = 100;
const maxWrites = 40;
const timer = setInterval(() => {
    writer.write(({ dataView }) => {
        dataView.setInt32(0, value, true);
    });
    console.log(`[main:writer] value=${value}`);
    value += 1;
    if (value >= maxWrites) {
        clearInterval(timer);
        setTimeout(() => process.exit(0), 1200);
    }
}, writeIntervalMs);
