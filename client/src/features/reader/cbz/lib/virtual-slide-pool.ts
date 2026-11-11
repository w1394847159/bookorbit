/**
 * Small LRU of images that have already completed `HTMLImageElement.decode()`.
 *
 * Inserting a decoded image into the DOM skips the main-thread decode that otherwise stalls the
 * first frame of a page turn by 50 to 100 ms on high-resolution comic pages. The pool only keeps a
 * bounded window around the current spread; keeping every decoded bitmap for a long book would
 * exhaust the memory of a phone long before the reader finishes it.
 */

export type PageUrlResolver = (pageIndex: number) => string

export interface VirtualSlidePoolOptions {
  maxCacheSize?: number
  onDecoded?: (pageIndex: number, image: HTMLImageElement) => void
  onError?: (pageIndex: number, error: unknown) => void
}

const DEFAULT_MAX_CACHE_SIZE = 4

export class VirtualSlidePool {
  private totalPages: number
  private readonly resolveUrl: PageUrlResolver
  private readonly maxCacheSize: number
  private readonly onDecoded?: (pageIndex: number, image: HTMLImageElement) => void
  private readonly onError?: (pageIndex: number, error: unknown) => void
  private readonly cache = new Map<number, HTMLImageElement>()
  private readonly pending = new Map<number, Promise<HTMLImageElement | null>>()
  private generation = 0
  private disposed = false

  constructor(totalPages: number, resolveUrl: PageUrlResolver, options: VirtualSlidePoolOptions = {}) {
    this.totalPages = totalPages
    this.resolveUrl = resolveUrl
    this.maxCacheSize = Math.max(1, options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE)
    this.onDecoded = options.onDecoded
    this.onError = options.onError
  }

  public setTotalPages(totalPages: number): void {
    if (this.totalPages === totalPages) return
    this.clear()
    this.totalPages = totalPages
  }

  /** Decodes a page in the background and returns the ready-to-insert image element. */
  public prewarm(pageIndex: number): Promise<HTMLImageElement | null> {
    if (this.disposed || pageIndex < 0 || pageIndex >= this.totalPages) return Promise.resolve(null)

    const cached = this.cache.get(pageIndex)
    if (cached) {
      this.touch(pageIndex, cached)
      return Promise.resolve(cached)
    }

    const inFlight = this.pending.get(pageIndex)
    if (inFlight) return inFlight

    const generation = this.generation
    const image = new Image()
    image.decoding = 'async'
    image.draggable = false

    const task = this.decode(image, this.resolveUrl(pageIndex))
      .then(() => {
        if (this.disposed || generation !== this.generation) return null
        this.cacheImage(pageIndex, image)
        this.onDecoded?.(pageIndex, image)
        return image
      })
      .catch((error: unknown) => {
        if (!this.disposed) this.onError?.(pageIndex, error)
        return null
      })
      .finally(() => {
        if (this.pending.get(pageIndex) === task) this.pending.delete(pageIndex)
      })

    this.pending.set(pageIndex, task)
    return task
  }

  public preloadWindow(centerPage: number, offsets: readonly number[] = [-2, -1, 0, 1, 2, 3]): void {
    for (const offset of offsets) void this.prewarm(centerPage + offset)
  }

  public preloadPages(pages: Iterable<number>): void {
    for (const page of pages) void this.prewarm(page)
  }

  public getImage(pageIndex: number): HTMLImageElement | null {
    const image = this.cache.get(pageIndex)
    if (image) this.touch(pageIndex, image)
    return image ?? null
  }

  /** Drops decoded bitmaps outside the active window so memory stays bounded while reading. */
  public retain(pages: Iterable<number>): void {
    const keep = new Set(pages)
    for (const page of this.cache.keys()) {
      if (!keep.has(page)) this.cache.delete(page)
    }
  }

  public clear(): void {
    this.generation++
    this.cache.clear()
    this.pending.clear()
  }

  public dispose(): void {
    this.disposed = true
    this.clear()
  }

  private decode(image: HTMLImageElement, src: string): Promise<void> {
    if (typeof image.decode === 'function') {
      image.src = src
      return image.decode()
    }

    return new Promise((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image failed to load'))
      image.src = src
    })
  }

  private touch(pageIndex: number, image: HTMLImageElement): void {
    this.cache.delete(pageIndex)
    this.cache.set(pageIndex, image)
  }

  private cacheImage(pageIndex: number, image: HTMLImageElement): void {
    this.cache.delete(pageIndex)
    this.cache.set(pageIndex, image)
    while (this.cache.size > this.maxCacheSize) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }
}
