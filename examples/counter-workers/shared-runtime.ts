import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker, parentPort, workerData } from "node:worker_threads";
import { SharedObject } from "./shared-object.js";
import type { SharedObjectConfig, SharedObjectDescriptor } from "./shared-object.js";

type RuntimeMode = "host" | "worker";

interface WorkerBootstrapData {
  name?: string;
}

interface InitMessage {
  type: "init";
  name: string;
  sharedObjects: SharedObjectDescriptor[];
}

interface ReadyMessage {
  type: "ready";
  name: string;
}

interface SharedObjectCreatedMessage {
  type: "shared-object-created";
  sharedObject: SharedObjectDescriptor;
}

type RuntimeMessage = InitMessage | ReadyMessage | SharedObjectCreatedMessage;

interface MessagePortLike {
  postMessage(message: RuntimeMessage): void;
  on(event: "message", listener: (message: unknown) => void): this;
  off(event: "message", listener: (message: unknown) => void): this;
}

interface MessageTarget {
  postMessage(message: RuntimeMessage): void;
}

interface WorkerEntry {
  worker: Worker;
  threadId: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMessagePortLike(portLike: unknown): portLike is MessagePortLike {
  if (!isObject(portLike)) {
    return false;
  }

  return (
    typeof portLike.postMessage === "function"
    && typeof portLike.on === "function"
    && typeof portLike.off === "function"
  );
}

function isReadyMessage(msg: unknown): msg is ReadyMessage {
  return isObject(msg) && msg.type === "ready";
}

function isInitMessage(msg: unknown): msg is InitMessage {
  return isObject(msg) && msg.type === "init" && Array.isArray(msg.sharedObjects);
}

function isSharedObjectCreatedMessage(msg: unknown): msg is SharedObjectCreatedMessage {
  return isObject(msg) && msg.type === "shared-object-created" && isObject(msg.sharedObject);
}

function ensurePort(portLike: unknown): MessagePortLike {
  if (isMessagePortLike(portLike)) {
    return portLike;
  }
  if (parentPort) return parentPort;
  throw new Error("No worker message port available");
}

function send(port: MessageTarget, msg: RuntimeMessage): void {
  port.postMessage(msg);
}

export default class SharedRuntime {
  private readonly mode: RuntimeMode;
  private readonly port: MessagePortLike | null;
  private readonly name: string;
  private readonly sharedObjects: Map<string, SharedObject>;
  private readonly workers: Map<string, WorkerEntry>;

  constructor(mode: RuntimeMode, port: MessagePortLike | null = null, name = "host") {
    this.mode = mode;
    this.port = port;
    this.name = name;
    this.sharedObjects = new Map();
    this.workers = new Map();
  }

  static host(_self: unknown, _codecs: unknown): SharedRuntime {
    return new SharedRuntime("host");
  }

  static async worker(_self: unknown, _codecs: unknown): Promise<SharedRuntime> {
    const port = ensurePort(_self);
    const bootstrap = workerData as WorkerBootstrapData | undefined;
    const runtime = new SharedRuntime("worker", port, bootstrap?.name ?? "worker");
    await runtime.waitForInit();
    return runtime;
  }

  async spawnWorker(workerPath: string, name: string): Promise<{ name: string }> {
    if (this.mode !== "host") {
      throw new Error("spawnWorker is only available on host runtime");
    }

    const workerUrl = this.resolveWorkerUrl(workerPath);

    const worker = new Worker(workerUrl, {
      workerData: { name },
    });
    const workerThreadId = worker.threadId;

    const ready = new Promise<void>((resolve, reject) => {
      const onMessage = (msg: unknown): void => {
        if (isReadyMessage(msg)) {
          worker.off("message", onMessage);
          resolve();
        }
      };
      worker.on("message", onMessage);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        this.handleWorkerExit(name, workerThreadId);
        if (code !== 0) {
          reject(new Error(`Worker "${name}" exited with code ${code}`));
        }
      });
    });

    this.workers.set(name, { worker, threadId: workerThreadId });
    send(worker, {
      type: "init",
      name,
      sharedObjects: [...this.sharedObjects.values()].map((obj) => obj.descriptor()),
    });

    await ready;
    return { name };
  }

  createSharedObject(id: string, config: SharedObjectConfig): SharedObject {
    if (this.sharedObjects.has(id)) {
      throw new Error(`Shared object "${id}" already exists`);
    }

    const obj = SharedObject.create(id, config);
    this.sharedObjects.set(id, obj);

    const descriptor = obj.descriptor();
    for (const entry of this.workers.values()) {
      send(entry.worker, { type: "shared-object-created", sharedObject: descriptor });
    }
    return obj;
  }

  openSharedObject(id: string): SharedObject {
    const obj = this.sharedObjects.get(id);
    if (!obj) {
      throw new Error(`Shared object "${id}" not found`);
    }
    return obj;
  }

  private async waitForInit(): Promise<void> {
    const port = this.port;
    if (!port) {
      throw new Error("Worker runtime has no message port");
    }

    await new Promise<void>((resolve) => {
      const onMessage = (msg: unknown): void => {
        if (isInitMessage(msg)) {
          for (const descriptor of msg.sharedObjects) {
            this.sharedObjects.set(descriptor.id, SharedObject.fromDescriptor(descriptor));
          }
          send(port, { type: "ready", name: this.name });
          port.off("message", onMessage);
          resolve();
        }
      };
      port.on("message", onMessage);
    });

    port.on("message", (msg: unknown) => {
      if (isSharedObjectCreatedMessage(msg)) {
        const descriptor = msg.sharedObject;
        this.sharedObjects.set(descriptor.id, SharedObject.fromDescriptor(descriptor));
      }
    });
  }

  private handleWorkerExit(name: string, deadThreadId: number): void {
    const workerEntry = this.workers.get(name);
    if (workerEntry?.threadId === deadThreadId) {
      this.workers.delete(name);
    }

    const lockedObjectIds: string[] = [];
    for (const obj of this.sharedObjects.values()) {
      if (obj.markWriterThreadDied(deadThreadId)) {
        lockedObjectIds.push(obj.id);
      }
    }

    if (lockedObjectIds.length === 0) {
      return;
    }

    const objectList = lockedObjectIds.map((id) => `"${id}"`).join(", ");
    const message = `Worker "${name}" (thread ${deadThreadId}) exited while holding write lock(s) on ${objectList}`;
    queueMicrotask(() => {
      throw new Error(message);
    });
  }

  private resolveWorkerUrl(workerPath: string): URL {
    if (workerPath.startsWith("file://")) {
      return new URL(workerPath);
    }

    if (path.isAbsolute(workerPath)) {
      return pathToFileURL(workerPath);
    }

    return new URL(workerPath, import.meta.url);
  }
}
