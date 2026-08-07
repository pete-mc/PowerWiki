import { useEffect, useRef, useState } from "react";

import { useThemeMode } from "../app/themeMode";
import { diagramTitle } from "./drawioDiagram";
import { startDrawioSession } from "./drawioEmbed";

export interface DrawioEditorTarget {
  /** Wiki path of the diagram being edited; absent when creating a new one. */
  readonly path?: string;
  /** The existing diagram as a `.drawio.png` data URL, for editing. */
  readonly dataUrl?: string;
}

interface DrawioEditorDialogProps {
  readonly target: DrawioEditorTarget;
  /** True while the saved diagram is being uploaded. */
  readonly busy: boolean;
  readonly error?: string;
  /** Receives the exported `.drawio.png` data URL and the diagram's title. */
  readonly onSave: (pngDataUrl: string, title: string) => void;
  readonly onClose: () => void;
}

/**
 * Hosts the draw.io editor for a new or existing diagram. The editor itself runs
 * in an iframe (see drawioEmbed); this component owns the surrounding chrome,
 * the diagram title, and the save/close lifecycle.
 */
export function DrawioEditorDialog({ target, busy, error, onSave, onClose }: DrawioEditorDialogProps) {
  const frameHostRef = useRef<HTMLDivElement>(null);
  const isNew = !target.path;
  const [title, setTitle] = useState(target.path ? diagramTitle(target.path) : "Diagram");
  const [loadError, setLoadError] = useState<string>();
  const themeMode = useThemeMode();

  // Keep the latest title and handlers reachable from the session's callbacks
  // without restarting the editor (which would discard the user's work).
  const titleRef = useRef(title);
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    titleRef.current = title;
    onSaveRef.current = onSave;
    onCloseRef.current = onClose;
  }, [onClose, onSave, title]);

  // The editor session is started once per open dialog. Theme is read at start:
  // restarting on a mid-edit theme change would throw away unsaved work.
  useEffect(() => {
    const host = frameHostRef.current;
    if (!host) {
      return;
    }

    const session = startDrawioSession({
      container: host,
      dark: themeMode === "dark",
      initial: target.dataUrl,
      onSave: (pngDataUrl) => onSaveRef.current(pngDataUrl, titleRef.current),
      onExit: () => onCloseRef.current(),
      onError: (message) => setLoadError(message),
    });

    return () => session.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once per dialog
  }, []);

  // Escape closes the dialog, matching the other PowerWiki dialogs.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy]);

  const message = error ?? loadError;

  return (
    <div className="wiki-export-overlay" role="dialog" aria-modal="true">
      <div className="powerwiki-drawio-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="wiki-export-header">
          <h2>{isNew ? "New diagram" : "Edit diagram"}</h2>
          <button aria-label="Close" className="wiki-export-close" disabled={busy} onClick={onClose} type="button">
            &times;
          </button>
        </div>

        <div className="powerwiki-drawio-bar">
          <label htmlFor="powerwiki-drawio-title">Name</label>
          <input
            disabled={!isNew || busy}
            id="powerwiki-drawio-title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Diagram name"
            type="text"
            value={title}
          />
          <span className="powerwiki-drawio-hint">
            {busy
              ? "Saving diagram…"
              : "Save in the draw.io toolbar to store the diagram in this wiki."}
          </span>
        </div>

        {message ? (
          <p className="wiki-export-error" role="alert">
            {message}
          </p>
        ) : null}

        <div className="powerwiki-drawio-frame-host" ref={frameHostRef} />
      </div>
    </div>
  );
}
