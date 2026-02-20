import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

// Set everything up from the worker-side:
//  - "Join" shared runtime
//  - Open previously defined shared object
const rt = await SharedRuntime.worker();
const counter = rt.openSharedObject("counter", CounterSchema);

const readerName = "reader-subscribed";

// Subscribe to changes instead of polling.
counter.subscribe(() => {
  const snap = counter.read();
  if (!snap) return;
  self.postMessage(`[${readerName}] seq=${snap.seq} value=${snap.value}`);
});
