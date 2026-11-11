import { GestureTracker, type GestureDirection } from './gesture-tracker'

export type CbzPageTurnMode = 'cover' | 'slide'
export type CbzPageTurnDirection = 'next' | 'prev'
export type CbzPagerLayerName = 'prev' | 'current' | 'next'

export interface CbzPagerLayers {
  prev: HTMLElement | null
  current: HTMLElement | null
  next: HTMLElement | null
}

export interface CbzPageTurnControllerOptions {
  getViewport: () => HTMLElement | null
  getLayers: () => CbzPagerLayers
  getMode: () => CbzPageTurnMode
  getDirection: () => GestureDirection
  canGoNext: () => boolean
  canGoPrev: () => boolean
  onTurnStart?: () => void
  onTurnAbort?: () => void
  onBoundaryNext?: () => void
  onCommit: (direction: CbzPageTurnDirection) => Promise<void> | void
  animationDurationMs?: number
}

const DEFAULT_ANIMATION_DURATION_MS = 220
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const RUBBER_BAND_FACTOR = 0.28
const CLICK_SUPPRESSION_MS = 400

/**
 * Owns the paginated viewport DOM. Drag frames are written straight to `style.transform`, so a
 * finger move never waits for Vue reactivity; the component only hears about a completed turn at
 * the very end, when the page anchor actually changes.
 */
export class CbzPageTurnController {
  private readonly options: CbzPageTurnControllerOptions
  private tracker: GestureTracker | null = null
  private viewport: HTMLElement | null = null
  private dragging = false
  private dragStarted = false
  private lastDx = 0
  private animating = false
  private animationToken = 0
  private pendingDirections: CbzPageTurnDirection[] = []
  private activeAnimations: Animation[] = []
  private lastAxisReleaseAt = 0

  constructor(options: CbzPageTurnControllerOptions) {
    this.options = options
  }

  public attach(viewport: HTMLElement): void {
    if (this.viewport === viewport && this.tracker) return
    this.detach()
    this.viewport = viewport
    this.tracker = new GestureTracker(viewport, {
      direction: this.options.getDirection(),
      onStart: this.handleStart,
      onMove: this.handleMove,
      onEnd: this.handleEnd,
      onCancel: this.handleCancel,
    })
  }

  public detach(): void {
    this.tracker?.destroy()
    this.tracker = null
    this.viewport = null
    this.abortActiveTurn()
  }

  public setEnabled(enabled: boolean): void {
    this.tracker?.setEnabled(enabled)
    if (!enabled) this.abortActiveTurn()
  }

  /** Rebuilds the tracker so a changed reading direction is reflected in release decisions. */
  public restart(): void {
    const viewport = this.viewport
    if (!viewport) return
    this.detach()
    this.attach(viewport)
  }

  /** Called when settings or layout change under a running animation. */
  public cancel(): void {
    this.abortActiveTurn()
  }

  public requestTurn(direction: CbzPageTurnDirection): void {
    if (!this.canTurn(direction)) return
    if (this.animating || this.dragging) {
      if (this.pendingDirections.length < 3) this.pendingDirections.push(direction)
      return
    }
    this.beginTurn(direction)
  }

  /** A click that follows a drag must not be treated as a tap-to-turn. */
  public shouldSuppressClick(): boolean {
    return performance.now() - this.lastAxisReleaseAt < CLICK_SUPPRESSION_MS
  }

  private handleStart = (): void => {
    // A new finger down interrupts a running turn; the fresh gesture is the user's latest intent.
    if (this.animating) this.abortActiveTurn()
    this.dragging = true
    this.dragStarted = false
    this.lastDx = 0
  }

  private handleMove = (deltaX: number): void => {
    if (!this.dragging || this.animating) return
    if (!this.dragStarted) {
      this.dragStarted = true
      this.options.onTurnStart?.()
    }
    this.lastDx = deltaX
    const direction = this.directionForDx(deltaX)
    this.layout(direction, deltaX, this.canTurn(direction))
  }

  private handleEnd = (result: {
    deltaX: number
    axisLocked: boolean
    shouldFlip: boolean
    flipDirection: CbzPageTurnDirection | 'cancel'
  }): void => {
    if (!this.dragging) return
    this.dragging = false

    if (!this.dragStarted || !result.axisLocked) {
      this.dragStarted = false
      this.options.onTurnAbort?.()
      this.resetVisual()
      return
    }

    this.lastAxisReleaseAt = performance.now()
    const direction = result.flipDirection
    const canTurn = direction !== 'cancel' && this.canTurn(direction)

    if (result.shouldFlip && canTurn) {
      this.runTurnAnimation(direction, result.deltaX)
      return
    }

    if (result.shouldFlip && direction === 'next' && !canTurn) this.options.onBoundaryNext?.()
    this.runCancelAnimation(result.deltaX, this.directionForDx(result.deltaX))
  }

