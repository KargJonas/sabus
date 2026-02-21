export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function cleanupSharedObject(sharedObject) {
  if (!sharedObject) {
    return;
  }

  const channel = sharedObject.notifyChannel;
  if (!channel) {
    return;
  }

  if (typeof channel.unref === "function") {
    channel.unref();
  }

  if (typeof channel.close === "function") {
    channel.close();
  }
}

export function cleanupRuntime(runtime) {
  if (!runtime) {
    return;
  }

  const sharedObjects = runtime.sharedObjects;
  if (!(sharedObjects instanceof Map)) {
    return;
  }

  for (const sharedObject of sharedObjects.values()) {
    cleanupSharedObject(sharedObject);
  }
}
