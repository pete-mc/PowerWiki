// Copies text to the clipboard, resilient to the cross-origin extension iframe.
//
// `navigator.clipboard.writeText` requires the `clipboard-write` permission
// policy, which the host Azure DevOps <iframe> does not delegate to the
// extension — so the async API rejects and copy silently fails. We fall back to
// a hidden <textarea> + document.execCommand("copy"), which works from within a
// user gesture even when the async Clipboard API is unavailable.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission policy blocks the async API in the iframe — fall through.
    }
  }
  return execCommandCopy(text);
}

function execCommandCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Keep it out of view and non-scrolling, but still selectable.
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0";

  const selection = document.getSelection();
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  }

  document.body.removeChild(textarea);

  // Restore any selection the copy clobbered.
  if (savedRange && selection) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }

  return succeeded;
}
