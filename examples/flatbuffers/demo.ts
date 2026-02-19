import * as flatbuffers from "flatbuffers";
import { ControlMessage } from "./generated/control-message";
import { FeedAdded } from "./generated/feed-added";
import { FeedDescriptor } from "./generated/feed-descriptor";
import { PixelFormat } from "./generated/pixel-format";

function buildFeedAddedMessage(seq: number): Uint8Array {
  const builder = new flatbuffers.Builder(512);

  const feedId = builder.createString("cam-0/stage-edges");
  const producerWorker = builder.createString("cv-worker");
  const graphWorker = builder.createString("graph-worker");
  const mlWorker = builder.createString("ml-worker");
  const messageKind = builder.createString("feed_added");

  const consumerWorkers = FeedAdded.createConsumerWorkersVector(builder, [
    graphWorker,
    mlWorker,
  ]);

  const descriptor = FeedDescriptor.createFeedDescriptor(
    builder,
    feedId,
    1280,
    720,
    4,
    1280 * 4,
    3,
    PixelFormat.RGBA8,
  );

  const feedAdded = FeedAdded.createFeedAdded(
    builder,
    descriptor,
    producerWorker,
    consumerWorkers,
  );

  ControlMessage.startControlMessage(builder);
  ControlMessage.addSeq(builder, seq);
  ControlMessage.addKind(builder, messageKind);
  // Schema field is uint32, so keep this demo value in 32-bit range.
  ControlMessage.addTimestampMs(builder, Date.now() >>> 0);
  ControlMessage.addFeedAdded(builder, feedAdded);
  const message = ControlMessage.endControlMessage(builder);
  ControlMessage.finishControlMessageBuffer(builder, message);
  return builder.asUint8Array();
}

function decodeAndLog(buffer: Uint8Array): void {
  const byteBuffer = new flatbuffers.ByteBuffer(buffer);
  const message = ControlMessage.getRootAsControlMessage(byteBuffer);
  const feedAdded = message.feedAdded();

  if (!feedAdded) {
    throw new Error("Expected feed_added payload");
  }

  const descriptor = feedAdded.descriptor();
  if (!descriptor) {
    throw new Error("Expected feed descriptor");
  }

  const consumers: string[] = [];
  for (let i = 0; i < feedAdded.consumerWorkersLength(); i += 1) {
    const name = feedAdded.consumerWorkers(i);
    if (name) {
      consumers.push(name);
    }
  }

  console.log("Decoded control message:");
  console.log({
    seq: message.seq(),
    kind: message.kind(),
    timestampMs: message.timestampMs(),
    feedId: descriptor.id(),
    width: descriptor.width(),
    height: descriptor.height(),
    channels: descriptor.channels(),
    bytesPerRow: descriptor.bytesPerRow(),
    slotCount: descriptor.slotCount(),
    format: PixelFormat[descriptor.format()],
    producerWorker: feedAdded.producerWorker(),
    consumerWorkers: consumers,
  });
}

const encoded = buildFeedAddedMessage(1);
console.log(`Encoded ${encoded.byteLength} bytes with identifier CTRL`);
decodeAndLog(encoded);
