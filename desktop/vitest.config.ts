import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { version } from '../package.json' with { type: 'json' };
export default defineConfig({define:{'import.meta.env.VITE_APP_VERSION':JSON.stringify(version)},resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'jsdom',globals:false,include:['src/**/*.test.{ts,tsx}','e2e/**/*.test.ts','tools/**/*.test.ts'],exclude:['**/*.spec.ts'],setupFiles:['src/test/setup.ts'],css:false}});
