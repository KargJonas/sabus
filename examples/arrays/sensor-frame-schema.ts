import { Type } from "../../schema.js";

export const SensorFrameSchema = {
  samples: [Type.Float32, 8],
  flags: [Type.Uint8, 8],
  gain: Type.Float32,
} as const;
