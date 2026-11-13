# Embedding a scene in a presentation

A GAMUT scene can be shown live in a presentation (Slides.com, reveal.js, or
any page that accepts an iframe). Inside an iframe, GAMUT shows the canvas
alone: no header, no expression panel, no library. This page lists what
controls how the embedded scene looks.

## 1. Get the scene link

1. Build the scene in GAMUT and arrange the view as it should appear.
2. Click **Copy link** in the header. The link looks like
   `https://eharquin.github.io/gamut/#scene=1.deflate-raw.…`.
3. Paste it as the address of an iframe:
   - **Slides.com**: add an *Iframe* block and paste the link.
   - **reveal.js or HTML**:

     ```html
     <iframe src="https://eharquin.github.io/gamut/#scene=1.deflate-raw.…"
             width="960" height="540" style="border:0"
             allow="fullscreen" title="GAMUT scene"></iframe>
     ```

Nothing has to be added to the link: GAMUT detects the iframe and switches to
the canvas-only view by itself.

## 2. What the link already carries

The link contains the whole scene as it was when **Copy link** was clicked.
To change any of these, change them in GAMUT, then copy the link again.

| What | Where to set it in GAMUT |
|---|---|
| Objects and their sources | The expression panel |
| Color, opacity, stroke, point style and size, labels of each object | The appearance menu of each row |
| Grid | **Settings** › Display › **Grid** |
| Axes and their labels | **Settings** › Display › **Axes and labels** |
| Graduations | **Settings** › Display › **Graduations** |
| Size of arrows, points and labels | **Settings** › Display › **Object scale** |
| Light or dark colors | **Settings** › Theme (*System*, *Light*, *Dark*) |
| Framing: center and zoom of the view | Pan and zoom the canvas before copying |

For example, a scene with only the objects and no background is made by
turning off **Grid**, **Axes and labels** and **Graduations** before copying
the link.

## 3. Options added at the end of the link

A few options can be appended to the link, after the scene, separated by `&`.
They change only how the embedded view is displayed, never the scene itself.

| Option | Effect |
|---|---|
| `theme=light` | Light colors, whatever the scene's theme. |
| `theme=dark` | Dark colors, whatever the scene's theme. |
| `lock=1` | Locks the view: no panning or zooming, and no zoom buttons. Objects can still be dragged. |
| `embed=1` | Shows the canvas-only view even outside an iframe, to preview it in a browser tab. |
| `embed=0` | Shows the full editor inside an iframe. |

Example, a dark scene with a fixed view:

```text
https://eharquin.github.io/gamut/#scene=1.deflate-raw.…&theme=dark&lock=1
```

Options can come in any order. An unknown option or value is ignored.

## 4. What the audience can do

- Drag the objects that can be moved, with the mouse or the keyboard.
- Pan and zoom the view with the mouse, the wheel, the keyboard, or the
  **+**, **−** and recenter buttons in the top-right corner (unless `lock=1`).
- **Open in GAMUT** (bottom-right corner) opens the full application with the
  original scene in a new tab. Changes made in the presentation are not
  carried over.
- **Fullscreen** (bottom-right corner) appears only when the page allows it,
  for example with `allow="fullscreen"` on the iframe.

Nothing is saved: the embedded scene never reads or writes the browser's
storage, so each viewer starts from the scene of the link.

## 5. Current limits

- Sliders are not shown in the embedded view yet, so parameters cannot be
  changed from the presentation and animations cannot be started
  ([#190](https://github.com/eharquin/gamut/issues/190)).
- The presentation page must be served over HTTPS (Slides.com is), or from
  `localhost` while testing; scene links need a secure page to open.
- Very large scenes make long links: GAMUT warns above 8 KiB and refuses links
  above 64 KiB. Use JSON export for those.
- An iframe keeps the keyboard while it has focus: click outside the scene, or
  change slide, to give the arrow keys back to the presentation.

The technical specification of scene links and embed mode is in
[Scene links](specifications/scene-links.md#embed-mode).
