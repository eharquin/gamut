import { HOLD_TO_CONFIRM_MS, useHoldToConfirm } from '../hooks/useHoldToConfirm'

/** Hold duration that discards the document's expressions. */
export const CLEAR_HOLD_MS = HOLD_TO_CONFIRM_MS

type ClearExpressionsButtonProps = Readonly<{
  count: number
  onClear: () => void
}>

/**
 * Clearing every expression is recoverable through document history. The
 * control retains a sustained hold to prevent accidental broad edits
 * (`useHoldToConfirm`), with the pointer and the keyboard alike (A11Y-007).
 */
export function ClearExpressionsButton({
  count,
  onClear,
}: ClearExpressionsButtonProps) {
  const hold = useHoldToConfirm(onClear, count > 0)
  return (
    <button
      type="button"
      className={`clear-expressions hold-action${hold.holding ? ' is-holding' : ''}`}
      disabled={count === 0}
      aria-label="Clear all expressions"
      aria-describedby="clear-expressions-hint"
      {...hold.props}
    >
      <span aria-hidden="true">✕</span>
      <span className="visually-hidden" id="clear-expressions-hint">
        Hold to clear all {count}{' '}
        {count === 1 ? 'expression' : 'expressions'}.
      </span>
    </button>
  )
}
