// Publishes src/lib/slots.js unbundled at /js/slots.js for the staff app, like search.js.
import source from '../../lib/slots.js?raw';

export const GET = () => new Response(source, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
