import { useEffect, useState } from 'react'

const KEY = 'simon_theme'
const listeners = new Set()

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function current() {
  return document.documentElement.dataset.theme || systemTheme()
}

function apply(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(KEY, theme) } catch { /* private mode */ }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  listeners.forEach((fn) => fn(theme))
}

/** Shared light/dark theme: [theme, toggle]. Follows the system until the user picks one. */
export function useTheme() {
  const [theme, setTheme] = useState(current)
  useEffect(() => {
    listeners.add(setTheme)
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
    return () => listeners.delete(setTheme)
  }, [])
  return [theme, () => apply(current() === 'dark' ? 'light' : 'dark')]
}
