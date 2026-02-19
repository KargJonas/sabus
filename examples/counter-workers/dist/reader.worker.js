import { workerData } from "node:worker_threads";
import SharedRuntime from "./shared-runtime.js";
const bootstrap = workerData;
const name = bootstrap?.name ?? "reader";
const pollMs = name.includes("slow") ? 350 : 140;
const rt = await SharedRuntime.worker(globalThis, null);
const counter = rt.openSharedObject("counter").reader();
setInterval(() => {
    const latest = counter.readLatest();
    if (!latest)
        return;
    const value = latest.dataView.getInt32(0, true);
    console.log(`[${name}] seq=${latest.seq} value=${value}`);
}, pollMs);
