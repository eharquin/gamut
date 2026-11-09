import { useEffect, useRef, useState } from 'react'
import { type ThemeMode } from '../document/canonicalDocument'
import {
  MAX_DECIMAL_PLACES,
  MIN_DECIMAL_PLACES,
} from '../presentation/formatNumber'

export type DisplaySettings = Readonly<{
  decimalPlaces: number
  gridVisible: boolean
  axisLabelsVisible: boolean
  graduationsVisible: boolean
  objectScale: number
  showApproximatedResidue: boolean
}>

export const MIN_OBJECT_SCALE = 0.25
export const MAX_OBJECT_SCALE = 4

type SettingsMenuProps = Readonly<{
  display: DisplaySettings
  theme: ThemeMode
  onDisplayChange(change: Partial<DisplaySettings>): void
  onThemeChange(theme: ThemeMode): void
  /**
   * Whether the settings that only affect rendering (grid, axes,
   * graduations, object size) are shown; false in NoViz, where nothing is drawn.
   */
  renderingSettings?: boolean
}>

type SwitchRowProps = Readonly<{
  label: string
  checked: boolean
  inputRef?: React.Ref<HTMLInputElement>
  onChange(checked: boolean): void
}>

function SwitchRow({ label, checked, inputRef, onChange }: SwitchRowProps) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">{label}</span>
      <span className="settings-switch">
        <input
          ref={inputRef}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="settings-switch-track" aria-hidden="true">
          <span className="settings-switch-thumb" />
        </span>
      </span>
    </label>
  )
}

/**
 * Presentation-only display settings (APP-006) and the theme, gathered behind
 * one header control. Every change is reported to the caller, which owns the
 * view command; this component never mutates a document. The document
 * commands are header buttons of their own (#249).
 */
export function SettingsMenu({
  display,
  theme,
  onDisplayChange,
  onThemeChange,
  renderingSettings = true,
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstControlRef = useRef<HTMLInputElement>(null)
  const restoreFocusOnClose = useRef(false)

  useEffect(() => {
    if (!open) return
    const returnFocusTarget = triggerRef.current
    firstControlRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current?.contains(event.target as Node)) return
      restoreFocusOnClose.current = false
      setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        restoreFocusOnClose.current = true
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      if (restoreFocusOnClose.current) returnFocusTarget?.focus()
    }
  }, [open])

  return (
    <div className="settings-menu" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`settings-menu-button${open ? ' is-open' : ''}`}
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => {
          restoreFocusOnClose.current = current
          return !current
        })}
      >
        {/* A cogwheel with eight teeth. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M13.06 6.43 L14.89 6.75 L14.89 9.25 L13.06 9.57 L12.69 10.47 L13.76 11.98 L11.98 13.76 L10.47 12.69 L9.57 13.06 L9.25 14.89 L6.75 14.89 L6.43 13.06 L5.53 12.69 L4.02 13.76 L2.24 11.98 L3.31 10.47 L2.94 9.57 L1.11 9.25 L1.11 6.75 L2.94 6.43 L3.31 5.53 L2.24 4.02 L4.02 2.24 L5.53 3.31 L6.43 2.94 L6.75 1.11 L9.25 1.11 L9.57 2.94 L10.47 3.31 L11.98 2.24 L13.76 4.02 L12.69 5.53Z"
            fill="none"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="2.2" fill="none" />
        </svg>
      </button>
      {open && (
        <div
          className="settings-menu-popover"
          role="dialog"
          aria-label="Settings"
        >
          <section className="settings-section">
            <h3>Display</h3>
            {renderingSettings && <>
              <SwitchRow
                label="Grid"
                checked={display.gridVisible}
                inputRef={firstControlRef}
                onChange={(gridVisible) => onDisplayChange({ gridVisible })}
              />
              <SwitchRow
                label="Axes and labels"
                checked={display.axisLabelsVisible}
                onChange={(axisLabelsVisible) =>
                  onDisplayChange({ axisLabelsVisible })
                }
              />
              <SwitchRow
                label="Graduations"
                checked={display.graduationsVisible}
                onChange={(graduationsVisible) =>
                  onDisplayChange({ graduationsVisible })
                }
              />
            </>}
            <label className="settings-row">
              <span className="settings-row-label">Decimal places</span>
              <input
                ref={renderingSettings ? undefined : firstControlRef}
                className="settings-number"
                type="number"
                aria-label="Decimal places"
                min={MIN_DECIMAL_PLACES}
                max={MAX_DECIMAL_PLACES}
                step="1"
                value={display.decimalPlaces}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isInteger(value)) return
                  onDisplayChange({
                    decimalPlaces: Math.max(
                      MIN_DECIMAL_PLACES,
                      Math.min(MAX_DECIMAL_PLACES, value),
                    ),
                  })
                }}
              />
            </label>
            <SwitchRow
              label="Show approximated residue"
              checked={display.showApproximatedResidue}
              onChange={(showApproximatedResidue) =>
                onDisplayChange({ showApproximatedResidue })
              }
            />
            {renderingSettings && <label className="settings-row settings-row-slider">
              <span className="settings-row-label">Object size</span>
              <input
                type="range"
                aria-label="Object scale"
                min={MIN_OBJECT_SCALE}
                max={MAX_OBJECT_SCALE}
                step="0.25"
                value={display.objectScale}
                onChange={(event) =>
                  onDisplayChange({
                    objectScale: Math.max(
                      MIN_OBJECT_SCALE,
                      Math.min(
                        MAX_OBJECT_SCALE,
                        Number(event.target.value) || 1,
                      ),
                    ),
                  })
                }
              />
              <output className="settings-slider-value">
                {display.objectScale.toFixed(2)}×
              </output>
            </label>}
          </section>
          <section className="settings-section">
            <h3>Theme</h3>
            <label className="settings-row">
              <span className="settings-row-label">Theme</span>
              <select
                className="settings-select"
                value={theme}
                onChange={(event) =>
                  onThemeChange(event.target.value as ThemeMode)
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </section>
        </div>
      )}
    </div>
  )
}
