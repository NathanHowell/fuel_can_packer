import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Strictest possible settings
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "warn", // Warn for Array.fill() issues
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "warn", // Warn for Array.fill() issues
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/strict-boolean-expressions": [
        "warn", // Warn instead of error - still valuable but not blocking
        {
          allowString: false,
          allowNumber: true, // Allow number in conditionals (common in JS)
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      "@typescript-eslint/no-unnecessary-condition": "warn", // Warn instead of error
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/prefer-optional-chain": "warn", // Warn instead of error
      "@typescript-eslint/prefer-nullish-coalescing": "warn", // Warn instead of error
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            arguments: false, // Allow promises in event handlers
            attributes: false,
          },
        },
      ],
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn", // Warn instead of error
      "@typescript-eslint/prefer-readonly-parameter-types": "off", // Too strict for practical use
      "@typescript-eslint/no-magic-numbers": "off", // Too strict for practical use
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "forbid",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "enumMember",
          format: ["PascalCase", "UPPER_CASE"],
        },
        {
          // Allow snake_case for object properties (common in external APIs/data)
          // Also allow for mime types (.html) and HTTP headers (Content-Type)
          selector: "property",
          format: ["camelCase", "snake_case", "PascalCase"],
          leadingUnderscore: "allow",
          filter: {
            // Allow leading dots and hyphens (mime types, HTTP headers)
            regex: "^(\\.|[A-Z][a-z]+-)",
            match: false,
          },
        },
        {
          // Allow snake_case for type properties (data structures)
          selector: "typeProperty",
          format: ["camelCase", "snake_case", "PascalCase"],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn", // Warn but don't error - common in TS
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: false,
          allowAny: false,
          allowNullish: true, // Allow nullish in templates
          allowRegExp: false,
        },
      ],
      "@typescript-eslint/require-await": "off", // Allow async functions without await

      // Additional strict rules
      "no-console": "off", // Allow console for this app
      "no-debugger": "error",
      "no-alert": "error",
      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "error",
      "prefer-template": "error",
      "no-nested-ternary": "error",
      "curly": ["error", "all"],
      "eqeqeq": ["error", "always"],
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "error",
    },
  },
  {
    files: ["*.mjs", "*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Relax naming rules for server/build scripts
    files: ["serve.mts", "assemble-site.mts"],
    rules: {
      "@typescript-eslint/naming-convention": "off", // Allow mime types and HTTP headers
    },
  },
  {
    ignores: ["dist/", "node_modules/", "_site/"],
  }
);
