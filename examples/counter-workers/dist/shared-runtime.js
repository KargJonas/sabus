import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker, parentPort, workerData } from "node:worker_threads";
import { SharedObject } from "./shared-object.js";
function isObject(value) {
    return typeof value === "object" && value !== null;
}
function isMessagePortLike(portLike) {
    if (!isObject(portLike)) {
        return false;
    }
    return (typeof portLike.postMessage === "function"
        && typeof portLike.on === "function"
        && typeof portLike.off === "function");
}
function isReadyMessage(msg) {
    return isObject(msg) && msg.type === "ready";
}
function isInitMessage(msg) {
    return isObject(msg) && msg.type === "init" && Array.isArray(msg.sharedObjects);
}
function isSharedObjectCreatedMessage(msg) {
    return isObject(msg) && msg.type === "shared-object-created" && isObject(msg.sharedObject);
}
function ensurePort(portLike) {
    if (isMessagePortLike(portLike)) {
        return portLike;
    }
    if (parentPort)
        return parentPort;
    throw new Error("No worker message port available");
}
function send(port, msg) {
    port.postMessage(msg);
}
export default class SharedRuntime {
    mode;
    port;
    name;
    sharedObjects;
    workers;
    constructor(mode, port = null, name = "host") {
        this.mode = mode;
        this.port = port;
        this.name = name;
        this.sharedObjects = new Map();
        this.workers = new Map();
    }
    static host(_self, _codecs) {
        return new SharedRuntime("host");
    }
    static async worker(_self, _codecs) {
        const port = ensurePort(_self);
        const bootstrap = workerData;
        const runtime = new SharedRuntime("worker", port, bootstrap?.name ?? "worker");
        await runtime.waitForInit();
        return runtime;
    }
    async spawnWorker(workerPath, name) {
        if (this.mode !== "host") {
            throw new Error("spawnWorker is only available on host runtime");
        }
        const workerUrl = workerPath instanceof URL
            ? workerPath
            : pathToFileURL(path.resolve(process.cwd(), workerPath));
        const worker = new Worker(workerUrl, {
            workerData: { name },
        });
        const ready = new Promise((resolve, reject) => {
            const onMessage = (msg) => {
                if (isReadyMessage(msg)) {
                    worker.off("message", onMessage);
                    resolve();
                }
            };
            worker.on("message", onMessage);
            worker.on("error", reject);
            worker.on("exit", (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker "${name}" exited with code ${code}`));
                }
            });
        });
        this.workers.set(name, worker);
        send(worker, {
            type: "init",
            name,
            sharedObjects: [...this.sharedObjects.values()].map((obj) => obj.descriptor()),
        });
        await ready;
        return { name };
    }
    createSharedObject(id, config) {
        if (this.sharedObjects.has(id)) {
            throw new Error(`Shared object "${id}" already exists`);
        }
        const obj = SharedObject.create(id, config);
        this.sharedObjects.set(id, obj);
        const descriptor = obj.descriptor();
        for (const worker of this.workers.values()) {
            send(worker, { type: "shared-object-created", sharedObject: descriptor });
        }
        return obj;
    }
    openSharedObject(id) {
        const obj = this.sharedObjects.get(id);
        if (!obj) {
            throw new Error(`Shared object "${id}" not found`);
        }
        return obj;
    }
    async waitForInit() {
        const port = this.port;
        if (!port) {
            throw new Error("Worker runtime has no message port");
        }
        await new Promise((resolve) => {
            const onMessage = (msg) => {
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
        port.on("message", (msg) => {
            if (isSharedObjectCreatedMessage(msg)) {
                const descriptor = msg.sharedObject;
                this.sharedObjects.set(descriptor.id, SharedObject.fromDescriptor(descriptor));
            }
        });
    }
}
