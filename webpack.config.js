const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");

module.exports = (_env, argv) => ({
  entry: {
    powerwiki: path.resolve(__dirname, "src/extension/main.tsx"),
    // The local sandbox (src/sandbox/main.tsx) runs the UI against an in-memory
    // wiki with no Azure DevOps SDK. It is a development tool, so it is left out
    // of production builds entirely and never reaches the packaged extension —
    // `files` in vss-extension.json publishes all of dist/.
    ...(argv.mode === "production"
      ? {}
      : { sandbox: path.resolve(__dirname, "src/sandbox/main.tsx") })
  },
  output: {
    clean: true,
    filename: "[name].js",
    chunkFilename: "[name].[contenthash].js",
    // "auto" makes webpack resolve async chunk URLs from the running script's
    // own location (document.currentScript). The extension is served from the
    // marketplace CDN under dist/, and the whole dist/ folder is published, so
    // Mermaid's lazily-loaded chunk is fetched from that same-origin CDN path.
    publicPath: "auto",
    path: path.resolve(__dirname, "dist")
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"]
  },
  module: {
    rules: [
      {
        // Transpile only. TypeScript 7 is the native compiler port and no longer
        // exposes the JS compiler-host API that ts-loader drove, so ts-loader
        // fails outright against it. Types are not lost: `npm test` runs
        // `tsc --noEmit` over the whole project as a separate step, and
        // `isolatedModules` in tsconfig.json guarantees every file can be
        // transpiled on its own — which is exactly what this loader does.
        test: /\.tsx?$/,
        loader: "esbuild-loader",
        options: {
          // Keep these in step with tsconfig.json ("target" and "jsx").
          target: "es2022",
          jsx: "automatic"
        },
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"]
      },
      {
        test: /\.(ttf|woff2?)$/,
        type: "asset/resource",
        generator: {
          filename: "assets/[name][ext]"
        }
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "public"),
          to: path.resolve(__dirname, "dist"),
          globOptions: {
            // sandbox.html loads sandbox.js, which only exists in development
            // builds. Copying it into a production build would publish a dead
            // page inside the extension.
            ignore: argv.mode === "production" ? ["**/sandbox.html"] : []
          }
        },
        {
          from: path.resolve(__dirname, "node_modules/monaco-editor/min/vs"),
          to: path.resolve(__dirname, "dist/vs")
        }
      ]
    })
  ]
});