  private handleCancel = (): void => {
    if (!this.dragging) return
    this.dragging = false
    if (!this.dragStarted) {
      this.options.onTurnAbort?.()
      return
    }
    this.runCancelAnimation(this.lastDx, this.directionForDx(this.lastDx))
  }

  private beginTurn(direction: CbzPageTurnDirection): void {
    if (!this.canTurn(direction)) return
    this.options.onTurnStart?.()
    this.animating = true
    const token = ++this.animationToken
    this.layout(direction, 0, true)
    this.runTurnAnimation(direction, 0, token)
  }

  private runTurnAnimation(direction: CbzPageTurnDirection, startDx: number, token = ++this.animationToken): void {
    this.animating = true
    this.animationToken = token
    const layers = this.options.getLayers()
    const width = this.viewportWidth()
    const dirNext = this.dirNext()

    this.layout(direction, startDx, true)
    this.resetAnimations()

    if (this.options.getMode() === 'cover') {
      if (direction === 'next') {
        this.animateTransform(layers.current, startDx, dirNext * width)
        this.animateShadow(layers.current, this.shadowOpacity(startDx, width), 1)
        this.animateTransform(layers.next, 0, 0)
      } else {
        this.animateTransform(layers.prev, dirNext * width + startDx, 0)
        this.animateShadow(layers.prev, this.shadowOpacity(startDx, width), 1)
        this.animateTransform(layers.current, 0, 0)
      }
    } else if (direction === 'next') {
      this.animateTransform(layers.current, startDx, dirNext * width)
      this.animateTransform(layers.next, -dirNext * width + startDx, 0)
    } else {
      this.animateTransform(layers.current, startDx, -dirNext * width)
      this.animateTransform(layers.prev, dirNext * width + startDx, 0)
    }

    void this.finishAnimation(direction, token)
  }

  private runCancelAnimation(startDx: number, direction: CbzPageTurnDirection): void {
    this.animating = true
    const token = ++this.animationToken
    const layers = this.options.getLayers()
    const width = this.viewportWidth()
    const dirNext = this.dirNext()
    const targetExists = this.canTurn(direction)
    const fromDx = targetExists ? startDx : startDx * RUBBER_BAND_FACTOR

    this.layout(direction, startDx, targetExists)
    this.resetAnimations()

    if (this.options.getMode() === 'cover') {
      if (direction === 'next') {
        this.animateTransform(layers.current, fromDx, 0)
        this.animateShadow(layers.current, this.shadowOpacity(fromDx, width), 0)
      } else {
        this.animateTransform(layers.prev, dirNext * width + fromDx, dirNext * width)
        this.animateShadow(layers.prev, this.shadowOpacity(fromDx, width), 0)
      }
    } else if (direction === 'next') {
      this.animateTransform(layers.current, fromDx, 0)
      this.animateTransform(layers.next, -dirNext * width + fromDx, -dirNext * width)
    } else {
      this.animateTransform(layers.current, fromDx, 0)
      this.animateTransform(layers.prev, dirNext * width + fromDx, dirNext * width)
    }

    void this.finishAnimation(null, token)
  }

  private async finishAnimation(direction: CbzPageTurnDirection | null, token: number): Promise<void> {
    const animations = this.activeAnimations.slice()
    if (animations.length > 0) {
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
    }
    if (token !== this.animationToken) return

    if (direction) {
      try {
        await this.options.onCommit(direction)
      } catch {
        this.abortActiveTurn()
        return
      }
      if (token !== this.animationToken) return
    }

    this.resetVisual()
    this.animating = false
    if (!direction) this.options.onTurnAbort?.()

    const pending = this.pendingDirections.shift()
    if (pending) this.requestTurn(pending)
  }

