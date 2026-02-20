import path from "node:path";
import { fileURLToPath } from "node:url";

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default {
  server: {
    headers,
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: path.resolve(rootDir, "index.html"),
        "examples/index": path.resolve(rootDir, "examples/index.html"),
        "examples/arrays/index": path.resolve(rootDir, "examples/arrays/index.html"),
        "examples/multiple-readers/index": path.resolve(rootDir, "examples/multiple-readers/index.html"),
        "examples/multiple-writers-lock/index": path.resolve(
          rootDir,
          "examples/multiple-writers-lock/index.html",
        ),
        "examples/nested-schema/index": path.resolve(rootDir, "examples/nested-schema/index.html"),
        "examples/webgl-canvas/index": path.resolve(rootDir, "examples/webgl-canvas/index.html"),
      },
    },
  },
};
