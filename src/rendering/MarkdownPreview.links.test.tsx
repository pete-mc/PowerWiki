// In-wiki links in the preview carry an absolute Azure DevOps URL.
//
// The preview runs in an iframe served from the extension's CDN, so a relative
// href resolves there: a plain click was intercepted and worked, but opening the
// link in a new tab, or copying it, led to an "Access Denied" page on
// `<publisher>.gallerycdn.vsassets.io`. The built-in wiki's links point back to
// dev.azure.com, and these now do too, while a plain click still navigates
// inside PowerWiki.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownPreview } from "./MarkdownPreview";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const buildPageLinkUrl = (path: string) => `https://dev.azure.com/org/project/_apps/hub/pub.ext.wiki?route=${path}`;

function render(markdown: string, { withUrls = true } = {}) {
  const onNavigate = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MarkdownPreview
        buildPageLinkUrl={withUrls ? buildPageLinkUrl : undefined}
        currentPath="/Ecosystem/Solution Architecture"
        markdown={markdown}
        onNavigate={onNavigate}
      />
    );
  });
  return { link: container.querySelector("a")!, onNavigate };
}

function click(link: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  act(() => {
    link.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("an in-wiki link", () => {
  it("has an absolute Azure DevOps href, resolved against the current page", () => {
    const { link } = render("[Sites](Environment-Strategy/Power-Pages-Sites)");

    expect(link.getAttribute("href")).toBe(
      "https://dev.azure.com/org/project/_apps/hub/pub.ext.wiki?route=/Ecosystem/Environment-Strategy/Power-Pages-Sites"
    );
  });

  it("keeps the path encoded, so a %2D hyphen is not lost on the way to the URL", () => {
    const { link } = render("[Rules](/List-%2D-Firewall-rules)");

    expect(link.getAttribute("href")).toContain("route=/List-%2D-Firewall-rules");
  });

  it("still navigates in place on a plain click", () => {
    const { link, onNavigate } = render("[Sites](/Ecosystem/Power-Pages-Sites)");

    expect(click(link).defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith("/Ecosystem/Power-Pages-Sites");
  });

  it("is left to the browser on a modified click, which opens the absolute URL", () => {
    const { link, onNavigate } = render("[Sites](/Ecosystem/Power-Pages-Sites)");

    expect(click(link, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("stays as written when the host cannot build a URL", () => {
    const { link, onNavigate } = render("[Sites](/Ecosystem/Power-Pages-Sites)", { withUrls: false });

    expect(link.getAttribute("href")).toBe("/Ecosystem/Power-Pages-Sites");
    click(link);
    expect(onNavigate).toHaveBeenCalledWith("/Ecosystem/Power-Pages-Sites");
  });
});

describe("links that are not to wiki pages", () => {
  it("leaves external links alone", () => {
    const { link } = render("[Docs](https://learn.microsoft.com/)");

    expect(link.getAttribute("href")).toBe("https://learn.microsoft.com/");
  });

  it("leaves attachment links alone", () => {
    const { link } = render("[Spec](/.attachments/spec.pdf)");

    expect(link.getAttribute("href")).toBe("/.attachments/spec.pdf");
  });

  it("leaves in-page fragment links alone", () => {
    const { link } = render("[Below](#below)");

    expect(link.getAttribute("href")).toBe("#below");
  });
});
