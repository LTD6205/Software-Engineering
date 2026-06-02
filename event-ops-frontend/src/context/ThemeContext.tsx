'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeContextType {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')

  // Restore the saved theme on mount (effect, not a lazy initializer, so the
  // server and first client render agree on 'dark' and avoid a hydration warning).
  useEffect(() => {
    const saved = localStorage.getItem('theme')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'light' || saved === 'dark') setThemeState(saved)
  }, [])

  // Apply the theme to <html data-theme>; the CSS variables key off it.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem('theme', t)
  }
  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
