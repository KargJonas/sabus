// main thread

import SharedRuntime from ...;
import codecs from "my_codecs.ts"; // describes how data is serialized/deserialized

const rt = SharedRuntime.host(self, codecs);

// url handling happens implicitly
// name is just the second argument
const cv = await rt.spawnWorker("./cv.worker.ts", "cv-worker");
const graph = await rt.spawnWorker("./graph.worker.ts", "graph-worker");

const cnv = document.querySelector(...);
const ctx = cnv.getContext('2d');

...



// cv thread

import SharedRuntime from ...;

const rt = await SharedRuntime.worker(self);

const MyPipeLineStage = new PipelineStage();

...



// canvas drawing thread

import SharedRuntime from ...;

const rt = await SharedRuntime.worker(self); // at this point, the codecs should already be available because they were registered in the host *before* the workers were registered

...
