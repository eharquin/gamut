import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ItemNormalization } from '../document/expressionDocument'
import { popoverPosition } from './popoverPosition'

const POPOVER_WIDTH = 236
const ESTIMATED_POPOVER_HEIGHT = 88

export type NormalizationOption = 'off' | ItemNormalization

const OPTION_TEXT: Readonly<Record<NormalizationOption, string>> = {
  off: 'off', natural: 'auto', euclidean: 'norm', ideal: 'inorm',
}

type NormalizationPopoverProps = Readonly<{
  /** The row's norm button, which the popover is placed against and returns focus to. */
  anchorRef: RefObject<HTMLButtonElement | null>
  /** The mode in use, `off` when the item is not normalized. */
  mode: NormalizationOption
  /** Off and auto, plus norm and inorm when the algebra has an ideal norm. */
  options: readonly NormalizationOption[]
  onChoose(option: NormalizationOption): void
  onClose(): void
}>

/**
 * The normalization choice of an expression row (#185), opened from its norm
 * button as a popover like the appearance menu: placed against the button,
 * closed by a choice, Escape, the close button, or a click outside, and
 * returning focus to the button.
 */
export function NormalizationPopover({ anchorRef, mode, options, onChoose, onClose }: NormalizationPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState(() =>
    popoverPosition(anchorRef.current, POPOVER_WIDTH, ESTIMATED_POPOVER_HEIGHT))
  const place = useCallback(() => {
    const measured = ref.current?.scrollHeight ?? 0
    const next = popoverPosition(anchorRef.current, POPOVER_WIDTH, measured > 0 ? measured : ESTIMATED_POPOVER_HEIGHT)
    setPlacement((current) => current.top === next.top && current.left === next.left ? current : next)
  }, [anchorRef])

  useLayoutEffect(place)

  useEffect(() => {
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [place])

  useEffect(() => {
    const returnFocusTarget = anchorRef.current
    ref.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus()
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return
      if (returnFocusTarget?.contains(event.target as Node)) return
      onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      returnFocusTarget?.focus()
    }
  }, [anchorRef, onClose])

  return createPortal(
    <div
      ref={ref}
      className="appearance-popover normalization-popover"
      role="dialog"
      aria-label="Normalize"
      style={{ top: placement.top, left: placement.left, width: POPOVER_WIDTH }}
    >
      <header className="appearance-header">
        <strong>Normalize</strong>
        <button type="button" className="appearance-close" onClick={onClose}
          aria-label="Close Normalize menu" title="Close">×</button>
      </header>
      <div className="normalization-popover-body">
        <div className="normalize-choice" role="group" aria-label="Normalize with">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => onChoose(option)}
            >{OPTION_TEXT[option]}</button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
