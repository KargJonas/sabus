import SharedRuntime from "../../shared-runtime.js";
import { computeLayout } from "../../schema.js";
import { CHANNEL_BYTES, StatusSchema, TEXT_BYTES } from "./status-schema.js";

interface DirectMessagePayload {
  writerId: number;
  tick: number;
  channel: string;
  text: string;
}

interface DirectMessage {
  type: "direct-msg";
  payload: DirectMessagePayload;
}

const log = (text: string): void => {
  document.body.innerHTML += `${text}<br>`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const encoder = new TextEncoder();
const utf8Capacity = CHANNEL_BYTES + TEXT_BYTES;
const rt = SharedRuntime.host();
const status = rt.createSharedObject("status", StatusSchema);
const reader = new Worker(new URL("./reader.worker.js", import.meta.url), { type: "module" });
await rt.attachWorker("reader", reader);

reader.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (typeof event.data === "string") log(event.data);
});

const layout = computeLayout(StatusSchema);
const slotCount = status.inner.slotCount;
const sabBytes = layout.byteLength * slotCount;

log("[setup] fixed-size UTF-8 strings in schema");
log(`[setup] channel=[Type.Utf8, ${CHANNEL_BYTES}] text=[Type.Utf8, ${TEXT_BYTES}]`);
log(`[overhead] memory: ${layout.byteLength} bytes/slot x ${slotCount} slots = ${sabBytes} bytes`);
log(
  `[overhead] write cost: TextEncoder + zero-fill ${utf8Capacity} bytes + copy up to ${utf8Capacity} bytes`,
);
log(`[overhead] read cost: scan up to ${utf8Capacity} bytes + TextDecoder to JS strings`);
log("[compare] each tick also sends the same payload via postMessage");
log("[compare] postMessage call time shown below excludes async transfer/clone completion time");
log("");

const samples = [
  "ok",
  "queue lag 14ms",
  "cache warmup complete",
  "backpressure on shard-2",
  "warming up \uD83D\uDD25",
];

for (let tick = 0; ; tick += 1) {
  const channel = tick % 2 === 0 ? "ingest" : "metrics";
  const text = `${samples[tick % samples.length]} | tick=${tick}`;
  const payload: DirectMessagePayload = {
    writerId: 7,
    tick,
    channel,
    text,
  };

  const channelBytes = encoder.encode(channel).length;
  const textBytes = encoder.encode(text).length;

  const t0 = performance.now();
  await status.write(payload);
  const sharedWriteMs = performance.now() - t0;

  const directMessage: DirectMessage = { type: "direct-msg", payload };
  const t1 = performance.now();
  reader.postMessage(directMessage);
  const postMessageCallMs = performance.now() - t1;

  log(
    `[writer] tick=${tick} channelBytes=${channelBytes}/${CHANNEL_BYTES} textBytes=${textBytes}/${TEXT_BYTES}` +
      ` sharedWrite=${sharedWriteMs.toFixed(3)}ms postMessageCall=${postMessageCallMs.toFixed(3)}ms`,
  );

  await sleep(350);
}
