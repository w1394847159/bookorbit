const inlineDocument = (text, type) => {
  let parsed = new DOMParser().parseFromString(text, type === 'application/xhtml+xml' ? type : 'text/html')
  if (parsed.querySelector('parsererror') || !parsed.documentElement) {
    parsed = new DOMParser().parseFromString(text, 'text/html')
  }
  const html = document.implementation.createHTMLDocument('')
  html.replaceChild(html.importNode(parsed.documentElement, true), html.documentElement)
  // Do NOT inject <base href="blob:...">:
  // 1) All internal assets inside `text` are already rewritten to blob: URLs by epub.js Loader.
  // 2) <base href="blob:..."> violates BookOrbit's Content-Security-Policy (`base-uri 'self'`)
  //    and breaks relative anchor fragments inside srcdoc frames.
  return { markup: '<!DOCTYPE html>' + html.documentElement.outerHTML, body: html.body }
}

export const loadIframeDocument = (iframe, src, signal) =>
  new Promise((resolve, reject) => {
    let settled = false
    let inline = false
    let inlineBody
    const wasHiddenDisplay = iframe.style.display === 'none'
    if (wasHiddenDisplay) {
      iframe.style.visibility = 'hidden'
      iframe.style.display = 'block'
    }
    const controller = new AbortController()
    const finish = (error, doc) => {
      if (settled) return
      settled = true
      clearTimeout(fallbackTimer)
      clearTimeout(timeoutTimer)
      iframe.removeEventListener('load', onLoad)
      signal?.removeEventListener('abort', onAbort)
      controller.abort()
      if (wasHiddenDisplay) {
        iframe.style.visibility = ''
        iframe.style.display = 'none'
      }
      if (error) reject(error)
      else resolve(doc)
    }
    const onAbort = () => finish(new DOMException('', 'AbortError'))
    const onLoad = () => {
      const doc = iframe.contentDocument
      if (doc?.body && (inline || doc.URL === src)) {
        // HTML parsing can insert elements such as tbody. Restore the XHTML body tree so CFIs
        // saved here still address the same nodes in other browsers and the native reader.
        if (inlineBody) doc.body.replaceWith(doc.importNode(inlineBody, true))
        finish(null, doc)
      }
    }
    const loadViaSrcdoc = async () => {
      if (settled || inline || !src.startsWith('blob:')) return
      try {
        const response = await fetch(src, { signal: controller.signal })
        const text = await response.text()
        if (settled) return
        const document = inlineDocument(text, response.headers.get('content-type')?.split(';')[0])
        inlineBody = document.body
        inline = true
        iframe.removeAttribute('src')
        iframe.srcdoc = document.markup
      } catch (error) {
        finish(error)
      }
    }
    const fallbackTimer = setTimeout(loadViaSrcdoc, 250)
    const timeoutTimer = setTimeout(() => finish(new DOMException('', 'TimeoutError')), 30_000)
    iframe.addEventListener('load', onLoad)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    // Mobile WebViews / browsers (Via, Android WebView, WeChat, iOS WebKit) frequently block or
    // stall blob: navigations inside sandboxed iframes (setting contentDocument to null on
    // chrome-error://chromewebdata/). Load blob: documents directly via srcdoc while restoring
    // the exact XHTML DOM body for 100% CFI compatibility.
    if (src.startsWith('blob:')) {
      void loadViaSrcdoc()
    } else {
      iframe.removeAttribute('srcdoc')
      iframe.src = src
    }
  })
