// Publishes src/lib/search.js unbundled at /js/search.js so the staff app (a plain HTML file
// in public/) can `import()` the same search code the order page bundles. One source, two users.
import source from '../../lib/search.js?raw';

export const GET = () => new Response(source, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
