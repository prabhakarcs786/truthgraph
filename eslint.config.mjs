import { defineConfig, globalIgnores } from "eslint/config";
import javascript from "@eslint/js";
import typescript from "typescript-eslint";
import next from "@next/eslint-plugin-next";
import hooks from "eslint-plugin-react-hooks";

export default defineConfig([
  globalIgnores([".next/**", "out/**", "dist/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
  { ...javascript.configs.recommended, files: ["**/*.{ts,tsx}"] },
  ...typescript.configs.recommended,
  next.configs["core-web-vitals"],
  hooks.configs.flat.recommended,
]);
