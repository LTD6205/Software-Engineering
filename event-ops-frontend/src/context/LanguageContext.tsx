'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type Lang = 'en' | 'vi'

interface LanguageContextType {
  lang: Lang
  setLang: (l: Lang) => void
  /** Pick the right string for the current language: t('Save', 'Lưu'). */
  t: (en: string, vi: string) => string
  /** Localize a combined "English / Vietnamese" message (e.g. from the API). */
  tError: (combined: string) => string
}

const LanguageContext = createContext<LanguageContextType | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  // Restore the saved language on mount. Done in an effect (not a lazy
  // initializer) so the server and first client render agree on 'en' and we
  // avoid a hydration mismatch across all translated text.
  useEffect(() => {
    const saved = localStorage.getItem('lang')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'en' || saved === 'vi') setLangState(saved)
  }, [])

  const setLang = (l: Lang) => {
    setLangState(l)
    localStorage.setItem('lang', l)
  }

  const t = (en: string, vi: string) => (lang === 'en' ? en : vi)

  const tError = (combined: string) => {
    const parts = combined.split(' / ')
    if (parts.length < 2) return combined
    return lang === 'en' ? parts[0] : parts[1]
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, tError }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLang() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLang must be used inside LanguageProvider')
  return ctx
}
