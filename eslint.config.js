// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**", "**/data/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // ルート直下の設定ファイル群はどのパッケージのtsconfig.jsonにも含まれないため、
    // 型情報を使う(=tsconfigを要求する)ルールセットの対象から外す。
    files: ["*.config.{js,ts,mjs,cjs}", "**/*.config.{js,ts,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
