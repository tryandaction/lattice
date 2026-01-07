import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Allow unused vars with underscore prefix (common pattern)
      "@typescript-eslint/no-unused-vars": ["warn", { 
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_"
      }],
      // Allow any in specific cases (legacy code)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow require imports for dynamic imports
      "@typescript-eslint/no-require-imports": "warn",
      // Prefer const is just a warning
      "prefer-const": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "src-tauri/**",
      "releases/**",
      "**/__tests__/**",
    ],
  },
];

export default eslintConfig;
