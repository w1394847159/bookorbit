import { computed, nextTick, onUnmounted, ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CbzReaderView from './CbzReaderView.vue'
import CbzSettingsPanel from './components/CbzSettingsPanel.vue'
import NextIssueCard from './components/NextIssueCard.vue'

const NEXT_BOOK = { bookId: 91, fileId: 501, format: 'cbz', title: 'Issue 10', seriesIndex: '10' }

const mocks = vi.hoisted(() => ({
  savedMode: 'infinite' as 'paginated' | 'infinite' | 'long-strip',
  savedViewMode: 'single' as 'single' | 'two-page',
  savedSpreadGap: 0,
  savedPageTurnMode: 'cover' as 'cover' | 'slide',
  savedDirection: 'ltr' as 'ltr' | 'rtl',
  savedFitMode: 'fit-page' as 'fit-page' | 'fit-width' | 'fit-height' | 'actual',
  pageCount: 10_000,
  savedPageNumber: 9_000,
  savedAutoAdvance: false,
  seriesId: 42 as number | null,
  nextBook: null as { bookId: number; fileId: number; format: string; title: string; seriesIndex: string } | null,
  loadNextBook: vi.fn<(seriesId: number | null, bookId: number) => Promise<void>>().mockResolvedValue(undefined),
  routerPush: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  onBeforeRouteLeave: vi.fn<(guard: () => Promise<void>) => void>(),
  pageUrl: vi.fn<(page: number) => string>((page) => `/api/v1/cbz/files/22/pages/${page}`),
  progressSave: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  scrollToIndex: vi.fn<(index: number, options: { align: string }) => void>(),
  updateBookSettings: vi.fn<(patch: unknown) => void>(),
  resetBookSettings: vi.fn<() => void>(),
  sessionEndSnapshots: [] as Array<{ percentage: number; pageNumber?: number | null }>,
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { bookId: '11', fileId: '22' }, query: {} }),
  useRouter: () => ({ back: vi.fn<() => void>(), push: mocks.routerPush, replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
  onBeforeRouteLeave: mocks.onBeforeRouteLeave,
}))

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (options: { value: { count: number } }) => {
    const center = ref(0)
    return computed(() => ({
      getVirtualItems: () => {
        const count = options.value.count
        if (count === 0) return []
        const start = Math.max(0, center.value - 2)
        const end = Math.min(count - 1, center.value + 2)
        return Array.from({ length: end - start + 1 }, (_, offset) => {
          const index = start + offset
          return { key: index, index, start: index * 1_000, end: (index + 1) * 1_000, size: 1_000, lane: 0 }
        })
      },
      getTotalSize: () => options.value.count * 1_000,
      measureElement: vi.fn<(element?: unknown) => void>(),
      scrollToIndex: (index: number, scrollOptions: { align: string }) => {
        center.value = index
        mocks.scrollToIndex(index, scrollOptions)
      },
    }))
  },
}))

vi.mock('./composables/useCbz', () => ({
  useCbz: () => {
    const pageCount = ref(0)
    return {
      pageCount,
      bookTitle: ref('Large comic'),
      loading: ref(false),
      error: ref(null),
      seriesId: ref(mocks.seriesId),
      pageUrl: mocks.pageUrl,
      load: async () => {
        pageCount.value = mocks.pageCount
      },
    }
  },
}))

vi.mock('../shared/composables/useSeriesNextBook', () => ({
  useSeriesNextBook: () => ({ nextBook: computed(() => mocks.nextBook), load: mocks.loadNextBook }),
}))

vi.mock('./composables/useCbzSettings', () => ({
  useCbzSettings: () => ({
    fitMode: ref(mocks.savedFitMode),
    viewMode: ref('single'),
    scrollMode: ref('paginated'),
    direction: ref('ltr'),
    pageTurnMode: ref('cover'),
    spreadAlignment: ref('normal'),
    spreadGap: ref(0),
    forceTwoPage: ref(false),
    widePageSingletonMode: ref('auto'),
    bgColor: ref('black'),
    autoAdvance: ref(false),
    bgValue: computed(() => '#000'),
    imgFitClass: computed(() => 'object-contain'),
  }),
}))

