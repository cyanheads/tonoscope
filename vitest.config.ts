/**
 * @fileoverview Vitest config — pure-logic tests (music, resonance math, pitch detection) in Node.
 * @module vitest.config
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
