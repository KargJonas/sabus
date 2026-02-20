import { Type } from "../../schema.js";

const Vec3 = {
  x: Type.Float32,
  y: Type.Float32,
  z: Type.Float32,
} as const;

export const ParticleSchema = {
  position: Vec3,
  velocity: Vec3,
  mass: Type.Float32,
} as const;
