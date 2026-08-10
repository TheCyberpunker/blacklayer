import type { RenderedBase } from '../preview/render.ts'
import { RULES, FILENAME_HINTS, ASPECT_HINTS } from './rules.ts'
import type { Confidence, Country, DetectionResult, DocumentType, IdSubtype } from './types.ts'
import { UNKNOWN_DETECTION } from './types.ts'

interface Score {
  type: DocumentType
  subtype: IdSubtype
  country: Country
  weight: number
  reasons: string[]
}

const CARD_ASPECT_TOLERANCE = 0.05

/**
 * Heuristic document detection. Combines three signals in order:
 *  1. filename hints (weight 1)
 *  2. image / page aspect ratio for single-page documents (weight 2)
 *  3. extracted text from PDF page 1 via pdfjs (weight up to 3)
 *
 * Returns UNKNOWN_DETECTION when no signal fires. No OCR is performed here; when
 * OCR lands, image files can also carry text signals.
 */
export async function detectDocument(file: File, base: RenderedBase): Promise<DetectionResult> {
  const scores = new Map<string, Score>()

  const bump = (partial: Omit<Score, 'reasons'>, reason: string): void => {
    const key = `${partial.type}|${partial.subtype ?? ''}|${partial.country}`
    const existing = scores.get(key)
    if (existing) {
      existing.weight += partial.weight
      existing.reasons.push(reason)
    } else {
      scores.set(key, { ...partial, reasons: [reason] })
    }
  }

  // 1. Filename hints
  const nameLower = file.name.toLowerCase()
  for (const hint of FILENAME_HINTS) {
    for (const pat of hint.patterns) {
      if (nameLower.includes(pat)) {
        bump(
          { type: hint.type, subtype: hint.subtype, country: hint.country, weight: 1 },
          `filename contains "${pat}"`,
        )
      }
    }
  }

  // 2. Aspect ratio (single-page documents only)
  const firstThumb = base.thumbnails[0]
  if (firstThumb && base.totalPages === 1) {
    const aspect = firstThumb.intrinsicWidth / firstThumb.intrinsicHeight
    for (const h of ASPECT_HINTS) {
      if (aspect >= h.minAspect - CARD_ASPECT_TOLERANCE && aspect <= h.maxAspect + CARD_ASPECT_TOLERANCE) {
        bump(
          { type: h.type, subtype: h.subtype, country: 'unknown', weight: h.weight },
          `aspect ratio ${aspect.toFixed(2)} matches ID card range`,
        )
      }
    }
  }

  // 3. Extracted text (PDF only, first page)
  if (base.kind === 'pdf') {
    try {
      const text = await extractPdfFirstPageText(file)
      if (text) {
        const textLower = text.toLowerCase()
        for (const rule of RULES) {
          for (const pat of rule.patterns) {
            if (textLower.includes(pat)) {
              bump(
                { type: rule.type, subtype: rule.subtype, country: rule.country, weight: rule.weight },
                `page 1 contains "${pat}"`,
              )
            }
          }
        }
      }
    } catch {
      // text extraction is best-effort
    }
  }

  return summarize(scores)
}

async function extractPdfFirstPageText(file: File): Promise<string> {
  const { ensurePdfjs } = await import('../preview/pdfjs.ts')
  const pdfjs = ensurePdfjs()
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) })
  try {
    const doc = await loadingTask.promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    // TextContent items have a `str` field with the actual text.
    const parts: string[] = []
    for (const item of content.items) {
      if (typeof (item as { str?: string }).str === 'string') {
        parts.push((item as { str: string }).str)
      }
    }
    await doc.cleanup()
    loadingTask.destroy()
    return parts.join(' ')
  } catch {
    loadingTask.destroy()
    return ''
  }
}

function summarize(scores: Map<string, Score>): DetectionResult {
  if (scores.size === 0) return UNKNOWN_DETECTION

  // Pick the score with the highest weight; ties broken by preferring more specific subtypes.
  let best: Score | null = null
  for (const s of scores.values()) {
    if (!best) {
      best = s
      continue
    }
    if (s.weight > best.weight) {
      best = s
      continue
    }
    if (s.weight === best.weight && s.subtype && !best.subtype) {
      best = s
    }
  }
  if (!best) return UNKNOWN_DETECTION

  const confidence: Confidence = best.weight >= 4 ? 'high' : best.weight >= 2 ? 'medium' : 'low'
  return {
    type: best.type,
    subtype: best.subtype,
    country: best.country,
    confidence,
    reasons: best.reasons,
    manual: false,
  }
}
