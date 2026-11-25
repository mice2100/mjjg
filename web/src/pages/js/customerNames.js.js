// Publishes src/lib/customerNames.js unbundled at /js/customerNames.js for the staff app (same idea as search.js.js).
import source from '../../lib/customerNames.js?raw';

export const GET = () => new Response(source, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
