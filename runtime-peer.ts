/**
 * Runtime message peer adapters.
 *
 * Converts browser- and Node-style worker endpoints into a uniform RuntimePeer.
 * Also provides worker-side auto-detection for SharedRuntime.worker().
 */

export interface RuntimePeer {
  postMessage(message: unknown): void;
  addMessageListener(listener: (message: unknown) => void): () => void;
}

interface BrowserPeerEndpoint {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

interface NodePeerEndpoint {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): void;
  off?(event: "message", listener: (message: unknown) => void): void;
  removeListener?(event: "message", listener: (message: unknown) => void): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBrowserPeerEndpoint(value: unknown): value is BrowserPeerEndpoint {
  return (
    isObject(value) &&
    typeof value.postMessage === "function" &&
    typeof value.addEventListener === "function" &&
    typeof value.removeEventListener === "function"
  );
}

function isNodePeerEndpoint(value: unknown): value is NodePeerEndpoint {
  return (
    isObject(value) &&
    typeof value.postMessage === "function" &&
    typeof value.on === "function"
  );
}

export function createRuntimePeer(endpoint: unknown): RuntimePeer {
  if (isBrowserPeerEndpoint(endpoint)) {
    return {
      postMessage(message: unknown): void {
        endpoint.postMessage(message);
      },

      addMessageListener(listener: (message: unknown) => void): () => void {
        const onMessage = (event: MessageEvent<unknown>): void => {
          listener(event.data);
        };
        endpoint.addEventListener("message", onMessage);
        return () => endpoint.removeEventListener("message", onMessage);
      },
    };
  }

  if (isNodePeerEndpoint(endpoint)) {
    return {
      postMessage(message: unknown): void {
        endpoint.postMessage(message);
      },

      addMessageListener(listener: (message: unknown) => void): () => void {
        const onMessage = (message: unknown): void => {
          listener(message);
        };
        endpoint.on("message", onMessage);
        return () => {
          if (typeof endpoint.off === "function") {
            endpoint.off("message", onMessage);
            return;
          }
          endpoint.removeListener?.("message", onMessage);
        };
      },
    };
  }

  throw new Error("Unsupported worker endpoint: expected browser Worker/worker scope or Node worker endpoint");
}

function detectBrowserWorkerEndpoint(): unknown {
  const g = globalThis as {
    document?: unknown;
    postMessage?: unknown;
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };

  if (
    typeof g.document === "undefined" &&
    typeof g.postMessage === "function" &&
    typeof g.addEventListener === "function" &&
    typeof g.removeEventListener === "function"
  ) return g;

  return null;
}

function isNodeLikeRuntime(): boolean {
  const processLike = (globalThis as Record<string, unknown>).process as
    | { versions?: { node?: unknown } }
    | undefined;

  return typeof processLike?.versions?.node === "string";
}

async function detectNodeParentPortEndpoint(): Promise<unknown> {
  if (!isNodeLikeRuntime()) return null;

  try {
    const dynamicImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const mod = await dynamicImport("node:worker_threads");
    if (!isObject(mod)) return null;
    return mod.parentPort ?? null;
  } catch { return null; }
}

export async function detectCurrentWorkerPeer(): Promise<RuntimePeer> {
  const browserEndpoint = detectBrowserWorkerEndpoint();
  if (browserEndpoint) return createRuntimePeer(browserEndpoint);
  const nodeEndpoint = await detectNodeParentPortEndpoint();
  if (nodeEndpoint) return createRuntimePeer(nodeEndpoint);
  throw new Error("No worker message endpoint available in this environment");
}
