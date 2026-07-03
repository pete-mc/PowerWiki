import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <ErrorBoundary>
          <span>ok</span>
        </ErrorBoundary>
      );
    });
    expect(container.textContent).toContain("ok");
    act(() => root.unmount());
  });

  it("shows a labelled fallback with the error message when a child throws", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    // React logs caught errors to console.error; silence it for this case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      root.render(
        <ErrorBoundary label="preview">
          <Boom />
        </ErrorBoundary>
      );
    });
    expect(container.textContent).toContain("Something went wrong in the preview");
    expect(container.textContent).toContain("kaboom");
    spy.mockRestore();
    act(() => root.unmount());
  });
});
