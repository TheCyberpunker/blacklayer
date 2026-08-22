/**
 * OCR entry point. Uses Tesseract.js with worker + WASM + language data all
 * self-hosted under /tesseract/ so the app stays offline-first: no external
 * CDN calls at runtime, and the Docker image ships everything needed.
 *
 * Everything here is dynamic-imported so the tesseract.js bundle (~800 KB gz)
 * is not on the critical path — it only downloads when the user asks for
 * text analysis on an image.
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
    const result = await worker.recognize(file)
    const text = typeof result.data.text === 'string' ? result.data.text : ''
    const confidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0
    return { text, confidence }
  } finally {
    await worker.terminate()
  }
}
