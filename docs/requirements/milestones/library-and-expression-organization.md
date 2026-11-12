# Library and Expression Organization Milestone

**Status:** Draft for review
**Kind:** Product milestone
**Release:** [0.3.0](../../releases/0.3.0.md)
**Depends on:** PGA 2D Foundation (release 0.2.0), whose acceptance record is
completed by [#192](https://github.com/eharquin/gamut/issues/192)
**Acceptance:** [Library and Expression Organization Acceptance Record](../../acceptance/library-and-expression-organization.md)
**Applies:** STORE-013 through STORE-018; DOC-001 through DOC-014; ANIM-003,
ANIM-004, and ANIM-006; CMD-001 through CMD-008; APP-006; SEC-001, SEC-002,
SEC-007, and SEC-010 through SEC-012; A11Y-001 through A11Y-014;
VIEW2D-008; [language §3 and §7](../../specifications/language.md); VEC-001,
PGA-VIZ-003, and the PGA tuple requirement as amended by
[#180](https://github.com/eharquin/gamut/issues/180) and
[#181](https://github.com/eharquin/gamut/issues/181)
**Date:** 2026-11-12

## Objective

Turn the local graph library of 0.2.0 into a browsable library with personal
graphs and shipped examples, and give longer documents structure: folders in
the library and in the expression panel, comment rows, and a setting that
hides values for teaching. Make the coordinate tuple belong to the active
algebra, so that `(x, y)` is a vector in VGA(2) and a point in PGA(2).

The milestone is judged on three properties as much as on its features: one
folder model shared by the expression panel, the library, and the archive;
compatibility of the three storage formats it touches (the canonical document
moves to format version 8, the library index stays version 1, and the
library archive is new); and new interface written outside `App.tsx`.

## Required workflow

A user, without developer tools, shall be able to:

- open the library panel from **Library**, browse **My library** and
  **Examples**, open a graph or an example, and add an example to **My
  library**;
- organize **My library** in nested folders, move graphs between folders by
  menu and by drag and drop, filter the panel by algebra, and browse the
  fixed folder tree of **Examples**;
- export the whole library as a `.zip` archive and import it, by **Import
  library** or by dropping the file, into another browser, finding the graphs
  in an `Imported YYYY-MM-DD` folder with nothing overwritten;
- start the application for the first time, or switch algebra, and get the
  algebra's showcase, identical to its example in **Examples**;
- group expressions in named, nested, collapsible folders, move rows into and
  out of them, and find the collapsed state again after reload, export, and a
  scene link;
- write a comment row starting with `#`, with bold, italic, inline code, and
  safe links;
- hide the values under the expressions from the display menu, and share a
  document whose values are hidden;
- save while a slider plays and see the graph saved at the value where the
  animation stopped;
- write `(x, y)` for a VGA(2) vector, `(x, y)` and `(x, y, w)` for PGA(2)
  points, and drag a weighted point `point(x, y, w)` or `(x, y, w)` while its
  weight is kept;
- do all of the above by keyboard, with a screen reader, at 200 % zoom, and in
  a narrow window, and in a temporary shared-scene session without writing
  browser storage except through an explicit save.

Folder appearance overrides and draw order
([#273](https://github.com/eharquin/gamut/issues/273)), the rest of the
`App.tsx` split ([#173](https://github.com/eharquin/gamut/issues/173)),
per-algebra numerical policies
([#68](https://github.com/eharquin/gamut/issues/68)), protection of an older
release against a newer format
([#275](https://github.com/eharquin/gamut/issues/275)), mobile browsers and
touch input ([#120](https://github.com/eharquin/gamut/issues/120)),
mathematical notation in comments, and revealing a single hidden value are
excluded.

## Completion criteria

- **LEO-001 — Interface boundary:** The expression row, the header and its
  document commands, and scalar playback are extracted from `App.tsx`
  without behavior change, and the library panel, folder, comment-row, and
  hidden-value interfaces are separate components and hooks
  ([#274](https://github.com/eharquin/gamut/issues/274)).
- **LEO-002 — Library panel:** The library panel satisfies STORE-014 and
  A11Y-010: it opens on **My library**, keeps every 0.2.0 library action,
  filters by algebra (All, VGA, PGA), resizes the viewport instead of
  covering it at 720 CSS pixels and above, and behaves as specified in a
  temporary session
  ([#266](https://github.com/eharquin/gamut/issues/266)).
- **LEO-003 — Library folders:** Folders in **My library** and **Examples**
  satisfy STORE-016 and A11Y-011. Tests show that an index written by 0.3.0
  keeps every entry under the 0.2.0 parsing rules, that a 0.2.0 index opens
  unchanged at the root, that a graph saved from 0.2.0 moves to the root, and
  cover the `folder` name lists, names containing `/`, empty folders in
  `gamut.library.v1.folders`, moves, and the deletion of a non-empty folder
  with its graphs and subfolders
  ([#267](https://github.com/eharquin/gamut/issues/267)).
- **LEO-004 — Library archive:** Export and import satisfy STORE-017,
  STORE-018, SEC-010, and SEC-011. Tests cover an export–import round trip
  with folders, invalid documents skipped and reported, identity collisions,
  the manifest as an untrusted hint, the `Imported YYYY-MM-DD` folder, a full quota, a dropped `.zip`, the
  temporary-session refusal, and every rejection and limit of SEC-010 at its
  boundary ([#268](https://github.com/eharquin/gamut/issues/268)).
- **LEO-005 — Examples and first run:** The shipped VGA(2) and PGA(2)
  examples satisfy STORE-015. A test fails if an example is not in the
  current canonical format or opens with diagnostics; the first run and the
  algebra switch load exactly the showcase example, and `App.tsx` imports no
  algebra-specific document or module
  ([#270](https://github.com/eharquin/gamut/issues/270),
  [#217](https://github.com/eharquin/gamut/issues/217)).
- **LEO-006 — Expression folders:** Expression folders satisfy DOC-013 and
  A11Y-011 under [document format §2.4](../../specifications/document-format.md#24-expression-folders).
  Tests cover moves into, out of, and within folders, refused empty and
  duplicate sibling names, undo and redo,
  collapsed state as an unsaved change without a history entry, canonical
  round trips, and flat documents that keep their order after migration
  ([#83](https://github.com/eharquin/gamut/issues/83)).
- **LEO-007 — Comment rows:** A row whose first non-whitespace character is
  `#` becomes an annotation and back in one undoable source edit, as language
  §3 specifies; its text renders under SEC-012 and A11Y-014, with fixtures for
  every Markdown rule, rejected link schemes, and mathematical text that stays
  literal ([#187](https://github.com/eharquin/gamut/issues/187)).
- **LEO-008 — Hidden values:** **Show multivector values** satisfies DOC-014
  and A11Y-013 for single, scalar, and list values, and round-trips through
  save, reload, export, import, the library, and scene links; a 0.2.0
  document opens with values visible
  ([#191](https://github.com/eharquin/gamut/issues/191)).
- **LEO-009 — Saving during playback:** Saving while one or several scalars
  play satisfies ANIM-006, and undo after saving behaves as after a manual
  pause ([#265](https://github.com/eharquin/gamut/issues/265)).
- **LEO-010 — Coordinate tuples and weighted points:** The tuple is resolved
  by the active algebra, with the arities, diagnostics, and
  spelling-preserving drags of #180; `point(x, y, w)` drags with its weight
  kept and `point(x, y, 0)` like an ideal point (#181). Language §7, VEC-001,
  PGA-VIZ-003, the PGA convention, and a PGA tuple requirement are updated by
  those issues, and existing VGA(2) and PGA(2) fixtures are unchanged.
- **LEO-011 — Compatibility:** Format version 8 migrates every earlier
  version. 0.1.0 and 0.2.0 (version 7) documents, 0.2.0 scene links, and a
  0.2.0 library snapshot from browser storage open unchanged as regression
  fixtures. The downgrade limitation of #275 is stated in the release notes.
- **LEO-012 — Accessibility and release:** The manual checklist of the
  acceptance record, including A11Y-012 in a narrow window and at 200 % zoom,
  passes on the supported browsers on the release build; `npm run verify`
  passes on the release commit; the PGA 2D Foundation acceptance record is
  complete (#192); and the package version, changelog, citation metadata, and
  release notes are updated together.

Completion claims an organized, shareable personal library with examples and
structured documents in the supported desktop browsers, not a collaborative
or synchronized library.

## Decisions

The design questions raised by this document were decided on 2026-11-12 in
[#83](https://github.com/eharquin/gamut/issues/83),
[#266](https://github.com/eharquin/gamut/issues/266),
[#267](https://github.com/eharquin/gamut/issues/267), and
[#268](https://github.com/eharquin/gamut/issues/268), and are stated in the
common requirements and specifications this milestone applies. The diagnostic
codes of the SEC-010 rejections, other than the limit codes, are chosen by
#268. The folder and archive limits of the
[limits and interaction constants](../../specifications/limits-and-constants.md#21-folders)
are proposed values, reviewed with this document.
