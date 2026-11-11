/**
 * Pointer-based horizontal gesture tracker for comic page turns.
 *
 * The tracker is deliberately framework-free: it only reports raw pixel deltas and a release
 * velocity so the renderer can keep the page under the finger (1:1) without a Vue re-render on
 * every pointermove. Velocity is averaged over the last 100 ms, which is what makes a short,
 * fast flick count as a page turn even when the finger never travels past the distance threshold.
 */

export type GestureDirection = 'ltr' | 'rtl'

export interface GestureEndResult {
  deltaX: number
  deltaY: number
  /** Average horizontal velocity over the last 100 ms, in px/ms. */
  velocity: number
  axisLocked: boolean
  shouldFlip: boolean
  flipDirection: 'next' | 'prev' | 'cancel'
}

export interface GestureTrackerOptions {
  direction?: GestureDirection
  /** Fraction of the viewport width that must be dragged to turn the page. */
  threshold?: number
  /** Release speed that turns the page regardless of distance, in px/ms. */
  speedThreshold?: number
  /** Horizontal travel required before the gesture takes over from vertical scrolling. */
  axisLockDistance?: number
  /** Vertical travel that proves the gesture is a scroll before the axis lock is acquired. */
  verticalSlop?: number
  onStart?: (x: number, y: number) => void
  onMove?: (deltaX: number, deltaY: number) => void
  onEnd?: (result: GestureEndResult) => void
  onCancel?: () => void
}

interface PointerSample {
  x: number
  time: number
}

const DEFAULT_THRESHOLD = 0.22
const DEFAULT_SPEED_THRESHOLD = 0.35
const DEFAULT_AXIS_LOCK_DISTANCE = 8
const DEFAULT_VERTICAL_SLOP = 10
const VELOCITY_WINDOW_MS = 100
const SAMPLE_HISTORY_MS = 160

/** Controls inside the reader must keep their native click and focus behaviour. */
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [contenteditable="true"], [role="dialog"], [data-reader-controls]'

export class GestureTracker {
  private readonly element: HTMLElement
  private readonly options: Required<Omit<GestureTrackerOptions, 'onStart' | 'onMove' | 'onEnd' | 'onCancel'>> &
    Pick<GestureTrackerOptions, 'onStart' | 'onMove' | 'onEnd' | 'onCancel'>

  private pointerId: number | null = null
  private startX = 0
  private startY = 0
  private lastX = 0
  private lastY = 0
  private isTracking = false
  private isHorizontalLock = false
  private enabled = true
  private samples: PointerSample[] = []

  constructor(element: HTMLElement, options: GestureTrackerOptions = {}) {
    this.element = element
    this.options = {
      direction: options.direction ?? 'ltr',
      threshold: options.threshold ?? DEFAULT_THRESHOLD,
      speedThreshold: options.speedThreshold ?? DEFAULT_SPEED_THRESHOLD,
      axisLockDistance: options.axisLockDistance ?? DEFAULT_AXIS_LOCK_DISTANCE,
      verticalSlop: options.verticalSlop ?? DEFAULT_VERTICAL_SLOP,
      onStart: options.onStart,
      onMove: options.onMove,
      onEnd: options.onEnd,
      onCancel: options.onCancel,
    }
    this.attach()
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.resetTracking()
  }

  public destroy(): void {
    this.resetTracking()
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove, { capture: true })
    window.removeEventListener('pointerup', this.onPointerUp, { capture: true })
    window.removeEventListener('pointercancel', this.onPointerUp, { capture: true })
  }

  private attach(): void {
    this.element.addEventListener('pointerdown', this.onPointerDown, { passive: false })
    // Capture phase so a child that stops propagation cannot strand a half-finished drag.
    window.addEventListener('pointermove', this.onPointerMove, { passive: false, capture: true })
    window.addEventListener('pointerup', this.onPointerUp, { passive: false, capture: true })
    window.addEventListener('pointercancel', this.onPointerUp, { passive: false, capture: true })
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!this.enabled) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.isPrimary === false) return
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return

    this.pointerId = event.pointerId
    this.startX = event.clientX
    this.startY = event.clientY
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.isTracking = true
    this.isHorizontalLock = false
    this.samples = [{ x: event.clientX, time: performance.now() }]

    this.options.onStart?.(event.clientX, event.clientY)
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.isTracking || (this.pointerId !== null && event.pointerId !== this.pointerId)) return

    const deltaX = event.clientX - this.startX
    const deltaY = event.clientY - this.startY

    if (!this.isHorizontalLock) {
      if (Math.abs(deltaX) > this.options.axisLockDistance && Math.abs(deltaX) > Math.abs(deltaY)) {
        this.isHorizontalLock = true
      } else if (Math.abs(deltaY) > this.options.verticalSlop) {
        // The reader may scroll vertically (zoomed mode, browser chrome); this is not a page turn.
        this.resetTracking(true)
        return
      }
    }

    if (!this.isHorizontalLock) return
    if (event.cancelable) event.preventDefault()

    const now = performance.now()
    this.samples.push({ x: event.clientX, time: now })
    this.trimSamples(now)

    this.lastX = event.clientX
    this.lastY = event.clientY
    this.options.onMove?.(deltaX, deltaY)
  }

  private onPointerUp = (event: PointerEvent) => {
    if (!this.isTracking || (this.pointerId !== null && event.pointerId !== this.pointerId)) return

    if (event.type === 'pointercancel') {
      this.resetTracking(false)
      this.options.onCancel?.()
      return
    }

    const wasHorizontal = this.isHorizontalLock
    const deltaX = event.clientX - this.startX
    const deltaY = event.clientY - this.startY
    const velocity = this.releaseVelocity(event.clientX)

    this.resetTracking(false)

    if (!wasHorizontal) {
      this.options.onEnd?.({
        deltaX,
        deltaY,
        velocity,
        axisLocked: false,
        shouldFlip: false,
        flipDirection: 'cancel',
      })
      return
    }

    const width = this.element.clientWidth || window.innerWidth || 1
    const distanceThreshold = width * this.options.threshold
    const isRtl = this.options.direction === 'rtl'

    let shouldFlip = false
    let flipDirection: 'next' | 'prev' | 'cancel' = 'cancel'

    if (deltaX < -distanceThreshold || velocity < -this.options.speedThreshold) {
      shouldFlip = true
      flipDirection = isRtl ? 'prev' : 'next'
    } else if (deltaX > distanceThreshold || velocity > this.options.speedThreshold) {
      shouldFlip = true
      flipDirection = isRtl ? 'next' : 'prev'
    }

    this.options.onEnd?.({
      deltaX,
      deltaY,
      velocity,
      axisLocked: true,
      shouldFlip,
      flipDirection,
    })
  }

  private releaseVelocity(endX: number): number {
    const now = performance.now()
    const cutoff = now - VELOCITY_WINDOW_MS
    const firstRecent = this.samples.find((sample) => sample.time >= cutoff) ?? this.samples[0]
    if (!firstRecent) return 0
    const elapsed = now - firstRecent.time
    if (elapsed <= 0) return 0
    return (endX - firstRecent.x) / elapsed
  }

  private trimSamples(now: number): void {
    const cutoff = now - SAMPLE_HISTORY_MS
    while (this.samples.length > 1 && this.samples[0]!.time < cutoff) this.samples.shift()
  }

  private resetTracking(cancel = false): void {
    const wasTracking = this.isTracking
    this.isTracking = false
    this.isHorizontalLock = false
    this.pointerId = null
    this.samples = []
    if (cancel && wasTracking) this.options.onCancel?.()
  }
}
