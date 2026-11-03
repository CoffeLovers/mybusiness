import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['reflect-metadata'],
    include: ['test/**/*.e2e-spec.ts'],
    hookTimeout: 30000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
