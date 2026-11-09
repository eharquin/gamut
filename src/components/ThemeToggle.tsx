import { useEffect, useState } from 'react'
import type { ThemeMode } from '../document/canonicalDocument'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false
}

type ThemeToggleProps = Readonly<{
  theme: ThemeMode
  onThemeChange(theme: ThemeMode): void
}>

/**
 * Switches between the light and dark themes in one click. The `system`
 * theme, the default, follows the operating system until the button is used;
 * the settings menu still offers System to return to it. The button shows the
 * theme it switches to: a moon in light, a sun in dark.
 */
export function ThemeToggle({ theme, onThemeChange }: ThemeToggleProps) {
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY)
    if (!query) return
    const update = () => setSystemDark(query.matches)
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      type="button"
      className="settings-menu-button theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => onThemeChange(dark ? 'light' : 'dark')}
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="none" />
          <path
            d="M8 1.25v1.5M8 13.25v1.5M1.25 8h1.5M13.25 8h1.5M3.23 3.23l1.06 1.06M11.71 11.71l1.06 1.06M3.23 12.77l1.06-1.06M11.71 4.29l1.06-1.06"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1z" fill="none" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
