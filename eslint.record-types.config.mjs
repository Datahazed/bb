import tsParser from "@typescript-eslint/parser";
import { bbTypeRules } from "./scripts/eslint-rules/no-record-string-unknown.mjs";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/routeTree.gen.ts",
      "apps/app/**",
      "packages/core/src/generated/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { bb: bbTypeRules },
    rules: { "bb/no-record-string-unknown": "error" },
  },
];
