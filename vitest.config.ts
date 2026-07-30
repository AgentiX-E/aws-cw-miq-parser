import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['source/**/*.ts'],
      exclude: ['source/generated/**', 'source/types.ts', 'source/index.ts'],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
      watermarks: {
        lines: [90, 95],
        branches: [85, 95],
        functions: [90, 100],
        statements: [90, 95],
      },
    },
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
  },
  bench: {
    include: ['test/**/*.bench.ts'],
  },
});
