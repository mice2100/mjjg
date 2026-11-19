// Customer website. Fully static output (web/dist) served by the Worker's assets layer.
// Dynamic data (cart pricing, orders, sign-in) goes through /api/* on the same origin.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mjjadegarden.com',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    // `npm run dev:web` hot-reloads the site; API calls go to `wrangler dev` on :8787.
    server: { proxy: { '/api': 'http://localhost:8787' } },
  },
});
