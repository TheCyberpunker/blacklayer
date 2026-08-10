import { zipSync, type Zippable } from 'fflate'

/**
 * Bundle a set of protected outputs into a single zip. Runs entirely in memory,
 * on the main thread. For a few dozen files with 100s of KB each this is fast
 * enough; larger workloads would need an async worker.
 */
export interface ZipEntry {
  filename: string
  bytes: Uint8Array
}

export function bundleZip(entries: readonly ZipEntry[]): Uint8Array {
  const seen = new Map<string, number>()
  const table: Zippable = {}
  for (const entry of entries) {
    const name = uniqueName(entry.filename, seen)
    table[name] = entry.bytes
  }
  return zipSync(table, { level: 6 })
}

function uniqueName(name: string, seen: Map<string, number>): string {
  const n = seen.get(name) ?? 0
  seen.set(name, n + 1)
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  const base = dot >= 0 ? name.slice(0, dot) : name
  const ext = dot >= 0 ? name.slice(dot) : ''
  return `${base}-${n}${ext}`
}
