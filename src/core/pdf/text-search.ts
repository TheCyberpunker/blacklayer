/**
 * Text-search across every page of a PDF, returning normalized rectangles for
 * every match. Used by the "Find and hide" workflow to censor recurring text
 * (emails, names, account numbers) without drawing rectangles by hand.
 *
 * Coordinates are normalized to a top-left origin ([0..1] × [0..1]) so they can
 * flow into the same redaction pipeline as manual rects and template rects.
 *
 * Cross-item matches (e.g., a match that spans two adjacent text items) are not
 * handled in this pass. Substring lengths inside an item are converted to a
 * pixel width proportionally, which is a small approximation but is fine for
 * most real-world PDFs where text items are word- or line-sized.
 */

export interface SearchMatch {
  pageIndex: number
  /** 0..1, top-left origin. */
  x: number
  y: number
  w: number
  h: number
  /** The exact substring matched (respects the source's original casing). */
  text: string
}

export interface FindTextArgs {
  sourceBytes: ArrayBuffer
  query: string
  caseSensitive?: boolean
}

export async function findTextMatches({
  sourceBytes,
  query,
  caseSensitive = false,
}: FindTextArgs): Promise<SearchMatch[]> {
  const q = query.trim()
  if (!q) return []
  const { ensurePdfjs } = await import('../preview/pdfjs.ts')
  const pdfjs = ensurePdfjs()
  // Same detachment guard as rasterize-page.ts — copy so the source ArrayBuffer
  // survives concurrent or subsequent pdfjs use.
  const dataCopy = new Uint8Array(sourceBytes.byteLength)
  dataCopy.set(new Uint8Array(sourceBytes))
  const loadingTask = pdfjs.getDocument({ data: dataCopy })
  const doc = await loadingTask.promise
  const needle = caseSensitive ? q : q.toLowerCase()
  const matches: SearchMatch[] = []
  try {
    for (let i = 0; i < doc.numPages; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = await doc.getPage(i + 1)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!item || typeof (item as { str?: unknown }).str !== 'string') continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const it = item as any
        const s: string = it.str
        if (!s) continue
        const hay = caseSensitive ? s : s.toLowerCase()
        let idx = 0
        while (idx <= hay.length - needle.length) {
          const found = hay.indexOf(needle, idx)
          if (found < 0) break
          const rect = itemRect(it, viewport, found, needle.length, s.length)
          if (rect) {
            matches.push({
              pageIndex: i,
              x: rect.x,
              y: rect.y,
              w: rect.w,
              h: rect.h,
              text: s.slice(found, found + needle.length),
            })
          }
          idx = found + needle.length
        }
      }
      page.cleanup?.()
    }
  } finally {
    await doc.cleanup()
    loadingTask.destroy()
  }
  return matches
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemRect(item: any, viewport: any, matchStart: number, matchLen: number, totalLen: number): Rect | null {
  const transform = item.transform as [number, number, number, number, number, number] | undefined
  if (!transform) return null
  const [a, , , d, e, f] = transform
  const itemWidth: number = typeof item.width === 'number' ? item.width : 0
  const itemHeight: number = typeof item.height === 'number' && item.height > 0 ? item.height : Math.abs(d) || Math.abs(a) || 10
  const fontSize = Math.max(1, itemHeight)
  const chunkX = e + itemWidth * (matchStart / Math.max(1, totalLen))
  const chunkW = itemWidth * (matchLen / Math.max(1, totalLen))
  // pdfjs y increases upward from bottom-left. Our normalized system is top-down.
  // baseline sits at f; glyphs occupy roughly [f, f + fontSize * 0.85].
  const topPdf = f + fontSize * 0.9
  const yTopLeft = viewport.height - topPdf
  const heightNorm = fontSize * 1.15
  const vw = viewport.width || 1
  const vh = viewport.height || 1
  return {
    x: Math.max(0, chunkX / vw),
    y: Math.max(0, yTopLeft / vh),
    w: Math.max(0, chunkW / vw),
    h: Math.max(0, heightNorm / vh),
  }
}
