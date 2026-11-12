# GAMUT Design Requirements

**Status:** Draft for review
**Date:** 2026-07-28
**License:** MIT

## 1. Purpose

GAMUT is a research-driven web application for creating, evaluating,
visualizing, saving, and sharing reproducible geometric algebra constructions.
Scientific reproducibility, mathematical correctness, explicit conventions, and
deterministic documents take priority while the interface remains approachable
to learners.

The project is a from-scratch successor to the private MultiVector Studio
prototype. Studio is a behavioral and scientific reference, not the
architectural starting point.

## 2. Product principles

- **PROD-001:** A document shall contain everything required to reproduce its
  mathematical state and visual presentation.
- **PROD-002:** Mathematical values, geometric interpretation, appearance, and
  UI state shall remain separate concepts.
- **PROD-003:** The public application shall run on GitHub Pages without a
  required application backend.
- **PROD-004:** Implemented features and roadmap targets shall be clearly
  distinguished.
- **PROD-005:** Scientific conventions shall be documented, versioned, and
  independently tested.
- **PROD-006:** GAMUT shall be designed as an algebra- and
  dimension-independent system.

Milestones define incremental delivery profiles and shall not become the
architectural owners of shared capabilities. Engineering milestones establish
independently testable foundations. Product milestones additionally deliver a
complete documented user workflow.

## 3. Scope and progression

GAMUT is planned to progress through the following engineering and product
milestones:

1. **Language and Document Foundation — Engineering:** Deliver the selected
   language frontend, dependency analysis, deterministic evaluation,
   diagnostics, canonical document format, validation, migrations, and resource
   limits without requiring a visualizer.

2. **VGA Core — Engineering:** Deliver one dimension-parameterized VGA
   definition with complete textual and computational support for dimensions 1
   through 3, independently of geometric interpretation and rendering.

3. **VGA 2D Foundation — Product:** Deliver the first public, text-driven
   workflow with renderer-independent geometry entities, the VGA 2D visualizer,
   local persistence, canonical JSON import and export, accessibility, and
   GitHub Pages deployment.

4. **VGA 2D Interactive Workflow — Planned Product:** Use evidence from the
   foundation to select and scope direct manipulation, controls, animation,
   sharing, history, and figure-export increments.

5. **VGA 3D Visual Workflow — Product:** Extend the same architecture to
   three-dimensional VGA geometry, including the required camera and
   interaction design.

6. **Higher-Dimensional VGA Evaluation — Engineering:** Activate and verify
   textual and computational VGA support for dimensions 4 through 9 without
   requiring corresponding geometric visualizers.

7. **PGA Visual Workflows — Product:** Introduce versioned PGA definitions and
   interpretations, followed by independently scoped 1D, 2D, and 3D visual
   workflows.

8. **CGA Visual Workflows — Product:** Introduce versioned CGA definitions,
   source basis conventions, interpretations, and independently scoped 1D, 2D,
   and 3D visual workflows.

9. **Parametric Constructions — Product:** Add sampled parametric expressions,
    animation beyond scalar controls, and the associated evaluation, history,
    rendering, and resource-limit behavior.

10. **Specialized Research Algebras — Research and Product:** Admit fixed
    definitions such as 2D CCGA or ACGA without assuming that every algebra is a
    dimension-parameterized member of the VGA, PGA, or CGA families.

Milestones 1 through 3 define the currently approved initial progression.
Milestones 4 through 10 are planned directions whose detailed scope,
requirements, ordering, and delivery boundaries require separate review before
implementation. In particular, the VGA 2D Interactive Workflow shall be shaped
by evidence from the VGA 2D Foundation rather than specified exhaustively in
advance. The numbering expresses the present progression model, not a permanent
release number or a commitment to implement every later milestone in strict
sequence.

The initial scope excludes slides, visual LaTeX input, embedding-space
visualization, and a required Rust implementation.

## 4. Technology baseline

- **TECH-001:** The primary production application and domain code shall use
  TypeScript with strict type checking. The initial user interface shall use
  React, and the application shall be developed and built with Vite. Specialized
  computation backends may use other languages behind the engine boundary
  defined by TECH-005 and TECH-006.
- **TECH-002:** React shall be limited to presentation and interaction
  composition.
- **TECH-003:** Domain code shall be testable without React or a browser DOM.
- **TECH-004:** The initial rendering technology shall support accessible,
  deterministic web rendering and the figure-export guarantees activated by a
  milestone. The selected rendering implementation is an architecture decision.
- **TECH-005:** Third-party algebra values shall be isolated behind engine
  adapters.
- **TECH-006:** Engine boundaries shall allow specialized sparse and future
  Rust/Wasm backends without changing documents or geometric entities.
- **TECH-007:** Runtime validation shall complement TypeScript's static type
  checking at external data boundaries.
- **TECH-008:** The initial source language shall be the GAMUT-owned
  expression language, and the initial built-in VGA implementation shall use
  ganja.js behind the algebra-engine adapter boundary. Ganja.js values, APIs,
  generated code, serialization, conventions, and failure behavior shall not
  become part of the document format or GAMUT-owned domain contracts.
  The application shall invoke explicit adapter operations and shall not pass
  document source to ganja.js inline translation.

