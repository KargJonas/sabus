const CTRL_PUBLISHED_SLOT = 0;
const CTRL_SEQ = 1;
const CTRL_WORDS = 2;
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
    write(cb) {
        const nextSeq = (Atomics.load(this.control, CTRL_SEQ) + 1) >>> 0;
        const slotIndex = nextSeq % this.slotCount;
        const offset = slotIndex * this.byteLength;
        const bytes = new Uint8Array(this.dataSab, offset, this.byteLength);
        const dataView = new DataView(this.dataSab, offset, this.byteLength);
        cb({ bytes, dataView, seq: nextSeq });
        Atomics.store(this.control, CTRL_PUBLISHED_SLOT, slotIndex);
        Atomics.store(this.control, CTRL_SEQ, nextSeq);
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
}
export class SharedObjectWriter {
    obj;
    constructor(obj) {
        this.obj = obj;
    }
    write(cb) {
        this.obj.write(cb);
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
