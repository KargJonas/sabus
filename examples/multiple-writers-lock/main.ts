import SharedRuntime from "../../shared-runtime.js";

interface WriterSetupData {
  lockObjectId: string;
  writerId: number;
  label: string;
  holdMs: number;
  startDelayMs: number;
  betweenRoundsMs: number;
}

const WRITER_ID_OFFSET = 0;
const ROUND_OFFSET = 4;
const HOLD_MS_OFFSET = 8;
const LOCK_STATE_BYTE_LENGTH = 12;

const lockObjectId = "write-lock-demo";
const writerScriptUrl = new URL("./writer.worker.js", import.meta.url).href;

const log = (text: string): void => {
  document.body.innerHTML += `${text}<br>`;
};

const writerASetup: WriterSetupData = {
  lockObjectId,
  writerId: 1,
  label: "writer-A",
  holdMs: 220,
  startDelayMs: 0,
  betweenRoundsMs: 40,
};

const writerBSetup: WriterSetupData = {
  lockObjectId,
  writerId: 2,
  label: "writer-B",
  holdMs: 90,
  startDelayMs: 15,
  betweenRoundsMs: 80,
};

const writerCSetup: WriterSetupData = {
  lockObjectId,
  writerId: 3,
  label: "writer-C",
  holdMs: 140,
  startDelayMs: 30,
  betweenRoundsMs: 55,
};

const rt = SharedRuntime.host();
const lockState = rt.createSharedObject(lockObjectId, { byteLength: LOCK_STATE_BYTE_LENGTH });

lockState.subscribe(() => {
  const snap = lockState.readLatest();
  if (!snap) return;

  const writerId = snap.dataView.getInt32(WRITER_ID_OFFSET, true);
  const round = snap.dataView.getInt32(ROUND_OFFSET, true);
  const holdMs = snap.dataView.getInt32(HOLD_MS_OFFSET, true);

  log(
    `[observer] seq=${snap.seq} published by writer-${writerId} round=${round} hold=${holdMs}ms`,
  );
});

log("[setup] 3 writers contend for the same SharedObject write lock");
log("[setup] each writer logs request -> acquire -> release");
log("[setup] requestWrite() uses FIFO ticket ordering");
log("[setup] demo runs continuously");
log("");

const attachWorkerLogger = (workerHandle: Worker): void => {
  workerHandle.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data === "string") {
      log(event.data);
    }
  });
};

const writerAPromise = rt.spawnWorker(writerScriptUrl, "writer-A", writerASetup);
const writerBPromise = rt.spawnWorker(writerScriptUrl, "writer-B", writerBSetup);
const writerCPromise = rt.spawnWorker(writerScriptUrl, "writer-C", writerCSetup);

const writerA = await writerAPromise;
const writerB = await writerBPromise;
const writerC = await writerCPromise;

attachWorkerLogger(writerA);
attachWorkerLogger(writerB);
attachWorkerLogger(writerC);

const workers = [writerA, writerB, writerC];

for (const worker of workers) {
  worker.postMessage({ type: "start" });
}
