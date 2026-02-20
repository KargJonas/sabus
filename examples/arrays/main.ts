import SharedRuntime from "../../shared-runtime.js";
import { ParticleSchema } from "./particle-schema.js";

const rt = SharedRuntime.host();
const particle = rt.createSharedObject("particle", ParticleSchema);

await rt.spawnWorker(new URL("./reader.worker.js", import.meta.url).href, "reader");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let t = 0;
const dt = 0.1;
const maxSteps = 30;

while (t < maxSteps) {
  const px = Math.sin(t * dt);
  const py = Math.cos(t * dt);
  const pz = t * dt;

  await particle.write({
    position: { x: px, y: py, z: pz },
    velocity: { x: Math.cos(t * dt), y: -Math.sin(t * dt), z: 1.0 },
    mass: 1.5,
  });

  console.log(`[writer] t=${t} pos=[${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}]`);
  t += 1;
  await sleep(100);
}

setTimeout(() => process.exit(0), 1200);
