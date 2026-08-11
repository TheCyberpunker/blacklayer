import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { ProtectionProfile, RedactionRect, WatermarkOptions } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import { applyMetadataMode, hasDigitalSignature } from './metadata.ts'
import { rasterizePageWithRedactions } from './rasterize-page.ts'
import { mulberry32 } from '../random/prng.ts'

export interface ApplyPdfWatermarkArgs {
  source: ArrayBuffer
  profile: ProtectionProfile
  lang: 'en' | 'es'
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

  const pages = pdf.getPages()
  for (const page of pages) {
    drawWatermarkOnPdfPage(page, font, lines, options)
  }

  applyMetadataMode(pdf, profile.metadata)

  const bytes = await pdf.save()
  return { bytes, hadDigitalSignature: hadSignature, rasterizedPages: rasterized.sort((a, b) => a - b) }
}

function drawWatermarkOnPdfPage(
  page: ReturnType<PDFDocument['getPages']>[number],
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  lines: string[],
  options: WatermarkOptions,
): void {
  const { width, height } = page.getSize()
  const { r, g, b } = options.color
  const color = rgb(r, g, b)
  const anyLines = lines.some((l) => l.trim())

  if (anyLines) {
    const rng = mulberry32(options.seed || 1)
    const centered = () => rng() - 0.5

    if (options.tile) {
      const stepX = Math.max(120, options.tileGapX)
      const stepY = Math.max(120, options.tileGapY)
      const diagonal = Math.hypot(width, height)
      const j = Math.max(0, Math.min(1, options.jitter))
      for (let y = -diagonal; y < diagonal * 2; y += stepY) {
        for (let x = -diagonal; x < diagonal * 2; x += stepX) {
          // Mirror the canvas draw path (see core/watermark/draw.ts). Tighter
          // multipliers keep the pattern readable without turning it into noise.
          const dx = centered() * options.tileGapX * 0.25 * j
          const dy = centered() * options.tileGapY * 0.25 * j
          const rot = options.rotationDeg + centered() * 8 * j
          const opacityMul = 1 + centered() * 0.35 * j
          const opacity = Math.max(0.05, Math.min(1, options.opacity * opacityMul))
          const sizeMul = 1 + centered() * 0.2 * j
          const size = Math.max(10, options.fontSize * sizeMul)
          drawPdfBlock(page, lines, font, x + dx, y + dy, rot, size, opacity, color)
        }
      }
    } else {
      drawPdfBlock(page, lines, font, width / 2, height / 2, options.rotationDeg, options.fontSize, options.opacity, color)
    }
  }

  if (options.patterns.crosshatch) {
    drawPdfCrosshatch(page, width, height, options, color)
  }
  if (options.patterns.frame) {
    drawPdfFrame(page, width, height, options, color)
  }
}

function drawPdfBlock(
  page: ReturnType<PDFDocument['getPages']>[number],
  lines: string[],
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  cx: number,
  cy: number,
  rotDeg: number,
  fontSize: number,
  opacity: number,
  color: ReturnType<typeof rgb>,
): void {
  const lineHeight = fontSize * 1.2
  const blockHeight = lines.length * lineHeight
  const startY = cy + blockHeight / 2 - lineHeight
  const rot = degrees(rotDeg)
  lines.forEach((text, i) => {
    if (!text) return
    const textWidth = font.widthOfTextAtSize(text, fontSize)
    page.drawText(text, {
      x: cx - textWidth / 2,
      y: startY - i * lineHeight,
      size: fontSize,
      font,
      color,
      opacity,
      rotate: rot,
    })
  })
}

function drawPdfCrosshatch(
  page: ReturnType<PDFDocument['getPages']>[number],
  width: number,
  height: number,
  options: WatermarkOptions,
  color: ReturnType<typeof rgb>,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const spacing = Math.max(14, 20 * scaleFactor)
  const alpha = Math.max(0.12, Math.min(0.32, options.opacity * 0.55))
  const thickness = Math.max(0.9, 1.3 * scaleFactor)
  const diagonal = Math.hypot(width, height)
  const cx = width / 2
  const cy = height / 2

  const drawLines = (angleDeg: number, step: number) => {
    const a = (angleDeg * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    for (let y = -diagonal; y <= diagonal; y += step) {
      // Endpoints in local (unrotated) space, then rotated + translated.
      const x1 = -diagonal
      const y1 = y
      const x2 = diagonal
      const y2 = y
      const px1 = cx + x1 * cos - y1 * sin
      const py1 = cy + x1 * sin + y1 * cos
      const px2 = cx + x2 * cos - y2 * sin
      const py2 = cy + x2 * sin + y2 * cos
      page.drawLine({
        start: { x: px1, y: py1 },
        end: { x: px2, y: py2 },
        thickness,
        color,
        opacity: alpha,
      })
    }
  }

  drawLines(30, spacing)
  drawLines(-60, spacing * 1.4)
}

function drawPdfFrame(
  page: ReturnType<PDFDocument['getPages']>[number],
  width: number,
  height: number,
  options: WatermarkOptions,
  color: ReturnType<typeof rgb>,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const margin = Math.max(14, 24 * scaleFactor)
  const gap = Math.max(3, 5 * scaleFactor)
  const thickness = Math.max(0.6, 1.2 * scaleFactor)
  const alpha = Math.min(1, options.opacity * 1.4)

  const rect = (m: number) => {
    const w = width - m * 2
    const h = height - m * 2
    if (w <= 0 || h <= 0) return
    page.drawRectangle({
      x: m,
      y: m,
      width: w,
      height: h,
      borderColor: color,
      borderWidth: thickness,
      borderOpacity: alpha,
      color: undefined,
      opacity: 0,
    })
  }

  rect(margin)
  rect(margin + gap)
}

export async function inspectPdf(source: ArrayBuffer): Promise<{ hasSignature: boolean; pageCount: number }> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  return {
    hasSignature: hasDigitalSignature(pdf),
    pageCount: pdf.getPageCount(),
  }
}