  private layout(direction: CbzPageTurnDirection, dx: number, targetExists: boolean): void {
    const layers = this.options.getLayers()
    const width = this.viewportWidth()
    const dirNext = this.dirNext()
    const mode = this.options.getMode()
    const effectiveDx = targetExists ? dx : dx * RUBBER_BAND_FACTOR

    this.hideLayer(layers.prev)
    this.hideLayer(layers.next)
    if (layers.current) {
      layers.current.style.visibility = 'visible'
      layers.current.style.zIndex = '2'
      this.setTransform(layers.current, 0)
    }
    this.setShadowOpacity(layers.current, 0)

    if (!targetExists) {
      this.setTransform(layers.current, effectiveDx)
      return
    }

    if (mode === 'cover') {
      if (direction === 'next') {
        this.showLayer(layers.next, 1)
        this.setTransform(layers.next, 0)
        this.setTransform(layers.current, dx)
        this.setShadowOpacity(layers.current, this.shadowOpacity(dx, width))
      } else {
        this.showLayer(layers.prev, 3)
        this.setTransform(layers.prev, dirNext * width + dx)
        this.setShadowOpacity(layers.prev, this.shadowOpacity(dx, width))
      }
      return
    }

    if (direction === 'next') {
      this.showLayer(layers.next, 1)
      this.setTransform(layers.next, -dirNext * width + dx)
    } else {
      this.showLayer(layers.prev, 1)
      this.setTransform(layers.prev, dirNext * width + dx)
    }
    this.setTransform(layers.current, dx)
  }

  private resetVisual(): void {
    this.resetAnimations()
    const layers = this.options.getLayers()
    this.hideLayer(layers.prev)
    this.hideLayer(layers.next)
    if (layers.current) {
      layers.current.style.visibility = 'visible'
      layers.current.style.zIndex = '2'
      this.setTransform(layers.current, 0)
    }
    this.setShadowOpacity(layers.current, 0)
    this.dragStarted = false
    this.lastDx = 0
  }

  private abortActiveTurn(): void {
    this.animationToken++
    this.pendingDirections = []
    this.dragging = false
    this.animating = false
    this.resetVisual()
    this.options.onTurnAbort?.()
  }

  private canTurn(direction: CbzPageTurnDirection): boolean {
    return direction === 'next' ? this.options.canGoNext() : this.options.canGoPrev()
  }

  private directionForDx(dx: number): CbzPageTurnDirection {
    return this.dirNext() * dx > 0 ? 'next' : 'prev'
  }

  private dirNext(): number {
    return this.options.getDirection() === 'rtl' ? 1 : -1
  }

  private viewportWidth(): number {
    return this.viewport?.clientWidth || window.innerWidth || 1
  }

  private shadowOpacity(dx: number, width: number): number {
    return Math.min(1, Math.abs(dx) / Math.max(1, width * 0.35))
  }

  private showLayer(element: HTMLElement | null, zIndex: number): void {
    if (!element) return
    element.style.visibility = 'visible'
    element.style.zIndex = String(zIndex)
  }

  private hideLayer(element: HTMLElement | null): void {
    if (!element) return
    element.style.visibility = 'hidden'
    this.setShadowOpacity(element, 0)
  }

  private setTransform(element: HTMLElement | null, x: number): void {
    if (!element) return
    element.style.transform = `translate3d(${x}px, 0, 0)`
  }

  private setShadowOpacity(element: HTMLElement | null, opacity: number): void {
    if (!element) return
    const shadow = element.querySelector<HTMLElement>('[data-pager-shadow]')
    if (shadow) shadow.style.opacity = String(opacity)
  }

  private animateTransform(element: HTMLElement | null, fromX: number, toX: number): void {
    if (!element) return
    if (typeof element.animate !== 'function') {
      this.setTransform(element, toX)
      return
    }
    this.setTransform(element, fromX)
    const animation = element.animate([{ transform: `translate3d(${fromX}px, 0, 0)` }, { transform: `translate3d(${toX}px, 0, 0)` }], {
      duration: this.options.animationDurationMs ?? DEFAULT_ANIMATION_DURATION_MS,
      easing: EASING,
      fill: 'forwards',
    })
    this.activeAnimations.push(animation)
  }

  private animateShadow(element: HTMLElement | null, from: number, to: number): void {
    if (!element) return
    const shadow = element.querySelector<HTMLElement>('[data-pager-shadow]')
    if (!shadow) return
    shadow.style.opacity = String(from)
    if (typeof shadow.animate !== 'function') {
      shadow.style.opacity = String(to)
      return
    }
    const animation = shadow.animate([{ opacity: from }, { opacity: to }], {
      duration: this.options.animationDurationMs ?? DEFAULT_ANIMATION_DURATION_MS,
      easing: EASING,
      fill: 'forwards',
    })
    this.activeAnimations.push(animation)
  }

  private resetAnimations(): void {
    for (const animation of this.activeAnimations) {
      try {
        animation.cancel()
      } catch {
        // A finished animation can no longer be cancelled; its fill has already been replaced below.
      }
    }
    this.activeAnimations = []
  }
}
