# Limits and Interaction Constants

**Status:** Draft for review
**Date:** 2026-07-27
**Applies to:** Initial language and VGA 2D workflow
**Refines:** SEC-004 through SEC-007, SEC-010, SEC-011, CMD-005, CMD-006,
DOC-013, STORE-016, A11Y-007, and A11Y-012
**License:** MIT

## 1. Purpose and evolution

This document owns initial resource limits and shared interaction constants.
Limits are checked at the earliest point where the bounded quantity is known.
Crossing a limit produces the listed diagnostic without a partial or truncated
mathematical result.

A limit may increase compatibly. Decreasing a limit in a way that would reject a
previously valid document requires an explicit format or language migration and
shall preserve lossless recovery and export. Implementations may use lower
warning thresholds but shall not fail below these normative limits.

## 2. Documents and source

| Quantity | Limit | Diagnostic |
| --- | ---: | --- |
| Encoded shared fragment | 64 KiB | `LIMIT_SHARE_ENCODED_SIZE` |
| Decoded shared or imported JSON | 4 MiB | `LIMIT_DOCUMENT_DECODED_SIZE` |
| Decompression expansion ratio | 64:1 | `LIMIT_DECOMPRESSION_RATIO` |
| Items per document | 1,000 | `LIMIT_ITEM_COUNT` |
| Source characters per source property | 65,536 | `LIMIT_SOURCE_LENGTH` |
| Migration steps during one load | 32 | `LIMIT_MIGRATION_STEPS` |

The encoded fragment limit counts characters after `#`. The decoded limit
counts UTF-8 bytes before JSON parsing. JSON export remains available when a
valid document exceeds the sharing limit.

Every item source, position source, control-bound source, and appearance source
is a separate source property for the source-length limit. The decoded document limit also bounds
metadata, appearance, parameters, and view state.

### 2.1 Folders

