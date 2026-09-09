// The geometry behind dragging an image's resize handles (GitHub #35).
//
// Kept separate from the editor because it is the part with rules - aspect
// ratio, minimum size, which edge moves which way - and those are worth
// testing without a DOM, a pointer, or a contenteditable.
//
// The result is written to the image's width/height attributes, which the
// `wikiImage` Turndown rule already turns into Azure DevOps' `=WxH` suffix. So
// resizing produces Markdown the built-in wiki renders identically; nothing new
// is stored.

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Below this an image is too small to grab a handle on again. */
export const MIN_IMAGE_SIZE = 24;

/** Whether dragging this handle keeps the image's proportions. */
export function preservesAspect(handle: ResizeHandle): boolean {
  return handle.length === 2;
}

/**
 * The size an image becomes when `handle` is dragged by (dx, dy) from `start`.
 *
 * Corners preserve the aspect ratio, driven by whichever axis the pointer moved
 * further on, so a diagonal drag does not fight the pointer. Edges resize their
 * own axis only, which is how you deliberately squash something.
 */
export function resizedSize(start: ImageSize, handle: ResizeHandle, dx: number, dy: number): ImageSize {
  const width = start.width + dx * horizontalSign(handle);
  const height = start.height + dy * verticalSign(handle);

  if (!preservesAspect(handle)) {
    return clamp({
      width: horizontalSign(handle) === 0 ? start.width : width,
      height: verticalSign(handle) === 0 ? start.height : height,
    });
  }

  const aspect = start.height === 0 ? 1 : start.width / start.height;
  // Follow the axis the pointer committed to; the other is derived, so the
  // image cannot drift out of proportion over a long drag.
  return clamp(
    Math.abs(dx) >= Math.abs(dy)
      ? { width, height: width / aspect }
      : { width: height * aspect, height }
  );
}

/** Rounds to whole pixels and keeps the image grabbable. */
function clamp(size: ImageSize): ImageSize {
  return {
    width: Math.max(MIN_IMAGE_SIZE, Math.round(size.width)),
    height: Math.max(MIN_IMAGE_SIZE, Math.round(size.height)),
  };
}

/** +1 when dragging this handle right grows the image, -1 when it shrinks it. */
function horizontalSign(handle: ResizeHandle): number {
  if (handle.endsWith("e")) {
    return 1;
  }
  return handle.endsWith("w") ? -1 : 0;
}

function verticalSign(handle: ResizeHandle): number {
  if (handle.startsWith("s")) {
    return 1;
  }
  return handle.startsWith("n") ? -1 : 0;
}
