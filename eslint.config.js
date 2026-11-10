import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
   { ignores: ["node_modules/", "dist/", ".wrangler/", ".e2e-local/", ".schema-check/", "e2e-artifacts/", "playwright-report/", "test-results/", "src/admin/**/*.generated.ts"] },
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
   {
      // Never the browser's own prompts: destructive actions and questions use the in-app dialogs
      // (src/admin/client/dialogs.ts), and nothing hooks beforeunload (in-app links ask instead).
      files: ["src/**/*.{ts,tsx}"],
      rules: {
         "no-alert": "error",
         "no-restricted-globals": [
            "error",
            { name: "confirm", message: "Use askConfirm (src/admin/client/dialogs.ts)." },
            { name: "alert", message: "Use toast or an inline error." },
            { name: "prompt", message: "Use an in-app dialog (e.g. askLink)." },
            { name: "onbeforeunload", message: "No beforeunload prompts: use the in-app leave guard." },
         ],
         "no-restricted-syntax": [
            "error",
            { selector: "Literal[value='beforeunload']", message: "No beforeunload prompts: use the in-app leave guard (addLeaveGuard)." },
            { selector: "Identifier[name='onbeforeunload']", message: "No beforeunload prompts: use the in-app leave guard (addLeaveGuard)." },
         ],
      },
   },
);
