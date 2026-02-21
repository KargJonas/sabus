import { Type } from "../../schema.js";

export const FRAME_WIDTH = 320;
export const FRAME_HEIGHT = 180;

export const VideoSchema = {
  feed: [Type.Rgba8, FRAME_WIDTH * FRAME_HEIGHT],
  width: Type.Uint32,
  height: Type.Uint32,
} as const;
