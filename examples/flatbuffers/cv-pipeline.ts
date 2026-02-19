import type {
  CalibrationParams,
  DetectionParams,
  PipelineGraph,
  PipelineGraphEdge,
  PipelineStage,
} from '../lib/cv-types'
import type { CameraRectification } from '../lib/types'

interface EmaState {
  avg: Float32Array | null
  w: number
  h: number
}

type StageKind = PipelineStage['kind']
type StageSubscriber = (frame: ImageData) => void

interface PipelineGraphOwner {
  onStageGraphMutated(): void
}

function normalizeMod(mod: number): number {
  if (!Number.isFinite(mod)) return 1
  return Math.max(1, Math.round(mod))
}

function isDetectInternalStage(stageId: string | null): boolean {
  return stageId === 'thresh_inv'
    || stageId === 'morph_inv'
    || stageId === 'thresh'
    || stageId === 'morph'
}

function grayMatToRgbaImageData(cv: any, gray: any): ImageData {
  const rgba = new cv.Mat()
  cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA)
  const image = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows)
  rgba.delete()
  return image
}

/**
 * Base node in the image pipeline DAG.
 * Stages are tick-driven and only recompute when `tick % mod === 0`.
 */
export abstract class PipelineStageBase {
  readonly id: string
  readonly label: string
  readonly kind: StageKind
  mod: number
  cachedFrame: ImageData | null = null
  readonly parents: PipelineStageBase[] = []
  readonly children: PipelineStageBase[] = []
  private readonly subscribers = new Set<StageSubscriber>()
  private graphOwner: PipelineGraphOwner | null = null

  constructor(id: string, label: string, kind: StageKind, mod = 1) {
    this.id = id
    this.label = label
    this.kind = kind
    this.mod = normalizeMod(mod)
  }

  addChild(child: PipelineStageBase): PipelineStageBase {
    if (child === this) {
      throw new Error(`Stage "${this.id}" cannot add itself as a child`)
    }
    if (this.graphOwner) {
      child.attachGraphOwner(this.graphOwner)
    }
    let changed = false
    if (!this.children.includes(child)) {
      this.children.push(child)
      changed = true
    }
    if (!child.parents.includes(this)) {
      child.parents.push(this)
      changed = true
    }
    if (changed && this.graphOwner) {
      this.graphOwner.onStageGraphMutated()
    }
    return child
  }

  attachGraphOwner(owner: PipelineGraphOwner | null): void {
    this.attachGraphOwnerRecursive(owner, new Set())
  }

  setMod(mod: number): void {
    this.mod = normalizeMod(mod)
  }

  getFrame(): ImageData | null {
    return this.cachedFrame
  }

  subscribe(cb: StageSubscriber): () => void {
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  runIfDue(tick: number): void {
    if (tick % this.mod !== 0) return
    const frame = this.compute(this.parents.map((parent) => parent.getFrame()))
    this.cachedFrame = frame
    if (!frame) return
    for (const cb of this.subscribers) cb(frame)
  }

  protected abstract compute(parentFrames: Array<ImageData | null>): ImageData | null

  private attachGraphOwnerRecursive(owner: PipelineGraphOwner | null, visited: Set<PipelineStageBase>): void {
    if (visited.has(this)) return
    visited.add(this)

    if (owner && this.graphOwner && this.graphOwner !== owner) {
      throw new Error(`Stage "${this.id}" already belongs to another pipeline`)
    }
    this.graphOwner = owner
    for (const child of this.children) {
      child.attachGraphOwnerRecursive(owner, visited)
    }
  }
}

class RawStage extends PipelineStageBase {
  constructor(id: string, label: string) {
    super(id, label, 'core', 1)
  }

  setFrame(frame: ImageData): void {
    this.cachedFrame = frame
  }

  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    return parentFrames[0] ?? this.cachedFrame
  }
}

class EmaStage extends PipelineStageBase {
  private readonly state: EmaState = { avg: null, w: 0, h: 0 }
  private readonly avgFramesProvider: () => number

