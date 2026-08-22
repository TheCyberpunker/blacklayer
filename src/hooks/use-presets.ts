import { useCallback, useEffect, useState } from 'react'
import type { ProtectionLevel } from '../core/types.ts'

export interface Preset {
  id: string
  name: string
  recipient: string
  purpose: string
  level: ProtectionLevel
  /** null = use whatever the level default is at apply time. */
  crosshatch: boolean | null
  frame: boolean | null
  iridescent: boolean | null
  guilloche: boolean | null
  moire: boolean | null
  /** Style overrides. null on any field means "keep the level default". */
  opacity: number | null
  rotationDeg: number | null
  fontSize: number | null
  colorHex: string | null
  createdAt: number
}

const STORAGE_KEY = 'blacklayer.presets'
const MAX_PRESETS = 24

function readStored(): Preset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPreset).map(withStyleDefaults)
  } catch {
    return []
  }
}

function isPreset(x: unknown): x is Preset {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.recipient === 'string' &&
    typeof p.purpose === 'string' &&
    (p.level === 'basic' || p.level === 'recommended' || p.level === 'maximum') &&
    (p.crosshatch === null || typeof p.crosshatch === 'boolean') &&
    (p.frame === null || typeof p.frame === 'boolean') &&
    typeof p.createdAt === 'number'
  )
}

/**
 * Fill in any missing style-override fields on a preset object read from
 * localStorage. Presets saved before these fields existed just get null defaults
 * so `useMemo`-based code can treat every preset uniformly.
 */
function withStyleDefaults(p: Preset): Preset {
  const withDefaults = p as Preset &
    Partial<Record<'opacity' | 'rotationDeg' | 'fontSize' | 'colorHex' | 'iridescent' | 'guilloche' | 'moire', unknown>>
  return {
    ...p,
    opacity: typeof withDefaults.opacity === 'number' ? withDefaults.opacity : null,
    rotationDeg: typeof withDefaults.rotationDeg === 'number' ? withDefaults.rotationDeg : null,
    fontSize: typeof withDefaults.fontSize === 'number' ? withDefaults.fontSize : null,
    colorHex: typeof withDefaults.colorHex === 'string' ? withDefaults.colorHex : null,
    iridescent: typeof withDefaults.iridescent === 'boolean' ? withDefaults.iridescent : null,
    guilloche: typeof withDefaults.guilloche === 'boolean' ? withDefaults.guilloche : null,
    moire: typeof withDefaults.moire === 'boolean' ? withDefaults.moire : null,
  }
}

function nextId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

export interface UsePresets {
  presets: Preset[]
  save: (input: Omit<Preset, 'id' | 'createdAt'>) => Preset | null
  remove: (id: string) => void
  clear: () => void
}

export function usePresets(): UsePresets {
  const [presets, setPresets] = useState<Preset[]>(() => readStored())

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
    } catch {
      // Storage quota or private mode. Fail silently.
    }
  }, [presets])

  const save = useCallback((input: Omit<Preset, 'id' | 'createdAt'>): Preset | null => {
    const name = input.name.trim()
    if (!name) return null
    const p: Preset = {
      ...input,
      name,
      id: nextId(),
      createdAt: Date.now(),
    }
    setPresets((prev) => {
      // Replace any existing preset with the same name (case-insensitive) so
      // "Bank" doesn't accumulate duplicates over time.
      const filtered = prev.filter((x) => x.name.toLowerCase() !== name.toLowerCase())
      return [p, ...filtered].slice(0, MAX_PRESETS)
    })
    return p
  }, [])

  const remove = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const clear = useCallback(() => {
    setPresets([])
  }, [])

  return { presets, save, remove, clear }
}

/**
 * Wipe every localStorage key BlackLayer writes. Used by the "Delete all local
 * settings" action so a user can leave no trace on a shared machine.
 */
export function clearAllLocalSettings(): void {
  if (typeof window === 'undefined') return
  const keys = ['blacklayer.presets', 'blacklayer.theme', 'blacklayer.lang', 'blacklayer.seen-intro', 'blacklayer.seen-tour']
  for (const k of keys) {
    try {
      window.localStorage.removeItem(k)
    } catch {
      // ignore
    }
  }
}