The language choice is durable and versioned through `languageVersion`; the
ganja.js engine choice remains replaceable under TECH-005 and TECH-006.
MultiVector Studio is behavioral evidence for ganja.js coverage, but its direct
use of ganja.js values throughout evaluation, classification, and rendering is
not an architectural precedent. A Python runtime is not part of the initial
production application.

## 5. Architecture

```text
source -> LanguageFrontend -> dependency plan -> controlled evaluator
       -> AlgebraEngine -> owned values
       -> optional GeometryInterpretation -> geometric entities
       -> render primitives -> optional visualizer
```

- **ARCH-001:** Backend-native values and APIs shall not cross the engine
  boundary; only GAMUT-owned values, diagnostics, and capability
  descriptors may cross it.
- **ARCH-002:** React types shall not appear in the domain model.
- **ARCH-003:** Visualizers shall not parse expressions, calculate algebra, or
  branch on algebra identifiers.
- **ARCH-004:** Engines and geometry interpretations shall not produce DOM,
  SVG, React, camera, or viewport objects.
- **ARCH-005:** All document mutations shall pass through explicit application
  commands.
- **ARCH-006:** Lists and individual values shall share one primitive-rendering
  pipeline.
- **ARCH-007:** Algebra definitions shall negotiate capabilities explicitly.
- **ARCH-008:** Algebra definition, geometric interpretation, entity rendering,
  and appearance shall be independently replaceable boundaries.
- **ARCH-009:** Language-frontend parse structures, backend-native values,
  generated code, runtime exceptions, and third-party serialization shall not
  become authoritative document data or public domain contracts.

ARCH-005 means that UI components do not modify document objects directly. An
edit requests a command such as “replace this source span,” “change this
appearance property,” or “set this algebra configuration.” The application
validates and applies that command as one deterministic transition. This gives
autosave, undo, redo, diagnostics, keyboard interaction, and pointer interaction
one mutation path; it does not require user-visible command syntax.

ARCH-004 does not prohibit expression-driven cameras. Camera expressions are
ordinary mathematical sources evaluated to owned values, then interpreted by a
separate camera adapter. Engines and geometry interpretations remain unaware of
camera and viewport objects.

## 6. Algebra definitions and dimensions

An algebra definition may be fixed or parameterized. Its stable identity,
parameters, versions, signature, basis, operations, and limits are governed by
the
[algebra definition requirements](requirements/algebras/algebra-definition.md).
An optional, separately versioned geometry interpretation classifies owned
values and may convert them to renderer-independent entities.

- **DIM-001:** Geometric dimension, generator count, metric signature, and
  visualization support shall be distinct concepts.
- **DIM-002:** A supported algebra configuration shall remain usable through
  textual inspection when no geometry interpretation or visualizer exists for
  its geometric dimension.
- **DIM-003:** Documents shall store an algebra definition identifier and its
  validated parameters rather than a closed family enum.
- **DIM-004:** Configuration changes shall preserve source and item identities,
  then deterministically rebuild derived language and evaluation data.
- **DIM-005:** An unavailable definition, version, or configuration shall
  preserve document content and produce a diagnostic, never a silent fallback.
- **DIM-006:** Multiple geometry interpretations may target the same algebra
  definition, but a document shall select at most one active interpretation.
- **DIM-007:** The abstract metric, its signature, the canonical computational
  basis, registered source basis frames, and the basis used for display are
  distinct concepts. A change of basis shall not be modeled as a change of
  algebraic value or metric.

The initial VGA definition is specified in
[VGA requirements](requirements/algebras/vga.md).
Its initial mathematical and numerical conventions are specified in
[VGA convention version 1](specifications/vga-conventions.md).
The second definition, PGA, is specified in
[PGA requirements](requirements/algebras/pga.md) with its conventions in
[PGA convention version 1](specifications/pga-conventions.md).

## 7. Document model

A versioned document shall contain an opaque immutable document identity,
`formatVersion`, `languageVersion`, an algebra reference with its independent
definition and convention versions, an optional interpretation reference,
metadata, expression items, appearance, and view state. Every item shall also
have an opaque immutable identity.

The normative version-one structure, canonicalization rules, and dependency
nodes are specified in the
[document format specification](specifications/document-format.md).

- **DOC-001:** Local, imported, exported, shared, and public documents shall use
  the same format.
- **DOC-002:** Serialization shall be canonical and deterministic.
- **DOC-003:** Loading shall validate and migrate before entering state.
- **DOC-004:** Invalid or unsupported data shall produce diagnostics and never
  execute code.
- **DOC-005:** Format, language, definition, and convention versions shall evolve
  independently.
- **DOC-006:** Source is authoritative; tokens and ASTs shall be reconstructed.
- **DOC-007:** Duplicating creates new identities; opening and importing preserve
  existing identities.
- **DOC-008:** Non-finite numbers shall be rejected and negative zero normalized.
- **DOC-009:** When geometric interpretation affects a document, the document
  shall identify its active interpretation and version independently of the
  algebra definition; no interpretation is also a valid state.
- **DOC-010:** The algebra reference shall have the canonical shape
  `{ algebraId, definitionVersion, conventionVersion, parameters }`, where
  `algebraId` is a stable reverse-DNS identifier, versions are positive
  integers, and `parameters` is a definition-owned JSON object with sorted keys.
- **DOC-011:** Unknown fields shall be rejected within closed normative objects
  of the current format version. A format version may define explicit extension
  containers, but extension data shall be size-limited, non-executable, and
  unable to alter language or evaluation semantics.
