import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Bundle @bms/shared from its TypeScript source (see packages/shared/package.json).
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
});
