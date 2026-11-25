// Publishes the one-file staff app (public/staff/index.html) at /pos/. The app reads
// location.pathname to choose its screen (APP_MODE), and Cloudflare Access protects
// this path with its own policy. See worker/auth/staff.js.
import source from '../../../public/staff/index.html?raw';

export const GET = () => new Response(source, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
