import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'blacklayer.theme'

function readStored(): Theme {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function resolveEffective(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(theme: Theme): void {
  const root = document.documentElement
  const effective = resolveEffective(theme)
  root.classList.toggle('dark', effective === 'dark')
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; effective: 'light' | 'dark' } {
  const [theme, setThemeState] = useState<Theme>(() => readStored())
  const [effective, setEffective] = useState<'light' | 'dark'>(() => resolveEffective(theme))

  useEffect(() => {
    apply(theme)
    setEffective(resolveEffective(theme))
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => {
      apply('system')
      setEffective(resolveEffective('system'))
    }
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [theme])

  return { theme, setTheme: setThemeState, effective }
}
