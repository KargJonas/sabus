import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

const rt = await SharedRuntime.worker();
const counter = rt.openSharedObject("counter", CounterSchema);

const pollMs = 140;
const threadName = "worker-fast";

setInterval(() => {
  const latest = counter.read();
  if (!latest) return;
  console.log(`[${threadName}] seq=${latest.seq} value=${latest.value}`);
}, pollMs);
