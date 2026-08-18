import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The renderer sanitizes with DOMPurify, which needs a DOM.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The VS Code UI suite is Mocha running inside a real VS Code window
    // (`npm run test:vscode`); it imports the `vscode` module, which only
    // exists there. Vitest would otherwise try to collect it and fail to
    // resolve that import.
    exclude: ["**/node_modules/**", "src/vscode/test/**"],
  },
});
