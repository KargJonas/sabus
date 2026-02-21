import { Type } from "../../schema.js";

export const CHANNEL_BYTES = 16;
export const TEXT_BYTES = 96;

export const StatusSchema = {
  writerId: Type.Uint16,
  tick: Type.Uint32,
  channel: [Type.Utf8, CHANNEL_BYTES],
  text: [Type.Utf8, TEXT_BYTES],
} as const;
