/**
 * OCR entry point. Uses Tesseract.js with worker + WASM + language data all
 * self-hosted under /tesseract/ so the app stays offline-first: no external
 * CDN calls at runtime, and the Docker image ships everything needed.
 *
 * Everything here is dynamic-imported so the tesseract.js bundle (~800 KB gz)
 * is not on the critical path — it only downloads when the user asks for
 * text analysis on an image.
 *
 * Results are cached in-memory by a SHA-256 hash of the file bytes plus
 * language, so re-running OCR on the same file (e.g. after the user cancels
 * and retries) is instant. Cache clears on full page reload — deliberate,
 * since a reload signals a fresh session.
 */
import type { Lang } from '../../hooks/use-lang.ts'

export interface OcrResult {
  text: string
  /** Rough model confidence 0..100 from Tesseract's own score. */
  confidence: number
}

/** Progress reported by the tesseract worker (0..1 within each phase). */
export interface OcrProgress {
  /** Free-text label from Tesseract ("recognizing text", "loading language traineddata"…). */
  status: string
  /** 0..1 within the current phase. */
  progress: number
}

const TESSERACT_BASE = `${import.meta.env.BASE_URL || '/'}tesseract`.replace(/\/{2,}/g, '/')

const paths = {
  workerPath: `${TESSERACT_BASE}/worker.min.js`,
  corePath: `${TESSERACT_BASE}/tesseract-core-simd-lstm.wasm.js`,
  langPath: `${TESSERACT_BASE}/lang-data`,
}

/** Map app UI language into a Tesseract lang code list. */
function langsFor(uiLang: Lang): string[] {
  return uiLang === 'es' ? ['spa', 'eng'] : ['eng', 'spa']
}

const ocrCache = new Map<string, OcrResult>()

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

/**
 * Warm up the tesseract.js chunk (JS + wasm loader) without running OCR.
 * Call in idle time after an image loads so the first user-triggered OCR
 * skips the initial ~800 KB network fetch.
 *
 * Safe to call multiple times: dynamic import is memoized by the bundler.
 * No language data is downloaded here — that happens on the first real run.
 */
export function preloadOcr(): void {
  void import('tesseract.js').catch(() => {})
}

/**
 * Run OCR on a File (JPEG/PNG/WebP). Loads the tesseract worker on demand and
 * releases it when finished. Returns raw text + Tesseract's own confidence.
 *
 * Throws on unrecoverable failure (asset missing, worker init error). Callers
 * should catch and degrade to "no OCR" rather than surface the error to users.
 */
export async function runOcr(
  file: File,
  uiLang: Lang,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  // Cache lookup first. If we already OCR'd this exact bytes+lang combination
  // this session, return the cached result and report a single "done" progress
  // tick so the UI doesn't sit at 0.
  const cacheKey = `img:${uiLang}:${await hashFile(file)}`
  const cached = ocrCache.get(cacheKey)
  if (cached) {
    onProgress?.({ status: 'recognizing text', progress: 1 })
    return cached
  }
  return runOcrInternal(file, cacheKey, uiLang, onProgress)
}

/**
 * OCR a rendered PDF page (or any pre-rendered bitmap). The caller provides a
 * stable cache key (e.g. `pdf:{hash}:{pageIndex}`) so the same page is not
 * re-recognized across clicks.
 */
export async function runOcrOnBitmap(
  bitmap: ImageBitmap,
  cacheKeyBase: string,
  uiLang: Lang,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const cacheKey = `bmp:${uiLang}:${cacheKeyBase}`
  const cached = ocrCache.get(cacheKey)
  if (cached) {
    onProgress?.({ status: 'recognizing text', progress: 1 })
    return cached
  }
  // Draw the ImageBitmap onto a canvas so Tesseract can consume it.
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  return runOcrInternal(canvas, cacheKey, uiLang, onProgress)
}

async function runOcrInternal(
  source: File | HTMLCanvasElement,
  cacheKey: string,
  uiLang: Lang,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const { createWorker } = await import('tesseract.js')
  const langs = langsFor(uiLang)

  const worker = await createWorker(langs, 1, {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    // Our fetch-ocr-assets.mjs saves the traineddata files uncompressed. The
    // worker defaults to appending ".gz"; disabling gzip makes it fetch the
    // raw file we actually ship.
    gzip: false,
    // Skip the tesseract.js default cache in IndexedDB — we already serve the
    // traineddata from same-origin, so caching adds no benefit and complicates
    // the "delete all local settings" story.
    cacheMethod: 'none',
    logger: onProgress
      ? (m: { status: string; progress: number }) =>
          onProgress({ status: m.status, progress: m.progress })
      : undefined,
    errorHandler: (err: unknown) => {
      // Surface errors that would otherwise hide inside the worker.
      // eslint-disable-next-line no-console
      console.error('[ocr] worker error:', err)
    },
  })

  try {
    const result = await worker.recognize(source)
    const text = typeof result.data.text === 'string' ? result.data.text : ''
    const confidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0
    const out = { text, confidence }
    ocrCache.set(cacheKey, out)
    return out
  } finally {
    await worker.terminate()
  }
}
