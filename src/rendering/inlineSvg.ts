// Inserting SVG markup that came from a service.
//
// Work item type icons arrive from Azure DevOps as SVG source, and both the
// query table and the linked-work-items panel need to put them in the document.
// Parsing as `image/svg+xml` and importing the parsed root — rather than
// assigning `innerHTML` — keeps a malformed or hostile response from becoming
// arbitrary markup: anything that is not a well-formed `<svg>` is dropped.

/** Appends `svg` to `host`, or does nothing if it is not a well-formed SVG document. */
export function appendInlineSvg(host: HTMLElement, svg: string): void {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const element = doc.documentElement;
  if (element && element.nodeName.toLowerCase() === "svg" && !doc.querySelector("parsererror")) {
    host.appendChild(document.importNode(element, true));
  }
}
