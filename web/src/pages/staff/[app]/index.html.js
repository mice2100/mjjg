// Publishes the staff app (public/staff/index.html) a second and third time at
// /staff/pos/ and /staff/kitchen/. It is one app; it reads location.pathname to show
// only the phone-order screens or only the order board (APP_MODE in the file).
// Cloudflare Access already covers /staff/*, so both new paths are protected too.
import source from '../../../../public/staff/index.html?raw';

export const getStaticPaths = () => [{ params: { app: 'pos' } }, { params: { app: 'kitchen' } }];

export const GET = () => new Response(source, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
