import SharedRuntime from "../../shared-runtime.js";

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;

// Set everything up from the worker-side:
//  - "Join" shared runtime
//  - Open previously defined shared object
const rt = await SharedRuntime.worker();
const pixels = rt.openSharedObject("pixels");

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

  await pixels.requestWrite(({ bytes }) => {
    fillFrame(bytes, time);
  });

  frame += 1;
  await sleep(16);
}
