/**
 * @fileoverview Vite config — static single-page build; WGSL shaders load via `?raw` imports.
 * @module vite.config
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2023', assetsInlineLimit: 0 },
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
});
