// Publishes src/lib/address.js unbundled at /js/address.js for the staff app (same idea as search.js.js).
import source from '../../lib/address.js?raw';

export const GET = () => new Response(source, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
