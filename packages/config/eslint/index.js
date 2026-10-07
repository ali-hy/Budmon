// F-1: the Budmon ESLint flat config (LLD §4.1).
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import prettier from "eslint-config-prettier";
import formatjs from "eslint-plugin-formatjs";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import iconFromRegistry from "./rules/icon-from-registry.js";
import noPhysicalTailwind from "./rules/no-physical-tailwind.js";

const SERVER_SRC = "apps/server/src";
const MONEY_FILES = [
  `${SERVER_SRC}/**/*.ts`,
  "packages/shared/src/**/*.ts",
  "apps/web/src/**/*.{ts,tsx}",
];

const PINO = {
  name: "pino",
  message: "Import pino only under apps/server/src/platform/observability.",
};

const DRIZZLE_PATTERNS = ["drizzle-orm", "drizzle-orm/*"];

/**
 * @param {{ paths?: Array<string | { name: string; message?: string }>; patterns?: string[] }} extra
 * @returns {[string, { paths: Array<string | { name: string; message?: string }>; patterns: string[] }]}
 */
function restricted(extra) {
  return ["error", { paths: [PINO, ...(extra.paths ?? [])], patterns: extra.patterns ?? [] }];
}

const ROUTER_PATTERNS = [...DRIZZLE_PATTERNS, "**/db/**", "**/*Repo.js"];
const SERVICE_PATTERNS = [...DRIZZLE_PATTERNS, "**/db/client.js"];
const HTTP_PATTERNS = ["**/*Repo.js"];

/**
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import("eslint").Linter.Config[]}
 */
export function createBudmonEslintConfig({ tsconfigRootDir }) {
  return [
    ...tseslint.configs.strictTypeChecked.map((config) => ({
      ...config,
      files: config.files ?? ["**/*.{ts,tsx,mts,cts}"],
    })),
    {
      files: ["**/*.{ts,tsx,mts,cts}"],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    {
      files: ["**/*.{js,mjs,cjs}"],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
      plugins: { "eslint-comments": eslintComments },
      rules: {
        "eslint-comments/require-description": "error",
        "no-console": "error",
      },
    },
    // 1. Layering, and 2. logging (pino only under observability). `no-restricted-imports` is one
    // rule per file, so every block lists the pino restriction too.
    {
      files: [`${SERVER_SRC}/**/*.ts`],
      ignores: [`${SERVER_SRC}/platform/observability/**`],
      rules: { "no-restricted-imports": restricted({}) },
    },
    {
      files: [`${SERVER_SRC}/*/*Router.ts`],
      rules: { "no-restricted-imports": restricted({ paths: ["pg"], patterns: ROUTER_PATTERNS }) },
    },
    {
      files: ["**/*Service.ts"],
      rules: { "no-restricted-imports": restricted({ paths: ["pg"], patterns: SERVICE_PATTERNS }) },
    },
    {
      files: [`${SERVER_SRC}/platform/http/**/*.ts`],
      rules: { "no-restricted-imports": restricted({ patterns: HTTP_PATTERNS }) },
    },
    {
      files: [`${SERVER_SRC}/platform/http/**/*Service.ts`],
      rules: {
        "no-restricted-imports": restricted({
          paths: ["pg"],
          patterns: [...SERVICE_PATTERNS, ...HTTP_PATTERNS],
        }),
      },
    },
    {
      files: [`${SERVER_SRC}/main/**`, "tools/**"],
      rules: { "no-console": "off" },
    },
    // 3. Money.
    {
      files: MONEY_FILES,
      rules: {
        "no-restricted-globals": ["error", "parseFloat"],
        "no-restricted-syntax": [
          "error",
          {
            selector: "CallExpression[callee.name='Number']",
            message:
              "Number() conversion is forbidden; use the money helpers or Number.parseInt with a reason.",
          },
          {
            selector:
              "CallExpression[callee.name='bigint'] ObjectExpression > Property[key.name='mode'][value.value='number']",
            message:
              'bigint({ mode: "number" }) is forbidden for money columns; use mode "bigint".',
          },
        ],
      },
    },
    // 4. Web.
    {
      files: ["apps/web/src/**/*.{ts,tsx}"],
      plugins: {
        formatjs,
        "jsx-a11y": jsxA11y,
        budmon: {
          rules: {
            "no-physical-tailwind": noPhysicalTailwind,
            "icon-from-registry": iconFromRegistry,
          },
        },
      },
      rules: {
        "formatjs/enforce-default-message": "error",
        "formatjs/enforce-id": [
          "error",
          { idInterpolationPattern: "[sha512:contenthash:base64:6]" },
        ],
        "formatjs/no-literal-string-in-jsx": "error",
        "budmon/no-physical-tailwind": "error",
        "budmon/icon-from-registry": "error",
        "jsx-a11y/alt-text": "error",
        "jsx-a11y/control-has-associated-label": "error",
        "jsx-a11y/label-has-associated-control": "error",
        "jsx-a11y/aria-props": "error",
        "jsx-a11y/aria-proptypes": "error",
        "jsx-a11y/aria-role": "error",
        "jsx-a11y/role-has-required-aria-props": "error",
        "jsx-a11y/tabindex-no-positive": "error",
      },
    },
    prettier,
  ];
}
