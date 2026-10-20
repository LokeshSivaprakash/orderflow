/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, mimic the nginx gateway used in Docker/Kubernetes: /api/<service>/... -> service
const target = (port: number) => ({ target: `http://localhost:${port}`, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api/, '') });

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api/auth': target(4001), '/api/inventory': target(4002), '/api/orders': target(4003), '/api/payments': target(4004) },
  },
  build: { sourcemap: true },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], css: false },
});
