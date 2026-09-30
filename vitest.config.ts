import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['test/unit/WebviewRender.test.ts', 'jsdom']],
    coverage: {
      provider: 'v8',
      include: ['src/env/**', 'src/security/**', 'src/utils/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
