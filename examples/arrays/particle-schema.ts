import { Type } from "../../schema.js";

export const ParticleSchema = {
  position: [Type.Float32, 3],
  velocity: [Type.Float32, 3],
  mass: Type.Float32,
} as const;