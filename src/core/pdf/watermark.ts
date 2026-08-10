import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { ProtectionProfile, WatermarkOptions } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import { applyMetadataMode, hasDigitalSignature } from './metadata.ts'

export interface ApplyPdfWatermarkArgs {
  source: ArrayBuffer
  profile: ProtectionProfile
  lang: 'en' | 'es'
}

export interface ApplyPdfWatermarkResult {
  bytes: Uint8Array
  hadDigitalSignature: boolean
}

export async function applyPdfWatermark({
  source,
  profile,
  lang,
}: ApplyPdfWatermarkArgs): Promise<ApplyPdfWatermarkResult> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  const hadSignature = hasDigitalSignature(pdf)

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
  return { bytes, hadDigitalSignature: hadSignature }
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

/**
 * Inspect a PDF for a digital signature without applying any protection.
 * Used by the UI to warn the user before they trigger the export.
 */
export async function inspectPdf(source: ArrayBuffer): Promise<{ hasSignature: boolean; pageCount: number }> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  return {
    hasSignature: hasDigitalSignature(pdf),
    pageCount: pdf.getPageCount(),
  }
}
