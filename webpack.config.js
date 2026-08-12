const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");

module.exports = {
  entry: {
    powerwiki: path.resolve(__dirname, "src/extension/main.tsx")
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
