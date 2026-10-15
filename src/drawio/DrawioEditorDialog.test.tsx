// The Maximize toggle on the draw.io editor dialog. Diagramming needs every
// pixel, and in the hub most of the screen is Azure DevOps' own header and
// navigation, outside the extension's iframe, which only the host can hide.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FullScreenProvider } from "../host/WikiHost";
import { DrawioEditorDialog } from "./DrawioEditorDialog";

// The real session loads embed.diagrams.net in an iframe; nothing here needs it.
vi.mock("./drawioEmbed", () => ({
  startDrawioSession: () => ({ dispose: () => undefined }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function fakeFullScreen(initially = false) {
  let on = initially;
  const provider = {
    isFullScreen: vi.fn(() => Promise.resolve(on)),
    setFullScreen: vi.fn((value: boolean) => {
      on = value;
      return Promise.resolve();
    }),
  } satisfies FullScreenProvider;
  return { provider, isOn: () => on };
}

async function renderDialog(fullScreen?: FullScreenProvider, onClose = vi.fn()) {
  await act(async () => {
    root.render(
      <DrawioEditorDialog busy={false} fullScreen={fullScreen} onClose={onClose} onSave={() => undefined} target={{}} />
    );
  });
  return onClose;
}

const overlay = () => container.querySelector(".powerwiki-drawio-overlay") as HTMLElement;
const toggle = () => container.querySelector(".powerwiki-drawio-maximize") as HTMLButtonElement;
const isMaximized = () => overlay().classList.contains("is-maximized");

function click(button: HTMLButtonElement) {
  act(() => {
    button.click();
  });
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

describe("DrawioEditorDialog maximize", () => {
  it("hides the host's chrome while maximized, and gives it back on restore", async () => {
    const { provider, isOn } = fakeFullScreen();
    await renderDialog(provider);
    expect(isMaximized()).toBe(false);
    expect(isOn()).toBe(false);

    click(toggle());
    expect(isMaximized()).toBe(true);
    expect(isOn()).toBe(true);
    expect(toggle().getAttribute("aria-label")).toBe("Restore");

    click(toggle());
    expect(isMaximized()).toBe(false);
    expect(isOn()).toBe(false);
    expect(toggle().getAttribute("aria-label")).toBe("Maximize");
  });

  it("still fills the frame on a host with no chrome to hide", async () => {
    await renderDialog(undefined);
    click(toggle());
    expect(isMaximized()).toBe(true);
  });

  it("leaves a full screen the user already chose alone", async () => {
    const { provider, isOn } = fakeFullScreen(true);
    await renderDialog(provider);

    click(toggle());
    click(toggle());
    expect(provider.setFullScreen).not.toHaveBeenCalled();
    expect(isOn()).toBe(true);
  });

  it("restores on the first Escape and closes on the next", async () => {
    const { provider, isOn } = fakeFullScreen();
    const onClose = await renderDialog(provider);
    click(toggle());

    pressEscape();
    expect(isMaximized()).toBe(false);
    expect(isOn()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives the host its chrome back when the dialog closes maximized", async () => {
    const { provider, isOn } = fakeFullScreen();
    await renderDialog(provider);
    click(toggle());

    act(() => root.render(<></>));
    expect(isOn()).toBe(false);
  });
});
