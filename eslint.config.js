import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.join(configDir, "src", "core");
const allowedCoreDynamicImports = new Set(["psdFormat"]);

function normalizeModulePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/\.[mc]?[jt]sx?$/, "");
}

const aiPaintRules = {
  rules: {
    "no-core-dynamic-import": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow lazy-loading app core modules directly.",
        },
        schema: [],
        messages: {
          coreDynamicImport:
            "src/core の中核モジュールは dynamic import しないでください。遅延化する場合は UI 境界で分割し、必要なら例外を eslint.config.js に明示してください。",
        },
      },
      create(context) {
        return {
          ImportExpression(node) {
            const rawSource = node.source;
            if (
              !rawSource ||
              rawSource.type !== "Literal" ||
              typeof rawSource.value !== "string" ||
              !rawSource.value.startsWith(".")
            ) {
              return;
            }

            const filename = context.filename ?? context.getFilename();
            const importedPath = path.resolve(
              path.dirname(filename),
              rawSource.value,
            );
            const relativeCorePath = normalizeModulePath(
              path.relative(coreDir, importedPath),
            );
            if (
              relativeCorePath.startsWith("..") ||
              path.isAbsolute(relativeCorePath) ||
              allowedCoreDynamicImports.has(relativeCorePath)
            ) {
              return;
            }

            context.report({
              node,
              messageId: "coreDynamicImport",
            });
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src-tauri/target"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.webworker,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "ai-paint": aiPaintRules,
      "react-hooks": reactHooks,
    },
    rules: {
      "ai-paint/no-core-dynamic-import": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-empty": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-useless-assignment": "off",
      "prefer-const": "error",
      "preserve-caught-error": "off",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
);
