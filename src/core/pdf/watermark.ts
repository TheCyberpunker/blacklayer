import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { ProtectionProfile, RedactionRect, WatermarkOptions } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import { applyMetadataMode, hasDigitalSignature } from './metadata.ts'
import { rasterizePageWithRedactions } from './rasterize-page.ts'

export interface ApplyPdfWatermarkArgs {
  source: ArrayBuffer
  profile: ProtectionProfile
  lang: 'en' | 'es'
  /**
   * Redactions to bake into the output. Keyed by 0-based page index.
   * A page with any redactions is rasterized via pdfjs and re-embedded, which
   * destroys the underlying text and vector data for that page.
   */
  redactionsByPage?: ReadonlyMap<number, readonly RedactionRect[]>
}

export interface ApplyPdfWatermarkResult {
  bytes: Uint8Array
  hadDigitalSignature: boolean
  rasterizedPages: readonly number[]
}

export async function applyPdfWatermark({
  source,
  profile,
  lang,
  redactionsByPage,
}: ApplyPdfWatermarkArgs): Promise<ApplyPdfWatermarkResult> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  const hadSignature = hasDigitalSignature(pdf)
  const rasterized: number[] = []

  if (redactionsByPage && redactionsByPage.size) {
    // Rasterize each affected page: insert a replacement image page at the same
    // index, then delete the original that shifted one to the right.
    // Process indices in descending order so earlier indices stay valid.
    const indices = Array.from(redactionsByPage.keys()).sort((a, b) => b - a)
    for (const idx of indices) {
      const rects = redactionsByPage.get(idx) ?? []
      if (!rects.length) continue
      await rasterizePageWithRedactions({
        sourceBytes: source,
        sourcePageIndex: idx,
        targetDoc: pdf,
        insertIndex: idx,
        redactions: rects,
      })
      pdf.removePage(idx + 1)
      rasterized.push(idx)
    }
  }

  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const options = profile.watermark
  const lines = formatWatermarkLines(options.text, lang)
  const { r, g, b } = options.color
  const color = rgb(r, g, b)
  const lineHeight = options.fontSize * 1.2
  const blockHeight = lines.length * lineHeight

  const pages = pdf.getPages()
  for (const page of pages) {
    const { width, height } = page.getSize()
    if (options.tile) {
      const stepX = Math.max(120, options.tileGapX)
      const stepY = Math.max(120, options.tileGapY)
      const diagonal = Math.hypot(width, height)
      for (let y = -diagonal; y < diagonal * 2; y += stepY) {
        for (let x = -diagonal; x < diagonal * 2; x += stepX) {
          drawBlock(page, lines, font, x, y, options, color, lineHeight, blockHeight)
        }
      }
    } else {
      drawBlock(page, lines, font, width / 2, height / 2, options, color, lineHeight, blockHeight)
    }
  }

  applyMetadataMode(pdf, profile.metadata)

  const bytes = await pdf.save()
  return { bytes, hadDigitalSignature: hadSignature, rasterizedPages: rasterized.sort((a, b) => a - b) }
}

function drawBlock(
  page: ReturnType<PDFDocument['getPages']>[number],
  lines: string[],
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  cx: number,
  cy: number,
  options: WatermarkOptions,
  color: ReturnType<typeof rgb>,
  lineHeight: number,
  blockHeight: number,
): void {
  const rot = degrees(options.rotationDeg)
  const startY = cy + blockHeight / 2 - lineHeight
  lines.forEach((text, i) => {
    const textWidth = font.widthOfTextAtSize(text, options.fontSize)
    page.drawText(text, {
      x: cx - textWidth / 2,
      y: startY - i * lineHeight,
      size: options.fontSize,
      font,
      color,
      opacity: options.opacity,
      rotate: rot,
    })
  })
}

export async function inspectPdf(source: ArrayBuffer): Promise<{ hasSignature: boolean; pageCount: number }> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  return {
    hasSignature: hasDigitalSignature(pdf),
    pageCount: pdf.getPageCount(),
  }
}
