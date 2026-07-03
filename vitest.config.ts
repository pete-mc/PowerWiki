import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The renderer sanitizes with DOMPurify, which needs a DOM.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
