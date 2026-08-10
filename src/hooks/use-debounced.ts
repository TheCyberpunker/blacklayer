import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState<T>(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return v
}
