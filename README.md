# Fast Worker Communication

This is a minimal library for near-zero-overhead inter-worker communication in JavaScript.

The idea is to use [SharedArrayBuffers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) SABs) to allow exchanging data between workers without having to use the default message-passing API, which becomes unusably slow when larger amounts data are transferred, or when the frequency of transfers is high.

To facilitate coordinated reading and writing of SABs, this library uses the following system:
- A central SharedRuntime spawns workers and allows creations of SharedObjects.
- SharedObject is an abstraction over SharedArrayBuffer with an internal ring-buffer data structure, and write permission handling.
- SharedObjects are always readable from all workers/threads, but a write-lock must be acquired before being able to write to the buffer.
- Write locks are handed out on a FIFO basis.
