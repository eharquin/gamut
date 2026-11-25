import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

describe('autosave (#173)', () => {
  it('saves every change as the active document', async () => {
    render(<App />)
    const editor = await screen.findByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(editor, { target: { value: 'b = 2' } })
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('b = 2'))
  })

  it('keeps the last saved revision and says so when a write fails, then recovers', async () => {
    render(<App />)
    const editor = await screen.findByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(editor, { target: { value: 'b = 2' } })
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('b = 2'))

    const setItem = Storage.prototype.setItem
    const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === ACTIVE_DOCUMENT_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      setItem.call(this, key, value)
    })
    fireEvent.change(editor, { target: { value: 'b = 3' } })
    await waitFor(() => expect(screen.getByText(/STORE_WRITE_FAILED: Changes remain open/)).toBeInTheDocument())
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('b = 2')

    failing.mockRestore()
    fireEvent.change(editor, { target: { value: 'b = 4' } })
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('b = 4'))
    expect(screen.queryByText(/STORE_WRITE_FAILED/)).not.toBeInTheDocument()
  })
})