  constructor(id: string, label: string, avgFramesProvider: () => number) {
    super(id, label, 'core', 1)
    this.avgFramesProvider = avgFramesProvider
  }

  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    const parentFrame = parentFrames[0]
    if (!parentFrame) return this.cachedFrame
    updateRgbaEma(parentFrame, this.state, this.avgFramesProvider())
    return emaToImageData(this.state) ?? parentFrame
  }
}

class PassThroughStage extends PipelineStageBase {
  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    return parentFrames[0] ?? null
  }
}

class ScaledStage extends PipelineStageBase {
  private readonly cv: any
  scaleX = 1
  scaleY = 1

  constructor(id: string, label: string, mod: number, cv: any) {
    super(id, label, 'core', mod)
    this.cv = cv
  }

  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    const parentFrame = parentFrames[0]
    if (!parentFrame) return this.cachedFrame

    const maxDim = Math.max(parentFrame.width, parentFrame.height)
    if (maxDim <= 1600) {
      this.scaleX = 1
      this.scaleY = 1
      return parentFrame
    }

    const scale = 1600 / maxDim
    const src = this.cv.matFromImageData(parentFrame)
    const dst = new this.cv.Mat()
    this.cv.resize(src, dst, new this.cv.Size(0, 0), scale, scale, this.cv.INTER_AREA)
    const scaled = new ImageData(new Uint8ClampedArray(dst.data), dst.cols, dst.rows)
    src.delete()
    dst.delete()
    this.scaleX = 1 / scale
    this.scaleY = 1 / scale
    return scaled
  }
}

class GrayStage extends PipelineStageBase {
  private readonly cv: any

  constructor(id: string, label: string, mod: number, cv: any) {
    super(id, label, 'core', mod)
    this.cv = cv
  }

  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    const parentFrame = parentFrames[0]
    if (!parentFrame) return this.cachedFrame

    const src = this.cv.matFromImageData(parentFrame)
    const gray = new this.cv.Mat()
    this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY)
    const imageData = grayMatToRgbaImageData(this.cv, gray)
    src.delete()
    gray.delete()
    return imageData
  }
}

class RectifyStage extends PipelineStageBase {
  private readonly rectify: (imageData: ImageData, enabled: boolean) => ImageData
  private readonly enabledProvider: () => boolean

  constructor(
    id: string,
    label: string,
    mod: number,
    rectify: (imageData: ImageData, enabled: boolean) => ImageData,
    enabledProvider: () => boolean,
  ) {
    super(id, label, 'core', mod)
    this.rectify = rectify
    this.enabledProvider = enabledProvider
  }

  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    const parentFrame = parentFrames[0]
    if (!parentFrame) return this.cachedFrame
    return this.rectify(parentFrame, this.enabledProvider())
  }
}

class ThresholdStage extends PipelineStageBase {
  private readonly cv: any
  private readonly polarity: 'bright' | 'dark'
  private readonly paramsProvider: () => DetectionParams | null
  private readonly enabledProvider: () => boolean

  constructor(
    id: string,
    label: string,
    mod: number,
    cv: any,
    polarity: 'bright' | 'dark',
    paramsProvider: () => DetectionParams | null,
    enabledProvider: () => boolean,
  ) {
    super(id, label, 'detect', mod)
    this.cv = cv
    this.polarity = polarity
    this.paramsProvider = paramsProvider
    this.enabledProvider = enabledProvider
  }

  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    const parentFrame = parentFrames[0]
    const params = this.paramsProvider()
    if (!parentFrame || !params || !this.enabledProvider()) return this.cachedFrame

    const blockSize = Math.max(3, params.blockSize) | 1
    const threshType = this.polarity === 'bright'
      ? this.cv.THRESH_BINARY_INV
      : this.cv.THRESH_BINARY

    const src = this.cv.matFromImageData(parentFrame)
    const channels = new this.cv.MatVector()
    this.cv.split(src, channels)

    const combined = this.cv.Mat.zeros(src.rows, src.cols, this.cv.CV_8UC1)
    const binary = new this.cv.Mat()

    for (let ch = 0; ch < 3; ch++) {
      const channelMat = channels.get(ch)
      const m = new this.cv.Mat()
      const s = new this.cv.Mat()
      this.cv.meanStdDev(channelMat, m, s)
      const channelC = Math.max(1, s.data64F[0] * 0.5 + params.threshC)
      m.delete()
      s.delete()

      this.cv.adaptiveThreshold(
        channelMat,
        binary,
        255,
        this.cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        threshType,
        blockSize,
        channelC,
      )
      this.cv.bitwise_or(combined, binary, combined)
      channelMat.delete()
    }

