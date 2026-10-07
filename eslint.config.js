import { createBudmonEslintConfig } from "@budmon/config/eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.data/**",
      "**/.tools/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  ...createBudmonEslintConfig({ tsconfigRootDir: import.meta.dirname }),
];
