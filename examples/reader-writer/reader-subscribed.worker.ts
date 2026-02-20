import SharedRuntime from "../../shared-runtime.js";
import { CounterSchema } from "./counter-schema.js";

const rt = await SharedRuntime.worker();
const counter = rt.openSharedObject("counter", CounterSchema);

const threadName = "worker-subscribed";

counter.subscribe(() => {
  const latest = counter.read();
  if (!latest) return;
  self.postMessage(`[${threadName}] seq=${latest.seq} value=${latest.value}`);
});
