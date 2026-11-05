import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['lib/**/*.ts', 'components/ui/**/*.{ts,tsx}'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
