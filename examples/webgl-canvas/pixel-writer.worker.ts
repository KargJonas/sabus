import SharedRuntime from "../../shared-runtime.js";

const WIDTH = 320;
const HEIGHT = 180;

const rt = await SharedRuntime.worker();
const pixels = rt.openSharedObject("pixels");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let frame = 0;
for (; ;) {
  const t = frame * 0.04;

  await pixels.requestWrite(({ bytes }) => {
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const i = (y * WIDTH + x) * 4;
        const fx = x / WIDTH;
        const fy = y / HEIGHT;

        bytes[i] = 128 + 127 * Math.sin(fx * 8 + t);
        bytes[i + 1] = 128 + 127 * Math.sin(fy * 8 + t * 1.3);
        bytes[i + 2] = 128 + 127 * Math.sin((fx + fy) * 12 - t * 0.7);
        bytes[i + 3] = 255;
      }
    }
  });

  frame += 1;
  await sleep(16);
}
