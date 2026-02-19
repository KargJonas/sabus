import SharedRuntime from "../../shared-runtime.js";
import { ParticleSchema } from "./particle-schema.js";

const rt = await SharedRuntime.worker();
const particle = rt.openSharedObject("particle", ParticleSchema);

particle.subscribe(() => {
  const snap = particle.read();
  if (!snap) return;

  const pos = snap.position; // Float32Array(3)
  const vel = snap.velocity; // Float32Array(3)
  console.log(
    `[reader] seq=${snap.seq} pos=[${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}, ${pos[2].toFixed(2)}]` +
      ` vel=[${vel[0].toFixed(2)}, ${vel[1].toFixed(2)}, ${vel[2].toFixed(2)}] mass=${snap.mass}`,
  );
});
