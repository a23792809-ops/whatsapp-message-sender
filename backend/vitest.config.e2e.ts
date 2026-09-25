import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Every spec talks to the same real database, and each file boots the app,
    // whose bootstrap recovery pass adopts any campaign left in RUNNING. Running
    // files in parallel would let one suite's recovery adopt another suite's
    // in-flight campaign and start a second runner, so serialise the files.
    fileParallelism: false,
  },
});
