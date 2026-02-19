import * as flatbuffers from "flatbuffers";
import { FrameMeta } from "./generated/shared/objectlayout/frame-meta";
import { PixelFormat } from "./generated/shared/objectlayout/pixel-format";

const CTRL_PUBLISHED_SLOT = 0;
const CTRL_SEQ = 1;
const CTRL_SIZE = 2;

export type FrameMetaValue = {
  seq: number;
  width: number;
  height: number;
  bytesPerRow: number;
  timestampMs: number;
  format: PixelFormat;
};

export type SharedFrameObjectState = {
  dataSab: SharedArrayBuffer;
  metaSab: SharedArrayBuffer;
  controlSab: SharedArrayBuffer;
  slotCount: number;
  slotByteSize: number;
  defaultWidth: number;
  defaultHeight: number;
  defaultBytesPerRow: number;
  defaultFormat: PixelFormat;
};

type WriteMeta = {
  width: number;
  height: number;
  bytesPerRow: number;
  timestampMs: number;
  format: PixelFormat;
};

type WriteView = {
  bytes: Uint8ClampedArray;
  meta: WriteMeta;
};

export type LatestFrame = {
  bytes: Uint8ClampedArray;
  meta: FrameMetaValue;
};

export class SharedFrameObject {
  private readonly bb: flatbuffers.ByteBuffer;
  private readonly control: Int32Array;
  private readonly slotSize = FrameMeta.sizeOf();

  private constructor(private readonly state: SharedFrameObjectState) {
    this.bb = new flatbuffers.ByteBuffer(new Uint8Array(state.metaSab));
    this.control = new Int32Array(state.controlSab);
    if (this.control.length < CTRL_SIZE) {
      throw new Error("control SAB too small");
    }
    const expectedMetaBytes = state.slotCount * this.slotSize;
    if (state.metaSab.byteLength < expectedMetaBytes) {
      throw new Error(`meta SAB too small: got ${state.metaSab.byteLength}, need at least ${expectedMetaBytes}`);
    }
  }

  static create(config: {
    width: number;
    height: number;
    format: PixelFormat;
  }): SharedFrameObject {
    const slotCount = 3;
    const defaultBytesPerRow = config.width * 4;
    const slotByteSize = defaultBytesPerRow * config.height;

    const state: SharedFrameObjectState = {
      dataSab: new SharedArrayBuffer(slotCount * slotByteSize),
      metaSab: new SharedArrayBuffer(slotCount * FrameMeta.sizeOf()),
      controlSab: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * CTRL_SIZE),
      slotCount,
      slotByteSize,
      defaultWidth: config.width,
      defaultHeight: config.height,
      defaultBytesPerRow,
      defaultFormat: config.format,
    };

    const obj = new SharedFrameObject(state);
    Atomics.store(obj.control, CTRL_PUBLISHED_SLOT, -1);
    Atomics.store(obj.control, CTRL_SEQ, 0);
    return obj;
  }

  static fromState(state: SharedFrameObjectState): SharedFrameObject {
    return new SharedFrameObject(state);
  }

  exportState(): SharedFrameObjectState {
    return this.state;
  }

  writer(): SharedFrameWriter {
    return new SharedFrameWriter(this);
  }

  reader(): SharedFrameReader {
    return new SharedFrameReader(this);
  }

  write(cb: (view: WriteView) => void): void {
    const nextSeq = (Atomics.load(this.control, CTRL_SEQ) + 1) >>> 0;
    const slot = nextSeq % this.state.slotCount;
    const bytes = this.slotBytes(slot);

    const meta: WriteMeta = {
      width: this.state.defaultWidth,
      height: this.state.defaultHeight,
      bytesPerRow: this.state.defaultBytesPerRow,
      timestampMs: performance.now(),
      format: this.state.defaultFormat,
    };

    cb({ bytes, meta });
    this.assertFrameFits(meta.bytesPerRow, meta.height);

    const frameMeta = this.metaView(slot);
    frameMeta.mutate_seq(nextSeq);
    frameMeta.mutate_width(meta.width >>> 0);
    frameMeta.mutate_height(meta.height >>> 0);
    frameMeta.mutate_bytes_per_row(meta.bytesPerRow >>> 0);
    frameMeta.mutate_timestamp_ms(meta.timestampMs);
    frameMeta.mutate_format(meta.format);
    frameMeta.mutate_flags(0);
    frameMeta.mutate_reserved(0);

    Atomics.store(this.control, CTRL_PUBLISHED_SLOT, slot);
    Atomics.store(this.control, CTRL_SEQ, nextSeq);
  }

  readLatest(): LatestFrame | null {
    for (let attempts = 0; attempts < 4; attempts += 1) {
      const seq1 = Atomics.load(this.control, CTRL_SEQ);
      const slot = Atomics.load(this.control, CTRL_PUBLISHED_SLOT);
      if (slot < 0) return null;

      const metaView = this.metaView(slot);
      const meta: FrameMetaValue = {
        seq: metaView.seq(),
        width: metaView.width(),
        height: metaView.height(),
        bytesPerRow: metaView.bytesPerRow(),
        timestampMs: metaView.timestampMs(),
        format: metaView.format(),
      };
      this.assertFrameFits(meta.bytesPerRow, meta.height);

      const bytes = this.slotBytes(slot, meta.bytesPerRow * meta.height);
      const seq2 = Atomics.load(this.control, CTRL_SEQ);
      if (seq1 === seq2) {
        return { bytes, meta };
      }
    }
    return null;
  }

  private metaView(slotIndex: number, out: FrameMeta = new FrameMeta()): FrameMeta {
    this.assertSlot(slotIndex);
    return out.__init(slotIndex * this.slotSize, this.bb);
  }

  private slotBytes(slotIndex: number, length = this.state.slotByteSize): Uint8ClampedArray {
    this.assertSlot(slotIndex);
    if (length < 0 || length > this.state.slotByteSize) {
      throw new RangeError(`slot byte length ${length} exceeds slot capacity ${this.state.slotByteSize}`);
    }
    return new Uint8ClampedArray(
      this.state.dataSab,
      slotIndex * this.state.slotByteSize,
      length,
    );
  }

  private assertSlot(slotIndex: number): void {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= this.state.slotCount) {
      throw new RangeError(`slot index ${slotIndex} out of range [0, ${this.state.slotCount})`);
    }
  }

  private assertFrameFits(bytesPerRow: number, height: number): void {
    const size = bytesPerRow * height;
    if (size <= 0 || size > this.state.slotByteSize) {
      throw new RangeError(`frame size ${size} exceeds slot capacity ${this.state.slotByteSize}`);
    }
  }
}

export class SharedFrameWriter {
  constructor(private readonly obj: SharedFrameObject) {}

  write(cb: (view: WriteView) => void): void {
    this.obj.write(cb);
  }
}

export class SharedFrameReader {
  constructor(private readonly obj: SharedFrameObject) {}

  readLatest(): LatestFrame | null {
    return this.obj.readLatest();
  }
}
