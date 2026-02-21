/**
 * SharedObject: synchronized access to a SharedArrayBuffer across threads.
 *
 * Provides a triple-buffered ring of data slots with a sequence lock for lock-free
 * reads and a ticket-lock for serialized writes. TypedSharedObject wraps a
 * SharedObject with a schema to provide typed read/write access.
 */

import {
  computeLayout,
  readSnapshot,
  writeFields,
  type Layout,
  type SchemaDefinition,
  type SchemaValues,
  type SchemaWriteValues,
} from "./schema.js";

const localThreadId = (crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff) || 1;

const CTRL_PUBLISHED_SLOT = 0;
const CTRL_SEQ = 1;
const CTRL_NEXT_TICKET = 2;
const CTRL_SERVING_TICKET = 3;
const CTRL_WRITE_OWNER_THREAD_ID = 4;
const CTRL_WORDS = 5;

const NO_OWNER_THREAD_ID = -1;

export interface SharedObjectConfig {
  byteLength: number;
}

export interface SharedObjectDescriptor {
  id: string;
  byteLength: number;
  slotCount: number;
  dataSab: SharedArrayBuffer;
  controlSab: SharedArrayBuffer;
}

export interface SharedObjectWriteContext {
  bytes: Uint8Array;
  dataView: DataView;
  seq: number;
}

export type SharedObjectReadSnapshot = SharedObjectWriteContext;
export type SharedObjectWriteCallback<TReturn = void> = (
  ctx: SharedObjectWriteContext,
) => TReturn | Promise<TReturn>;

export interface TypedSharedObjectWriteContext<S extends SchemaDefinition>
  extends SharedObjectWriteContext {
  view: SchemaValues<S>;
  set(values: Partial<SchemaWriteValues<S>>): void;
}

export type TypedSharedObjectWriteCallback<S extends SchemaDefinition, TReturn = void> = (
  ctx: TypedSharedObjectWriteContext<S>,
) => TReturn | Promise<TReturn>;

type WaitAsyncResultLike = {
  async: boolean;
  value: PromiseLike<string> | string;
};

type WaitAsyncFunction = (
  typedArray: Int32Array,
  index: number,
  value: number,
  timeout?: number,
) => WaitAsyncResultLike;

const atomicsWithWaitAsync = Atomics as unknown as {
  waitAsync?: WaitAsyncFunction;
};

export class SharedObject {
  readonly id: string;
  readonly byteLength: number;
  readonly slotCount: number;
  readonly dataSab: SharedArrayBuffer;
  readonly controlSab: SharedArrayBuffer;
  private readonly control: Int32Array;
  private readonly notifyChannel: BroadcastChannel;

  constructor(descriptor: SharedObjectDescriptor) {
    this.id = descriptor.id;
    this.byteLength = descriptor.byteLength;
    this.slotCount = descriptor.slotCount;
    this.dataSab = descriptor.dataSab;
    this.controlSab = descriptor.controlSab;
    this.control = new Int32Array(this.controlSab);
    this.notifyChannel = new BroadcastChannel(`shared-object:${this.id}`);
  }

  static create(id: string, config: SharedObjectConfig): SharedObject {
    const byteLength = config.byteLength;
    const slotCount = 3;
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw new Error(`byteLength must be a positive integer, got ${byteLength}`);
    }

