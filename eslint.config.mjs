import js from "@eslint/js";

export default [
  {
    ignores: [
      "**/.cache/**",
      "**/.pnpm-store/**",
      "**/.turbo/**",
      "**/artifacts/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/vendor/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        Buffer: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
      },
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { "varsIgnorePattern": "^TEXT_ENCODER$" }],
    },
  },
];
