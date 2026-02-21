import SharedRuntime from "../../shared-runtime.js";
import { ParticleSchema } from "./particle-schema.js";

const log = (text: string) => document.body.innerHTML += `${text}<br>`;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Set everything up:
//  - Create shared runtime
//  - Create shared object based on schema definition
//  - Spawn a worker and attach it to runtime
const rt = SharedRuntime.host();
const particle = rt.createSharedObject("particle", ParticleSchema);
const worker = new Worker(new URL("./reader.worker.js", import.meta.url), { type: "module" });
await rt.attachWorker("reader", worker);

// Print any messages we receive from the worker
worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (typeof event.data === "string") log(event.data);
});

log("[setup] writer updates particle position/velocity every 100ms");
log("[setup] reader receives update events via subscribe()");
log("[setup] demo runs continuously");
log("");

// Create some made-up position/velocity data and evolve it over time.
// The reader accesses the written data.
for (let t = 0; ; t += 1) {
  const dt = t * 0.1;
  const px = Math.sin(dt);
  const py = Math.cos(dt);

  await particle.write({
    position: { x: px, y: py, z: dt },
    velocity: { x: Math.cos(dt), y: -Math.sin(dt), z: 1 },
    mass: 1.5,
  });

  log(`[writer] t=${t} pos=[${px.toFixed(2)}, ${py.toFixed(2)}, ${dt.toFixed(2)}]`);
  await sleep(100);
}
