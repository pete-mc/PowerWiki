// Build for the VS Code extension (`vscode/`).
//
// Separate from webpack.config.js because the targets genuinely differ: the
// extension entry runs in Node with `vscode` provided by the runtime, while the
// webview entry is a browser bundle. What they share — the loader rules — is
// factored out rather than duplicated, so a change to how TypeScript or CSS is
// handled applies to both hosts at once.

const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");

const outputPath = path.resolve(__dirname, "vscode/dist");

// Same options as the Azure DevOps build: transpile only, with `tsc --noEmit`
// (run by `npm test`) doing the type checking. See AGENTS.md.
const typescriptRule = {
  test: /\.tsx?$/,
  loader: "esbuild-loader",
  options: {
    // Keep in step with tsconfig.json ("target" and "jsx").
    target: "es2022",
    jsx: "automatic"
  },
  exclude: /node_modules/
};

const resolve = { extensions: [".tsx", ".ts", ".js"] };

/** The Node half: activation, the custom editor, and the filesystem wiki client. */
const extensionConfig = {
  name: "extension",
  target: "node",
  entry: { extension: path.resolve(__dirname, "src/vscode/extension.ts") },
  output: {
    clean: true,
    filename: "[name].js",
    libraryTarget: "commonjs2",
    path: outputPath
  },
  // Supplied by the VS Code runtime, never bundled.
  externals: { vscode: "commonjs vscode" },
  resolve,
  module: { rules: [typescriptRule] },
  devtool: "nosources-source-map"
};

/** The webview half: the same React app the Azure DevOps hub renders. */
const webviewConfig = {
  name: "webview",
  target: "web",
  dependencies: ["extension"],
  entry: {
    "powerwiki-vscode": path.resolve(__dirname, "src/vscode/webview/main.tsx")
  },
  output: {
    filename: "[name].js",
    chunkFilename: "[name].[contenthash].js",
    // Resolves async chunks (Mermaid) against the running script's own URL,
    // which in a webview is a vscode-resource URI — nothing else would work,
    // since a webview's document has an opaque origin.
    publicPath: "auto",
    path: outputPath
  },
  resolve,
  module: {
    rules: [
      typescriptRule,
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
      {
        test: /\.(ttf|woff2?)$/,
        type: "asset/resource",
        generator: { filename: "assets/[name][ext]" }
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        // Monaco's AMD build, loaded at runtime from a webview URI rather than
        // bundled (see src/app/wiki/monacoLoader.ts).
        {
          from: path.resolve(__dirname, "node_modules/monaco-editor/min/vs"),
          to: path.join(outputPath, "vs")
        },
        { from: path.resolve(__dirname, "media/logo_new.png"), to: path.join(outputPath, "media") }
      ]
    })
  ],
  performance: {
    // The bundle carries Monaco's workers, KaTeX and the Markdown pipeline; the
    // size warning is expected and is not a build failure. Same as the hub.
    hints: false
  }
};

/**
 * The UI test harness: a launcher that runs outside VS Code and a Mocha suite
 * that runs inside it. Bundled like everything else so there is no second
 * TypeScript toolchain to keep in step, with the test-only libraries left
 * external — they are dev dependencies resolved from node_modules at run time
 * and have no business inside the shipped extension.
 */
const testConfig = {
  name: "test",
  target: "node",
  dependencies: ["extension"],
  entry: {
    "test/runTests": path.resolve(__dirname, "src/vscode/test/runTests.ts"),
    "test/suite/index": path.resolve(__dirname, "src/vscode/test/suite/index.ts")
  },
  output: {
    filename: "[name].js",
    libraryTarget: "commonjs2",
    path: outputPath
  },
  externals: {
    vscode: "commonjs vscode",
    mocha: "commonjs mocha",
    "@vscode/test-electron": "commonjs @vscode/test-electron"
  },
  resolve,
  module: { rules: [typescriptRule] },
  devtool: "nosources-source-map"
};

module.exports = [extensionConfig, webviewConfig, testConfig];