    const imageData = grayMatToRgbaImageData(this.cv, combined)

    binary.delete()
    combined.delete()
    channels.delete()
    src.delete()
    return imageData
  }
}

class MorphStage extends PipelineStageBase {
  private readonly cv: any
  private readonly paramsProvider: () => DetectionParams | null
  private readonly enabledProvider: () => boolean

  constructor(
    id: string,
    label: string,
    mod: number,
    cv: any,
    paramsProvider: () => DetectionParams | null,
    enabledProvider: () => boolean,
  ) {
    super(id, label, 'detect', mod)
    this.cv = cv
    this.paramsProvider = paramsProvider
    this.enabledProvider = enabledProvider
  }

  protected compute(parentFrames: Array<ImageData | null>): ImageData | null {
    const parentFrame = parentFrames[0]
    const params = this.paramsProvider()
    if (!parentFrame || !params || !this.enabledProvider()) return this.cachedFrame

    const minRadiusPx = Math.max(1, params.minRadius * params.cameraScale)
    const openSize = Math.max(3, Math.round(minRadiusPx * 0.3) | 1)
    const closeSize = Math.max(3, Math.round(minRadiusPx * 0.5) | 1)

    const src = this.cv.matFromImageData(parentFrame)
    const gray = new this.cv.Mat()
    this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY)

    const kernelOpen = this.cv.getStructuringElement(this.cv.MORPH_ELLIPSE, new this.cv.Size(openSize, openSize))
    const kernelClose = this.cv.getStructuringElement(this.cv.MORPH_ELLIPSE, new this.cv.Size(closeSize, closeSize))
    this.cv.morphologyEx(gray, gray, this.cv.MORPH_OPEN, kernelOpen)
    this.cv.morphologyEx(gray, gray, this.cv.MORPH_CLOSE, kernelClose)

    const imageData = grayMatToRgbaImageData(this.cv, gray)

    kernelOpen.delete()
    kernelClose.delete()
    gray.delete()
    src.delete()
    return imageData
  }
}

function updateRgbaEma(imageData: ImageData, state: EmaState, avgFrames: number): void {
  const pixels = imageData.data
  const frames = Math.max(1, avgFrames)

  if (!state.avg || state.w !== imageData.width || state.h !== imageData.height) {
    state.avg = Float32Array.from(pixels)
    state.w = imageData.width
    state.h = imageData.height
    return
  }

  const alpha = 1 - 1 / frames
  for (let i = 0; i < pixels.length; i++) {
    state.avg[i] = state.avg[i] * alpha + pixels[i] * (1 - alpha)
  }
}

function emaToImageData(state: EmaState): ImageData | null {
  if (!state.avg || state.w === 0 || state.h === 0) return null
  const avg = new Uint8ClampedArray(state.avg.length)
  for (let i = 0; i < avg.length; i++) avg[i] = state.avg[i]
  return new ImageData(avg, state.w, state.h)
}

export function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
}

/**
 * Shared image stage graph used by frame sinks (detection + calibration).
 */
export class CvPipeline implements PipelineGraphOwner {
  private static readonly DEFAULT_DETECT_MOD = 3
  private static readonly DEFAULT_CALIB_MOD = 4

  private readonly cv: any
  private tickCount = 0
  private rectification: CameraRectification | null = null
  private detectionParamsValue: DetectionParams | null = null
  private calibrationParamsValue: CalibrationParams | null = null
  private graphEnabledValue = false

  private readonly rawStage: RawStage
  readonly emaStage: EmaStage
  readonly throttledStage: PassThroughStage
  readonly calibThrottledStage: PassThroughStage
  readonly rectifiedStage: RectifyStage
  readonly scaledStage: ScaledStage
  readonly grayStage: GrayStage
  readonly threshInvStage: ThresholdStage
  readonly morphInvStage: MorphStage
  readonly threshStage: ThresholdStage
  readonly morphStage: MorphStage

