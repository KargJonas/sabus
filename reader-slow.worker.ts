import SharedRuntime from "./shared-runtime.js";
import { Type } from "./schema.js";

const CounterSchema = { value: Type.Int32 } as const;

const rt = await SharedRuntime.worker();
const counter = rt.openSharedObject("counter", CounterSchema);

const pollMs = 350;
const threadName = "worker-slow";

setInterval(() => {
  const latest = counter.read();
  if (!latest) return;
  console.log(`[${threadName}] seq=${latest.seq} value=${latest.value}`);
}, pollMs);
