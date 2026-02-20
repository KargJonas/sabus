import SharedRuntime from "../../shared-runtime.js";
import { SensorFrameSchema } from "./sensor-frame-schema.js";

// Set everything up from the worker-side:
//  - "Join" shared runtime
//  - Open previously defined shared object
const rt = await SharedRuntime.worker();
const frame = rt.openSharedObject("sensor-frame", SensorFrameSchema);

frame.subscribe(() => {
  const snap = frame.read();
  if (!snap) return;

  let sum = 0;
  let activeFlags = 0;

  for (let i = 0; i < snap.samples.length; i += 1) {
    sum += snap.samples[i] ?? 0;
    activeFlags += snap.flags[i] ?? 0;
  }

  const mean = sum / snap.samples.length;

  self.postMessage(
    `[reader] seq=${snap.seq} mean=${mean.toFixed(2)} activeFlags=${activeFlags}` +
      ` sample0=${snap.samples[0].toFixed(2)} sample7=${snap.samples[7].toFixed(2)}`,
  );
});
