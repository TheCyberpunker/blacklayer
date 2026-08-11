/** { r, g, b } with each channel in the 0..1 range used by pdf-lib and our types. */
export interface Rgb01 {
  r: number
  g: number
  b: number
}

export function hexToRgb01(hex: string): Rgb01 {
  const clean = normalize(hex)
  if (!clean) return { r: 0, g: 0, b: 0 }
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return { r, g, b }
}

export function rgb01ToHex(c: Rgb01): string {
  const to = (n: number) => {
    const v = Math.max(0, Math.min(1, n))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`
}

export function rgb01ToCss(c: Rgb01, alpha = 1): string {
  const to = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255)
  return `rgba(${to(c.r)}, ${to(c.g)}, ${to(c.b)}, ${alpha})`
}

function normalize(hex: string): string | null {
  const trimmed = hex.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return trimmed
      .split('')
      .map((ch) => ch + ch)
      .join('')
      .toLowerCase()
  }
  return null
}
