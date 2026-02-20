/**
 * SharedRuntime: orchestrates shared memory communication between browser workers.
 *
 * In host mode, spawns workers and manages SharedObject creation/distribution.
 * In worker mode, receives SharedObject descriptors from the host and provides
 * access to them.
 */

import { SharedObject, TypedSharedObject } from "./shared-object.js";
import type { SharedObjectConfig, SharedObjectDescriptor } from "./shared-object.js";
import { computeLayout, type SchemaDefinition } from "./schema.js";

type RuntimeMode = "host" | "worker";

interface InitMessage {
  type: "init";
  sharedObjects: SharedObjectDescriptor[];
}

interface ReadyMessage {
  type: "ready";
}

interface SharedObjectCreatedMessage {
  type: "shared-object-created";
  sharedObject: SharedObjectDescriptor;
}

type RuntimeMessage = InitMessage | ReadyMessage | SharedObjectCreatedMessage;

interface MessagePortLike {
  postMessage(message: RuntimeMessage): void;
  addMessageListener(listener: (message: unknown) => void): () => void;
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

function isReadyMessage(msg: unknown): msg is ReadyMessage {
  return isObject(msg) && msg.type === "ready";
}

function isInitMessage(msg: unknown): msg is InitMessage {
  return isObject(msg) && msg.type === "init" && Array.isArray(msg.sharedObjects);
}

function isSharedObjectCreatedMessage(msg: unknown): msg is SharedObjectCreatedMessage {
  return isObject(msg) && msg.type === "shared-object-created" && isObject(msg.sharedObject);
}

function ensurePort(): MessagePortLike {
  if (typeof document !== "undefined") {
    throw new Error("No worker message port available");
  }

  const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
  return {
    postMessage(message: RuntimeMessage): void {
      scope.postMessage(message);
    },
    addMessageListener(listener: (message: unknown) => void): () => void {
      const onMessage = (event: MessageEvent<unknown>): void => {
        listener(event.data);
      };
      scope.addEventListener("message", onMessage);
      return () => scope.removeEventListener("message", onMessage);
    },
  };
}

function send(port: MessageTarget, msg: RuntimeMessage): void {
  port.postMessage(msg);
}

export default class SharedRuntime {
  private readonly mode: RuntimeMode;
  private readonly port: MessagePortLike | null;
  private readonly sharedObjects: Map<string, SharedObject>;
  private readonly workers: Map<string, WorkerEntry>;

  constructor(mode: RuntimeMode, port: MessagePortLike | null = null) {
    this.mode = mode;
    this.port = port;
    this.sharedObjects = new Map();
    this.workers = new Map();
  }

  static host(): SharedRuntime {
    return new SharedRuntime("host");
  }

  static async worker(): Promise<SharedRuntime> {
    const port = ensurePort();
    const runtime = new SharedRuntime("worker", port);
    await runtime.waitForInit();
    return runtime;
  }

  async spawnWorker(workerPath: string, name: string): Promise<{ name: string; worker: Worker }> {
    if (this.mode !== "host") {
      throw new Error("spawnWorker is only available on host runtime");
    }

    const workerUrl = this.resolveWorkerUrl(workerPath);
    const worker = new Worker(workerUrl, { type: "module" });
    const workerThreadId = (crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff) || 1;

    const ready = new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<unknown>): void => {
        if (!isReadyMessage(event.data)) {
          return;
        }

        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        resolve();
      };

      const onError = (event: ErrorEvent): void => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(event.error instanceof Error ? event.error : new Error(event.message));
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
    });

    this.workers.set(name, { worker, threadId: workerThreadId });
    send(worker, {
      type: "init",
      sharedObjects: [...this.sharedObjects.values()].map((obj) => obj.descriptor()),
    });

    await ready;
    return { name, worker };
  }

  createSharedObject(id: string, config: SharedObjectConfig): SharedObject;
  createSharedObject<S extends SchemaDefinition>(id: string, schema: S): TypedSharedObject<S>;
  createSharedObject<S extends SchemaDefinition>(
    id: string,
    configOrSchema: SharedObjectConfig | S,
  ): SharedObject | TypedSharedObject<S> {
    if (this.sharedObjects.has(id)) {
      throw new Error(`Shared object "${id}" already exists`);
    }

    const isConfig = "byteLength" in configOrSchema && typeof configOrSchema.byteLength === "number";
    const config: SharedObjectConfig = isConfig
      ? (configOrSchema as SharedObjectConfig)
      : { byteLength: computeLayout(configOrSchema as S).byteLength };

    const obj = SharedObject.create(id, config);
    this.sharedObjects.set(id, obj);

    const descriptor = obj.descriptor();
    for (const entry of this.workers.values()) {
      send(entry.worker, { type: "shared-object-created", sharedObject: descriptor });
    }

    return isConfig ? obj : new TypedSharedObject(obj, configOrSchema as S);
  }

  openSharedObject(id: string): SharedObject;
  openSharedObject<S extends SchemaDefinition>(id: string, schema: S): TypedSharedObject<S>;
  openSharedObject<S extends SchemaDefinition>(
    id: string,
    schema?: S,
  ): SharedObject | TypedSharedObject<S> {
    const obj = this.sharedObjects.get(id);
    if (!obj) {
      throw new Error(`Shared object "${id}" not found`);
    }
    return schema ? new TypedSharedObject(obj, schema) : obj;
  }

  private async waitForInit(): Promise<void> {
    const port = this.port;
    if (!port) {
      throw new Error("Worker runtime has no message port");
    }

    await new Promise<void>((resolve) => {
      const stop = port.addMessageListener((msg: unknown): void => {
        if (!isInitMessage(msg)) {
          return;
        }

        for (const descriptor of msg.sharedObjects) {
          this.sharedObjects.set(descriptor.id, SharedObject.fromDescriptor(descriptor));
        }

        send(port, { type: "ready" });
        stop();
        resolve();
      });
    });

    port.addMessageListener((msg: unknown): void => {
      if (!isSharedObjectCreatedMessage(msg)) {
        return;
      }

      const descriptor = msg.sharedObject;
      this.sharedObjects.set(descriptor.id, SharedObject.fromDescriptor(descriptor));
    });
  }

  private resolveWorkerUrl(workerPath: string): URL {
    return new URL(workerPath, import.meta.url);
  }
}
