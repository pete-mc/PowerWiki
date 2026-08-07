/**
 * Minimal client for the draw.io embed protocol.
 *
 * The editor runs in an iframe on embed.diagrams.net and talks over
 * postMessage with JSON payloads (`proto=json`). Diagram data never leaves the
 * browser — the host sends the source in and gets the edited result back, so
 * nothing is uploaded to diagrams.net. The iframe is only created while the
 * editor dialog is open; viewing a page never loads it.
 *
 * The flow this module drives:
 *   1. editor -> host  {event:"init"}          the editor is ready
 *   2. host -> editor  {action:"load", xml}    XML, or a .drawio.png data URL
 *   3. user presses Save
 *      editor -> host  {event:"save"}
 *   4. host -> editor  {action:"export", format:"xmlpng"}
 *      editor -> host  {event:"export", data}  PNG data URL with XML embedded
 *   5. editor -> host  {event:"exit"}          the user closed the editor
 */

const EMBED_ORIGIN = "https://embed.diagrams.net";

/** Exported at 2x so diagrams stay crisp on high-DPI screens and in exports. */
const EXPORT_SCALE = 2;

/** How long to wait for the editor to load before giving up. */
const INIT_TIMEOUT_MS = 30000;

/** How long to wait for an export to come back after the user presses Save. */
const EXPORT_TIMEOUT_MS = 30000;

export interface DrawioSessionOptions {
  /** Element the editor iframe is appended to. */
  readonly container: HTMLElement;
  /**
   * What to open: the draw.io XML source, a `.drawio.png` data URL, or nothing
   * for a blank canvas. A stored diagram is passed as its data URL — draw.io
   * reads the XML back out of the PNG's metadata.
   */
  readonly initial?: string;
  readonly dark: boolean;
  /** Called with a `.drawio.png` data URL each time the user saves. */
  readonly onSave: (pngDataUrl: string) => void;
  /** Called when the user closes the editor. */
  readonly onExit: () => void;
  /** Called when the editor fails to load or an export fails. */
  readonly onError: (message: string) => void;
}

export interface DrawioSession {
  /** Tears down the iframe and stops listening. Safe to call more than once. */
  dispose(): void;
}

function embedUrl(dark: boolean): string {
  const params = new URLSearchParams({
    embed: "1",
    proto: "json",
    spin: "1",
    libraries: "1",
    // Keep the editor's own Save button — it is the affordance users expect —
    // and let the host close the dialog when the save completes.
    saveAndExit: "0",
    ui: dark ? "dark" : "kennedy",
  });
  return `${EMBED_ORIGIN}/?${params.toString()}`;
}

/**
 * Opens a draw.io editor in `container`. The returned session must be disposed
 * when the host dialog closes.
 */
export function startDrawioSession(options: DrawioSessionOptions): DrawioSession {
  const iframe = document.createElement("iframe");
  iframe.className = "powerwiki-drawio-frame";
  iframe.title = "draw.io diagram editor";
  iframe.setAttribute("frameborder", "0");

  let disposed = false;
  let initialized = false;
  let exportTimer: number | undefined;

  const initTimer = window.setTimeout(() => {
    if (!initialized && !disposed) {
      options.onError("The draw.io editor did not load. Check network access to embed.diagrams.net.");
    }
  }, INIT_TIMEOUT_MS);

  function post(message: unknown): void {
    iframe.contentWindow?.postMessage(JSON.stringify(message), EMBED_ORIGIN);
  }

  function onMessage(event: MessageEvent): void {
    // Only trust messages from this iframe, on the expected origin.
    if (disposed || event.origin !== EMBED_ORIGIN || event.source !== iframe.contentWindow) {
      return;
    }

    let payload: { event?: string; data?: string };
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }

    switch (payload.event) {
      case "init":
        initialized = true;
        window.clearTimeout(initTimer);
        post({ action: "load", autosave: 0, xml: options.initial ?? "" });
        break;

      case "save":
        // The editor reports a save; ask for the PNG-with-embedded-XML that we
        // actually store, and hand it back once it arrives.
        window.clearTimeout(exportTimer);
        exportTimer = window.setTimeout(() => {
          if (!disposed) {
            options.onError("Timed out exporting the diagram.");
          }
        }, EXPORT_TIMEOUT_MS);
        post({ action: "export", format: "xmlpng", scale: EXPORT_SCALE });
        break;

      case "export":
        window.clearTimeout(exportTimer);
        if (payload.data) {
          options.onSave(payload.data);
        } else {
          options.onError("The draw.io editor returned an empty diagram.");
        }
        break;

      case "exit":
        options.onExit();
        break;

      default:
        break;
    }
  }

  window.addEventListener("message", onMessage);
  iframe.src = embedUrl(options.dark);
  options.container.appendChild(iframe);

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      window.clearTimeout(initTimer);
      window.clearTimeout(exportTimer);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    },
  };
}