- **DOC-012:** A document whose algebra is unavailable shall open in a
  read-only recovery state that permits inspection and lossless export of its
  stored content, but not evaluation, source mutation, or resaving over the
  original local record.

DOC-013 and DOC-014 have **Milestone** commitment and apply to milestones that
explicitly include them, starting with
[Library and Expression Organization](requirements/milestones/library-and-expression-organization.md).
They are stored in canonical format version 8.

- **DOC-013:** A document may organize its items in named, nestable,
  collapsible expression folders stored in the canonical document. Folders
  are structural only: they have no value, name binding, or dependency, do
  not override appearance or position, and do not change evaluation or the
  canvas draw order, which stays the item order. Removing a folder keeps its
  items at the folder's position in its parent. Creating, renaming, removing,
  nesting folders and moving items are undoable commands; a move preserves
  item identities and source. A folder's collapsed state is document content:
  it is saved, exported, and carried by scene links and library graphs, and
  changing it counts as an unsaved change, but it creates no history entry.
  Collapsing a folder hides its rows in the expression panel only. Folders do
  not count towards the item limit and have their own limits. The same folder
  model, and where possible the same interface component, serves the library
  folders of STORE-016 and the archive directories of STORE-017.
- **DOC-014:** The persistent display setting `valuesVisible`, `true` by
  default, shall hide the multivector value shown under each expression when
  it is `false`. Descriptions, diagnostics, controls, and the viewport drawing
  are unchanged, and turning the setting back on reveals every value at once.
  The setting is document content like the other display settings (APP-006):
  it is saved, exported, and carried by scene links and library graphs. It is
  a teaching aid, not a protection: the values remain in the document.

