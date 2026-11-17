import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createBuiltinAlgebraRegistry, DEFAULT_ALGEBRA_ID } from './algebra/builtinAlgebras'
import { readExamples } from './examples'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

const registry = createBuiltinAlgebraRegistry()
const showcaseOf = (algebraId: string) => {
  const definition = registry.definitions().find((candidate) => candidate.algebraId === algebraId)!
  return readExamples().examples.find((example) => example.id === definition.showcaseExampleId)!.document
}
const rowSources = () => screen.getAllByRole('textbox', { name: /^(Expression|Annotation) \d+$/ })
  .map((element) => (element as HTMLInputElement).value)

describe('showcase examples (#217, LEO-005)', () => {
  it('opens the showcase example of the default algebra on a first run', () => {
    // Browser storage, empty here, is read outside the test mode only.
    vi.stubEnv('MODE', 'development')
    render(<App />)
    const example = showcaseOf(DEFAULT_ALGEBRA_ID)
    expect(rowSources()).toEqual(example.items.map((item) => item.source))
    // Unsaved, it is offered under the example's title.
    fireEvent.click(screen.getByRole('button', { name: /^Save( \(unsaved changes\))?$/ }))
    expect(within(screen.getByRole('region', { name: 'Library' })).getByRole('textbox', { name: 'Graph name' }))
      .toHaveValue(example.metadata.title)
  })

  it('loads exactly the showcase example of the algebra switched to', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    const example = showcaseOf('org.multivector.pga')
    expect(rowSources()).toEqual(example.items.map((item) => item.source))
    // One undo goes back to the document before the switch.
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' })).toBeInTheDocument()
  })
})
