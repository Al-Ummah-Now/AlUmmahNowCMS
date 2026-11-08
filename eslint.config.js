import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
   { ignores: ["node_modules/", "dist/", ".wrangler/", ".schema-check/", "e2e-artifacts/", "playwright-report/", "test-results/"] },
   js.configs.recommended,
   ...tseslint.configs.recommended,
   {
      languageOptions: { ecmaVersion: 2023, sourceType: "module" },
      rules: {
         "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
         "@typescript-eslint/no-explicit-any": "error",
         "no-control-regex": "off",
         eqeqeq: ["error", "smart"],
      },
   },
);
