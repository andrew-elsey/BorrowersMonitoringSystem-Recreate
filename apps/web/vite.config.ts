import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Bundle @bms/shared from its TypeScript source (see packages/shared/package.json).
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  // `npm run dev`: forward /api to the API running on this machine, as nginx does in Docker.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
