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
| LEO-001 — Interface boundary | — | Extraction pull requests of [#274](https://github.com/eharquin/gamut/issues/274) with their `App.tsx` line counts; `npm run verify` after each step; new panels and rows outside `App.tsx`; smoke test of the VGA and PGA workflows | Pending |
| LEO-002 — Library panel | — | Panel, sections, actions, and temporary-session tests ([#266](https://github.com/eharquin/gamut/issues/266)); manual checklist | Pending |
| LEO-003 — Library folders | — | Folder tests, including the 0.2.0 parsing rules on an index written by 0.3.0, a 0.2.0 index at the root, and a graph saved from 0.2.0 ([#267](https://github.com/eharquin/gamut/issues/267)); manual checklist | Pending |
| LEO-004 — Library archive | — | Round-trip, invalid-entry, collision, quota, drop, temporary-session, and SEC-010 boundary tests ([#268](https://github.com/eharquin/gamut/issues/268)); manual export and import across two browsers | Pending |
| LEO-005 — Examples and first run | — | Test that every shipped example is in the current canonical format and opens without diagnostics; first-run and algebra-switch tests ([#270](https://github.com/eharquin/gamut/issues/270), [#217](https://github.com/eharquin/gamut/issues/217)); link from P2D-001 in the [PGA 2D Foundation record](pga-2d-foundation.md) | Pending |
| LEO-006 — Expression folders | — | Move, undo, collapsed-state, round-trip, and migration tests ([#83](https://github.com/eharquin/gamut/issues/83)); keyboard folder operations in the manual checklist | Pending |
| LEO-007 — Comment rows | — | Kind-switching, undo, and Markdown fixtures, including rejected link schemes and literal mathematical text ([#187](https://github.com/eharquin/gamut/issues/187)); screen-reader check | Pending |
| LEO-008 — Hidden values | — | Setting tests for single, scalar, and list values and every round trip ([#191](https://github.com/eharquin/gamut/issues/191)); screen-reader check | Pending |
| LEO-009 — Saving during playback | — | Tests with one and several playing scalars ([#265](https://github.com/eharquin/gamut/issues/265)); manual check | Pending |
| LEO-010 — Coordinate tuples and weighted points | — | Tuple and weighted-drag fixtures in both algebras; language §7, VEC-001, PGA-VIZ-003, PGA convention, and PGA tuple requirement updated ([#180](https://github.com/eharquin/gamut/issues/180), [#181](https://github.com/eharquin/gamut/issues/181)) | Pending |
| LEO-011 — Compatibility | — | Regression fixtures: 0.1.0 and 0.2.0 documents, 0.2.0 scene links, a 0.2.0 library snapshot; version 8 migration tests; downgrade limitation ([#275](https://github.com/eharquin/gamut/issues/275)) in the release notes | Pending |
| LEO-012 — Accessibility and release | — | Manual checklist below on the supported browsers; `npm run verify` on the release commit; [PGA 2D Foundation record](pga-2d-foundation.md) complete ([#192](https://github.com/eharquin/gamut/issues/192)); release checklist below | Pending |

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
- [ ] Narrow the window below 720 px: the library panel opens as an
  overlay, closes on Escape, and returns focus to **Library**; nothing else
  collapses.
- [ ] Repeat the keyboard, focus, accessible-name, screen-reader, 200 % zoom,
  and reduced-motion checks for the library panel, both kinds of folders,
  comment rows, and hidden values.

## Release checklist

- [ ] Every issue of the [0.3.0 milestone](https://github.com/eharquin/gamut/milestone/4)
  is closed, and the PGA 2D Foundation record is complete (#192).
- [ ] `npm run verify` passes on the release commit.
- [ ] The package version, `CHANGELOG.md`, `CITATION.cff`, and
  [release notes](../releases/0.3.0.md) are updated together; the release
  notes state the downgrade limitation of #275.
- [ ] This record and the milestone status are changed to **Accepted** only
  after all required evidence is present.
- [ ] After publication: the release workflow run, deployed URL, revision,
  tester, and date are recorded below, and the documented workflow is
  repeated on the deployed application.

- Workflow:
- Deployed URL:
- Revision:
- Tester and date:
