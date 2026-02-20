import SharedRuntime from "../../shared-runtime.js";
import { ParticleSchema } from "./particle-schema.js";

// Set everything up from the worker-side:
//  - "Join" shared runtime
//  - Open previously defined shared object
const rt = await SharedRuntime.worker();
const particle = rt.openSharedObject("particle", ParticleSchema);

// Subscribe to any changes of the shared object
particle.subscribe(() => {
  const snap = particle.read();
  if (!snap) return;

  const { position: pos, velocity: vel } = snap;
  self.postMessage(
    `[reader] seq=${snap.seq} pos=[${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}]` +
      ` vel=[${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)}] mass=${snap.mass}`,
  );
});