**Proposed for 0.3.0** ([#272](https://github.com/eharquin/gamut/issues/272)):
the values below may change through review until
[#83](https://github.com/eharquin/gamut/issues/83) and
[#267](https://github.com/eharquin/gamut/issues/267) land. Expression folders
(DOC-013) and library folders (STORE-016) share one folder model and these
limits.

| Quantity | Limit | Diagnostic |
| --- | ---: | --- |
| Folder nesting depth, a root-level folder being depth 1 | 8 | `LIMIT_FOLDER_DEPTH` |
| Expression folders per document | 256 | `LIMIT_FOLDER_COUNT` |
| Folders in the local library | 1,000 | `LIMIT_FOLDER_COUNT` |
| Characters per folder name | 128 | `LIMIT_FOLDER_NAME_LENGTH` |

Folders do not count towards the 1,000 items per document. A folder name is
counted in Unicode code points. Loading a document over a folder limit fails
validation like any other resource limit; an interactive command that would
cross one is refused without changing the document or the library.

### 2.2 Library archives

**Proposed for 0.3.0** ([#272](https://github.com/eharquin/gamut/issues/272)):
the values below may change through review until
[#268](https://github.com/eharquin/gamut/issues/268) lands. They bound the
import of a library archive (STORE-018, SEC-010).

| Quantity | Limit | Diagnostic |
| --- | ---: | --- |
| Archive file size | 32 MiB | `LIMIT_ARCHIVE_SIZE` |
| Entries per archive, including directories and the manifest | 2,048 | `LIMIT_ARCHIVE_ENTRIES` |
| UTF-8 bytes per entry path | 1,024 | `LIMIT_ARCHIVE_PATH_LENGTH` |
| Decompressed bytes per document entry | 4 MiB | `LIMIT_DOCUMENT_DECODED_SIZE` |
| Decompressed bytes of the manifest | 1 MiB | `LIMIT_ARCHIVE_MANIFEST_SIZE` |
| Total decompressed bytes per archive | 64 MiB | `LIMIT_ARCHIVE_DECODED_SIZE` |
| Decompression expansion ratio per entry | 64:1 | `LIMIT_DECOMPRESSION_RATIO` |

The archive file size is checked before the file is read. Decompressed sizes
and the expansion ratio are counted while inflating each entry, as for scene
links, and never taken from the sizes the archive declares. A document entry
then enters the raw JSON import pipeline of the
[document format](document-format.md#4-validation-and-migration). Folder
depth and folder name length apply to the directories of an entry path.
Crossing the manifest limit discards the manifest with a warning, since the
manifest is only a hint (SEC-011); crossing any other limit rejects the whole
archive. Browser storage quotas are usually far below the total decompressed
limit; a quota failure during import is reported under STORE-018 rather than
treated as a limit.

## 3. Parsing and dependency analysis

| Quantity | Limit | Diagnostic |
| --- | ---: | --- |
| Tokens per source property | 32,768 | `LIMIT_TOKEN_COUNT` |
| AST depth | 128 | `LIMIT_AST_DEPTH` |
| AST nodes per source property | 32,768 | `LIMIT_AST_NODE_COUNT` |
| Direct dependencies per graph node | 256 | `LIMIT_DEPENDENCIES` |
| Dependency edges per document | 100,000 | `LIMIT_DEPENDENCY_EDGES` |

AST depth counts the root as depth one. Duplicate references from one node to
the same target form one dependency edge. Limits are enforced before dependency
traversal or recursive evaluation.

## 4. Evaluation and generated values

| Quantity | Limit | Diagnostic |
| --- | ---: | --- |
| Elements generated by one expression | 10,000 | `LIMIT_GENERATED_VALUES` |
| Generated element records per document evaluation | 100,000 | `LIMIT_DOCUMENT_VALUES` |
| Stored non-zero coefficients in one owned value | 100,000 | `LIMIT_COEFFICIENT_COUNT` |
| Deterministic work units per document evaluation | 10,000,000 | `LIMIT_EVALUATION_WORK` |
| Generator count accepted by the common engine boundary | 32 | `LIMIT_GENERATOR_COUNT` |
| Formatted result characters per item | 1 MiB | `LIMIT_FORMATTED_RESULT` |

The range limit in the language specification is an application of the
per-expression generated-value limit. Algebra definitions may declare stricter
configuration or operation limits under ALG-019, but shall expose them before
engine construction or expensive expansion.

A work unit is charged for each AST-node evaluation, dependency-edge traversal,
generated list element, and owned coefficient read or write. An engine
capability shall publish an additional deterministic cost formula for an
operation whose work is not bounded by those charges. Wall-clock duration is
not a work unit.

Coefficient limits count explicitly stored non-zero terms, not the cardinality
of a possible dense basis. Implementations shall predict product expansion and
charge or reject it before allocation when possible.

## 5. Rendering

| Quantity | Limit | Diagnostic |
| --- | ---: | --- |
| Rendered list elements per visual item | 1,000 | `LIMIT_RENDER_ELEMENTS` |
| Render primitives per frame | 20,000 | `LIMIT_RENDER_PRIMITIVES` |

Rendering may omit elements beyond these limits because omission does not alter
the evaluated mathematical result. The visualizer shall preserve the prefix
order, report the exact omitted count, and keep the complete value available for
textual inspection and export.

### 5.1 Appearance settings

The numeric appearance settings of the
[document format](document-format.md) accept a value in these inclusive
ranges. A source whose value falls outside its range, or is not a finite real
scalar, uses the default of the object kind and reports a diagnostic on the
setting; the document stays valid.

| Setting | Unit | Range | Default |
| --- | --- | ---: | --- |
| Stroke width | reference px | 0.25 to 10 | object kind |
| Point size | reference px | 1 to 20 | object kind |
| Opacity | % | 0 to 100 | 100 |
| Label angle | degrees | −180 to 180 | 0 |
| Label size | reference px | 6 to 36 | 13 |
| Label distance | reference px | 0 to 40 | object kind |

Pixel values are multiplied by the document's object scale.

## 6. Interaction constants

The two-dimensional viewport uses 72 reference pixels per mathematical unit
after reset. Interactive zoom is clamped from 0.001 through 1,000,000 reference
pixels per unit. This range covers a 1,000,000-unit overview in a
1,000-reference-pixel canvas and resolves features near one millionth of a
unit at close inspection. Its adaptive grid targets 72 reference pixels
between major lines, selects the next spacing from the 1–2–5 × 10^n
progression, subdivides major steps into four or five intervals, and generates
no more than 256 lines per axis. Wheel zoom uses a continuous exponential scale
and preserves the mathematical coordinate under the pointer.

Coordinates written by the viewport retain approximately one reference screen
pixel at the active zoom. Their decimal precision is
`round(log10(pixelsPerUnit))`, clamped from zero through eight decimal places:
two decimals from about 32 through 316 pixels per unit, one more for each
further tenfold zoom in, one fewer for each tenfold zoom out. The rule applies
to objects created by double-click, to base, head, and literal-point drags,
to arrow-key moves, and to the coordinates announced after an arrow-key move,
so one object never mixes precisions. Line coefficients are written with a
ten times finer step, refined further by the anchor's distance from the
origin, so that rotating a line about an anchor stays smooth and the anchor
stays on the line. Trailing zeroes are removed and negative zero is
serialized as `0`. Literals already in a document are rewritten only when the
viewport moves the object that holds them.

The library panel (STORE-014) is docked beside the viewport above a width
breakpoint and opens as an overlay over the viewport below it (A11Y-012). The
breakpoint value is open, decided in
[#266](https://github.com/eharquin/gamut/issues/266).

Document history retains at most 100 complete pre-command document snapshots.
When the limit is exceeded, the oldest snapshot is discarded first. Undo and
redo stacks are transient application state and are never serialized.

Repeated keyboard changes to the same property coalesce when successive accepted
changes are no more than 750 milliseconds apart. The events named by CMD-005 and
CMD-006 terminate coalescence regardless of elapsed time.

## 7. Accessible-name policy

Hiding a visual label does not remove the corresponding entity's accessible
name. A visual entity uses, in order:

1. its explicit item name;
2. its entity-type name followed by its one-based document position;
3. for a list element, the owning item name or fallback followed by its
   zero-based element index.

The accessible description conveys visibility, evaluation state, and any
creation refusal or truncation reason. Repeated elements shall have distinct
names. Decorative primitives are hidden from the accessibility tree.
