export type ProtectionLevel = 'basic' | 'recommended' | 'maximum'
export type MetadataMode = 'preserve' | 'neutralize'

/**
 * Redaction rectangle in normalized coordinates relative to the rendered base.
 * x, y, w, h are all in [0, 1]. Multiply by base intrinsic dimensions to draw.
 */
export interface RedactionRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface WatermarkText {
  recipient: string
  purpose: string
  date: string
}

export interface WatermarkOptions {
  text: WatermarkText
  opacity: number
  rotationDeg: number
  fontSize: number
  tile: boolean
  tileGapX: number
  tileGapY: number
  color: { r: number; g: number; b: number }
}

export interface ProtectionProfile {
  level: ProtectionLevel
  watermark: WatermarkOptions
  metadata: MetadataMode
}

const BASE_COLOR = { r: 0.1, g: 0.1, b: 0.1 }

export function profileFor(level: ProtectionLevel, text: WatermarkText): ProtectionProfile {
  switch (level) {
    case 'basic':
      return {
        level,
        watermark: {
          text,
          opacity: 0.16,
          rotationDeg: -30,
          fontSize: 46,
          tile: false,
          tileGapX: 320,
          tileGapY: 240,
          color: BASE_COLOR,
        },
        metadata: 'preserve',
      }
    case 'recommended':
      return {
        level,
        watermark: {
          text,
          opacity: 0.22,
          rotationDeg: -30,
          fontSize: 40,
          tile: true,
          tileGapX: 280,
          tileGapY: 210,
          color: BASE_COLOR,
        },
        metadata: 'neutralize',
      }
    case 'maximum':
      return {
        level,
        watermark: {
          text,
          opacity: 0.3,
          rotationDeg: -30,
          fontSize: 36,
          tile: true,
          tileGapX: 210,
          tileGapY: 170,
          color: BASE_COLOR,
        },
        metadata: 'neutralize',
      }
  }
}

/** Kept for the smoke test and any legacy callers. Wraps profileFor('recommended'). */
export function defaultWatermarkOptions(text: WatermarkText): WatermarkOptions {
  return profileFor('recommended', text).watermark
}

export function formatWatermarkLines(text: WatermarkText, lang: 'en' | 'es'): string[] {
  if (lang === 'es') {
    return [
      `COPIA PARA ${text.recipient.toUpperCase()}`,
      `SOLO PARA ${text.purpose.toUpperCase()}`,
      text.date,
    ]
  }
  return [
    `COPY FOR ${text.recipient.toUpperCase()}`,
    `FOR ${text.purpose.toUpperCase()} ONLY`,
    text.date,
  ]
}
