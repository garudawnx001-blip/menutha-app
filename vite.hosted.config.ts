import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// "Hosted" build for the Supabase Edge Function host: app code only, with
// React / ReactDOM / React Router / supabase-js loaded as UMD globals from
// jsDelivr in the HTML shell. Keeps the embedded function payload tiny.
// JSX uses the classic runtime (React.createElement) because UMD React has no
// jsx-runtime module; every component file imports React explicitly.
export default defineConfig({
  plugins: [react({ jsxRuntime: 'classic' })],
  build: {
    outDir: 'dist-hosted',
    rollupOptions: {
      external: ['react', 'react-dom/client', 'react-router-dom', '@supabase/supabase-js', 'xlsx'],
      output: {
        format: 'iife',
        globals: {
          react: 'React',
          'react-dom/client': 'ReactDOM',
          'react-router-dom': 'ReactRouterDOM',
          '@supabase/supabase-js': 'supabase',
          xlsx: 'XLSX',
        },
      },
    },
  },
});
