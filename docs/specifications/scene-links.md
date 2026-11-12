# Self-contained scene links

Scene links carry a complete [canonical document](document-format.md) in the
URL fragment. They require no backend or stored document identifier. Use
the **Copy link** icon button of the header, after **Import** and **Export**
and before the theme and settings buttons. Clipboard denial leaves selectable text available for manual
copying.

## Version 1 envelope

```text
https://eharquin.github.io/gamut/#scene=1.deflate-raw.<sha256>.<base64url>
```

The `scene` key is literal and appears once. Its value has four dot-separated
fields:

1. Envelope version `1`, independent of `formatVersion` and `languageVersion`.
2. Encoding: `deflate-raw` (RFC 1951) or `json` (uncompressed UTF-8 JSON).
3. SHA-256 of the payload bytes, as 64 lowercase hexadecimal characters.
4. Payload bytes as canonical, unpadded base64url, with no whitespace.

The payload is the complete canonical JSON, including document and item
identities, algebra, interpretation, sources, controls, appearance, viewport,
and theme. JSON property order is canonicalized before compression. Equivalent
documents produce the same link in a given browser implementation. Different
conforming DEFLATE implementations may produce different valid compressed
bytes; document identity is defined by the decoded canonical JSON.

The encoder uses `CompressionStream('deflate-raw')`. It selects `json` when
compression would increase size or would exceed the 64:1 decoding ratio.
Compression and decompression use browser APIs; no compression dependency is
bundled. Library archives (STORE-017) reuse the same `deflate-raw` stream and
keep this statement true. Missing Web Crypto or compression support produces a textual
diagnostic and leaves JSON import/export available. SHA-256 detects corruption;
it does not authenticate the author, so the document is still untrusted input.

