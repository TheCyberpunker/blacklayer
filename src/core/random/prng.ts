/**
 * mulberry32: small, fast, seeded PRNG. Good enough for visual jitter.
 * Not cryptographic. The seed itself is generated with crypto.getRandomValues,
 * but downstream expansion into per-tile jitter values uses this deterministic
 * expansion so the preview matches the export byte-for-byte.
 *
 * Reference: https://gist.github.com/tommyettinger/46a3f7d4c9a63a9498a4e00742703f80
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Convenience: PRNG returning values centered on 0 in [-0.5, 0.5]. */
export function centeredPrng(seed: number): () => number {
  const p = mulberry32(seed)
  return () => p() - 0.5
}
