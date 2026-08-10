export type ProtectionLevel = 'basic' | 'recommended' | 'maximum'

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

export const defaultWatermarkOptions = (text: WatermarkText): WatermarkOptions => ({
  text,
  opacity: 0.25,
  rotationDeg: -30,
  fontSize: 42,
  tile: true,
  tileGapX: 240,
  tileGapY: 180,
  color: { r: 0.1, g: 0.1, b: 0.1 },
})

export const formatWatermarkLines = (text: WatermarkText, lang: 'en' | 'es'): string[] => {
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
