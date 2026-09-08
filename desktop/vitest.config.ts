import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'jsdom',globals:false,include:['src/**/*.test.{ts,tsx}','e2e/**/*.test.ts','tools/**/*.test.ts'],exclude:['**/*.spec.ts'],setupFiles:['src/test/setup.ts'],css:false}});
