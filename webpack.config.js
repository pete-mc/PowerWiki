const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");
const webpack = require("webpack");

module.exports = {
  entry: {
    powerwiki: path.resolve(__dirname, "src/extension/main.tsx")
  },
  output: {
    clean: true,
    filename: "[name].js",
    path: path.resolve(__dirname, "dist")
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
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
    // Azure DevOps extension iframes are served from the marketplace CDN. Keep
    // Mermaid's dynamically imported diagram modules in the main bundle so the
    // preview does not depend on runtime chunk loading from that sandbox.
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "public"),
          to: path.resolve(__dirname, "dist")
        },
        {
          from: path.resolve(__dirname, "node_modules/monaco-editor/min/vs"),
          to: path.resolve(__dirname, "dist/vs")
        }
      ]
    })
  ]
};
