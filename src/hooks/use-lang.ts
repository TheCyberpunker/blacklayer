import { useEffect, useState } from 'react'

export type Lang = 'en' | 'es'

const STORAGE_KEY = 'blacklayer.lang'

function readInitial(): Lang {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'es') return stored
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const [lang, setLangState] = useState<Lang>(() => readInitial())

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  return { lang, setLang: setLangState }
}
