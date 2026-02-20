import SharedRuntime from "../../shared-runtime.js";

const WRITER_ID_OFFSET = 0;
const ROUND_OFFSET = 4;
const HOLD_MS_OFFSET = 8;

interface StartMessage {
  type: "start";
}

interface WriterSetupData {
  lockObjectId: string;
  writerId: number;
  label: string;
  holdMs: number;
  startDelayMs: number;
  betweenRoundsMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const rt = await SharedRuntime.worker();
const setupData = rt.getWorkerSetupData<WriterSetupData>();
if (!setupData) throw new Error("writer.worker requires setupData in spawnWorker()");

const {lockObjectId, writerId, label, holdMs, startDelayMs, betweenRoundsMs} = setupData;
const lockState = rt.openSharedObject(lockObjectId);

let hasStarted = false;

async function runWriter(): Promise<void> {
  if (startDelayMs > 0) {
    await sleep(startDelayMs);
  }

  for (let round = 1; ; round += 1) {
    const requestedAt = performance.now();
    self.postMessage(`[${label}] round=${round} requested lock`);

    await lockState.requestWrite(async ({ dataView, seq }) => {
      const acquiredAt = performance.now();
      const waitMs = acquiredAt - requestedAt;

      self.postMessage(
        `[${label}] round=${round} acquired lock wait=${waitMs.toFixed(1)}ms seq=${seq}`,
      );

      dataView.setInt32(WRITER_ID_OFFSET, writerId, true);
      dataView.setInt32(ROUND_OFFSET, round, true);
      dataView.setInt32(HOLD_MS_OFFSET, holdMs, true);

      await sleep(holdMs);

      self.postMessage(`[${label}] round=${round} releasing lock`);
    });

    if (betweenRoundsMs > 0) {
      await sleep(betweenRoundsMs);
    }
  }
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (hasStarted) return;
  if (!event.data) return; 

  const data = event.data as StartMessage;
  if (data.type !== "start") return;

  hasStarted = true;
  void runWriter();
});

self.postMessage(`[${label}] ready`);
