const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");

module.exports = {
  entry: {
    powerwiki: path.resolve(__dirname, "src/extension/main.tsx")
  },
  output: {
    clean: true,
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    // The extension runs in a sandboxed, cross-origin ADO iframe. Async chunk
    // loading (webpack's default for dynamic import()) is unreliable there, and
    // mermaid v11 dynamically imports its diagram/layout modules — which crashes
    // inside the iframe. "auto" lets webpack infer the CDN base at runtime.
    publicPath: "auto"
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"]
  },
  module: {
    // Bundle every dynamic import() into the main chunk instead of emitting
    // separate async chunks. This makes mermaid's layout/diagram modules load
    // synchronously (as they do in a plain browser), eliminating the async
    // chunk-loading failures that break mermaid rendering in the ADO iframe.
    parser: {
      javascript: {
        dynamicImportMode: "eager"
      }
    },
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"]
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "public"),
          to: path.resolve(__dirname, "dist")
        }
      ]
    })
  ]
};