vi.mock('../shared/composables/useReaderSettings', () => ({
  useReaderSettings: () => ({
    effective: computed(() => ({
      fitMode: mocks.savedFitMode,
      viewMode: mocks.savedViewMode,
      scrollMode: mocks.savedMode,
      direction: mocks.savedDirection,
      pageTurnMode: mocks.savedPageTurnMode,
      spreadAlignment: 'normal',
      spreadGap: mocks.savedSpreadGap,
      forceTwoPage: false,
      widePageSingletonMode: 'auto',
      bgColor: 'black',
      autoAdvance: mocks.savedAutoAdvance,
    })),
    isCustomized: ref(false),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    updateBookSettings: mocks.updateBookSettings,
    resetBookSettings: mocks.resetBookSettings,
  }),
}))

vi.mock('../shared/composables/useReaderProgress', () => ({
  useReaderProgress: () => ({
    pageNumber: ref(mocks.savedPageNumber),
    percentage: ref(90),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    save: mocks.progressSave,
  }),
}))

// Like the real composable, the session ends from an unmounted hook registered before the view's own.
vi.mock('../shared/composables/useReadingSession', () => ({
  useReadingSession: (_fileId: number, getProgress: () => { percentage: number; pageNumber?: number | null }) => {
    onUnmounted(() => mocks.sessionEndSnapshots.push(getProgress()))
    return { onActivity: vi.fn<() => void>(), elapsedMinutes: ref(0) }
  },
}))

vi.mock('../shared/composables/useVisibility', () => ({
  useVisibility: () => ({
    headerVisible: ref(false),
    footerVisible: ref(false),
    handleMiddleTap: vi.fn<() => void>(),
    showHeader: vi.fn<() => void>(),
    showFooter: vi.fn<() => void>(),
    setVisibilityLock: vi.fn<(locked: boolean) => void>(),
  }),
}))

vi.mock('../shared/composables/useFullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: ref(false), toggleFullscreen: vi.fn<() => void>() }),
}))

