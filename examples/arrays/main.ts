import SharedRuntime from "../../shared-runtime.js";
import { SensorFrameSchema } from "./sensor-frame-schema.js";

const log = (text: string): void => {
  document.body.innerHTML += `${text}<br>`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Set everything up:
//  - Create shared runtime
//  - Create shared object based on schema definition
//  - Spawn a worker and attach it to runtime
const rt = SharedRuntime.host();
const frame = rt.createSharedObject("sensor-frame", SensorFrameSchema);
const reader = new Worker(new URL("./reader.worker.js", import.meta.url), { type: "module" });
await rt.attachWorker("reader", reader);

reader.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (typeof event.data === "string") {
    log(event.data);
  }
});

log("[setup] writing 8 Float32 samples + 8 Uint8 flags");
log("[setup] reader receives updates via subscribe()");
log("[setup] demo runs continuously");
log("");

for (let tick = 0; ; tick += 1) {
  const phase = tick * 0.2;
  const samples = new Float32Array(8);

  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin(phase + i * 0.35) * 10;
  }

  const flags = Array.from({ length: 8 }, (_, i) => ((tick + i) % 3 === 0 ? 1 : 0));
  const gain = 0.8 + 0.2 * Math.sin(phase * 0.5);

  await frame.write({
    samples,
    flags,
    gain,
  });

  log(
    `[writer] tick=${tick} samples=[${samples[0].toFixed(2)}, ${samples[1].toFixed(2)}, ${samples[2].toFixed(2)}, ...]` +
      ` flags=[${flags.join(",")}] gain=${gain.toFixed(2)}`,
  );

  await sleep(120);
}