    const descriptor: SharedObjectDescriptor = {
      id,
      byteLength,
      slotCount,
      dataSab: new SharedArrayBuffer(slotCount * byteLength),
      controlSab: new SharedArrayBuffer(CTRL_WORDS * Int32Array.BYTES_PER_ELEMENT),
    };
    const obj = new SharedObject(descriptor);
    Atomics.store(obj.control, CTRL_PUBLISHED_SLOT, -1);
    Atomics.store(obj.control, CTRL_SEQ, 0);
    Atomics.store(obj.control, CTRL_NEXT_TICKET, 0);
    Atomics.store(obj.control, CTRL_SERVING_TICKET, 0);
    Atomics.store(obj.control, CTRL_WRITE_OWNER_THREAD_ID, NO_OWNER_THREAD_ID);
    return obj;
  }

  static fromDescriptor(descriptor: SharedObjectDescriptor): SharedObject {
    return new SharedObject(descriptor);
  }

  descriptor(): SharedObjectDescriptor {
    return {
      id: this.id,
      byteLength: this.byteLength,
      slotCount: this.slotCount,
      dataSab: this.dataSab,
      controlSab: this.controlSab,
    };
  }

  async requestWrite<TReturn>(cb: SharedObjectWriteCallback<TReturn>): Promise<TReturn> {
    if (Atomics.load(this.control, CTRL_WRITE_OWNER_THREAD_ID) === localThreadId) {
      throw new Error(`Reentrant writes are not supported for shared object "${this.id}"`);
    }

    const ticket = Atomics.add(this.control, CTRL_NEXT_TICKET, 1);
    await this.waitForTurn(ticket);

    Atomics.store(this.control, CTRL_WRITE_OWNER_THREAD_ID, localThreadId);
    try     { return await this.writeUnlocked(cb); }
    finally { this.releaseWriteLock(); }
  }

  private async writeUnlocked<TReturn>(
    cb: SharedObjectWriteCallback<TReturn>,
  ): Promise<TReturn> {
    const nextSeq = (Atomics.load(this.control, CTRL_SEQ) + 1) >>> 0;
    const slotIndex = nextSeq % this.slotCount;
    const offset = slotIndex * this.byteLength;
    const bytes = new Uint8Array(this.dataSab, offset, this.byteLength);
    const dataView = new DataView(this.dataSab, offset, this.byteLength);

    const result = await cb({ bytes, dataView, seq: nextSeq });

    Atomics.store(this.control, CTRL_PUBLISHED_SLOT, slotIndex);
    Atomics.store(this.control, CTRL_SEQ, nextSeq);
    this.notifyChannel.postMessage(null);
    return result;
  }

  subscribe(callback: () => void): () => void {
    const channel = new BroadcastChannel(`shared-object:${this.id}`);
    channel.onmessage = callback;
    return () => channel.close();
  }

  readLatest(): SharedObjectReadSnapshot | null {
    for (let attempts = 0; attempts < 4; attempts += 1) {
      const seq1 = Atomics.load(this.control, CTRL_SEQ);
      const slotIndex = Atomics.load(this.control, CTRL_PUBLISHED_SLOT);
      if (slotIndex < 0) return null;

      const offset = slotIndex * this.byteLength;
      const bytes = new Uint8Array(this.dataSab, offset, this.byteLength);
      const dataView = new DataView(this.dataSab, offset, this.byteLength);
      const seq2 = Atomics.load(this.control, CTRL_SEQ);
      if (seq1 === seq2) return { seq: seq1 >>> 0, bytes, dataView };
    }
    return null;
  }

  private async waitForTurn(ticket: number): Promise<void> {
    for (; ;) {
      const servingTicket = Atomics.load(this.control, CTRL_SERVING_TICKET);
      if (servingTicket === ticket) return;

      const waitAsync = atomicsWithWaitAsync.waitAsync;
      if (typeof waitAsync === "function") {
        const waitResult = waitAsync(this.control, CTRL_SERVING_TICKET, servingTicket);
        if (typeof waitResult.value !== "string") await waitResult.value;
        continue;
      }

      // Fallback path for runtimes without Atomics.waitAsync.
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
  }

  private releaseWriteLock(): void {
    const ownerThreadId = Atomics.load(this.control, CTRL_WRITE_OWNER_THREAD_ID);
    if (ownerThreadId !== localThreadId) {
      throw new Error(`Thread ${localThreadId} attempted to release write lock owned by ${ownerThreadId}`);
    }

    Atomics.store(this.control, CTRL_WRITE_OWNER_THREAD_ID, NO_OWNER_THREAD_ID);
    Atomics.add(this.control, CTRL_SERVING_TICKET, 1);
    Atomics.notify(this.control, CTRL_SERVING_TICKET, 1);
  }
}

export class TypedSharedObject<S extends SchemaDefinition> {
  readonly inner: SharedObject;
  readonly layout: Layout<S>;

  constructor(inner: SharedObject, schema: S) {
    this.inner = inner;
    this.layout = computeLayout(schema);
  }

  async requestWrite<TReturn>(cb: TypedSharedObjectWriteCallback<S, TReturn>): Promise<TReturn> {
    return this.inner.requestWrite((ctx) => {
      const set = (values: Partial<SchemaWriteValues<S>>): void => {
        writeFields(this.layout, ctx.dataView, values);
      };
      return cb({
        ...ctx,
        view: readSnapshot(this.layout, ctx.dataView),
        set,
      });
    });
  }

  async write(values: Partial<SchemaWriteValues<S>>): Promise<void> {
    await this.inner.requestWrite(({ dataView }) => writeFields(this.layout, dataView, values));
  }

  read(): (SchemaValues<S> & { seq: number }) | null {
    const snap = this.inner.readLatest();
    if (!snap) return null;
    return { ...readSnapshot(this.layout, snap.dataView), seq: snap.seq };
  }

  subscribe(callback: () => void): () => void {
    return this.inner.subscribe(callback);
  }
}
