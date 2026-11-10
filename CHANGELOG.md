# Changelog

GAMUT records user-visible and scientific changes here from the start of
its release process. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and planned releases
use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.2.0 - 2026-11-10

Release notes: [docs/releases/0.2.0.md](docs/releases/0.2.0.md); tag
[`v0.2.0`](https://github.com/eharquin/gamut/releases/tag/v0.2.0); acceptance
record: [PGA 2D Foundation](docs/acceptance/pga-2d-foundation.md) (manual
validation pending, #192).

### Scene sharing

- Added self-contained scene links carrying the canonical document, including
  sources, appearance, algebra, theme, and viewport.
- **Import**, **Export**, and **Copy link** are icon buttons in the header,
  left of the theme button and the settings cogwheel and drawn like them,
  with accessible names and tooltips; the settings menu no longer has a
  Document section (#249). **Copy iframe code** and its iframe snippet were
  removed: Slides.com accepts the plain HTTPS link in its iframe source field.
- A document opens by dropping its `.json` file anywhere on the window, through
  the same path as **Import**. An announced overlay shows while a file is
  dragged over the window; several files or a non-JSON file are rejected with
  a diagnostic and leave the current document unchanged.
- Shared scenes open as temporary sessions without reading or writing browser
  storage. An explicit **Save local copy** creates a new document identity;
  JSON export remains available when storage is blocked or a link is too large.
- Scene links use a versioned, integrity-checked envelope with bounded
  decompression. Links over 8 KiB display a compatibility warning; fragments
  over 64 KiB are rejected without generating a partial link.

### Product identity and compatibility

- Renamed the product from **MultiVector** to **GAMUT — Geometric Algebra
  Multivector Unveiling Tool**. Mathematical uses of *multivector*, stable
  `org.multivector.*` identifiers and browser storage keys remain unchanged.
- The repository moves to `eharquin/gamut` and the application to
  <https://eharquin.github.io/gamut/>. Former repository links redirect, and
  the former application URL forwards to the new one with its query and
  fragment; saved documents carry over, since both URLs share one origin.
- New downloads use `*.gamut.json`; existing `*.multivector.json` documents
  remain importable without a format or identifier migration.

### Scientific capabilities

- Added gather indexing for lists. `L[I]` accepts literal, referenced, range,
  broadcast, and otherwise computed index lists; it preserves order and
  duplicates, returns `[]` for an empty index list, and reports the position of
  an invalid index without returning a partial result.

- Added `%` as a common Euclidean scalar modulo operator in every registered
  algebra. It has the precedence and left associativity of `*` and `/`,
  broadcasts over lists, returns a grade-zero value, and reports a domain
  diagnostic for non-scalar operands or a non-positive modulus.

- Added the plane-based PGA(2) algebra `org.multivector.pga` under
  [PGA convention version 1](docs/specifications/pga-conventions.md): points,
  ideal points, and lines with `point`, `ipoint`, and `line`; meet, join
  through the explicit Hodge dual, incidence, Euclidean and ideal norms, and
  rotors, translators, motors, reflections, and glide reflections through the
  common operators; classification, projective descriptions with weight and
  scale, point markers, clipped lines, positioned ideal-point arrows with an
  optional marker on the line at infinity, and the line at infinity drawn as
  the ellipse inscribed in the viewport.

- Implemented the scalar functions of language section 10 — `abs`, `sqrt`,
  `log`, `asin`, `acos`, `atan`, `min`, `max` — and added `atan2(y, x)` as a
  compatible extension. Their names are reserved, arity is checked at parse
  time, values outside the real domain report a domain diagnostic, and the
  functions broadcast over lists. The PGA example shows the distance and angle
  read-outs they enable (`norm(A & B)`, `acos(Lu | M)`,
  `atan2((Lu ^ M).e12, Lu | M)`, `(M ^ A).e012`).

- Added the principal logarithm and square root of PGA(2) unit motors,
  `log(M)` and `sqrt(M)`, as an amendment of PGA convention version 1
  (section 8.1, PGA-013, PGA-014): the logarithm of a rotation is its centre
  weighted by minus the half-angle, that of a translator an ideal point, and
  `exp(t * log(M))` interpolates a motor. Non-unit, odd, and mixed arguments
  and the branch cut (scalar part −1) report a domain diagnostic instead of
  the values ganja.js returns; scalar arguments keep the section 10 functions.
  The PGA showcase gains a rotation about `A` from side `L` to side `M` and a
  slider that sweeps `B` onto `M`.

### Document and convention changes

- Canonical format version 5 adds `Appearance.idealPointDisplay` (`vector`,
  `ideal`, `both`); version 4 documents migrate with `vector`.
- Canonical format version 6 adds `Appearance.pointListDisplay` (`none`,
  `open-polyline`, `closed-loop`) and `Appearance.pointMarkersVisible`;
  version 5 documents migrate with `none` and visible markers.
- Canonical format version 7 prepares stroke, point, opacity, and label
  placement settings (#221, #222, #226) and the normalization modes (#185).
  Appearance adds `strokeStyle` (`solid`, `dashed`, `dotted`), `pointStyle`
  (`dot`, `ring`, `cross`, `plus`, `square`, `diamond`), `labelAnchor`
  (`auto` or one of eight positions), and numeric settings stored as source
  text, a number or a scalar expression, where an empty source selects the
  object kind's default: `strokeWidthSource`, `pointSizeSource`,
  `opacitySource`, `labelAngleSource`, `labelSizeSource`, and
  `labelDistanceSource`. Lists style their points and lines in separate
  `primitiveStyles` blocks, which replace `pointListDisplay` (now
  `points.connection`) and `pointMarkersVisible` (now `points.visible`).
  `Item.normalization` accepts `euclidean` and `ideal` besides `natural`.
  The style registry adds the `orange`, `teal`, `purple`, and `pink` ramps.
  Version 6 documents migrate with empty sources and the label anchored
  `top-right`, as before, and draw unchanged; new objects place their label
  automatically. The new settings are not drawn or editable yet, except those
  listed under Interface and accessibility.

### Interface and accessibility

- **? Expression reference** opens the reference under its band, inside the
  expression panel, instead of a modal dialog, so an example sits right
  under the rows being written and the canvas stays usable (#259). The band
  shows a chevron and the algebra badge and reports its state. The
  reference has sticky section titles and examples with their results and a
  **+** button that adds the example as a new expression. Escape inside it
  closes it. A
  handle above the band shares the panel height between the list and the
  reference, by pointer or Up and Down arrows; the height is a local
  preference. The clear-all cross moves to the bottom of the list.
- The reference has two categories, shown one at a time from a
  **General | VGA** (or **General | PGA**) tab bar at its top: **General**, true in every
  algebra, ending with a **Style** section listing the values the appearance
  menu takes; then the algebra's own tab, opening on the
  algebra's **Primitives** (each with how it is written, one short line and
  one or two examples to add with **+**, then the row's normalization
  choices) followed by its own values,
  properties, functions and positioning. Every entry is reduced to its
  syntax, one short line, and at most two examples; no default colors are
  listed.
- The algebra **i** dialog keeps only the algebra: signature, basis and
  metric, Cayley table, the algebraic reading of each object, sub-algebras,
  and mathematical notes. Default object colors, constructors, rendering
  notes, normalization behavior, and source spellings now live in the
  expression reference.
- A slider's play and pause button sits at the start of its slider row, left
  of the bar, as a disc tinted with the scalar's color; while playing it is
  a solid disc of that color. The actions column keeps an empty slot, so the
  appearance swatch stays aligned with the object kind.
- **Save as new graph…** in the Library menu saves the open graph as a new
  library graph under a new name, leaving the saved version of the open one
  untouched; the new graph becomes the open one.
- The canvas buttons that collapse the panel or switch to NoViz have no fill
  or border, like the viewport lock. In NoViz the expressions sit in a
  centred column, and scalar sliders and their bounds keep a usable width in
  a wide panel. The graph name sits against the Save button.
- The appearance swatch is centred on the object-kind line (Point, Line,
  Scalar…), and a hidden object's swatch is no longer crossed out: its
  crossed eye already shows the state.
- In NoViz, where nothing is drawn, a hidden expression is shown like the
  others; its hidden setting is kept and applies again with the canvas.
- The normalization popover, the Library menu and the appearance menu close
  on a press on the canvas, like the settings menu.
- A NoViz calculator mode: a button at the top left of the canvas collapses
  the canvas to the right and leaves the expression panel full width, and a
  button at the right edge of the panel brings the canvas back at the view it
  had in this session, as long as the same document stays open. Nothing is drawn, and position fields, visibility buttons, labels, the
  appearance menu, and the rendering settings are hidden while evaluation,
  scalar controls, history, and import and export keep working. NoViz is saved
  in the document (`visualizerId: null`, viewport `none`, positions off) and
  carried by exports and scene links. Undo and redo across an algebra change
  show each algebra with its own visualizer, in and out of NoViz. A document
  that cannot be drawn (one NoViz marker only, an unknown visualizer, or an
  unavailable interpretation) opens as the calculator, and **Show canvas**
  repairs it (#55).
- A button at the top right of the expression panel collapses it to the
  left so that the canvas fills the window; a button at the left edge of the
  canvas brings it back at its previous width. The choice is remembered in
  this browser, like the viewport lock, but is not part of the document,
  its export, or scene links. Opening a document without a canvas reopens a
  collapsed panel and moves focus left in the canvas to **Show canvas** (#234).
- A local library keeps several named graphs in the browser. **Save** stores
  the open graph under its name, asking for a name in the library menu the
  first time; in a shared-link session it saves a local copy. **Library**
  lists the graphs grouped by algebra with their last update, and offers New,
  Open, Rename, Duplicate, and Delete, with confirmations inside the menu. The
  header shows the open graph's name, editable in place, and a small dot in the text colour on Save
  while the graph has unsaved changes; the browser tab shows the name too.
  Its buttons form three groups: the graph, the document file, the display.
  The previously saved document becomes the first graph of the library,
  without being overwritten first, even from a shared-link session. Save never
  overwrites another graph, reopening the open graph keeps its changes, and the
  list follows other tabs. Storage that is unavailable or full is reported
  without stopping the editor, and a damaged graph never hides the others
  (#212).
- A document that stored `view.positionEnabled: false` drew every object at
  the origin while its position fields and base drags still updated. Positions
  now switch off only without a visualizer (NoViz, #55): a document drawn on a
  canvas always applies its positions, and writing a position turns them on.
- In PGA, the normalization choice opens in a popover anchored to the row's
  norm button, like the appearance menu: a **Normalize** header with a close
  button, then off · auto · norm · inorm. It closes on a choice, Escape, or a
  click outside, and returns focus to the button. In VGA, which has one norm,
  the button switches between off and auto directly, with no menu.
- **Copy link** confirms a copied link with a brief notice instead of opening
  the link panel; the panel with selectable text only appears when the
  clipboard refuses the copy.
- The settings button shows a cogwheel. Beside it, a sun and moon button
  switches between the light and dark themes in one click; by default the
  application follows the system theme, which the settings menu still offers.
- The appearance menu is reworked (#216): the header shows the object kind,
  a visibility eye (the same setting as the row's eye), and the close button;
  titled sections fold from a chevron on their title. **Color** offers nine
  hues and the six shades of the selected hue; **Style** gathers the drawing
  settings (bivector shape, outline, orientation, ideal-point display) as
  named icon buttons and switches; a list gets one section per primitive type
  it holds, **Points** (with the connection) and **Lines**, each with its
  display switch; **Label** has its switch in the title. A scalar's
  **Animate** switch replaces the number or slider choice: on, the scalar is
  an animated slider with Once, Loop, or Ping-pong; off, a number field. A
  slider without animation keeps its display until the switch is used.
- Lines, vectors, bivector outlines, and ideal-point arrows can be drawn
  solid, dashed, or dotted, with a stroke width (#221). **Style** shows the
  three stroke icons and a **Width** field on one row; the bivector row
  appears with its outline, the ideal-point row while the direction arrow is
  drawn. Dashes and round dots grow with the width. **Opacity**, under the
  shades of **Color**, fades the fill and stroke of any drawn object together.
  Width and opacity take a number or a scalar expression such as `w`, so they
  follow a slider while it animates; a refused value (invalid text, unknown
  name, non-scalar or out of range) draws the default and shows a red line
  under the field. The **Lines** section of a list has its own **Style**:
  stroke, width, and orientation, independent of the item's stroke.
- A new line starts without its orientation; saved documents keep the
  orientation they store.
- Points can be drawn as a dot, ring, cross, plus, square, or diamond, with a
  size (#222). Each style keeps an outer shape of its own form, 10 / 4.5
  times the core at 20 % opacity, in place of the outer disk; the core grows
  into it on hover and while dragged, without animation under reduced motion.
  **Style** shows the six icons, then a **Size** field, a number or a scalar
  expression. The **Points** section of a list has its own **Style**: marker
  style and size, then the stroke and width of the links while the points are
  connected. A dot of default size draws as before.
- Labels are edited under their expression and placed from the menu (#226).
  While a label is shown, its text field sits under the expression, with the
  declared name as placeholder. **Label** keeps its switch in the title, then
  **Angle** and **Size**, then **Distance** beside a 3 × 3 position grid whose
  center is **Auto**: the label takes the first of the eight positions, from
  the top right clockwise, where it overlaps no other label and no point or
  handle of another object, and the top right when none is free. New objects
  place their label automatically; saved documents keep the top-right label.
  A list has no label any more: its Label section and the numbered labels of
  its elements are removed, and the elements keep their accessible names.
- The row's **norm** button chooses the normalization mode (#185): a click
  opens off · auto · norm · inorm under the expression, and choosing closes
  it. The button shows the active mode (auto, norm, inorm) in the accent
  color, or a grey "norm" when off; VGA offers off and auto only. Auto follows
  the interpretation's classification, so a PGA point whose weight is within
  the classification tolerance is normalized by `inorm` instead of a tiny
  `norm`; norm and inorm force their norm and leave the value unchanged, as
  unavailable, when it is zero. The unit badge follows the norm actually
  applied, so a normalized ideal point shows it.

- The settings menu is named **Settings** for assistive technology, since it
  also holds the document commands (Import, Export, Copy link).
- The file-drop overlay always hides when a drag leaves the window, even when
  the browser skipped a nested `dragleave` event.
- Coordinates written by the viewport are rounded to about one screen pixel,
  `round(log10(pixelsPerUnit))` decimals clamped from 0 to 8, instead of one
  tenth of a pixel. With about five units across the viewport, a double-click
  now creates `point(-0.96, -0.86)` instead of `point(-0.9553, -0.8645)`.
  Creation, drags, arrow-key moves, and their announcements share the rule;
  line coefficients keep a ten times finer step. Existing documents are
  unchanged until an object is moved.
- The expression reference follows the document's algebra and names it. A
  PGA(2) document lists `point(x, y)`, `point(x, y, w)`, `ipoint(x, y)`,
  `line(a, b, c)`, the blades `e0` to `e012` with the null `e0`, `A.inorm`,
  every coefficient extraction, `log(M)` and `sqrt(M)` for unit motors, and
  ideal-point positions and heads, and no longer shows VGA tuples, `vector`,
  or VGA norms. Every documented entry is evaluated by a test in its algebra.
- The visibility control is a grey eye that appears while its row is hovered
  or holds keyboard focus. A hidden object keeps its crossed eye visible, and
  touch screens always show the eye. The button keeps its accessible name and
  pressed state.
- A list of points can be connected as an open polyline or a closed loop
  from its appearance menu. Links join consecutive points in evaluated list
  order: a segment between two finite points, and the ray from a finite point
  towards an ideal point's direction. They keep the labels and follow the
  item's visibility and color; the point markers, ideal points included, can
  be hidden to show the links alone. Lists holding other entities
  keep independent markers.
- Scalar sliders can now animate concurrently through one shared animation
  loop. Each slider pauses, resumes, completes, or stops independently;
  concurrent motion remains one coherent history transaction, and Escape
  cancels the complete active playback session.

- Added algebra selection from the header capsule: its badge opens a menu of
  registered algebras, its `i` segment the algebra information; switching
  replaces the document with the selected algebra's showcase after
  confirmation, as one undoable entry. The PGA showcase is a triangle whose
  side lengths, oriented angle, height, and signed area are read from the
  norms of joins, the inner product and meet of two sides, the outer product
  of a side and a vertex, and the triple join, next to a movable literal
  line.
- Lines show a translucent halo on hover, optional orientation ticks on
  their positive side (the _Orientation visible_ appearance toggle), and,
  when their source is a literal `line(a, b, c)`, can be translated by
  dragging and rotated about the pressed point through a dashed normal handle
  of fixed screen length that preserves the scale `√(a² + b²)`; both gestures
  work from the keyboard.
- Compact blade names accept every generator of the active algebra, so an
  unavailable blade such as `e0` under VGA(2) reports an unknown-blade
  diagnostic at its span instead of an undefined name.

- Kept the viewport lock button in place while zooming: the zoom read-out
  is as wide as a toolbar command and longer values extend leftwards over the
  canvas instead of widening the toolbar.

- Made the viewport zoom read-out editable: typing a percentage such as
  `150`, `150%`, or `1.5E3%` and pressing Enter sets the scale around the
  viewport center, clamped to the zoom bounds, and any other text returns to
  100 %; Escape or leaving the field restores the read-out, and the field is
  read-only while the viewport is locked. VIEW2D-004 now states the bounds
  extended in #79.

- The viewport's `Reset view` control became `Recenter view`: it and the `0`
  key bring the origin back to the center at the current zoom, while `Home`
  still restores the origin at 100 %. Both announce what they did.

- Arrow keys on a focused handle now move the object by a round step that
  follows the zoom (0.1 at 100 %, ten times that with Shift; at least 7 screen
  pixels at every scale), and the announced position matches the rewritten
  source.

- A scalar slider's interval fields read as the inequality they set,
  `[min] ≤ a ≤ [max] step [s]`, instead of an `INTERVAL` label followed by
  three fields; in a narrow panel the step wraps below the inequality.

- Scalar sliders draw their track in the object's colour at 20 %, and their
  thumb as the canvas base point, at the same size and object scale: a ring in
  the object's colour with a white centre inside a 20 % aura. Hovering or
  dragging grows the ring to fill the aura while the centre keeps its size,
  and keyboard focus rings the thumb; the look is the same in every browser.

- Running scalar animations now reevaluate expression-valued interval bounds
  when their dependencies change. A reduced interval takes effect on the next
  frame, and an invalid interval stops playback instead of retaining stale
  bounds.

- Objects created by double-clicking the viewport are named with the first
  free letter, `A` to `Z`, then `A1` to `Z1` and so on, instead of `V1`, `V2`
  in VGA and `P1`, `P2` in PGA.

- The viewport's accessible name and canvas description follow the active
  visualizer: a PGA document is announced as a `Two-dimensional PGA viewport`
  whose description counts and describes its points, lines, ideal points, and
  line at infinity, and offers to create a point; VGA output is unchanged.

- Undoing or redoing a viewport gesture keeps focus in the viewport — on the
  canvas after a pointer drag, on the moved handle after an arrow-key move —
  instead of jumping to the last edited expression.

### Corrections

- A VGA(2) bivector built as an outer product of two vectors is drawn as the
  parallelogram they span whatever the operands are written as: list elements
  such as `L[0] ^ L[1]`, inline operands such as `(1, 0) ^ (0, 1)`, an outer
  product inside a list literal such as `[V1, V2, V1 ^ V2]`, and a reference
  to or index of such a bivector. A versor sandwich such as `R >>> L` carries
  the construction by transforming each side, so the parallelogram turns with
  the transformed vectors. The **From vectors** shape is offered for these
  rows (#85, #87).
- A list element computed from single values, such as `V1 ^ V2` in
  `[V1, V2, V1 ^ V2]`, inherits the position of its positioned operands like
  any other list element: their common position, or a position conflict when
  they disagree, instead of no position at the origin (#88).
- Where base handles coincide, the handle of the selected object is on top and
  takes the press: the object whose expression row has focus or the pointer,
  otherwise the last object moved in the viewport. The order holds while a
  handle has keyboard focus, so it never loses focus, and the tab order of the
  handles follows it. A base drag no longer links back to the anchor it
  started on: the anchor is taken only after the pointer has left it once, so
  a short drag separates coinciding or linked objects. A drag starts only after
  the pointer has moved 3 pixels, so a click on a linked base keeps its link
  (#100).
- PGA(2) position diagnostics no longer mention VGA vectors. A coordinate
  tuple such as `(1, 2)` reports that a position must evaluate to a Euclidean
  point, such as `point(1, 2)`, instead of an unsupported `vector` function;
  a position that evaluates to another kind, such as a line, reports that it
  must evaluate to a Euclidean point. VGA(2) messages are unchanged (#236).
- In PGA(2), the empty position of an ideal point evaluates to the origin
  point `e12`, where its arrow is drawn, instead of `0`: `J.position` is `e12`
  and `J.head` is `J + e12`, as the row shows. An empty VGA(2) position still
  evaluates to `0` (#235).
- The appearance menu stays inside the window: it is placed from its measured
  height, opens above its row when it does not fit below, scrolls inside when
  it is taller than the window, and follows its row when the window is
  resized or the expression list scrolls.
- A scalar whose value is computed, such as `t = 2*v*s - v`, no longer shows
  a disabled slider, interval fields, play button, or animation settings. A
  control stored while it was a literal stays dormant in the document and
  returns when the source is a literal again.
- Reading `position` or `head` on a PGA list, such as `L.position` for
  `L = [e01, e02]`, no longer blanks the application: inherited list
  positions are built in the active algebra's basis.
- List inspections name the blades of the active algebra, so a PGA list reads
  `[2e01 - e02 + e12, e12]` instead of showing `undefined` terms.
- Switching algebra gives the document the title and description of the
  example it loads, so a PGA(2) document no longer keeps the *VGA 2D Rotation
  Example* title or exports as `VGA-2D-Rotation-Example.gamut.json`.

## 0.1.0 - 2026-09-13

First stable release. Tag
[`v0.1.0`](https://github.com/eharquin/multivector/releases/tag/v0.1.0);
acceptance evidence in the
[VGA 2D Visual Workflow acceptance record](docs/acceptance/vga-2d-visual-workflow.md);
scope and limitations in the [release notes](docs/releases/0.1.0.md).

### Scientific capabilities

- Added the accepted VGA(2) foundation: owned multivector evaluation,
  versioned conventions, standard scalar/vector/bivector/rotor interpretation,
  geometric operations, rotors, lists, and positioned 2D visualization.
- Added natural normalization, scalar controls and deterministic playback,
  direct positioned-object manipulation, and dynamic base/head anchoring.
- Added a tolerance-aware VGA(2) classification policy so harmless
  floating-point leakage no longer changes an object's semantic kind, with
  an explicit "approximated" indicator when it is suppressed.

### Document and convention changes

- Established a closed canonical document format with local persistence,
  import/export validation, stable item identities, and independent value,
  position, appearance, control, and view state.
- Added persistent numerical display precision without changing mathematical
  values or classification.

### Corrections

- Preserved full binary64 round-trip precision when scalar controls rewrite
  authoritative source and made playback reach evaluated endpoints exactly.
- Kept vector-base manipulation available when bivector fills overlap it.
- Stopped browser default actions from leaking through viewport gestures:
  native text selection during manipulation and pans, page zoom on
  Ctrl+wheel and pinch, and selection or hit-testing of the panels while a
  gesture is held.
- Dropped a dragged expression row exactly where its indicator was shown.
- Removed the "Two-dimensional VGA viewport" tooltip shown over the canvas.

### Interface and accessibility

- Added persistent display, theme, object-size, viewport-lock, appearance,
  label, bivector-shape, border, and orientation controls.
- Added keyboard workflows, textual announcements, reduced-motion behavior,
  bounded clear interaction, and recorded VGA foundation accessibility checks.
- Added Alt+Arrow row movement from an expression field and on the reorder
  handle.
- Drew keyboard focus on viewport handles as an SVG ring shown for keyboard
  focus only, returned focus to the canvas after a pointer gesture, and kept
  the gesture cursor over the panels.
- Replaced font-dependent glyphs (settings gear, play and pause) with inline
  icons that render identically on every platform.

### Distribution

- Changed the public GitHub Pages deployment to publish only verified stable
  release artifacts while pull requests and `main` pushes retain production
  build validation; a maintainer may also deploy a chosen ref by hand for
  browser testing.
- Recorded the supported-browser matrix: current Chrome and Firefox on Linux
  desktops, Safari 17.6 on macOS 12.7; Edge, touch input, and mobile browsers
  are not claimed.

## Maintenance rules

- Pull requests add an Unreleased entry when they change a scientific
  capability, public document or convention, canonical format, compatibility,
  or material user workflow.
- Pure test refactors and internal maintenance need no entry unless they change
  verification guarantees.
- A release moves relevant Unreleased entries under a dated version heading,
  links the Git tag and acceptance record, and leaves a new empty Unreleased
  section.
