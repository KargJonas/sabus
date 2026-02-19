// main thread

import SharedRuntime from "...";
import codecs from "my_codecs.ts";

const rt = SharedRuntime.host(self, codecs);

const cv = await rt.spawnWorker("./cv.worker.ts", "cv-worker");
const graph = await rt.spawnWorker("./graph.worker.ts", "graph-worker");

// create one shared object
// all workers can read it by default
const frames = rt.createSharedObject("cam-0-frames", {
  width: 1280,
  height: 720,
  format: "rgba8",
});

// optional: transfer initial write ownership to cv worker
await frames.transferWrite("cv-worker");


// cv thread

import SharedRuntime from "...";

const rt = await SharedRuntime.worker(self);
const frames = rt.openSharedObject("cam-0-frames");
const writer = await frames.acquireWriter();

function onPipelineFrame(frame: Uint8ClampedArray) {
  writer.write((slot) => {
    slot.bytes.set(frame);
  }); // beginWrite/commit happen implicitly
}


// canvas drawing thread

import SharedRuntime from "...";

const rt = await SharedRuntime.worker(self);
const frames = rt.openSharedObject("cam-0-frames");
const reader = frames.reader(); // always readable

const cnv = self.canvas;
const ctx = cnv.getContext("2d");

function drawLoop() {
  const frame = reader.readLatest(); // event-less polling
  if (frame) ctx.putImageData(frame.imageData, 0, 0);
  requestAnimationFrame(drawLoop);
}

drawLoop();