  private executionOrder: PipelineStageBase[] = []
  private graphValue: PipelineGraph = { stages: [], edges: [] }
  private stageLookup = new Map<string, PipelineStageBase>()

  constructor(cv: any) {
    this.cv = cv

    this.rawStage = new RawStage('raw', 'Raw Camera')
    this.emaStage = new EmaStage(
      'ema',
      'EMA',
      () => Math.max(1, this.detectionParamsValue?.avgFrames ?? 1),
    )
    this.throttledStage = new PassThroughStage('throttled', 'Throttled', 'core', CvPipeline.DEFAULT_DETECT_MOD)
    this.calibThrottledStage = new PassThroughStage(
      'calib_throttled',
      'Calib Throttled',
      'calibration',
      CvPipeline.DEFAULT_CALIB_MOD,
    )
    this.rectifiedStage = new RectifyStage(
      'rectified',
      'Rectified Feed',
      CvPipeline.DEFAULT_DETECT_MOD,
      (imageData, enabled) => this.maybeRectify(imageData, enabled),
      () => this.isRectificationActive(),
    )
    this.scaledStage = new ScaledStage('scaled', 'Scaled', CvPipeline.DEFAULT_DETECT_MOD, cv)
    this.grayStage = new GrayStage('gray', 'Grayscale', CvPipeline.DEFAULT_DETECT_MOD, cv)
    this.threshInvStage = new ThresholdStage(
      'thresh_inv',
      'Threshold (bright)',
      CvPipeline.DEFAULT_DETECT_MOD,
      cv,
      'bright',
      () => this.detectionParamsValue,
      () => this.shouldRunDetectInternals(),
    )
    this.morphInvStage = new MorphStage(
      'morph_inv',
      'Morphology (bright)',
      CvPipeline.DEFAULT_DETECT_MOD,
      cv,
      () => this.detectionParamsValue,
      () => this.shouldRunDetectInternals(),
    )
    this.threshStage = new ThresholdStage(
      'thresh',
      'Threshold (dark)',
      CvPipeline.DEFAULT_DETECT_MOD,
      cv,
      'dark',
      () => this.detectionParamsValue,
      () => this.shouldRunDetectInternals(),
    )
    this.morphStage = new MorphStage(
      'morph',
      'Morphology (dark)',
      CvPipeline.DEFAULT_DETECT_MOD,
      cv,
      () => this.detectionParamsValue,
      () => this.shouldRunDetectInternals(),
    )

    this.addChild(this.emaStage)
    this.emaStage.addChild(this.throttledStage)
    this.emaStage.addChild(this.calibThrottledStage)
    this.throttledStage.addChild(this.rectifiedStage)
    this.rectifiedStage.addChild(this.scaledStage)
    this.scaledStage.addChild(this.grayStage)
    this.rectifiedStage.addChild(this.threshInvStage)
    this.threshInvStage.addChild(this.morphInvStage)
    this.rectifiedStage.addChild(this.threshStage)
    this.threshStage.addChild(this.morphStage)

    this.rawStage.attachGraphOwner(this)
    this.rebuildGraph()
  }

  addChild(child: PipelineStageBase): PipelineStageBase {
    return this.rawStage.addChild(child)
  }

  tick(imageData: ImageData): void {
    this.tickCount++
    this.rawStage.setFrame(imageData)
    for (const stage of this.executionOrder) {
      if (stage === this.rawStage) continue
      stage.runIfDue(this.tickCount)
    }
  }

  setDetectionParams(params: DetectionParams): void {
    const detectMod = normalizeMod(params.mod)
    this.detectionParamsValue = params
    this.throttledStage.setMod(detectMod)
    this.rectifiedStage.setMod(detectMod)
    this.scaledStage.setMod(detectMod)
    this.grayStage.setMod(detectMod)
    this.threshInvStage.setMod(detectMod)
    this.morphInvStage.setMod(detectMod)
    this.threshStage.setMod(detectMod)
    this.morphStage.setMod(detectMod)
  }

  setCalibrationParams(params: CalibrationParams | null): void {
    this.calibrationParamsValue = params
    this.calibThrottledStage.setMod(params?.mod ?? CvPipeline.DEFAULT_CALIB_MOD)
  }

