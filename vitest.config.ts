import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/types/**', '**/*.d.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 80,
        statements: 95
      }
    }
  }
});
