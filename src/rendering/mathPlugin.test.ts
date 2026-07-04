import { describe, expect, it } from "vitest";

import { createMarkdownRenderer } from "./createMarkdownRenderer";

const md = createMarkdownRenderer();

describe("mathPlugin", () => {
  it("tokenizes inline $...$ math into a placeholder carrying the TeX", () => {
    const html = md.render("Euler: $e^{i\\pi}+1=0$ done.");
    expect(html).toContain('data-powerwiki-math="inline"');
    expect(html).toContain("e^{i");
  });

  it("tokenizes $$...$$ into a display-math placeholder", () => {
    const html = md.render("$$\\int_0^1 x\\,dx$$");
    expect(html).toContain('data-powerwiki-math="display"');
  });

  it("does not treat plain currency as math", () => {
    const html = md.render("It costs $5 and $10.");
    expect(html).not.toContain("data-powerwiki-math");
  });
});
