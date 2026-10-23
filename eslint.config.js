// Supplies ESLint's standard JavaScript correctness rules.
import eslint from "@eslint/js";
// Builds ESLint's current flat configuration format.
import { defineConfig, globalIgnores } from "eslint/config";
// Detects incorrect React Hook usage and dependencies.
import reactHooks from "eslint-plugin-react-hooks";
// Protects React components used by Vite Fast Refresh.
import { reactRefresh } from "eslint-plugin-react-refresh";
// Parses TypeScript and supplies its recommended correctness rules.
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/src/generated/**"
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [eslint.configs.recommended]
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended
    ]
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite()
    ]
  }
);
