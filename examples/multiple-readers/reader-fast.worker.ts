import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

// Set everything up from the worker-side:
//  - "Join" shared runtime
//  - Open previously defined shared object
const rt = await SharedRuntime.worker();
const counter = rt.openSharedObject("counter", CounterSchema);

const pollMs = 140;
const readerName = "reader-fast";

// Poll at a fixed interval and report the latest value.
setInterval(() => {
  const snap = counter.read();
  if (!snap) return;
  self.postMessage(`[${readerName}] seq=${snap.seq} value=${snap.value}`);
}, pollMs);
