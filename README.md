# Fast Worker Communication

This is a minimal library for near-zero-overhead inter-worker communication in JavaScript.

The idea is to use [SharedArrayBuffers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) (SABs) to allow exchanging data between workers without having to use the default message-passing API, which becomes unusably slow when larger amounts data are transferred, or when the frequency of transfers is high.

> [!TIP]
> Please have a look at the `examples/` directory. It contains a number of small, well documented examples. Each subdirectory also includes a `README` file that explains the overall idea of that specific example.

### Features

To facilitate coordinated reading and writing of SABs, this library uses the following system:
- A central SharedRuntime coordinates workers and allows creation of SharedObjects.
  - On the host side, you spawn workers however your environment requires and attach them to the runtime.
- SharedObject is an abstraction over SharedArrayBuffer with:
  - A clear schema definition that describes how data is laid out in the buffer and ensures type safety.
  - Write permission handling
  - An internal ring-buffer-like data structure to prevent reading incomplete writes
  - A system to notify subscribed workers of changes (this happens through message-passing)
- SharedObjects are always readable from all workers/threads, but a write-lock must be acquired before being able to write to the buffer.
- Write locks are handed out on a FIFO basis.
