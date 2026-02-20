import SharedRuntime from "../../shared-runtime.js";
import { ParticleSchema } from "./particle-schema.js";

const out = document.createElement("pre");
out.style.font = "14px/1.4 monospace";
out.style.margin = "16px";
document.body.append(out);

const log = (line: string): void => {
  out.textContent += `${line}\n`;
};

const rt = SharedRuntime.host();
const particle = rt.createSharedObject("particle", ParticleSchema);

const { worker } = await rt.spawnWorker(new URL("./reader.worker.js", import.meta.url).href, "reader");
worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (typeof event.data === "string") {
    log(event.data);
  }
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

for (let t = 0; t < 30; t += 1) {
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
