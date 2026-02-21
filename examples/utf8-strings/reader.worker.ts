import SharedRuntime from "../../shared-runtime.js";
import { StatusSchema } from "./status-schema.js";

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDirectMessage(value: unknown): value is DirectMessage {
  if (!isObject(value) || value.type !== "direct-msg") return false;
  const payload = value.payload;
  return (
    isObject(payload) &&
    typeof payload.writerId === "number" &&
    typeof payload.tick === "number" &&
    typeof payload.channel === "string" &&
    typeof payload.text === "string"
  );
}

const rt = await SharedRuntime.worker();
const status = rt.openSharedObject("status", StatusSchema);

self.postMessage("[worker] listening for shared updates + direct postMessage payloads");

status.subscribe(() => {
  const snap = status.read();
  if (!snap) return;
  self.postMessage(
    `[shared] seq=${snap.seq} tick=${snap.tick} channel="${snap.channel}" text="${snap.text}"`,
  );
});

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isDirectMessage(event.data)) return;
  const { payload } = event.data;
  self.postMessage(
    `[direct] tick=${payload.tick} channel="${payload.channel}" text="${payload.text}"`,
  );
});
