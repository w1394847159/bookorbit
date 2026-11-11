import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GestureTracker, type GestureEndResult } from '../gesture-tracker'

function pointer(target: EventTarget, type: string, clientX: number, clientY = 200) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }))
}

describe('GestureTracker', () => {
  let element: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    element = document.createElement('div')
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 800 },
    })
    document.body.append(element)
  })

  it('reports 1:1 movement after the horizontal axis lock', () => {
    const onMove = vi.fn<(dx: number, dy: number) => void>()
    const tracker = new GestureTracker(element, { onMove })

    pointer(element, 'pointerdown', 350)
    pointer(window, 'pointermove', 150)

    expect(onMove).toHaveBeenCalledWith(-200, 0)
    tracker.destroy()
  })

  it('turns a page once the drag passes the distance threshold', () => {
    const onEnd = vi.fn<(result: GestureEndResult) => void>()
    const tracker = new GestureTracker(element, { onEnd, threshold: 0.22 })

    pointer(element, 'pointerdown', 350)
    pointer(window, 'pointermove', 100)
    pointer(window, 'pointerup', 100)

    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ axisLocked: true, shouldFlip: true, flipDirection: 'next' }))
    tracker.destroy()
  })

  it('maps horizontal directions for right-to-left reading', () => {
    const onEnd = vi.fn<(result: GestureEndResult) => void>()
    const tracker = new GestureTracker(element, { onEnd, direction: 'rtl' })

    pointer(element, 'pointerdown', 50)
    pointer(window, 'pointermove', 300)
    pointer(window, 'pointerup', 300)

    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ flipDirection: 'next' }))
    tracker.destroy()
  })

  it('releases tracking when the gesture is a vertical scroll', () => {
    const onMove = vi.fn<(deltaX: number, deltaY: number) => void>()
    const onCancel = vi.fn<() => void>()
    const tracker = new GestureTracker(element, { onMove, onCancel })

    pointer(element, 'pointerdown', 200, 200)
    pointer(window, 'pointermove', 205, 260)
    pointer(window, 'pointerup', 205, 260)

    expect(onMove).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
    tracker.destroy()
  })

  it('cancels a touch that is interrupted before the axis lock', () => {
    const onCancel = vi.fn<() => void>()
    const tracker = new GestureTracker(element, { onCancel })

    pointer(element, 'pointerdown', 200, 200)
    pointer(window, 'pointercancel', 202, 204)

    expect(onCancel).toHaveBeenCalledOnce()
    tracker.destroy()
  })
})
