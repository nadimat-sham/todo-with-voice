import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Every /api call from the browser goes through Vite to the Express API,
  // so the frontend and backend share one origin (no CORS needed).
  const proxy = { '/api': { target: `http://127.0.0.1:${env.PORT || 3004}`, changeOrigin: true } };
  return {
    root: 'frontend',
    // Own dev port, so it never collides with the other projects' Vite servers.
    // `npm run dev:lan` (mode "lan") opens it to the local network instead,
    // over HTTPS with the self-signed certificate in certs/ — browsers only
    // allow the microphone on https:// or localhost pages.
    server: mode === 'lan'
      ? {
        host: '0.0.0.0', port: 5183, strictPort: true, proxy,
        https: { key: readFileSync('certs/lan-key.pem'), cert: readFileSync('certs/lan-cert.pem') },
      }
      : { host: '127.0.0.1', port: 5182, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 4182, proxy },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      // Two pages: the app itself and the sign-in page
      rollupOptions: { input: { main: resolve('frontend/index.html'), login: resolve('frontend/login.html') } },
    },
  };
});
