/// <reference types="node" />
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import { serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument } from './document/expressionDocument'

const SOURCES = ['sq(x) = x * x', 'a = sq(3)', 'sq'] as const

function row(index: number): HTMLElement {
  return screen.getByRole('textbox', { name: `Expression ${index + 1}` })
    .closest('.expression-item') as HTMLElement
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('MODE', 'development')
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('rows of declared functions (#340)', () => {
  it('shows the signature, with no value, swatch or drag control, and the calls their values', async () => {
    const document = expressionDocument(SOURCES.map((source, index) => ({ id: `item-${index}`, source })))
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(toCanonicalDocument(document, 'light')))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue(SOURCES[0]))

    const declaration = row(0)
    expect(within(declaration).getByText('Function')).toBeInTheDocument()
    expect(within(declaration).getByText('sq(x)')).toHaveClass('function-signature')
    expect(declaration.querySelector('output')).toBeNull()
    expect(declaration.querySelector('.appearance-swatch')).toBeNull()
    expect(within(declaration).queryByRole('button', { name: /^Drag / })).not.toBeInTheDocument()

    expect(within(row(1)).getByText('9')).toBeInTheDocument()
    expect(within(row(2)).getByText('LANG_FUNCTION_VALUE')).toBeInTheDocument()
  })
})
