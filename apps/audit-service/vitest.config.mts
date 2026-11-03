import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['reflect-metadata'],
    include: ['test/**/*.spec.ts'],
  },
});
