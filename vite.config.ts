import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA — deep routes like /scan/<token> and /track/<id> must fall back to
// index.html. `vite preview`/`dev` do this out of the box; production hosts
// need a rewrite rule (see apps/web/README.md).
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  preview: { port: 5180 },
});
