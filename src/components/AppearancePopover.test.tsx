import { createRef } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearancePopover } from './AppearancePopover'
import type { ExpressionControl } from '../document/expressionDocument'
import { DEFAULT_APPEARANCE_SOURCES } from '../application/evaluateAppearanceSources'

type Props = Parameters<typeof AppearancePopover>[0]

function open(props: Partial<Props> = {}) {
  const handlers = {
    onStyleChange: vi.fn(),
    onVisibleChange: vi.fn(),
    onLabelVisibleChange: vi.fn(),
    onLabelChange: vi.fn(),
    onClose: vi.fn(),
  }
  render(<AppearancePopover
    kind="Vector"
    styleId="yellow-4"
    visible
    labelVisible={false}
    label=""
    anchorRef={createRef<HTMLButtonElement>()}
    {...handlers}
    {...props}
  />)
  return { dialog: screen.getByRole('dialog'), ...handlers }
}

const slider: ExpressionControl = {
  mode: 'slider', minimumSource: '-1', maximumSource: '1', stepSource: '0.1',
  animation: { mode: 'loop', direction: 'reverse', durationSeconds: 5 },
}

afterEach(cleanup)

describe('appearance menu', () => {
  it('titles the menu with the object kind, then the eye and the close button', () => {
    const { dialog, onVisibleChange } = open({ kind: 'List (3)' })
    expect(dialog).toHaveAccessibleName('List')
    const header = dialog.querySelector('header')!
    expect(header.querySelector('strong')).toHaveTextContent(/^List$/)
    expect([...header.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')))
      .toEqual(['Visible', 'Close List menu'])
    const eye = within(header).getByRole('switch', { name: 'Visible' })
    expect(eye).toHaveAttribute('aria-checked', 'true')
    expect(eye).toHaveAttribute('title', 'Hide')
    expect(eye).toHaveFocus()
    fireEvent.click(eye)
    expect(onVisibleChange).toHaveBeenCalledWith(false)
  })

  it('shows no eye for an object that is not drawn', () => {
    const { dialog } = open({ kind: 'Scalar', colorOnly: true })
    expect(within(dialog).queryByRole('switch', { name: 'Visible' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close Scalar menu' })).toHaveFocus()
  })

  it('offers nine hues, then the six shades of the selected hue', () => {
    const { dialog, onStyleChange } = open({ styleId: 'teal-5' })
    const hues = within(within(dialog).getByRole('group', { name: 'Hue' })).getAllByRole('button')
    expect(hues.map((hue) => hue.getAttribute('aria-label')))
      .toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink', 'Neutral'])
    expect(hues.every((hue) => hue.getAttribute('title') === hue.getAttribute('aria-label'))).toBe(true)
    expect(hues.filter((hue) => hue.getAttribute('aria-pressed') === 'true').map((hue) => hue.getAttribute('aria-label')))
      .toEqual(['Teal'])
    const shades = within(within(dialog).getByRole('group', { name: 'Teal shade' })).getAllByRole('button')
    expect(shades).toHaveLength(6)
    expect(shades[4]).toHaveAttribute('aria-pressed', 'true')
    expect(shades[4]).toHaveAccessibleName('Use color teal 5')
    // A hue keeps the selected shade.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Purple' }))
    expect(onStyleChange).toHaveBeenLastCalledWith('purple-5')
    fireEvent.click(shades[1])
    expect(onStyleChange).toHaveBeenLastCalledWith('teal-2')
  })

  it('folds each section from a chevron on its title', () => {
    const { dialog } = open({ kind: 'Bivector', onBorderVisibleChange: vi.fn(), onBivectorShapeChange: vi.fn(), onOrientationVisibleChange: vi.fn() })
    const folds = within(dialog).getAllByRole('button', { expanded: true })
    expect(folds.map((fold) => fold.textContent)).toEqual(['Color', 'Style'])
    const style = folds[1]
    const body = document.getElementById(style.getAttribute('aria-controls')!)!
    expect(within(body).getByRole('switch', { name: 'Outline' })).toBeVisible()
    fireEvent.click(style)
    expect(style).toHaveAttribute('aria-expanded', 'false')
    expect(body).not.toBeVisible()
    fireEvent.click(style)
    expect(body).toBeVisible()
  })

  it('groups the drawing settings of a bivector in Style, with named icon buttons', () => {
    const { dialog } = open({ kind: 'Bivector', onBorderVisibleChange: vi.fn(), onBivectorShapeChange: vi.fn(), onOrientationVisibleChange: vi.fn() })
    const shape = within(dialog).getByRole('group', { name: 'Bivector shape' })
    for (const button of within(shape).getAllByRole('button')) {
      expect(button.textContent).toBe('')
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'))
    }
    const orientation = within(dialog).getByRole('switch', { name: 'Orientation visible' }).closest('label')!
    expect(orientation).toHaveClass('appearance-field-toggle')
    expect(orientation.querySelector('span')).toHaveTextContent(/^Orientation$/)
  })

  it('selects the shape actually drawn when From vectors is unavailable', () => {
    const shapeButton = (name: string) =>
      within(screen.getByRole('group', { name: 'Bivector shape' })).getByRole('button', { name })
    open({ kind: 'Bivector', bivectorShape: 'from-vectors', parallelogramAvailable: false, onBivectorShapeChange: vi.fn() })
    expect(shapeButton('Disk')).toHaveAttribute('aria-pressed', 'true')
    expect(shapeButton('From vectors')).toHaveAttribute('aria-pressed', 'false')
    expect(shapeButton('From vectors')).toBeDisabled()
    cleanup()
    open({ kind: 'Bivector', bivectorShape: 'from-vectors', parallelogramAvailable: true, onBivectorShapeChange: vi.fn() })
    expect(shapeButton('From vectors')).toHaveAttribute('aria-pressed', 'true')
  })

  it('names and titles the icons of the ideal point display', () => {
    const { dialog } = open({ kind: 'Ideal point', onIdealPointDisplayChange: vi.fn() })
    const display = within(dialog).getByRole('group', { name: 'Ideal point display' })
    expect(within(display).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['As a vector', 'At infinity', 'Both'])
  })

  it('switches the label from its title and edits its text below', () => {
    const { dialog, onLabelVisibleChange } = open()
    expect(within(dialog).queryByRole('textbox', { name: 'Text' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Show label' }))
    expect(onLabelVisibleChange).toHaveBeenCalledWith(true)
  })

  it('gives a list one section per primitive type it holds', () => {
    const lists = vi.fn()
    open({
      kind: 'List (3)', listPrimitives: { points: true, lines: false },
      pointListDisplayAvailable: true, onPointListDisplayChange: vi.fn(), onPointMarkersVisibleChange: vi.fn(), onLinesVisibleChange: lists,
    })
    expect(screen.getByRole('button', { name: 'Points' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Point list display' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Show lines' })).not.toBeInTheDocument()
  })

  it('switches the lines of a mixed list, whose points cannot be connected', () => {
    const onLinesVisibleChange = vi.fn()
    open({
      kind: 'List (2)', listPrimitives: { points: true, lines: true }, linesVisible: true,
      onPointListDisplayChange: vi.fn(), onPointMarkersVisibleChange: vi.fn(), onLinesVisibleChange,
    })
    expect(screen.queryByRole('group', { name: 'Point list display' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Show point markers' })).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Show lines' }))
    expect(onLinesVisibleChange).toHaveBeenCalledWith(false)
  })

  it('replaces the number or slider choice of a scalar with Animate', () => {
    const onControlChange = vi.fn()
    const { dialog } = open({ kind: 'Scalar', styleId: 'green-4', colorOnly: true, control: slider, onControlChange })
    expect(within(dialog).queryByRole('button', { name: 'Slider' })).not.toBeInTheDocument()
    const animate = within(dialog).getByRole('switch', { name: 'Animate' })
    expect(animate).toBeChecked()
    const playback = within(dialog).getByRole('group', { name: 'Animation mode' })
    expect(within(playback).getAllByRole('button').map((button) => button.getAttribute('title')))
      .toEqual(['Once', 'Loop', 'Ping-pong'])
    expect(within(playback).getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(playback).getByRole('button', { name: 'Once' }))
    expect(onControlChange).toHaveBeenLastCalledWith({ ...slider, animation: { ...slider.animation, mode: 'once' } })
    // Off: a number field, keeping the animation for later.
    fireEvent.click(animate)
    expect(onControlChange).toHaveBeenLastCalledWith({ ...slider, mode: 'number' })
  })

  it('shows a slider without animation as it is, until Animate is touched', () => {
    const onControlChange = vi.fn()
    const still = { ...slider, animation: null }
    const { dialog } = open({ kind: 'Scalar', colorOnly: true, control: still, onControlChange })
    const animate = within(dialog).getByRole('switch', { name: 'Animate' })
    expect(animate).not.toBeChecked()
    expect(within(dialog).queryByRole('group', { name: 'Animation mode' })).not.toBeInTheDocument()
    expect(onControlChange).not.toHaveBeenCalled()
    fireEvent.click(animate)
    expect(onControlChange).toHaveBeenCalledWith({
      ...still, mode: 'slider', animation: { mode: 'ping-pong', direction: 'forward', durationSeconds: 2 },
    })
  })

  it('animates a number field again with the animation it kept', () => {
    const onControlChange = vi.fn()
    open({ kind: 'Scalar', colorOnly: true, control: { ...slider, mode: 'number' }, onControlChange })
    fireEvent.click(screen.getByRole('switch', { name: 'Animate' }))
    expect(onControlChange).toHaveBeenCalledWith(slider)
  })
})

describe('stroke, width and opacity settings', () => {
  const withSources = (change: Partial<typeof DEFAULT_APPEARANCE_SOURCES>) => ({ ...DEFAULT_APPEARANCE_SOURCES, ...change })

  it('puts the three stroke icons and the Width field on one row, then Orientation, for a line', () => {
    const onAppearanceChange = vi.fn()
    const { dialog } = open({ kind: 'Line', onAppearanceChange, onOrientationVisibleChange: vi.fn(), orientationVisible: false,
      appearance: { strokeStyle: 'dashed', strokeWidthSource: 'w' } })
    const stroke = within(dialog).getByRole('group', { name: 'Stroke style' })
    const icons = within(stroke).getAllByRole('button')
    expect(icons.map((button) => [button.getAttribute('aria-label'), button.getAttribute('title')]))
      .toEqual([['Solid', 'Solid'], ['Dashed', 'Dashed'], ['Dotted', 'Dotted']])
    expect(within(stroke).getByRole('button', { name: 'Dashed' })).toHaveAttribute('aria-pressed', 'true')
    const row = stroke.parentElement!
    expect(row).toHaveClass('appearance-row')
    const width = within(row).getByRole('textbox', { name: 'Width' })
    expect(width).toHaveValue('w')
    expect(width).toHaveAttribute('placeholder', '2.5')
    expect(width.parentElement).toHaveTextContent('px')
    expect(row.nextElementSibling).toContainElement(within(dialog).getByRole('switch', { name: 'Orientation visible' }))

    fireEvent.click(within(stroke).getByRole('button', { name: 'Dotted' }))
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ strokeStyle: 'dotted' }, undefined)
    fireEvent.change(width, { target: { value: '2 * w' } })
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ strokeWidthSource: '2 * w' }, 'strokeWidth')
  })

  it('shows a red line under a refused field, and nothing under a valid one', () => {
    const { dialog } = open({ kind: 'Vector', onAppearanceChange: vi.fn(), appearance: { strokeWidthSource: '2' } })
    expect(within(dialog).getByRole('textbox', { name: 'Width' })).not.toHaveAttribute('aria-invalid')
    expect(dialog.querySelector('.appearance-error')).toBeNull()
    cleanup()
    const refused = open({
      kind: 'Vector', onAppearanceChange: vi.fn(), appearance: { strokeWidthSource: 'k' },
      sources: withSources({ strokeWidth: { value: null, error: 'The name “k” is not defined. Default used.' } }),
    }).dialog
    const width = within(refused).getByRole('textbox', { name: 'Width' })
    expect(width).toHaveAttribute('aria-invalid', 'true')
    expect(width).toHaveAccessibleDescription('Width: The name “k” is not defined. Default used.')
    expect(refused.querySelector('.appearance-error')).toHaveTextContent('Width: The name “k” is not defined. Default used.')
  })

  it('offers Opacity under the shades for a drawn object only', () => {
    const onAppearanceChange = vi.fn()
    const { dialog } = open({ kind: 'List (3)', onAppearanceChange })
    const opacity = within(dialog).getByRole('textbox', { name: 'Opacity' })
    expect(opacity).toHaveAttribute('placeholder', '100')
    expect(opacity.parentElement).toHaveTextContent('%')
    expect(dialog.querySelector('.appearance-shades')!.nextElementSibling).toContainElement(opacity)
    fireEvent.change(opacity, { target: { value: '40' } })
    expect(onAppearanceChange).toHaveBeenCalledWith({ opacitySource: '40' }, 'opacity')
    cleanup()
    open({ kind: 'Scalar', colorOnly: true, onAppearanceChange })
    expect(screen.queryByRole('textbox', { name: 'Opacity' })).not.toBeInTheDocument()
  })

  it('shows the bivector stroke row only with the outline', () => {
    const props = { kind: 'Bivector', onAppearanceChange: vi.fn(), onBorderVisibleChange: vi.fn() }
    open({ ...props, borderVisible: false })
    expect(screen.queryByRole('group', { name: 'Stroke style' })).not.toBeInTheDocument()
    cleanup()
    open({ ...props, borderVisible: true })
    expect(screen.getByRole('group', { name: 'Stroke style' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Width' })).toHaveAttribute('placeholder', '2')
  })

  it('shows the ideal-point stroke row while the direction arrow is drawn', () => {
    const props = { kind: 'Ideal point', onAppearanceChange: vi.fn(), onIdealPointDisplayChange: vi.fn() }
    for (const [display, shown] of [['vector', true], ['both', true], ['ideal', false]] as const) {
      open({ ...props, idealPointDisplay: display })
      expect(!!screen.queryByRole('group', { name: 'Stroke style' })).toBe(shown)
      cleanup()
    }
  })

  it('gives the Lines of a list their own Style: stroke, width and orientation', () => {
    const onAppearanceChange = vi.fn()
    const { dialog } = open({
      kind: 'List (2)', listPrimitives: { points: false, lines: true }, onLinesVisibleChange: vi.fn(),
      onAppearanceChange, linesOrientationVisible: true,
      appearance: { strokeStyle: 'dashed', primitiveStyles: { lines: { strokeWidthSource: '3' } } },
    })
    const lines = within(dialog).getByRole('switch', { name: 'Show lines' }).closest('section')!
    expect(within(lines).getByRole('heading', { name: 'Style' })).toBeInTheDocument()
    // No inheritance from the item's own stroke.
    expect(within(lines).getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(lines).getByRole('textbox', { name: 'Width' })).toHaveValue('3')
    expect(within(lines).getByRole('switch', { name: 'Orientation visible' })).toBeChecked()
    fireEvent.click(within(lines).getByRole('button', { name: 'Dotted' }))
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ primitiveStyles: { lines: { strokeStyle: 'dotted' } } }, undefined)
    fireEvent.change(within(lines).getByRole('textbox', { name: 'Width' }), { target: { value: 'w' } })
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ primitiveStyles: { lines: { strokeWidthSource: 'w' } } }, 'lines.strokeWidth')
    fireEvent.click(within(lines).getByRole('switch', { name: 'Orientation visible' }))
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ primitiveStyles: { lines: { orientationVisible: false } } }, undefined)
    // A list has no list-wide stroke.
    expect(within(dialog).getAllByRole('group', { name: /style/i }).map((group) => group.getAttribute('aria-label')))
      .toEqual(['Line style'])
  })
})

describe('point style and size settings (#222)', () => {
  it('shows six point style icons on one line, then the Size field', () => {
    const onAppearanceChange = vi.fn()
    const { dialog } = open({ kind: 'Point', onAppearanceChange, appearance: { pointStyle: 'ring', pointSizeSource: '6' } })
    const styles = within(dialog).getByRole('group', { name: 'Point style' })
    expect(within(styles).getAllByRole('button').map((button) => [button.getAttribute('aria-label'), button.getAttribute('title')]))
      .toEqual([['Dot', 'Dot'], ['Ring', 'Ring'], ['Cross', 'Cross'], ['Plus', 'Plus'], ['Square', 'Square'], ['Diamond', 'Diamond']])
    expect(within(styles).getByRole('button', { name: 'Ring' })).toHaveAttribute('aria-pressed', 'true')
    // Each icon is the outer shape and a core that grows on hover.
    expect(within(styles).getByRole('button', { name: 'Square' }).querySelectorAll('rect')).toHaveLength(2)
    expect(within(styles).getByRole('button', { name: 'Square' }).querySelector('.point-icon-core rect')).not.toBeNull()
    const size = within(dialog).getByRole('textbox', { name: 'Size' })
    expect(styles.nextElementSibling).toContainElement(size)
    expect(size).toHaveValue('6')
    expect(size).toHaveAttribute('placeholder', '4.5')
    fireEvent.click(within(styles).getByRole('button', { name: 'Diamond' }))
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ pointStyle: 'diamond' }, undefined)
    fireEvent.change(size, { target: { value: 's' } })
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ pointSizeSource: 's' }, 'pointSize')
  })

  it('gives the Points of a list their Style: markers, then the links while connected', () => {
    const onAppearanceChange = vi.fn()
    const base = {
      kind: 'List (3)', listPrimitives: { points: true, lines: false }, onPointMarkersVisibleChange: vi.fn(),
      onPointListDisplayChange: vi.fn(), pointListDisplayAvailable: true, onAppearanceChange,
      appearance: { pointStyle: 'cross' as const, primitiveStyles: { points: { pointSizeSource: '3' } } },
    }
    open({ ...base, pointListDisplay: 'none' })
    let points = screen.getByRole('switch', { name: 'Show point markers' }).closest('section')!
    expect(within(points).getAllByRole('group').map((group) => group.getAttribute('aria-label')))
      .toEqual(['Point list display', 'Point style'])
    // No inheritance from the item's own point style.
    expect(within(points).getByRole('button', { name: 'Dot' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(points).getByRole('textbox', { name: 'Size' })).toHaveValue('3')
    fireEvent.click(within(points).getByRole('button', { name: 'Plus' }))
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ primitiveStyles: { points: { pointStyle: 'plus' } } }, undefined)
    cleanup()

    open({ ...base, pointListDisplay: 'open-polyline' })
    points = screen.getByRole('switch', { name: 'Show point markers' }).closest('section')!
    expect(within(points).getAllByRole('group').map((group) => group.getAttribute('aria-label')))
      .toEqual(['Point list display', 'Point style', 'Connection style'])
    const width = within(points).getByRole('textbox', { name: 'Width' })
    expect(width).toHaveAttribute('placeholder', '2')
    fireEvent.change(width, { target: { value: 'w' } })
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ primitiveStyles: { points: { strokeWidthSource: 'w' } } }, 'points.strokeWidth')
    fireEvent.click(within(points).getByRole('button', { name: 'Dashed' }))
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ primitiveStyles: { points: { strokeStyle: 'dashed' } } }, undefined)
    cleanup()

    // Links alone: only the link stroke remains.
    open({ ...base, pointListDisplay: 'closed-loop', pointMarkersVisible: false })
    points = screen.getByRole('switch', { name: 'Show point markers' }).closest('section')!
    expect(within(points).getAllByRole('group').map((group) => group.getAttribute('aria-label')))
      .toEqual(['Point list display', 'Connection style'])
  })
})
