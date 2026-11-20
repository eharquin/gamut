import { fireEvent, within } from '@testing-library/react'

/**
 * Shows a group of library actions behind its ⋯ button, unless it is already
 * shown: the library's own (`More library actions`) or a card's (`Actions for …`).
 */
export function revealActions(container: HTMLElement, label: string): void {
  const toggle = within(container).getByRole('button', { name: label })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
}
