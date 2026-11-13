import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Isolated from the working development vite.config.ts.
// Relative asset links are mandatory when Electron loads file:// URLs.
const project = process.cwd();
export default defineConfig({
  root: path.resolve(project, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(project, 'src') } },
  build: {
    outDir: path.resolve(project, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