Unknown fragment options are ignored. The display options of
[embed mode](#embed-mode) (`embed`, `theme`, `lock`) are read next to `scene`
and never change the canonical document, whose theme is preserved.

## Validation and limits

Before parsing the envelope or decoding its payload, enforce the
[64 KiB encoded fragment limit](limits-and-constants.md). This counts every
character after `#`, including unknown options. Then validate the version,
encoding, checksum syntax, and canonical base64url. Verify integrity before
decompression. Read decompressed output incrementally, enforcing both the
4 MiB decoded-byte limit and the 64:1 expansion ratio before assembling JSON.
Uncompressed payloads pass through the same strict UTF-8, duplicate-key,
migration, canonical schema, and resource-limit checks as JSON imports.
Resolve the algebra before displaying the shared document. A failed step
never supplies a partial document to the editor.

Links longer than 8 KiB (complete URL) produce a compatibility warning.
That is a warning threshold, not an asserted Slides.com limit. Oversized
fragments produce `LIMIT_SHARE_ENCODED_SIZE` and direct the user to JSON
export; they never produce a truncated link. The maximum URL accepted by
Slides.com's iframe field remains to be measured in an authenticated host
session. JSON export remains the archival alternative.

## Temporary sessions and storage

On initial navigation to a scene link, decode and validate before mounting the
editor. A valid shared scene never reads the active document, the viewport-lock
preference, or the collapsed-panel preference, and never writes browser storage, even during editing, import,
theme changes, or viewport manipulation. It therefore works with blocked or
partitioned storage. Edits do not rewrite the URL; copying another link
captures the current edits. Reloading the original URL reopens its original
scene.

An invalid link displays its diagnostic and retains the existing active
document when it can be restored, otherwise the normal initial example. This
fallback session also disables automatic writes. The application shows no
banner in a temporary session ([#287](https://github.com/eharquin/gamut/issues/287)):
the name “Shared scene (temporary)” and the dot on **Save** show that nothing
is stored. The header **Save** button explicitly stores the current document in
the local library under the name it asks for, with a new document identity,
and enables ordinary autosave after success. Before it
writes, and before **Open** or **New** in the library panel end the session,
the previously saved active document is stored in the local library if it is
not there yet, so that it is never overwritten; if that fails, the session
stays temporary. Opening the library panel reads storage but writes nothing.
The header shows “Shared scene (temporary)” as the graph name until then. It keeps the undo history and removes the scene
fragment from the address, so reloading opens the saved copy. A failed save retains the temporary session and JSON
export. No separate local-library implementation is introduced here.

### Library panel in a temporary session

The library panel (STORE-014) replaces the library menu of release 0.2.0.
In a temporary session it behaves as follows:

- **My library** lists the stored graphs and states that the open scene is
  temporary and not stored. Opening a graph ends the session as **Open**
  does above.
- Opening an example from **Examples** behaves like opening a library graph:
  the previously saved active document is stored in the library first when it
  is not there yet, then the example opens unbound from any library entry
  (STORE-015) and the session ends; if that write fails, the session stays
  temporary and the scene stays open.
- **Add to my library** in **My library** copies the scene. It is an explicit
  write and behaves like **Save**
  ([#266](https://github.com/eharquin/gamut/issues/266)): the previously saved
  active document is protected in the same way, then the scene is copied into
  the library with a new document identity, the copy opens, and the temporary
  session ends.
- **Add to my library** on an example copies the example, not the scene: the
  previously saved active document is protected in the same way, the copy is
  stored in the library with a new document identity, and the scene stays
  open, temporary, and unsaved; the active document and the address are not
  written ([#266](https://github.com/eharquin/gamut/issues/266)).
- **Import library**, and dropping a `.zip` file, are unavailable: they report
  that a temporary session does not write the library, and write nothing
  ([#268](https://github.com/eharquin/gamut/issues/268)). **Export library**
  only reads storage and stays available.
- Collapsing or expanding a library folder does not write its per-browser
  preference (STORE-016). Collapsing an expression folder changes the shared
  document like any other edit (DOC-013) and does not rewrite the URL.

## Embedding and scope

The application generates no iframe snippet. Slides.com accepts a plain HTTPS
URL in its iframe source field, so the scene link is enough to embed a scene;
actual host integration and host-specific URL-length limits require a host
test ([Slides.com iframe documentation](https://slides.com/docs/iframe-blocks)).
An embedded link opens in [embed mode](#embed-mode). Viewport scalar sliders
belong to #190. Native slides, a `postMessage` API, and release-pinned hosting
are outside #213 and #215.
The browser compression format is specified by the
[Compression Standard](https://compression.spec.whatwg.org/).

## Embed mode

Embed mode (STORE-019, [#215](https://github.com/eharquin/gamut/issues/215))
shows a scene inside a presentation iframe with the canvas alone.

### Activation

Embed mode turns on automatically when GAMUT runs inside a frame
(`window.self !== window.top`; a top window that cannot be read counts as a
frame), so scene links already pasted in presentations need no change. The
fragment overrides the detection:

| Option | Effect |
|---|---|
| `embed=1` | Forces embed mode outside a frame, for testing in a tab. |
| `embed=0` | Turns embed mode off inside a frame: the full editor opens. |
| `theme=light` or `theme=dark` | Overrides the document theme for this view; the document is unchanged. |
| `lock=1` | Opens with the viewport locked: no pan or zoom by pointer, wheel, or keyboard, and no zoom controls, while objects stay draggable. |

Options sit next to `scene`, in any order, for example
`#scene=1.deflate-raw.…&embed=1&lock=1`. They are read without decoding the
scene payload. Unknown options and unknown values are ignored without
error, and a repeated option counts by its first occurrence. The 64 KiB
fragment limit counts them. An `autoplay` option is not implemented: playback
state is not part of the document, and embed mode offers no control to pause
an animation (A11Y-004).

### What is shown

The viewport fills the frame and follows its size, at any frame size. There
is no header, notice, diagnostic banner, expression panel, library panel, or
panel toggle, and sliders are not shown until #190 places them in the
viewport. As a consequence, no animation can start in embed mode until #190
or an `autoplay` option exists.

Free objects stay draggable by pointer and keyboard. Base anchoring gestures
remain, since they are viewport manipulations: dragging a base onto another
object anchors it, Enter cycles the anchor candidates, and Delete or Backspace
unlinks an anchored base. The viewport can be panned and zoomed by pointer,
wheel, and keyboard unless `lock=1` is set; the viewport toolbar keeps
**Zoom in**, **Zoom out**, and **Recenter view**, for touch screens without
pinch zoom, and drops the lock, the square-canvas command, and the zoom field.
With `lock=1` the toolbar is hidden. Undo and redo shortcuts still apply.
Double-clicking the viewport creates nothing, and dropping a file opens
nothing.

Two discreet controls sit in the bottom-right corner, after the canvas in the
keyboard order:

- **Open in GAMUT**, a link that opens the full application in a new tab with
  the same `scene` entry and no display option, so the scene opens as an
  ordinary temporary session. Edits made in the frame are not carried. It is
  absent without a `scene` entry, since the application would then open the
  viewer's own active document rather than what the frame shows.
- **Enter fullscreen** / **Exit fullscreen**, shown only when the host allows
  fullscreen (`document.fullscreenEnabled`, which an iframe grants with
  `allowfullscreen`). It toggles fullscreen for the whole page.

### Storage

Embed mode never reads or writes browser storage: no active document, library,
viewport-lock, panel, or reference preference. It works when storage is
blocked or throws. Without a `scene` entry it shows the default example and
writes nothing. A scene that fails validation shows a plain sentence with its
diagnostic code in parentheses, as an alert, with **Open in GAMUT**, instead
of falling back on the active document as the full editor does.
