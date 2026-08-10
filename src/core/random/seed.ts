/**
 * Generate a fresh 32-bit unsigned seed using the platform's secure random source.
 * The seed only ever lives in the current tab's memory and never leaves the device.
 * It does not identify the user; it exists so each exported copy carries a subtly
 * unique watermark layout that automated cleanup tools cannot template against.
 */
export function generateSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const arr = new Uint32Array(1)
    crypto.getRandomValues(arr)
    return arr[0] >>> 0
  }
  // Fallback path for non-browser test contexts. Should never fire in the app.
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}
