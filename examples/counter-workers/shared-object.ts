const CTRL_PUBLISHED_SLOT = 0;
const CTRL_SEQ = 1;
const CTRL_WORDS = 2;

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
export type SharedObjectWriteCallback = (ctx: SharedObjectWriteContext) => void;

export class SharedObject {
  readonly id: string;
  readonly byteLength: number;
  readonly slotCount: number;
  readonly dataSab: SharedArrayBuffer;
  readonly controlSab: SharedArrayBuffer;
  private readonly control: Int32Array;

  constructor(descriptor: SharedObjectDescriptor) {
    this.id = descriptor.id;
    this.byteLength = descriptor.byteLength;
    this.slotCount = descriptor.slotCount;
    this.dataSab = descriptor.dataSab;
    this.controlSab = descriptor.controlSab;
    this.control = new Int32Array(this.controlSab);
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

  writer(): SharedObjectWriter {
    return new SharedObjectWriter(this);
  }

  reader(): SharedObjectReader {
    return new SharedObjectReader(this);
  }

  write(cb: SharedObjectWriteCallback): void {
    const nextSeq = (Atomics.load(this.control, CTRL_SEQ) + 1) >>> 0;
    const slotIndex = nextSeq % this.slotCount;
    const offset = slotIndex * this.byteLength;
    const bytes = new Uint8Array(this.dataSab, offset, this.byteLength);
    const dataView = new DataView(this.dataSab, offset, this.byteLength);

    cb({ bytes, dataView, seq: nextSeq });

    Atomics.store(this.control, CTRL_PUBLISHED_SLOT, slotIndex);
    Atomics.store(this.control, CTRL_SEQ, nextSeq);
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
      if (seq1 === seq2) {
        return { seq: seq1 >>> 0, bytes, dataView };
      }
    }
    return null;
  }
}

export class SharedObjectWriter {
  private readonly obj: SharedObject;

  constructor(obj: SharedObject) {
    this.obj = obj;
  }

  write(cb: SharedObjectWriteCallback): void {
    this.obj.write(cb);
  }
}

export class SharedObjectReader {
  private readonly obj: SharedObject;

  constructor(obj: SharedObject) {
    this.obj = obj;
  }

  readLatest(): SharedObjectReadSnapshot | null {
    return this.obj.readLatest();
  }
}
