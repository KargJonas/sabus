import { threadId as localThreadId } from "node:worker_threads";
const CTRL_PUBLISHED_SLOT = 0;
const CTRL_SEQ = 1;
const CTRL_NEXT_TICKET = 2;
const CTRL_SERVING_TICKET = 3;
const CTRL_WRITE_OWNER_THREAD_ID = 4;
const CTRL_WRITE_REENTRANCE_DEPTH = 5;
const CTRL_FATAL_WRITE_OWNER_DIED = 6;
const CTRL_WORDS = 7;
const NO_OWNER_THREAD_ID = -1;
const atomicsWithWaitAsync = Atomics;
export class SharedObject {
    id;
    byteLength;
    slotCount;
    dataSab;
    controlSab;
    control;
    constructor(descriptor) {
        this.id = descriptor.id;
        this.byteLength = descriptor.byteLength;
        this.slotCount = descriptor.slotCount;
        this.dataSab = descriptor.dataSab;
        this.controlSab = descriptor.controlSab;
        this.control = new Int32Array(this.controlSab);
    }
    static create(id, config) {
        const byteLength = config.byteLength;
        const slotCount = 3;
        if (!Number.isInteger(byteLength) || byteLength <= 0) {
            throw new Error(`byteLength must be a positive integer, got ${byteLength}`);
        }
        const descriptor = {
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
        Atomics.store(obj.control, CTRL_WRITE_REENTRANCE_DEPTH, 0);
        Atomics.store(obj.control, CTRL_FATAL_WRITE_OWNER_DIED, 0);
        return obj;
    }
    static fromDescriptor(descriptor) {
        return new SharedObject(descriptor);
    }
    descriptor() {
        return {
            id: this.id,
            byteLength: this.byteLength,
            slotCount: this.slotCount,
            dataSab: this.dataSab,
            controlSab: this.controlSab,
        };
    }
    writer() {
        return new SharedObjectWriter(this);
    }
    reader() {
        return new SharedObjectReader(this);
    }
    async requestWrite(cb) {
        this.throwIfFatalWriteState();
        if (Atomics.load(this.control, CTRL_WRITE_OWNER_THREAD_ID) === localThreadId) {
            Atomics.add(this.control, CTRL_WRITE_REENTRANCE_DEPTH, 1);
            try {
                return await this.writeUnlocked(cb);
            }
            finally {
                this.releaseWriteLock();
            }
        }
        const ticket = Atomics.add(this.control, CTRL_NEXT_TICKET, 1);
        await this.waitForTurn(ticket);
        this.throwIfFatalWriteState();
        Atomics.store(this.control, CTRL_WRITE_OWNER_THREAD_ID, localThreadId);
        Atomics.store(this.control, CTRL_WRITE_REENTRANCE_DEPTH, 1);
        try {
            return await this.writeUnlocked(cb);
        }
        finally {
            this.releaseWriteLock();
        }
    }
    markWriterThreadDied(deadThreadId) {
        if (Atomics.load(this.control, CTRL_WRITE_OWNER_THREAD_ID) !== deadThreadId) {
            return false;
        }
        Atomics.store(this.control, CTRL_FATAL_WRITE_OWNER_DIED, 1);
        Atomics.store(this.control, CTRL_WRITE_OWNER_THREAD_ID, NO_OWNER_THREAD_ID);
        Atomics.store(this.control, CTRL_WRITE_REENTRANCE_DEPTH, 0);
        Atomics.notify(this.control, CTRL_SERVING_TICKET);
        return true;
    }
    async writeUnlocked(cb) {
        const nextSeq = (Atomics.load(this.control, CTRL_SEQ) + 1) >>> 0;
        const slotIndex = nextSeq % this.slotCount;
        const offset = slotIndex * this.byteLength;
        const bytes = new Uint8Array(this.dataSab, offset, this.byteLength);
        const dataView = new DataView(this.dataSab, offset, this.byteLength);
        const result = await cb({ bytes, dataView, seq: nextSeq });
        Atomics.store(this.control, CTRL_PUBLISHED_SLOT, slotIndex);
        Atomics.store(this.control, CTRL_SEQ, nextSeq);
        return result;
    }
    readLatest() {
        for (let attempts = 0; attempts < 4; attempts += 1) {
            const seq1 = Atomics.load(this.control, CTRL_SEQ);
            const slotIndex = Atomics.load(this.control, CTRL_PUBLISHED_SLOT);
            if (slotIndex < 0)
                return null;
            const offset = slotIndex * this.byteLength;
            const bytes = new Uint8Array(this.dataSab, offset, this.byteLength);
            const dataView = new DataView(this.dataSab, offset, this.byteLength);
            const seq2 = Atomics.load(this.control, CTRL_SEQ);
            if (seq1 === seq2) {
                return { seq: seq1 >>> 0, bytes, dataView };
            }
        }
        return null;
    }
    async waitForTurn(ticket) {
        for (;;) {
            this.throwIfFatalWriteState();
            const servingTicket = Atomics.load(this.control, CTRL_SERVING_TICKET);
            if (servingTicket === ticket) {
                return;
            }
            const waitAsync = atomicsWithWaitAsync.waitAsync;
            if (typeof waitAsync === "function") {
                const waitResult = waitAsync(this.control, CTRL_SERVING_TICKET, servingTicket);
                if (typeof waitResult.value !== "string") {
                    await waitResult.value;
                }
                continue;
            }
            // Fallback path for runtimes without Atomics.waitAsync.
            Atomics.wait(this.control, CTRL_SERVING_TICKET, servingTicket, 10);
        }
    }
    releaseWriteLock() {
        const ownerThreadId = Atomics.load(this.control, CTRL_WRITE_OWNER_THREAD_ID);
        if (ownerThreadId !== localThreadId) {
            throw new Error(`Thread ${localThreadId} attempted to release write lock owned by ${ownerThreadId}`);
        }
        const currentDepth = Atomics.load(this.control, CTRL_WRITE_REENTRANCE_DEPTH);
        if (currentDepth <= 0) {
            throw new Error(`Invalid write lock depth ${currentDepth} on shared object "${this.id}"`);
        }
        const remainingDepth = currentDepth - 1;
        Atomics.store(this.control, CTRL_WRITE_REENTRANCE_DEPTH, remainingDepth);
        if (remainingDepth > 0) {
            return;
        }
        Atomics.store(this.control, CTRL_WRITE_OWNER_THREAD_ID, NO_OWNER_THREAD_ID);
        Atomics.add(this.control, CTRL_SERVING_TICKET, 1);
        Atomics.notify(this.control, CTRL_SERVING_TICKET, 1);
    }
    throwIfFatalWriteState() {
        if (Atomics.load(this.control, CTRL_FATAL_WRITE_OWNER_DIED) !== 0) {
            throw new Error(`Shared object "${this.id}" entered fatal state: a writer thread exited while holding the write lock`);
        }
    }
}
export class SharedObjectWriter {
    obj;
    constructor(obj) {
        this.obj = obj;
    }
    async write(cb) {
        return this.obj.requestWrite(cb);
    }
}
export class SharedObjectReader {
    obj;
    constructor(obj) {
        this.obj = obj;
    }
    readLatest() {
        return this.obj.readLatest();
    }
}