Moving the canonical format from version 7 to version 8 for DOC-013 and
DOC-014 follows DOC-003: earlier documents migrate on load. An earlier
release cannot open a version 8 document: 0.2.0 replaces a stored version 8
active document with its example on reload and reports a version 8 library
graph as unreadable when it is opened. Protecting an older
release against a newer format is deferred to
[#275](https://github.com/eharquin/gamut/issues/275) and accepted while GAMUT
has no users.

## 8. Language and evaluation

The normative language is specified in
[language.md](specifications/language.md).

- **LANG-001:** Parsing, dependency analysis, and evaluation shall be separate.
- **LANG-002:** Names shall form an explicit dependency graph.
- **LANG-003:** Every numeric result, including a scalar, shall be a multivector.
- **LANG-004:** Missing names, duplicates, cycles, syntax, domain, capability,
  upstream, and internal failures shall have distinct diagnostics.
- **LANG-005:** Failed expressions shall produce no stale visible value while
  independent graph branches continue evaluating.
- **LANG-006:** Lists, individual values, and scalar extraction boundaries shall
  have uniform documented semantics.
- **LANG-007:** The selected language shall define its accepted source forms,
  precedence, name binding, source locations, list behavior, capability access,
  and future-extension boundary independently of backend accidents.
- **LANG-008:** A language frontend shall return GAMUT-owned declarations,
  dependency references, source locations, limit charges, and diagnostics.
  Frontend-native tokens or AST nodes shall remain derived internal data.
- **LANG-009:** `languageVersion` shall select a version of the GAMUT
  expression language. Supporting another source language requires a separately
  approved language-identity, persistence, and migration design.

## 9. Appearance and direct manipulation

- **APP-001:** Algebraic values shall not contain visual placement or style.
- **APP-002:** Appearance sources shall use the common language and dependency
  graph where supported.
- **APP-003:** Every visual item shall store visibility, label visibility, label
  text, and a palette-independent style reference; renderers shall apply
  explicit defaults when a property is absent.
- **APP-004:** Appearance applies to a whole list in the initial workflow;
  per-element appearance is outside that workflow.
- **APP-005:** Position is a separate expression source owned by the item.
  `head` is derived, read-only, and shall never be serialized as appearance.

APP-006 has **Milestone** commitment and applies only to milestones that
explicitly include configurable display settings.

- **APP-006:** Document display settings shall cover numeric display precision,
  axis labels and graduation visibility, grid visibility, object-size scaling,
  and light, dark, or system theme. They are presentation-only and shall not change
  mathematical values or evaluation semantics. Persistent display settings are
  stored in view state and restored under CMD-004.
- **APP-007:** Position support shall be an explicitly enabled interpretation
  capability. It is disabled when no visualizer is active and for entity kinds
  that do not support position. Disabling it shall preserve stored position
  sources without evaluating them or attaching position diagnostics.
- **APP-008:** Canonical appearance shall reference a registered semantic style
  identifier rather than a concrete color value. Unknown identifiers shall fail
  canonical validation; renderers may use an explicit defensive fallback only
  before validation.
- **APP-009:** A non-spatial value may use its style in textual presentation,
  but shall not expose object-visibility or visualizer-label controls when it
  has no render primitive.

The direct-manipulation requirements below have **Milestone** commitment and
apply only to milestones that explicitly include interactive source editing.

- **EDIT-001:** Direct manipulation shall resolve a geometric edit into a
  language-aware source edit; visualizers shall never rewrite text directly.
- **EDIT-002:** A supported edit shall replace the smallest source span whose
  scalar value controls the manipulated degree of freedom, preserving all
  unrelated whitespace, comments, syntax choice, and component sources.
- **EDIT-003:** The initial inverse-editing set is limited to numeric literals,
  unary-signed numeric literals, tuple or constructor components, and a direct
  reference to one free scalar declaration. Ambiguous, shared, cyclic, or
  compound inverse edits shall be refused without changing the document.
- **EDIT-004:** A refused manipulation shall retain selection and provide a
  textual reason; it shall not fall back to replacing the whole expression.

## 10. Commands, undo, and animation

CMD-003, CMD-005, and CMD-006 have **Milestone** commitment and apply only to
milestones that explicitly include advanced history behavior.

- **CMD-001:** Commands shall produce deterministic state transitions.
- **CMD-002:** Undo and redo shall operate on documents, not UI component state.
- **CMD-003:** Gestures and playback shall use explicit coalescing policies.
- **CMD-004:** View commands shall not enter mathematical history but persistent
  view state shall be restored.
- **CMD-005:** A completed pointer or keyboard gesture shall create one undo
  entry. Repeated keyboard changes may coalesce only while they target the same
  property, remain uninterrupted, and occur within the window specified by the
  [limits and interaction constants](specifications/limits-and-constants.md).
- **CMD-006:** Text edits may coalesce while focus, item, and edit kind remain
  unchanged. Selection changes, blur, explicit commands, import, save-as, and
  algebra changes terminate coalescence.
- **CMD-007:** Undo followed by a new document mutation shall clear redo.
  Failed, cancelled, playback-only, and view-only actions shall create no
  history entry.
- **CMD-008:** Undo and redo shall restore source, appearance, controls, algebra
  configuration, and deterministic derived results atomically.
- **CMD-009:** Until document history makes clearing recoverable, clearing all
  expressions shall require a sustained pointer or keyboard activation. The
  command shall remove every item and item-keyed appearance record while
  preserving document identity, then move focus to the add-expression control.

The scalar-control and animation requirements below have **Milestone**
commitment and apply only to milestones that explicitly include controls or
animation.

- **CTRL-001:** A scalar declaration may expose either a numeric field or a
  slider without changing its mathematical meaning; the stored source remains
  authoritative.
- **CTRL-002:** Control minimum, maximum, and step are finite scalar expressions
  shared by slider and animation behavior. They shall satisfy
  `minimum < maximum` and `step > 0`; invalid configuration disables the slider
  and animation, leaves numeric-field editing available, and reports a
  diagnostic without changing the scalar.
- **CTRL-003:** A control change uses the direct-edit rules and shall not clamp
  a stored value silently. The UI may show an out-of-range state.
- **CTRL-004:** Animation modes are `once`, `loop`, and `ping-pong`, with an
  explicit direction and positive finite duration. They interpolate from the
  configured minimum to maximum using elapsed time, independent of frame rate.
  Animation is available in both numeric-field and slider presentation modes;
  changing the control mode does not change its animation configuration.
- **ANIM-001:** Animation shall use an injectable clock and elapsed time.
- **ANIM-002:** Active playback state shall not be persisted.
- **ANIM-003:** Saving and sharing shall reproduce the visible mathematical
  value.
- **ANIM-004:** Starting playback shall snapshot the scalar source. Pausing
  commits the currently visible value as one undoable command; cancelling
  restores the snapshot without a history entry.
- **ANIM-005:** Reduced-motion mode shall never auto-start animation and shall
  provide equivalent manual scalar controls.
- **ANIM-006:** Saving a graph, from **Save** or from the library, while
  scalars are playing shall first stop every active playback as pausing does
  (ANIM-004), then save the values they stopped on, so that the saved graph
  shows no unsaved change until the next edit or playback. The playback
  announcement states that saving stopped the animation. ANIM-006 has
  **Milestone** commitment and applies to
  [Library and Expression Organization](requirements/milestones/library-and-expression-organization.md).

## 11. Persistence, import, export, and sharing

Local persistence and canonical JSON import/export are **Core**. URL sharing
requirements STORE-003 and STORE-009 through STORE-011, and figure export
requirement STORE-012, have **Milestone** commitment.

- **STORE-001:** Persistence shall use an internal storage interface; IndexedDB
  is the preferred initial implementation.
- **STORE-002:** Imports, exports, local documents, examples, and shared fragments
  shall pass through common validation.
- **STORE-003:** URL sharing shall encode a complete size-limited document after
  `#` without a server identifier.
- **STORE-004:** Public examples shall be immutable; editing creates a local copy.
- **STORE-005:** JSON export shall support archival and oversized documents.
- **STORE-006:** Local persistence shall be transactional and retain the last
  valid saved revision if quota, validation, migration, or write operations
  fail. Autosave status and failures shall be visible.
- **STORE-007:** Import shall create a new local record while preserving the
  document and item identities contained in the file; an identity collision
  shall require explicit replace or duplicate-as-new behavior.
- **STORE-008:** Export shall emit UTF-8 canonical JSON with a media type and
  filename suitable for archival. Importing that export shall reproduce the
  same canonical document.
- **STORE-009:** A shared URL shall contain an explicit share-envelope version,
  compression/encoding identifier, integrity check, and complete canonical
  document. Decoding shall occur only after encoded-size checks and before
  document validation.
- **STORE-010:** Opening a shared URL shall not write local storage. Saving it
  creates a local copy; subsequent edits shall not mutate the URL implicitly.
- **STORE-011:** If a document exceeds the URL limit, sharing shall offer JSON
  export and shall not create a partial URL.
- **STORE-012:** The application shall export the visible visualization as a
  deterministic, self-contained figure. SVG is the initial required format;
  PNG raster export may also be provided, while PDF is future scope. Exported
  figures shall inline their styles, contain no external references, reproduce
  the visible scene, and exclude interaction-only chrome. Figure export is not a
  document mutation and shall not change mathematical or viewport coordinates.
- **STORE-013:** A local library shall keep several named graphs in the
  browser (#212). A versioned index (`gamut.library.v1`) lists each graph's
  identity, name, algebra, creation and last-update instants; each graph is
  stored under its own key as canonical JSON, and its library identity is its
  document identity. The open graph remains the autosaved active document,
  and `gamut.library.v1.open` records which library graph it is, if any.
  **Save** stores it in the library under its name, asking for a name in the
  library menu the first time, and in a temporary scene-link session acts as
  Save local copy. Save shall never overwrite another graph: a document that
  is not the library graph of its identity (a default, imported, or recovery
  document) takes a fresh identity when the library already holds its own.
  The header shows the open graph's name left of **Save**, editable in place
  (Enter or leaving the field confirms it; naming a graph never saved saves
  it), “Untitled” for a graph never saved and “Shared scene (temporary)” in a
  temporary session; the browser tab reads `<name> · GAMUT`. A dot on **Save**,
  and the accessible name “Save (unsaved changes)”, show that the document
  differs from its last saved revision; the viewport centre and zoom and the
  viewport lock do not count. The same state decides whether **New** and
  **Open** ask before discarding changes; opening the graph that is already
  open discards nothing. **Library** lists the graphs grouped by algebra with
  their name and last update, follows changes made in other tabs, and offers
  New, Open, Rename, Duplicate (“X copy”, “X copy 2”, …), and Delete;
  deleting and discarding are confirmed inside the menu, and Escape dismisses
  a confirmation before the menu. Reading the library, including opening its
  menu, writes nothing. Each write reads the index again first; the former
  active document becomes the first entry at the first write, before any
  action replaces it, also in a temporary session, and an index that could
  not be read is rewritten then. Every storage access tolerates unavailable
  storage and full quotas, keeps the open graph working in memory, and
  reports the problem in text. A graph is written before the index, and is
  put back as it was if the index cannot be written, so that no graph loses
  its entry and the last valid revision is kept; an invalid index entry or a
  graph missing from the index is listed again from the stored graph; a
  corrupted graph is reported as unreadable when opened, renamed, or
  duplicated, and never hides the others.

The library panel, example, folder, and archive requirements STORE-014 through
STORE-018 have **Milestone** commitment and apply to milestones that
explicitly include them, starting with
[Library and Expression Organization](requirements/milestones/library-and-expression-organization.md).
Where they apply, the library panel of STORE-014 replaces the library menu of
STORE-013; every other STORE-013 guarantee (storage keys, write order,
recovery, unsaved-changes state, and tolerance of unavailable storage) is
unchanged.

- **STORE-014:** The **Library** header button shall open and close a library
  panel docked on the right of the page, beside the viewport, which resizes
  instead of being covered; below the width breakpoint of A11Y-012 the panel
  is an overlay. The panel has a **My library** section, on which it opens,
  and an **Examples** section. **My library** lists the graphs of STORE-013
  with their name and last update and offers New, Open, Rename, Duplicate,
  Delete, and Save as new graph, with the confirmations of STORE-013 shown
  inside the panel. Opening the panel reads storage and writes nothing. The
  temporary-session behavior of the panel is specified in
  [scene links](specifications/scene-links.md#temporary-sessions-and-storage).
- **STORE-015:** Examples shall be canonical documents shipped in the source
  tree in the current format version, in a fixed folder tree, and shall pass
  the common validation of STORE-002. They are read-only: they cannot be
  renamed, moved, deleted, or overwritten (STORE-004). Opening an example
  shows it unbound from any library entry, like a new document. **Add to my
  library** stores a copy with a new document identity (DOC-007) in **My
  library**, under the example's folder path, creating the folders that are
  missing; it never asks where to put it. Each algebra definition names one
  example as its showcase; the first run and switching to that algebra load
  exactly that example, so the showcase has one source.
- **STORE-016:** **My library** and **Examples** shall be organized in
  nestable folders following the common folder model of DOC-013 and the
  folder limits of the
  [limits and interaction constants](specifications/limits-and-constants.md#21-folders).
  Graphs outside any folder are listed at the root. In **My library** the user
  can create, rename, nest, and delete folders and move a graph into or out of
  a folder by a menu action and by drag and drop; deleting a folder that is
  not empty requires a confirmation inside the panel that states how many
  graphs it contains. The index keeps `version: 1`: an entry gains an
  optional `folder` field naming its folder path, and an entry without
  `folder`, or with a folder that cannot be resolved, is listed at the root.
  Empty folders, which no entry names, are stored under a separate key that
  earlier versions ignore. An index written under this requirement shall
  remain readable by the 0.2.0 parsing rules with every entry kept; saving a
  graph from 0.2.0 rewrites its entry without `folder` and so moves it to the
  root, which is accepted. The collapsed state of library folders is a
  per-browser preference, not document content, and is tolerant of
  unavailable storage.
- **STORE-017:** **Export library** shall download the whole of **My library**
  as one `.zip` archive named `gamut-library-<date>.zip`, containing one
  canonical JSON document per graph, identical to its single-graph export
  (STORE-008), in directories that reproduce the library folders, and a
  versioned manifest that records the export date and each graph's name,
  identity, and last update. Entry names are written as UTF-8 with the
  archive's UTF-8 flag set; characters that are unsafe in a path, such as
  `/`, `\`, and `:`, are replaced, and colliding names in one directory get a
  suffix, while the manifest and the documents keep the real names. The
  archive is written with the browser's `deflate-raw` compression already
  used by scene links, without a new dependency. Export reads storage only
  and remains available in a temporary session.
- **STORE-018:** **Import library**, and dropping one `.zip` file on the
  application window, shall import an archive of STORE-017 through one path.
  An archive that fails a SEC-010 check is rejected as a whole with a
  diagnostic and writes nothing. Otherwise every document entry passes the
  same validation and migration as a single-file import (STORE-002); invalid
  entries are skipped and listed in a summary with their diagnostics, and
  valid ones are imported. Imported graphs go into a new top-level folder
  `Imported <date>`, keeping their archive folders below it; an import never
  replaces or overwrites a graph and never asks per graph, and a graph whose
  identity is already in the library is stored under a new identity. Storage
  failures, including a full quota, are reported, and an interrupted import
  leaves an index in which every stored graph has its entry (STORE-013).
  **Import library** is unavailable in a temporary session, with a message
  explaining why.

## 12. Diagnostics, limits, and security

Diagnostics shall contain a stable code, severity, affected item or property,
safe message, and optional development detail.

Initial numeric bounds, diagnostic codes, keyboard increments, target size, and
accessible-name policy are specified in
[limits and interaction constants](specifications/limits-and-constants.md).

- **ERR-001:** Unexpected exceptions shall never become unexplained empty output.
- **ERR-002:** Correcting a cause shall automatically recover dependants.
- **ERR-003:** Diagnostics shall have stable identity across unchanged
  reevaluations and deterministic ordering by document position, property, and
  code; user-facing messages shall not expose stacks or untrusted markup.
- **ERR-004:** A primary failure shall be attached to its cause. Dependants
  shall receive an upstream diagnostic that references the causing item without
  duplicating the primary message as an independent mathematical error.
- **ERR-005:** Syntax recovery may produce multiple diagnostics and editor
  structure, but no recovered AST fragment may be evaluated as the failed
  item's value.
- **ERR-006:** Unexpected failures shall be contained at item or service
  boundaries where possible. Independent items, lossless export, and recovery
  actions shall remain available.
- **SEC-001:** Imported and shared content shall be untrusted and size-limited.
- **SEC-002:** User content shall never become unsafe HTML or JavaScript.
- **SEC-003:** Local documents shall remain on-device unless explicitly exported
  or shared.
- **SEC-004:** Limits shall cover encoded and decoded document size, item count,
  source length, AST depth, dependencies, generated values, generator count,
  coefficient growth, and evaluation budget.
- **SEC-005:** Exceeding a limit shall fail without a partial or silently
  truncated mathematical result.
- **SEC-006:** Limit checks shall occur before allocation or expansion whenever
  the resulting size can be predicted, and evaluation shall support a
  deterministic work budget rather than relying on wall-clock interruption.
- **SEC-007:** URL decompression, JSON parsing, migration, dependency analysis,
  range expansion, products, and formatting shall each be bounded. Limits and
  their diagnostic codes shall be documented and tested at the boundary.
- **SEC-008:** Document source shall never be passed to a general-purpose
  dynamic evaluator or interpolated into generated host-language code. Trusted
  backend-internal code generation is permitted only inside an isolated worker
  when it consumes validated owned structures rather than source text or user
  identifiers, is covered by security review and conformance tests, and remains
  compatible with the deployable content-security policy. External links shall
  be treated as untrusted, downloads shall use inert data, and the policy shall
  prohibit inline script execution.
- **SEC-009:** Storage and computation failures shall not corrupt the current
  in-memory source. Recovery shall include copying source and exporting any
  structurally valid document.

SEC-010 through SEC-012 have **Milestone** commitment and apply to milestones
that explicitly include library archives or comment rows, starting with
[Library and Expression Organization](requirements/milestones/library-and-expression-organization.md).

- **SEC-010:** A library archive (STORE-018) is untrusted input. Before
  writing anything, import shall enforce the archive size, entry count,
  per-document decoded size, and total decompressed size limits of the
  [limits and interaction constants](specifications/limits-and-constants.md#22-library-archives),
  checking decompressed sizes and the expansion ratio while inflating rather
  than trusting declared sizes. It shall reject entry paths that are empty,
  absolute, or contain a `..` segment, a backslash, or a control character;
  paths over the folder depth, name-length, or path-length limits; names that
  are not valid UTF-8; duplicate paths after normalization; encrypted entries;
  ZIP64 records; compression methods other than stored and `deflate`; and CRC
  mismatches. A failed check rejects the whole archive with a diagnostic and
  never supplies a partial document to validation.
- **SEC-011:** The manifest of a library archive shall be only a hint. Graph
  names and identities come from the validated documents, and folders from
  the validated archive paths; a manifest that is missing, malformed,
  over its size limit, or inconsistent with the entries never makes a valid
  document entry fail and is never trusted over the documents.
- **SEC-012:** Annotation text shall be rendered as a restricted Markdown
  subset, specified in [language §3](specifications/language.md#3-items-names-and-annotations):
  bold and italic with delimiters that leave intraword and mathematical text
  such as `a*b*c`, `2*3`, and `x_1` literal, inline code, backslash escapes,
  and links. Rendering shall build interface elements and never parse or
  inject HTML (SEC-002): raw HTML, images, headings, and lists are shown as
  text. A link is active only when its scheme is `http`, `https`, or
  `mailto`; any other destination, including `javascript:`, `data:`, and
  relative URLs, is shown as plain text. Active links open in a new browsing
  context with `rel="noopener noreferrer"`, and their destination is exposed
  in a tooltip and the accessible description.

## 13. Accessibility

- **A11Y-001:** Document and editor actions shall be keyboard-operable.
- **A11Y-002:** Color shall not be the sole carrier of identity or state.
- **A11Y-003:** Controls shall have accessible names and errors shall be text.
- **A11Y-004:** Animation shall respect reduced motion and offer immediate pause.
- **A11Y-005:** The editor, item list, panels, dialogs, and visualizer shall have
  a logical focus order, visible focus, and no keyboard trap. Focus shall return
  predictably when transient UI closes.
- **A11Y-006:** Selection, evaluation state, diagnostics, scalar values, and
  manipulation results shall be available in text and exposed with appropriate
  names, roles, states, and relationships.
- **A11Y-007:** Pointer gestures shall have keyboard equivalents with documented
  increments; zoom shall not be required to read essential text, and targets
  shall meet the project minimums in the limits and interaction constants.
- **A11Y-008:** Status announcements shall avoid interrupting typing and
  animation frames. Critical import, save, and evaluation failures shall be
  announced once when their state changes.
- **A11Y-009:** Automated accessibility checks and manual keyboard,
  screen-reader, contrast, zoom, and reduced-motion checks shall be completion
  evidence for product milestones.

A11Y-010 through A11Y-014 have **Milestone** commitment and apply to
milestones that explicitly include the library panel, folders, comment rows,
or hidden values, starting with
[Library and Expression Organization](requirements/milestones/library-and-expression-organization.md).

- **A11Y-010:** The library panel shall be a labelled region. The **Library**
  button exposes its expanded state; opening the panel moves focus into it,
  and closing it returns focus to the **Library** button. Both sections, every
  graph and example action, and every confirmation are reachable and
  operable by keyboard, and Escape dismisses a confirmation before the panel.
- **A11Y-011:** Expression and library folders shall expose their name,
  nesting level, and expanded state, and every folder operation shall have a
  keyboard equivalent, including moving an item or graph into and out of a
  folder without drag and drop. After a move, focus stays on the moved row,
  and its new folder and position are announced once.
- **A11Y-012:** Below a width breakpoint at which the expression panel, the
  library panel, and a usable viewport do not fit side by side, the library
  panel shall open as an overlay over the viewport that closes on Escape and
  returns focus to the **Library** button; opening it collapses nothing else.
  At 200 % browser zoom on the supported desktop browsers, the expression
  panel, the library panel, and their menus remain readable and operable
  without loss of content or function. The breakpoint value is owned by the
  [limits and interaction constants](specifications/limits-and-constants.md#6-interaction-constants).
  Mobile browsers and touch input are not claimed
  ([#120](https://github.com/eharquin/gamut/issues/120)).
- **A11Y-013:** When values are hidden (DOC-014), each affected row shall
  announce that its value is hidden and never expose the hidden coefficients
  through its accessible name, description, or live announcements.
- **A11Y-014:** An annotation row shall keep its accessible name
  (“Annotation N”) and expose its text without Markdown delimiters. Its links
  are reachable with Tab in reading order and expose their destination
  (SEC-012).

## 14. Verification

- **TEST-001:** One canonical command shall type-check, lint, test, and build.
- **TEST-002:** It shall pass without hidden expected failures.
- **TEST-003:** Fundamental operations shall have independent reference cases;
  a backend shall not be its own sole reference.
- **TEST-004:** Capability conformance suites shall apply to every backend that
  advertises the capability.
- **TEST-005:** Fixed bugs shall gain permanent regression fixtures.
- **TEST-006:** When multiple backends are declared conforming for an equivalent
  supported configuration, they shall satisfy deterministic serialization and
  versioned numerical conventions. No milestone is required to deliver a second
  backend unless its capability profile explicitly says so.
- **TEST-007:** The canonical verification command shall run automatically on
  every pull request targeting the primary branch and on every push to that
  branch.
- **TEST-008:** A change shall not be eligible for merge when its required
  automated verification fails or has not completed.
- **TEST-009:** Local and continuous-integration verification shall invoke the
  same project-owned commands and shall not rely on tests available only in the
  continuous-integration environment.

The following deployment requirements have **Milestone** commitment and apply
only to milestones that deliver a public application:

- **TEST-010:** A successful revision selected for public release shall deploy
  its production artifact to the configured GitHub Pages environment through an
  automated, reproducible workflow.
- **TEST-011:** A failed build or pre-deployment validation shall not replace
  the last successfully deployed production artifact. A failed deployment or
  post-deployment smoke test shall report failure and retain the revision and
  evidence required to restore the last successful deployment.

## 15. Initial milestones

- [Language and Document Foundation](requirements/milestones/language-foundation.md)
  is an engineering milestone.
- [VGA Core](requirements/milestones/vga-core.md) is an engineering milestone
  covering VGA dimensions 1 through 3 without requiring visualizers.
- [VGA 2D Foundation](requirements/milestones/vga-2d-foundation.md) is the first
  product milestone, delivers the initial text-driven public workflow, and
  introduces the first renderer-independent geometry entities and
  render-primitive adapters.
- [VGA 2D Visual Workflow](requirements/milestones/vga-2d-visual-workflow.md) is
  a planned interactive product milestone whose capability profile will be
  selected from foundation evidence and the shared
  [2D visualization requirements](requirements/visualization/2d.md).
- [PGA 2D Foundation](requirements/milestones/pga-2d-foundation.md) is the
  planned product milestone that introduces the second algebra through the
  registered-algebra boundary.
- [Library and Expression Organization](requirements/milestones/library-and-expression-organization.md)
  is the product milestone of release 0.3.0: the library panel with examples,
  folders, library archives, expression folders, comment rows, hidden values,
  and algebra-owned coordinate tuples.

Later product milestones add VGA 3D, PGA 2D and 3D, and CGA 2D and 3D visual
workflows. A VGA 1D visualizer and 1D workflows for other algebra families are
deferred without a delivery commitment. Parametric animation and specialized
algebras receive separate approved milestone requirements when they enter active
design.

## 16. Lessons from MultiVector Studio

Studio validated algebra-bound evaluation factories, adapter registries,
positioned vectors, list broadcasting, scalar controls, direct manipulation,
scientific graph fixtures, shared 2D/3D rendering, and specialized CCGA/ACGA
engines and geometric interpretations.

The new architecture shall avoid backend values leaking into UI code, informal
mixed value models, algebra-identifier branches in shared panels, duplicated
list rendering, repeated presentation-layer parsing, and documents coupled to a
server or backend implementation.

## 17. Documentation structure and evolution

Requirements state what GAMUT guarantees. Specifications define precise
normative behavior. Architecture documents explain implementation boundaries.
Milestones compose requirements instead of duplicating them.
Requirement and acceptance-criterion identifiers follow the
[requirement identifier convention](requirements/identifier-convention.md).
The current prefixes, their scope, and their normative owner are listed in the
[requirement prefix registry](requirements/requirement-prefix-registry.md).

- This document owns behavior and quality shared across algebras and
  visualizers.
- `specifications/language.md` owns normative source syntax and evaluation
  semantics.
- `architecture/application-architecture.md` describes current code ownership,
  dependency direction, and implementation boundaries.
- `architecture/technology-decisions.md` records the selected initial language
  and backend technologies and their replacement boundaries.
- `specifications/document-format.md` owns the serialized schema,
  canonicalization, migration boundary, and dependency-node model.
- `specifications/limits-and-constants.md` owns shared resource bounds and
  interaction constants.
- `requirements/algebras/algebra-definition.md` owns the contract implemented
  by algebra definitions and interpretations.
- `requirements/algebras/vga.md` owns mathematical behavior and conventions
  specific to VGA(n).
- `requirements/algebras/pga.md` owns mathematical behavior, interpretation,
  and visualization scope specific to PGA(n).
- `requirements/visualization/2d.md` owns the initial rendering and interaction
  guarantees shared by two-dimensional visualizers.
- `requirements/milestones/*.md` own the composed capability profiles and
  evidence actually required for delivery.

If two documents appear to own the same rule, the rule shall be stated
normatively only in the document selected by this list; other documents shall
link to it or state milestone applicability.

Normative documents declare one of: **Planned**, **Draft for review**,
**Accepted**, **Implemented**, or **Superseded**. Moving requirements should
follow the identifier lifecycle rules and preserve identifiers whenever their
meaning and registered scope remain compatible.

Future documents include 2D/3D visualization requirements, PGA/CGA and
specialized-algebra requirements, geometry and render specifications,
architecture, development and deployment guides, and tutorials.
They shall be created when their subject enters active design, not as empty
stubs.

## 18. Future design topics

Visual LaTeX editing, sampled parametric functions, nested and filtered lists,
complex inverse editing, dynamic or per-element appearance, expression-driven
cameras, higher-dimensional visualization, explicit multi-digit blade syntax,
Rust/Wasm, user-authored algebra definitions and geometry interpretations,
configurable constructor names, and hosted short links each require a separate
approved design before implementation.

Expression-driven camera design shall cover these initial dimensional profiles:

- a 1D camera uses `camera_position`, interpreted as a 1D VGA vector or a 1D
  point for point-based interpretations, and a positive scalar `camera_zoom`;
- a 2D camera uses the corresponding 2D vector or point `camera_position` and a
  positive scalar `camera_zoom`;
- a 3D camera uses a 3D vector or point `camera_position` for the eye and a
  non-zero 3D vector `camera_direction` for its world-space viewing direction.

Camera sources shall use the common language, dependency graph, animation, and
language-aware inverse-editing rules. Literal camera sources may be rewritten by
camera gestures; computed sources own the corresponding camera degree of freedom
and may drive reproducible world-space camera animation. A camera adapter, not
the algebra engine or geometry interpretation, converts evaluated values into
viewport state. The detailed design shall define enablement, invalid values,
defaults, gesture ownership, history, and serialization before implementation.