  setRectification(next: CameraRectification | null): void {
    this.rectification = next
  }

  setGraphEnabled(enabled: boolean): void {
    this.graphEnabledValue = enabled
  }

  get isGraphEnabled(): boolean {
    return this.graphEnabledValue
  }

  get detectionParams(): DetectionParams | null {
    return this.detectionParamsValue
  }

  get calibrationParams(): CalibrationParams | null {
    return this.calibrationParamsValue
  }

  getStages(): PipelineStage[] {
    return this.graphValue.stages
  }

  getGraph(): PipelineGraph {
    return this.graphValue
  }

  getStageFrame(stageId: string): ImageData | null {
    return this.stageLookup.get(stageId)?.getFrame() ?? null
  }

  get scaleX(): number {
    return this.scaledStage.scaleX
  }

  get scaleY(): number {
    return this.scaledStage.scaleY
  }

  onStageGraphMutated(): void {
    this.rebuildGraph()
  }

  private rebuildGraph(): void {
    const ordered = this.getTopologicalOrder()
    this.executionOrder = ordered
    this.stageLookup = new Map(ordered.map((stage) => [stage.id, stage]))

    const stages: PipelineStage[] = ordered.map((stage) => ({
      id: stage.id,
      label: stage.label,
      parentIds: stage.parents.map((parent) => parent.id),
      kind: stage.kind,
    }))
    const edges: PipelineGraphEdge[] = []
    for (const stage of ordered) {
      for (const child of stage.children) {
        edges.push({ fromStageId: stage.id, toStageId: child.id })
      }
    }
    this.graphValue = { stages, edges }
  }

  private getTopologicalOrder(): PipelineStageBase[] {
    const stages: PipelineStageBase[] = []
    const seen = new Set<PipelineStageBase>()
    const queue: PipelineStageBase[] = [this.rawStage]

    while (queue.length > 0) {
      const stage = queue.shift()!
      if (seen.has(stage)) continue
      seen.add(stage)
      stages.push(stage)
      for (const child of stage.children) queue.push(child)
    }

    const indegree = new Map<PipelineStageBase, number>()
    for (const stage of stages) indegree.set(stage, 0)
    for (const stage of stages) {
      for (const child of stage.children) {
        if (!indegree.has(child)) continue
        indegree.set(child, (indegree.get(child) ?? 0) + 1)
      }
    }

    const ready: PipelineStageBase[] = []
    for (const stage of stages) {
      if ((indegree.get(stage) ?? 0) === 0) ready.push(stage)
    }

    const ordered: PipelineStageBase[] = []
    while (ready.length > 0) {
      const stage = ready.shift()!
      ordered.push(stage)
      for (const child of stage.children) {
        if (!indegree.has(child)) continue
        indegree.set(child, (indegree.get(child) ?? 0) - 1)
        if ((indegree.get(child) ?? 0) === 0) ready.push(child)
      }
    }

    if (ordered.length !== stages.length) {
      throw new Error('Pipeline graph contains a cycle')
    }
    return ordered
  }

  private isRectificationActive(): boolean {
    const params = this.detectionParamsValue
    return !!params && (params.rectifyEnabled || params.debugStage === 'rectified')
  }

  private shouldRunDetectInternals(): boolean {
    const params = this.detectionParamsValue
    if (!params) return false
    return this.graphEnabledValue || params.detectCircles || isDetectInternalStage(params.debugStage)
  }

  private maybeRectify(imageData: ImageData, enabled: boolean): ImageData {
    if (!enabled || !this.rectification) return imageData

    const src = this.cv.matFromImageData(imageData)
    const H = this.cv.matFromArray(3, 3, this.cv.CV_64F, this.rectification.homography)
    const dst = new this.cv.Mat()
    this.cv.warpPerspective(
      src,
      dst,
      H,
      new this.cv.Size(this.rectification.width, this.rectification.height),
      this.cv.INTER_LINEAR,
      this.cv.BORDER_CONSTANT,
      new this.cv.Scalar(0, 0, 0, 255),
    )
    const result = new ImageData(new Uint8ClampedArray(dst.data), dst.cols, dst.rows)
    src.delete()
    H.delete()
    dst.delete()
    return result
  }
}
