import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'

/** A controllable `prefers-color-scheme: dark` query. */
function mockSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return (next: boolean) => {
    query.matches = next
    listeners.forEach((listener) => listener())
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('theme toggle', () => {
  it('follows a light system theme and switches to dark', () => {
    mockSystemTheme(false)
    const onThemeChange = vi.fn()
    render(<ThemeToggle theme="system" onThemeChange={onThemeChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(onThemeChange).toHaveBeenCalledWith('dark')
  })

  it('follows a dark system theme and switches to light', () => {
    mockSystemTheme(true)
    const onThemeChange = vi.fn()
    render(<ThemeToggle theme="system" onThemeChange={onThemeChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(onThemeChange).toHaveBeenCalledWith('light')
  })

  it('updates when the system theme changes while it is followed', () => {
    const setSystemDark = mockSystemTheme(false)
    render(<ThemeToggle theme="system" onThemeChange={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to dark theme')
    act(() => setSystemDark(true))
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to light theme')
  })

  it('uses an explicit theme over the system theme', () => {
    mockSystemTheme(true)
    const onThemeChange = vi.fn()
    render(<ThemeToggle theme="light" onThemeChange={onThemeChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(onThemeChange).toHaveBeenCalledWith('dark')
  })
})
