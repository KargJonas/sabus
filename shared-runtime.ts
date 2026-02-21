/**
 * SharedRuntime: orchestrates shared memory communication between host and workers.
 *
 * In host mode, callers attach worker endpoints and manage SharedObject creation/distribution.
 * In worker mode, runtime receives SharedObject descriptors from the host and provides
 * access to them.
 */

import { SharedObject, TypedSharedObject } from "./shared-object.js";
import type { SharedObjectConfig, SharedObjectDescriptor } from "./shared-object.js";
import { computeLayout, type SchemaDefinition } from "./schema.js";
import { createRuntimePeer, detectCurrentWorkerPeer, type RuntimePeer } from "./runtime-peer.js";

type RuntimeMode = "host" | "worker";

interface InitMessage {
  type: "init";
  sharedObjects: SharedObjectDescriptor[];
  setupData?: unknown;
}

interface ReadyMessage {
  type: "ready";
}

interface SharedObjectCreatedMessage {
  type: "shared-object-created";
  sharedObject: SharedObjectDescriptor;
}

type RuntimeMessage = InitMessage | ReadyMessage | SharedObjectCreatedMessage;

interface MessageTarget {
  postMessage(message: RuntimeMessage): void;
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

function send(port: MessageTarget, msg: RuntimeMessage): void {
  port.postMessage(msg);
}

export default class SharedRuntime {
  private readonly mode: RuntimeMode;
  private readonly port: RuntimePeer | null;
  private readonly sharedObjects: Map<string, SharedObject>;
  private readonly workers: Map<string, RuntimePeer>;
  private workerSetupData: unknown;

  constructor(mode: RuntimeMode, port: RuntimePeer | null = null) {
    this.mode = mode;
    this.port = port;
    this.sharedObjects = new Map();
    this.workers = new Map();
    this.workerSetupData = undefined;
  }

  static host(): SharedRuntime {
    return new SharedRuntime("host");
  }

  static async worker(endpoint?: unknown): Promise<SharedRuntime> {
    const port = endpoint ? createRuntimePeer(endpoint) : await detectCurrentWorkerPeer();
    const runtime = new SharedRuntime("worker", port);
    await runtime.waitForInit();
    return runtime;
  }

  async attachWorker(name: string, endpoint: unknown, setupData?: unknown): Promise<void> {
    if (this.mode !== "host") throw new Error("attachWorker is only available on host runtime");
    if (this.workers.has(name)) throw new Error(`Worker "${name}" already attached`);

    const peer = createRuntimePeer(endpoint);
    const ready = new Promise<void>((resolve) => {
      const stop = peer.addMessageListener((msg: unknown): void => {
        if (!isReadyMessage(msg)) return;
        stop();
        resolve();
      });
    });

    this.workers.set(name, peer);
    send(peer, {
      type: "init",
      sharedObjects: [...this.sharedObjects.values()].map((obj) => obj.descriptor()),
      setupData,
    });

    await ready;
  }

  createSharedObject(id: string, config: SharedObjectConfig): SharedObject;
  createSharedObject<S extends SchemaDefinition>(id: string, schema: S): TypedSharedObject<S>;
  createSharedObject<S extends SchemaDefinition>(id: string, configOrSchema: SharedObjectConfig | S): SharedObject | TypedSharedObject<S> {
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
    for (const peer of this.workers.values()) {
      send(peer, { type: "shared-object-created", sharedObject: descriptor });
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
    if (!obj) throw new Error(`Shared object "${id}" not found`);
    return schema ? new TypedSharedObject(obj, schema) : obj;
  }

  getWorkerSetupData<TSetup = unknown>(): TSetup | undefined {
    return this.workerSetupData as TSetup | undefined;
  }

  private async waitForInit(): Promise<void> {
    const port = this.port;
    if (!port) throw new Error("Worker runtime has no message port");

    await new Promise<void>((resolve) => {
      const stop = port.addMessageListener((msg: unknown): void => {
        if (!isInitMessage(msg)) return;

        for (const descriptor of msg.sharedObjects) {
          this.sharedObjects.set(descriptor.id, SharedObject.fromDescriptor(descriptor));
        }
        this.workerSetupData = msg.setupData;

        send(port, { type: "ready" });
        stop();
        resolve();
      });
    });

    port.addMessageListener((msg: unknown): void => {
      if (!isSharedObjectCreatedMessage(msg)) return;
      const descriptor = msg.sharedObject;
      this.sharedObjects.set(descriptor.id, SharedObject.fromDescriptor(descriptor));
    });
  }
}
