import { SharedFrameObject } from "./shared-object-layout";
import { PixelFormat } from "./generated/shared/objectlayout/pixel-format";

const shared = SharedFrameObject.create({
  width: 1280,
  height: 720,
  format: PixelFormat.RGBA8,
});

// Simulate passing SAB handles to another thread.
const writerSide = SharedFrameObject.fromState(shared.exportState());
const readerSide = SharedFrameObject.fromState(shared.exportState());

const writer = writerSide.writer();
writer.write((frame) => {
  frame.bytes.fill(127);
  frame.meta.timestampMs = performance.now();
});

const reader = readerSide.reader();
const latest = reader.readLatest();

if (!latest) {
  throw new Error("Expected latest frame");
}

console.log("Read latest shared frame:", {
  seq: latest.meta.seq,
  width: latest.meta.width,
  height: latest.meta.height,
  bytesPerRow: latest.meta.bytesPerRow,
  timestampMs: latest.meta.timestampMs,
  format: PixelFormat[latest.meta.format],
  bytesLength: latest.bytes.length,
  firstPixel: latest.bytes[0],
});
