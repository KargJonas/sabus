import SharedRuntime from "./shared-runtime.js";

const rt = await SharedRuntime.worker();
const counter = rt.openSharedObject("counter");

const pollMs = 140;
const threadName = "worker-fast";

setInterval(() => {
    const latest = counter.readLatest();
    if (!latest) return;

    const value = latest.dataView.getInt32(0, true);
    console.log(`[${threadName}] seq=${latest.seq} value=${value}`);
}, pollMs);
