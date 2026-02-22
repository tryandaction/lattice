import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
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
      // Discourage console statements (use logger instead)
      "no-console": "warn",
      // React Compiler/Hook rules: keep visible but non-blocking
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "output/**",
    "scripts/**",
    "next-env.d.ts",
    "src-tauri/**",
    "releases/**",
    "**/__tests__/**",
  ]),
]);

export default eslintConfig;
