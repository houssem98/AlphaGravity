import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
// Local `vercel dev` (see START_PROJECTS.bat step 5) vs the deployed functions.
const VERCEL_DEV = 'http://localhost:3003';
const VERCEL_PROD = {
  target: 'https://market-ui-self.vercel.app',
  changeOrigin: true,
  secure: true,
};

const PROXY = {
    '/api/history': 'http://localhost:3002',
    '/api/fundamentals': 'http://localhost:3002',
    '/api/financials': 'http://localhost:3002',
    '/api/quote': 'http://localhost:3002',
    '/api/predictions': 'http://localhost:3002',
    // These live in apps/market-ui/api/ as Vercel functions, not in market-server.
    //
    // `vercel dev` re-bundles and re-invokes on EVERY request: a trivial
    // function measured 3-5s against Express's 5ms, and a cold /trading load
    // sat at 23.7s per card. The deployed copies of the same files answer in
    // 0.5-1.3s, so read-only display data is proxied straight to them.
    //
    // Flip a line back to VERCEL_DEV when you are editing that file's handler —
    // otherwise you are testing the deployed copy, not your edit.
    '/api/crypto': VERCEL_PROD,
    '/api/social': VERCEL_PROD,
    '/api/tn': VERCEL_PROD,
    '/api/news': VERCEL_PROD,
    '/api/spark': VERCEL_PROD,
    // NOT proxied to prod: /api/agent writes (decision journal, outcome
    // grading). A local run must never mutate production state -- that is
    // exactly how a failed local Company Brief poisoned the shared
    // lib_grid_runs cache and surfaced on the deployed site.
    '/api/agent': VERCEL_DEV,
    '/ws': {
      target: 'ws://localhost:3002',
      ws: true,
    },
};

export default defineConfig({
  base: '/',
  plugins: [inspectAttr(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: [
      '@react-pdf/renderer',
      'pako',
    ],
  },
  build: {
    // Split the heaviest libraries into their own long-cached chunks so they
    // load only on routes that need them and don't bloat the initial bundle.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'pdf': ['@react-pdf/renderer'],
          'charts': ['recharts', 'lightweight-charts'],
          'markdown': ['react-markdown'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: PROXY,
  },
  // `vite preview` serves the production build. Same proxy table, so a dev
  // build and a prod build can be compared on one machine.
  preview: {
    proxy: PROXY,
  },
});
