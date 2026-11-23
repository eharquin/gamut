# Library and Expression Organization Acceptance Record

- **Issue:** [#272](https://github.com/eharquin/gamut/issues/272)
- **Release:** [0.3.0](../releases/0.3.0.md)
- **Milestone:** [Library and Expression Organization](../requirements/milestones/library-and-expression-organization.md)
- **Status:** In progress

This record tracks the evidence required to accept release 0.3.0. Automated
evidence is recorded as each issue lands; a criterion stays pending until its
manual evidence on the release build (`npm run preview`) is complete on the
supported browsers. The deployed evidence follows publication.

## Acceptance matrix

| Criterion | Current evidence | Remaining evidence | Status |
| --- | --- | --- | --- |
| LEO-001 — Interface boundary | Extractions merged: scalar playback ([#276](https://github.com/eharquin/gamut/pull/276)), expression row ([#279](https://github.com/eharquin/gamut/pull/279)), header and document commands ([#283](https://github.com/eharquin/gamut/pull/283)); `App.tsx` 3,963 lines at 0.2.0, 3,141 after the extractions, 3,474 at `v0.3.0` (`7f6cebe`) with the later features; the library panel, library and expression folder trees, add menu, embed controls, canvas sliders and performance monitor are components of their own; `npm run verify` after each step | Smoke test of the deployed VGA and PGA workflows ([#274](https://github.com/eharquin/gamut/issues/274)) | Automated evidence ready; manual validation pending |
| LEO-002 — Library panel | Panel region, focus on open and return on close, overlay below 720 px with Escape, confirmations in the panel, examples opened unbound and copied (`App.test.tsx`, *library panel (#266)* and *local library of named graphs (#212)*); width, resizing, search and action menus (`libraryGallery.integration.test.tsx`, [#328](https://github.com/eharquin/gamut/issues/328)); temporary sessions write nothing (`sceneLink.integration.test.tsx`); filter and copy rules (`documentLibrary.test.ts`) | Manual checklist | Automated evidence ready; manual validation pending |
| LEO-003 — Library folders | Folder storage, 0.2.0 parsing rules on an index written by 0.3.0, a 0.2.0 index at the root, a graph saved from 0.2.0 moved to the root, names with `/`, limits, rename, move and delete with their failures (`libraryFolders.test.ts`, 14 tests); nesting, collapsed state per browser, filter, other tab, non-empty deletion, drag and drop, read-only Examples tree, temporary session (`libraryFolders.integration.test.tsx`, 11 tests) | Manual checklist | Automated evidence ready; manual validation pending |
| LEO-004 — Library archive | ZIP reading and writing, CRC, unsafe paths, encryption, ZIP64, expansion and size bounds, manifest as a hint, invalid entries, collisions into `Imported YYYY-MM-DD`, full storage (`libraryArchive.test.ts`, 22 tests); export, import, drop, rejection without write, temporary session (`libraryArchive.integration.test.tsx`, 4 tests) | Manual export and import across two browsers | Automated evidence ready; manual validation pending |
| LEO-005 — Examples and first run | Every shipped example in the current canonical format byte for byte and opened without diagnostics, with a showcase per algebra (`examples.test.ts`); first run and algebra switch load the showcase (`showcase.integration.test.tsx`); showcases evaluate and draw (`showcase.test.ts`); [#270](https://github.com/eharquin/gamut/issues/270) closed | Manual checklist; link from P2D-001 in the [PGA 2D Foundation record](pga-2d-foundation.md) | Automated evidence ready; manual validation pending |
| LEO-006 — Expression folders | Tree, names and limits, moves of rows and folders by pointer and keyboard, undo and redo, collapsed state outside history, appearance overwrite, migrations (`expressionFolders.test.ts`, 42 tests); keyboard and pointer workflows, slash trigger, auto-scroll (`expressionFolders.integration.test.tsx`, 17 tests); round trip and migrations (`canonicalDocument.test.ts`) | Keyboard folder operations in the manual checklist | Automated evidence ready; manual validation pending |
| LEO-007 — Comment rows | Inline Markdown subset, rejected link schemes, literal mathematical text and dollars, escapes, linear parsing time (`annotationText.test.ts`, 12 tests); blocks, never HTML (`annotationBlocks.test.ts`, 11 tests); kind switching with one undo, safe links, mathematics, names and dependencies (`commentRows.integration.test.tsx`, 15 tests); version 8 → 9 migration (`canonicalDocument.test.ts`) | Screen-reader check | Automated evidence ready; manual validation pending |
| LEO-008 — Hidden values | Single, scalar and list values hidden and announced, diagnostics and controls kept, undo and redo, export, library and scene links (`hiddenValues.test.tsx`, 7 tests); version 7 → 8 migration (`canonicalDocument.test.ts`) | Screen-reader check | Automated evidence ready; manual validation pending |
| LEO-009 — Saving during playback | One and several playing sliders stopped on save, stopped values saved, the graph kept saved, undo as after a manual pause (`App.test.tsx`, *saving while sliders play (#265)*) | Manual check | Automated evidence ready; manual validation pending |
| LEO-010 — Coordinate tuples and weighted points | Algebra-neutral tuples and arity diagnostics (`parseExpression.test.ts`, `lowerExpression.test.ts`, `evaluateDocument.test.ts`); tuples rewritten in place and weighted points edited without their weight (`constructorLiteralEdit.test.ts`); weighted drag coordinates (`viewportCreation.test.ts`); language §7 and the PGA requirements updated with [#180](https://github.com/eharquin/gamut/issues/180) and [#181](https://github.com/eharquin/gamut/issues/181) | Manual checklist | Automated evidence ready; manual validation pending |
| LEO-011 — Compatibility | Migrations from format 1 to 13, byte-stable (`canonicalDocument.test.ts`); version 6 VGA and PGA canvases drawn exactly as before (`appearanceRendering.test.tsx`, SVG snapshots); `*.multivector.json` and historical storage keys (`App.test.tsx`, `documentStorage.test.ts`); 0.2.0 library indexes (`libraryFolders.test.ts`); scene links (`sceneLink.test.ts`); downgrade limitation ([#275](https://github.com/eharquin/gamut/issues/275)) in the [release notes](../releases/0.3.0.md) | Open 0.1.0 and 0.2.0 documents, a 0.2.0 scene link and a 0.2.0 library on the deployed application | Automated evidence ready; manual validation pending |
| LEO-012 — Accessibility and release | `npm run verify` passed on the release commit `7f6cebe` (typecheck, lint, 72 test files, 1481 tests, build); release workflow [44831792704](https://github.com/eharquin/gamut/actions/runs/44831792704) verified and deployed `v0.3.0` | Manual checklist below on the supported browsers; [PGA 2D Foundation record](pga-2d-foundation.md) complete ([#192](https://github.com/eharquin/gamut/issues/192)); release checklist below | Automated evidence ready; manual validation pending |
| LEO-013 — Embed mode | Frame detection, options and Open in GAMUT address (`embedMode.test.ts`, 10 tests); canvas only, dragging, fullscreen, theme, background, invalid scene (`embedMode.integration.test.tsx`, 9 tests); storage spies in both modes, with a control (`embedStorage.integration.test.tsx`) | Manual check in a Slides.com iframe block below | Automated evidence ready; manual validation pending |

## Specification ownership

Issue #272 owns this record, the milestone document, the prefix registry, and
the cross-cutting changes to the
[design requirements](../design-requirements.md),
[document format](../specifications/document-format.md),
[limits and interaction constants](../specifications/limits-and-constants.md),
and [scene links](../specifications/scene-links.md). Feature issues update
the specifications of their own behavior; #272 checks them before acceptance.

- [ ] Language §7, VEC-001, PGA-VIZ-003, the PGA convention, and a PGA tuple
  requirement (#180, #181).
- [ ] Language §1 and §3 with the Markdown subset (#187).
- [ ] Document format §2.4 layout and the version 8 history row (#83, #191).
- [ ] Folder and archive limits confirmed or revised (#83, #267, #268).
- [ ] Field names of the version 8 item folder list and collapsed-state record (#83), and the SEC-010 rejection diagnostic codes (#268), recorded in the specifications.
- [ ] User documentation: README and the in-app expression reference (tuples
  and `#` comments).

## Supported-browser and environment record

Record exact versions. A browser that cannot be tested is listed as untested
and is not claimed as supported merely because it is expected to work. The
0.2.0 statement is the starting point: current Chrome and Firefox on Linux
and Safari on macOS.

| Browser | Version | Operating system | Pointer or input setup | Result |
| --- | --- | --- | --- | --- |
| Google Chrome | — | Linux | Mouse | Pending |
| Mozilla Firefox | — | Linux | Mouse or trackpad | Pending |
| Safari | — | macOS | Trackpad | Pending |
| Microsoft Edge | — | — | — | Untested; not claimed |

- Tester:
- Test date:
- Revision tested (release build, `npm run preview`):

## Manual workflow checklist

To be completed on every browser in the table above, on the release build.

- [ ] First launch with empty storage opens the default algebra's showcase,
  identical to its example in **Examples**; switching algebra loads that
  algebra's showcase.
- [ ] **Library** opens the panel on **My library** with focus inside it, the
  viewport resizes, and closing returns focus to **Library**; every 0.2.0
  library action still works, with its confirmations in the panel.
- [ ] Open an example, edit it, and confirm it is unbound; **Add to my library**
  stores a copy under the example's folder path.
- [ ] Create, rename, nest, collapse, and delete library folders; move a graph
  by menu, by keyboard, and by drag and drop; use a folder name containing
  `/`; filter by All, VGA, and PGA; reload and find the collapsed state
  again; delete a non-empty folder and confirm that the confirmation counts
  the graphs deleted with its subfolders.
- [ ] Export the library, import it in another browser or profile, by
  **Import library** and by dropping the `.zip`; find every graph in
  `Imported YYYY-MM-DD` with its folders and nothing overwritten. Import a
  modified archive with an invalid document and read the summary.
- [ ] Open a scene link: **My library** states that the session is temporary,
  **Import library** and a dropped `.zip` are refused with a message,
  **Export library** works, and nothing is written until an explicit save;
  **Add to my library** copies the scene into the library, opens the copy,
  and ends the temporary session.
- [ ] Open a scene link: no banner is shown, the header names the graph
  “Shared scene (temporary)”, and **Save** shows the unsaved-changes dot;
  **Save** asks for a name, stores the copy in the library, opens it, ends the
  session, and removes the scene fragment from the address (#287).
- [ ] Create nested expression folders, move rows in and out by pointer and
  keyboard, undo and redo; confirm that an empty name and a duplicate name in
  the same parent are refused; collapse a folder and see the dot on **Save**
  without a history entry; reload, export, import, and copy a link, and
  find the folders and their collapsed state again.
- [ ] Type `# note` with bold, italic, inline code, an `https` link, and a
  `javascript:` link; confirm the rendering, the link destination, Tab order,
  and that removing `#` restores evaluation in one undo.
- [ ] Turn **Show multivector values** off: no coefficients remain, the
  screen reader announces hidden values, and descriptions, diagnostics,
  controls, and the drawing are unchanged; share the document by link and
  reopen it with values hidden.
- [ ] Play a slider, save while it plays: playback stops, the dot disappears
  and stays hidden, and the announcement mentions saving.
- [ ] Write `(2, 1)` in VGA(2), `(2, 1)` and `(4, 2, 2)` in PGA(2); drag the
  weighted point and an ideal `point(x, y, 0)`, and confirm the rewritten
  sources keep their spelling and weight.
- [ ] Open the 0.1.0 and 0.2.0 regression documents and a 0.2.0 scene link
  unchanged; after running 0.2.0 in the same profile, open 0.3.0 and confirm
  the 0.2.0 library is listed with every graph.
- [ ] Paste a scene link, unchanged, into a Slides.com iframe block (16:9) and
  present: no header, notice, or panel is shown; the canvas fills the block
  and follows a resize of the block; a vector or point can be dragged;
  **Open in GAMUT** opens the same scene in the full application in a new
  tab; **Fullscreen** is offered and works when the host allows it, and its
  absence is recorded otherwise; the controls are reachable with Tab (#215).
- [ ] Narrow the window below 720 px: the library panel opens as an
  overlay, closes on Escape, and returns focus to **Library**; nothing else
  collapses.
- [ ] Repeat the keyboard, focus, accessible-name, screen-reader, 200 % zoom,
  and reduced-motion checks for the library panel, both kinds of folders,
  comment rows, and hidden values.

## Release checklist

- [ ] Every issue of the [0.3.0 milestone](https://github.com/eharquin/gamut/milestone/4)
  is closed, and the PGA 2D Foundation record is complete (#192).
- [x] `npm run verify` passes on the release commit (`7f6cebe`).
- [x] The package version, `CHANGELOG.md`, `CITATION.cff`, and
  [release notes](../releases/0.3.0.md) are updated together; the release
  notes state the downgrade limitation of #275 ([#334](https://github.com/eharquin/gamut/pull/334)).
- [ ] This record and the milestone status are changed to **Accepted** only
  after all required evidence is present.
- [ ] After publication: the release workflow run, deployed URL, revision,
  tester, and date are recorded below, and the documented workflow is
  repeated on the deployed application.

- Workflow: [44831792704](https://github.com/eharquin/gamut/actions/runs/44831792704) (verify and deploy, both successful)
- Deployed URL: <https://eharquin.github.io/gamut/>
- Revision: `v0.3.0` (`7f6cebe`)
- Tester and date:
