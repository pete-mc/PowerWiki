import { useEffect, useRef, useState } from "react";

import { useThemeMode } from "../app/themeMode";
import type { FullScreenProvider } from "../host/WikiHost";
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
  /** The host's full-screen mode, used while the dialog is maximized. */
  readonly fullScreen?: FullScreenProvider;
}

/**
 * Hosts the draw.io editor for a new or existing diagram. The editor itself runs
 * in an iframe (see drawioEmbed); this component owns the surrounding chrome,
 * the diagram title, and the save/close lifecycle.
 */
export function DrawioEditorDialog({ target, busy, error, onSave, onClose, fullScreen }: DrawioEditorDialogProps) {
  const frameHostRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
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

  // Maximized, the dialog fills the extension's frame edge to edge, and the
  // host hides its own chrome around the frame where it can.
  const hostWasFullScreen = useRef<boolean>(undefined);
  useEffect(() => {
    let current = true;
    void fullScreen
      ?.isFullScreen()
      .then((value) => {
        if (current) {
          hostWasFullScreen.current = value;
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [fullScreen]);

  // Restoring, or closing the dialog, hands the host back its chrome — unless
  // the host was already full screen, which is the user's choice to keep.
  useEffect(() => {
    if (!maximized || !fullScreen || hostWasFullScreen.current) {
      return;
    }
    void fullScreen.setFullScreen(true).catch(() => undefined);
    return () => {
      void fullScreen.setFullScreen(false).catch(() => undefined);
    };
  }, [fullScreen, maximized]);

  // Escape restores a maximized dialog, and otherwise closes it, matching the
  // other PowerWiki dialogs.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (maximized) {
        setMaximized(false);
      } else if (!busy) {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, maximized]);

  const message = error ?? loadError;

  return (
    <div
      className={`wiki-export-overlay powerwiki-drawio-overlay${maximized ? " is-maximized" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="powerwiki-drawio-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="wiki-export-header">
          <h2>{isNew ? "New diagram" : "Edit diagram"}</h2>
          <div className="powerwiki-drawio-header-actions">
            <button
              aria-label={maximized ? "Restore" : "Maximize"}
              aria-pressed={maximized}
              className="powerwiki-drawio-maximize"
              onClick={() => setMaximized(!maximized)}
              title={maximized ? "Restore (Esc)" : "Maximize"}
              type="button"
            >
              {maximized ? "\u2921" : "\u2922"}
            </button>
            <button aria-label="Close" className="wiki-export-close" disabled={busy} onClick={onClose} type="button">
              &times;
            </button>
          </div>
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
