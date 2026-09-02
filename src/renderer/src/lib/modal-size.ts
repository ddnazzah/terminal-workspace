export interface Size {
  width: number
  height: number
}

/** Fraction of the viewport the modal takes when the user has not resized it. */
const WIDTH_RATIO = 0.92
const HEIGHT_RATIO = 0.92

/** Never smaller than this, or the editor stops being usable. */
const MIN_WIDTH = 420
const MIN_HEIGHT = 300

/**
 * Widest the editor goes on its own. Beyond roughly this, lines get long
 * enough to hurt readability, so extra screen width is left as margin rather
 * than spent on the editor.
 */
const MAX_AUTO_WIDTH = 1800

/** Margin kept around the modal so it never meets the window edge. */
const EDGE_MARGIN = 40

/**
 * Size for the file modal, given the viewport and any previously saved size.
 *
 * With no saved size the modal is proportional to the screen, so a larger
 * display genuinely gets a larger editor instead of the old fixed 900×600.
 *
 * A saved size is respected, but it is clamped to fit the current viewport —
 * and grown if it is far smaller than the screen now allows, which is what
 * happens when a size saved on a laptop is reopened on a much larger display.
 * A saved size that is merely a bit smaller than the proportional default is
 * treated as a deliberate choice and left alone.
 */
export function modalSizeFor(viewport: Size, saved: Size | null): Size {
  const auto = {
    width: clamp(
      Math.round(viewport.width * WIDTH_RATIO),
      MIN_WIDTH,
      Math.min(MAX_AUTO_WIDTH, viewport.width - EDGE_MARGIN)
    ),
    height: clamp(
      Math.round(viewport.height * HEIGHT_RATIO),
      MIN_HEIGHT,
      viewport.height - EDGE_MARGIN
    ),
  }

  if (!saved || saved.width < MIN_WIDTH || saved.height < MIN_HEIGHT) {
    return auto
  }

  // "Far smaller" = under 70% of what the screen now affords. Below that the
  // saved value is almost certainly a leftover from a smaller display rather
  // than a preference worth preserving.
  const outgrown = saved.width < auto.width * 0.7

  if (outgrown) {
    return auto
  }

  return {
    width: clamp(saved.width, MIN_WIDTH, viewport.width - EDGE_MARGIN),
    height: clamp(saved.height, MIN_HEIGHT, viewport.height - EDGE_MARGIN),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

/**
 * Clamp an explicitly chosen size to the viewport.
 *
 * Used while dragging the resize handle. Unlike {@link modalSizeFor} this
 * never grows the result: the user dragging the modal small on a large display
 * is a deliberate choice, and snapping it back to the proportional default
 * would make the handle feel broken.
 */
export function clampModalSize(viewport: Size, size: Size): Size {
  return {
    width: clamp(size.width, MIN_WIDTH, viewport.width - EDGE_MARGIN),
    height: clamp(size.height, MIN_HEIGHT, viewport.height - EDGE_MARGIN),
  }
}
