import SharedRuntime from "../../shared-runtime.js";
import { FRAME_HEIGHT, FRAME_WIDTH, VideoSchema } from "./video-schema.js";

// Set everything up from the worker-side:
//  - "Join" shared runtime
//  - Open previously defined shared object
const rt = await SharedRuntime.worker();
const video = rt.openSharedObject("video", VideoSchema);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fillFrame = (bytes: Uint8Array, time: number): void => {
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const i = (y * FRAME_WIDTH + x) * 4;
      const fx = x / FRAME_WIDTH;
      const fy = y / FRAME_HEIGHT;

      bytes[i] = 128 + 127 * Math.sin(fx * 8 + time);
      bytes[i + 1] = 128 + 127 * Math.sin(fy * 8 + time * 1.3);
      bytes[i + 2] = 128 + 127 * Math.sin((fx + fy) * 12 - time * 0.7);
      bytes[i + 3] = 255;
    }
  }
};

// Write a new frame roughly at 60fps.
let frame = 0;
while (true) {
  const time = frame * 0.04;

  await video.requestWrite(({ view, set }) => {
    set({ width: FRAME_WIDTH, height: FRAME_HEIGHT });
    fillFrame(view.feed, time);
  });

  frame += 1;
  await sleep(16);
}