describe('CbzReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.savedMode = 'infinite'
    mocks.savedViewMode = 'single'
    mocks.savedSpreadGap = 0
    mocks.savedPageTurnMode = 'cover'
    mocks.savedDirection = 'ltr'
    mocks.savedFitMode = 'fit-page'
    mocks.pageCount = 10_000
    mocks.savedPageNumber = 9_000
    mocks.savedAutoAdvance = false
    mocks.seriesId = 42
    mocks.nextBook = null
    mocks.sessionEndSnapshots.length = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn<(handle: number) => void>())
  })

  it('offers DjVu embedded text and recovers from a failed page image', async () => {
    mocks.savedMode = 'paginated'
    mocks.savedPageNumber = 1
    mocks.pageCount = 2
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22, source: 'djvu' } })
    await flushPromises()
    expect(wrapper.find('[aria-label="reader.djvu.pageText"]').exists()).toBe(true)
    const currentLayer = wrapper.get('[data-pager-layer="current"]')
    await currentLayer.get('img').trigger('error')
    expect(wrapper.text()).toContain('reader.pageImages.pageFailed')
    const retry = wrapper.findAll('button').find((button) => button.text() === 'common.retry')!
    await retry.trigger('click')
    expect(wrapper.text()).not.toContain('reader.pageImages.pageFailed')
    expect(wrapper.get('[data-pager-layer="current"]').get('img').attributes('alt')).toBe('reader.pageImages.pageAlt')
    wrapper.unmount()
  })

  it.each(['infinite', 'long-strip'] as const)('restores %s mode by index while rendering only a bounded page window', async (mode) => {
    mocks.savedMode = mode
    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(8_999, { align: 'start' })

    const renderedPages = wrapper.findAll('[data-page]').map((page) => Number(page.attributes('data-page')))
    expect(renderedPages).toEqual([8_997, 8_998, 8_999, 9_000, 9_001])
    expect(wrapper.findAll('img')).toHaveLength(5)
    expect(new Set(mocks.pageUrl.mock.calls.map(([page]) => page)).size).toBeLessThanOrEqual(5)
    expect(mocks.pageUrl).not.toHaveBeenCalledWith(0)

    wrapper.unmount()
  })

  it.each([0, 24])('anchors two-page images to the spine with a %ipx configurable gap', async (spreadGap) => {
    mocks.savedMode = 'paginated'
    mocks.savedViewMode = 'two-page'
    mocks.savedSpreadGap = spreadGap
    mocks.pageCount = 6
    mocks.savedPageNumber = 2
    window.innerWidth = 1_200

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-testid="cbz-paginated-pages"]').attributes('style')).toContain(`column-gap: ${spreadGap}px`)
    expect(wrapper.get('[data-spread-side="left"]').classes()).toContain('justify-end')
    expect(wrapper.get('[data-spread-side="right"]').classes()).toContain('justify-start')
    expect(wrapper.get('[data-spread-side="left"]').classes()).toContain('items-center-safe')
    expect(wrapper.get('[data-spread-side="right"]').classes()).toContain('items-center-safe')
    expect(wrapper.get('[data-pager-layer="current"]').findAll('[data-spread-side] img')).toHaveLength(2)

    wrapper.unmount()
  })

  it('safely centers a paginated page without putting oversized content before the scroll origin', async () => {
    mocks.savedMode = 'paginated'
    mocks.savedViewMode = 'single'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    const pages = wrapper.get('[data-testid="cbz-paginated-pages"]')
    expect(pages.classes()).toContain('items-center-safe')
    expect(pages.classes()).toContain('justify-center-safe')

    wrapper.unmount()
  })

  it('routes settings panel updates and reset through the per-book settings store', async () => {
    mocks.savedMode = 'paginated'
    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
      global: {
        stubs: {
          Popover: { template: '<div><slot /></div>' },
          PopoverTrigger: { template: '<div><slot /></div>' },
          PopoverContent: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()
    await nextTick()

    const panel = wrapper.getComponent(CbzSettingsPanel)
    expect(panel.props('settings')).toMatchObject({ fitMode: 'fit-page', bgColor: 'black' })

    panel.vm.$emit('update', { bgColor: 'white' })
    await nextTick()
    expect(mocks.updateBookSettings).toHaveBeenCalledWith({ bgColor: 'white' })

    panel.vm.$emit('reset')
    expect(mocks.resetBookSettings).toHaveBeenCalledOnce()

    wrapper.unmount()
  })
  it('zooms with desktop controls and Ctrl-wheel without turning the page', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
      global: {
        stubs: {
          Tooltip: { template: '<div><slot /></div>' },
          TooltipTrigger: { template: '<div><slot /></div>' },
          TooltipContent: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()
    await nextTick()

    const pages = wrapper.get('[data-testid="cbz-paginated-pages"]')
    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 800 },
    })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1_000, height: 800 } as DOMRect)
    expect(pages.attributes('style')).toContain('scale(1)')

    await wrapper.get('button[aria-label="reader.cbz.zoomIn"]').trigger('click')
    await nextTick()
    expect(pages.attributes('style')).toContain('scale(1.25)')
    expect(viewport.scrollLeft).toBe(125)
    expect(viewport.scrollTop).toBe(100)

    const slider = wrapper.get('input[type="range"]')
    expect(slider.attributes('value')).toBe('1')

    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, clientX: 500, clientY: 400, deltaY: 100 }))
    await nextTick()

    expect(pages.attributes('style')).toContain('scale(1)')
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.scrollTop).toBe(0)
    expect(slider.attributes('value')).toBe('1')

    wrapper.unmount()
  })
  it('offers the next book of the series on the last page and opens it on request', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(mocks.loadNextBook).toHaveBeenCalledWith(42, 11)
    const card = wrapper.findComponent(NextIssueCard)
    expect(card.exists()).toBe(true)

    card.vm.$emit('open')
    await flushPromises()

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'reader', params: { bookId: 91, fileId: 501 }, query: { format: 'cbz' } })

    wrapper.unmount()
  })

  it('hides the next book until the last page is reached', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 2
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(false)

    wrapper.unmount()
  })

  it('keeps arrow keys turning pages after a reader button is clicked, leaving activation keys to the button', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 5
    mocks.savedPageNumber = 2
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 }, attachTo: document.body })
    await flushPromises()
    await nextTick()
    const pages = () => wrapper.findAll('img').map((image) => image.attributes('src'))
    const opened = pages()
    const button = wrapper.get('button').element as HTMLButtonElement
    button.focus()

    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await nextTick()
    expect(pages()).toEqual(opened)

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(pages()).not.toEqual(opened)

    wrapper.unmount()
  })

  it('leaves the page turn inert past the last page while auto-advance is off', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()

    expect(mocks.routerPush).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('crosses into the next book on a further page turn once auto-advance has settled on the last page', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.savedAutoAdvance = true
    mocks.nextBook = NEXT_BOOK

    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    // The turn that landed on the last page must not carry through into the next book.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(mocks.routerPush).not.toHaveBeenCalled()

    now.mockReturnValue(11_000)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'reader', params: { bookId: 91, fileId: 501 }, query: { format: 'cbz' } })

    now.mockRestore()
    wrapper.unmount()
  })

  it('never crosses into another book while peeking', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.savedAutoAdvance = true
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22, peekMode: true } })
    await flushPromises()
    await nextTick()

    expect(mocks.loadNextBook).not.toHaveBeenCalled()
    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(false)

    wrapper.unmount()
  })

  it('flushes a debounced page turn before the reading session ends', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await nextTick()
    wrapper.unmount()

    expect(mocks.sessionEndSnapshots).toEqual([{ percentage: 50, pageNumber: 3 }])
    expect(mocks.progressSave).toHaveBeenCalledOnce()
  })

  it('places the next book after the last page in continuous modes', async () => {
    mocks.savedMode = 'long-strip'
    mocks.pageCount = 3
    mocks.savedPageNumber = 2
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(true)

    wrapper.unmount()
  })

  function dispatchPointer(target: EventTarget, type: string, clientX: number) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 400, button: 0 }))
  }

  function sizeViewport(viewport: HTMLElement) {
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 800 },
    })
  }

  it('turns to the next page while the current layer follows the finger 1:1', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)

    dispatchPointer(viewport, 'pointerdown', 350)
    dispatchPointer(window, 'pointermove', 150)

    const currentLayer = wrapper.get('[data-pager-layer="current"]').element as HTMLElement
    const nextLayer = wrapper.get('[data-pager-layer="next"]').element as HTMLElement
    expect(currentLayer.style.transform).toBe('translate3d(-200px, 0, 0)')
    expect(nextLayer.style.visibility).toBe('visible')
    expect(Number((currentLayer.querySelector('[data-pager-shadow]') as HTMLElement).style.opacity)).toBeGreaterThan(0)

    dispatchPointer(window, 'pointerup', 150)
    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-pager-layer="current"] [data-page]').attributes('data-page')).toBe('2')
    expect(currentLayer.style.transform).toBe('translate3d(0px, 0, 0)')

    wrapper.unmount()
  })

  it('snaps back when a slow drag stays below the turn threshold', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)

    let now = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    dispatchPointer(viewport, 'pointerdown', 350)
    now = 200
    dispatchPointer(window, 'pointermove', 320)
    now = 400
    dispatchPointer(window, 'pointerup', 320)
    nowSpy.mockRestore()
    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-pager-layer="current"] [data-page]').attributes('data-page')).toBe('1')
    expect((wrapper.get('[data-pager-layer="current"]').element as HTMLElement).style.transform).toBe('translate3d(0px, 0, 0)')

    wrapper.unmount()
  })

  it('slides both layers together when the slide page turn mode is selected', async () => {
    mocks.savedMode = 'paginated'
    mocks.savedPageTurnMode = 'slide'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)

    dispatchPointer(viewport, 'pointerdown', 350)
    dispatchPointer(window, 'pointermove', 250)

    const currentLayer = wrapper.get('[data-pager-layer="current"]').element as HTMLElement
    const nextLayer = wrapper.get('[data-pager-layer="next"]').element as HTMLElement
    expect(currentLayer.style.transform).toBe('translate3d(-100px, 0, 0)')
    expect(nextLayer.style.transform).toBe('translate3d(300px, 0, 0)')

    dispatchPointer(window, 'pointerup', 250)
    await flushPromises()
    wrapper.unmount()
  })

  it('hands the gesture back to native panning while zoomed in', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 800 } as DOMRect)

    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, clientX: 200, clientY: 400, deltaY: -100 }))
    await nextTick()

    dispatchPointer(viewport, 'pointerdown', 350)
    dispatchPointer(window, 'pointermove', 50)
    dispatchPointer(window, 'pointerup', 50)
    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-pager-layer="current"] [data-page]').attributes('data-page')).toBe('1')

    wrapper.unmount()
  })

  it('predecodes the pages around the current spread before they are shown', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const OriginalImage = globalThis.Image
    const decodedSources: string[] = []
    class DecodedImage {
      decoding = ''
      draggable = false
      naturalWidth = 800
      naturalHeight = 1200
      src = ''

      decode() {
        decodedSources.push(this.src)
        return Promise.resolve()
      }
    }
    vi.stubGlobal('Image', DecodedImage)

    try {
      const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
      await flushPromises()
      await nextTick()

      expect(decodedSources).toEqual(
        expect.arrayContaining([
          '/api/v1/cbz/files/22/pages/0',
          '/api/v1/cbz/files/22/pages/1',
          '/api/v1/cbz/files/22/pages/2',
          '/api/v1/cbz/files/22/pages/3',
        ]),
      )

      wrapper.unmount()
    } finally {
      vi.stubGlobal('Image', OriginalImage)
    }
  })

  it('turns back when the finger drags to the right', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)

    dispatchPointer(viewport, 'pointerdown', 50)
    dispatchPointer(window, 'pointermove', 250)
    dispatchPointer(window, 'pointerup', 250)
    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-pager-layer="current"] [data-page]').attributes('data-page')).toBe('0')

    wrapper.unmount()
  })

  it('maps a rightward drag to the next page in right-to-left reading', async () => {
    mocks.savedMode = 'paginated'
    mocks.savedDirection = 'rtl'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)

    dispatchPointer(viewport, 'pointerdown', 150)
    dispatchPointer(window, 'pointermove', 350)
    dispatchPointer(window, 'pointerup', 350)
    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-pager-layer="current"] [data-page]').attributes('data-page')).toBe('2')

    wrapper.unmount()
  })

  it('keeps continuous mode page buttons scrolling the strip', async () => {
    mocks.savedMode = 'infinite'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()
    mocks.scrollToIndex.mockClear()

    await wrapper.get('button[aria-label="reader.pageImages.nextPage"]').trigger('click')
    await flushPromises()
    await nextTick()

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
    expect(wrapper.get('input[type="range"]').attributes('value')).toBe('2')

    wrapper.unmount()
  })

  it('allows native scrolling when a paginated page is wider than the viewport', async () => {
    mocks.savedMode = 'paginated'
    mocks.savedFitMode = 'fit-width'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]')
    expect(viewport.classes()).toContain('overflow-auto')

    wrapper.unmount()
  })

  it('keeps the incoming page opaque after it was already decoded in the next layer', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)
    await wrapper.get('[data-pager-layer="next"]').get('img').trigger('load')

    dispatchPointer(viewport, 'pointerdown', 350)
    dispatchPointer(window, 'pointermove', 150)
    dispatchPointer(window, 'pointerup', 150)
    await flushPromises()
    await nextTick()

    const currentImage = wrapper.get('[data-pager-layer="current"]').get('img')
    expect(currentImage.attributes('data-page')).toBe('2')
    expect(currentImage.classes()).not.toContain('opacity-0')

    wrapper.unmount()
  })

  it('opens the next book when a gesture turns past the last page with auto-advance armed', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.savedAutoAdvance = true
    mocks.nextBook = NEXT_BOOK

    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)
    now.mockReturnValue(11_000)
    dispatchPointer(viewport, 'pointerdown', 350)
    dispatchPointer(window, 'pointermove', 100)
    dispatchPointer(window, 'pointerup', 100)
    await flushPromises()

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'reader', params: { bookId: 91, fileId: 501 }, query: { format: 'cbz' } })

    now.mockRestore()
    wrapper.unmount()
  })

  it('clears a preview load failure once the real image loads', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    sizeViewport(viewport)
    const nextImage = wrapper.get('[data-pager-layer="next"]').get('img')
    await nextImage.trigger('error')
    await nextImage.trigger('load')

    dispatchPointer(viewport, 'pointerdown', 350)
    dispatchPointer(window, 'pointermove', 150)
    dispatchPointer(window, 'pointerup', 150)
    await flushPromises()
    await nextTick()

    expect(wrapper.text()).not.toContain('reader.pageImages.pageFailed')

    wrapper.unmount()
  })
})
