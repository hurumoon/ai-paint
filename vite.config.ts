import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { transform } from "esbuild";
import { resolve } from "path";
import { execSync } from "child_process";

const CONSOLE_METHODS = ["log", "debug", "info", "warn", "error", "trace"] as const;
const CONSOLE_PURE_CALLS = CONSOLE_METHODS.flatMap((method) => [
  `console.${method}`,
  `window.console.${method}`,
  `globalThis.console.${method}`,
]);

function stripConsoleCallsPlugin(enabled: boolean): PluginOption {
  return {
    name: "strip-console-calls",
    apply: "build",
    async renderChunk(code) {
      if (!enabled || !code.includes("console.")) return null;
      const result = await transform(code, {
        loader: "js",
        target: "esnext",
        minifySyntax: true,
        minifyIdentifiers: false,
        minifyWhitespace: false,
        pure: CONSOLE_PURE_CALLS,
      });
      return {
        code: result.code,
        map: null,
      };
    },
  };
}

function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function getGitHashFull(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ command, mode }) => {
  const stripProductionLogs = command === "build" && mode === "production";

  return {
    plugins: [react(), stripConsoleCallsPlugin(stripProductionLogs)],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
    },
    envPrefix: ["VITE_", "TAURI_"],
    resolve: {
      alias: {
        util: resolve(__dirname, "src/core/nodeUtilBrowserShim.ts"),
      },
    },
    define: {
      __APP_GIT_HASH__: JSON.stringify(getGitHash()),
      __APP_GIT_HASH_FULL__: JSON.stringify(getGitHashFull()),
    },
    build: {
      target: "esnext",
      minify: "esbuild",
      sourcemap: !!process.env.TAURI_DEBUG,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          chat: resolve(__dirname, "chat.html"),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");
            if (normalizedId.endsWith("/src/core/composite.ts")) {
              return "composite";
            }
          },
        },
      },
    },
  };
});
