// Vitest runs unit/property/contract tests in Node.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/api/**', 'src/bio/**', 'src/core/**', 'electron/net.ts', 'electron/cache.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'scratch/coverage',
    },
  },
});
