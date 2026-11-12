import { fullApplicationUrl } from '../application/embedMode'
import { useFullscreen } from '../hooks/useFullscreen'

/**
 * The only controls of embed mode (#215), laid over the canvas: a link that
 * opens the same scene in the full application in a new tab, and fullscreen
 * when the host allows it.
 */
export function EmbedControls() {
  const fullscreen = useFullscreen()
  return (
    <div className="embed-controls" role="group" aria-label="Embedded scene">
      <a
        className="embed-command embed-open"
        href={fullApplicationUrl(window.location.href)}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this scene in GAMUT in a new tab"
      >
        Open in GAMUT
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9 2.5h4.5V7M13.5 2.5 7 9M12 10v3.5H2.5V4H6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      {fullscreen.available && <button
        type="button"
        className="embed-command"
        aria-label={fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
        onClick={fullscreen.toggle}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d={fullscreen.active
              ? 'M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5'
              : 'M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10'}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>}
    </div>
  )
}

/** Embed mode shows no notices, so a scene that cannot be shown says so here. */
export function EmbeddedSceneUnavailable({ message }: { message: string }) {
  return (
    <div className="embed-unavailable">
      <p role="alert">{message}</p>
      <EmbedControls />
    </div>
  )
}
