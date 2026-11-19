// Fuzzy search shared by the customer order page (bundled by Astro) and the staff POS
// (loaded at runtime from /js/search.js, see src/pages/js/search.js.js).
// Keep this file dependency-free and browser-safe: no imports, no DOM access.

const SEPARATORS = new Set([' ', '-', '.', '(', '_', '/', '&']);

// Subsequence match. Returns { score, positions } or null when `query` is not in `text`.
// A contiguous substring scores highest; otherwise word starts and consecutive letters win.
export function fuzzyMatch(text, query) {
  if (!query) return { score: 0, positions: [] };
  const t = String(text).toLowerCase();
  const q = String(query).toLowerCase();

  const exactIdx = t.indexOf(q);
  if (exactIdx !== -1) {
    const positions = Array.from({ length: q.length }, (_, i) => exactIdx + i);
    return { score: 200 + (100 - exactIdx), positions };
  }

  const positions = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    let found = false;
    while (ti < t.length) {
      if (t[ti] === q[qi]) {
        positions.push(ti);
        ti++;
        found = true;
        break;
      }
      ti++;
    }
    if (!found) return null;
  }

  let score = 0;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (pos === 0 || SEPARATORS.has(t[pos - 1])) score += 15;
    if (i > 0 && positions[i] === positions[i - 1] + 1) score += 10;
    if (i > 0) score -= Math.min(5, positions[i] - positions[i - 1] - 1);
  }
  score += Math.max(0, 30 - positions[0]);
  return { score, positions };
}

const escapeHtml = (ch) => ch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// HTML-escaped `text` with matched positions wrapped in <mark>.
export function fuzzyHighlight(text, positions) {
  const s = String(text);
  const posSet = new Set(positions || []);
  let html = '';
  let inMark = false;
  for (let i = 0; i < s.length; i++) {
    const hit = posSet.has(i);
    if (hit && !inMark) { html += '<mark>'; inMark = true; }
    if (!hit && inMark) { html += '</mark>'; inMark = false; }
    html += escapeHtml(s[i]);
  }
  if (inMark) html += '</mark>';
  return html;
}

// Menu search over {code, name, category}. A code prefix ("B8") always ranks first.
// Returns [{ item, score, namePositions, codePositions }], best first. An empty query
// returns every item in its original order.
export function searchMenu(items, query) {
  const q = String(query || '').trim();
  if (!q) return items.map((item) => ({ item, score: 0, namePositions: [], codePositions: [] }));

  const ql = q.toLowerCase();
  const results = [];
  for (const item of items) {
    if (item.code && item.code.toLowerCase().startsWith(ql)) {
      const pos = Array.from({ length: ql.length }, (_, i) => i);
      results.push({ item, score: 500, namePositions: [], codePositions: pos });
      continue;
    }

    const nameMatch = fuzzyMatch(item.name, q);
    const catMatch = item.category ? fuzzyMatch(item.category, q) : null;
    const codeMatch = item.code ? fuzzyMatch(item.code, q) : null;
    const best = Math.max(
      nameMatch ? nameMatch.score : -Infinity,
      catMatch ? catMatch.score : -Infinity,
      codeMatch ? codeMatch.score + 50 : -Infinity
    );
    if (best === -Infinity) continue;

    results.push({
      item,
      score: best,
      namePositions: nameMatch ? nameMatch.positions : [],
      codePositions: codeMatch ? codeMatch.positions : [],
    });
  }
  return results.sort((a, b) => b.score - a.score);
}

// "740 thatcher" → { house: '740 ', streetPart: 'thatcher' }. Ordinals ("9th ave") are not house numbers.
export function parseHouseAndStreet(input) {
  const trimmed = String(input || '').trim();
  const m = trimmed.match(/^(\d+[a-zA-Z]?(?<!st|nd|rd|th))\s+(.*)$/i);
  if (m) return { house: m[1] + ' ', streetPart: m[2] };
  return { house: '', streetPart: trimmed };
}

// Expands common abbreviations so "9 ave nw" finds "9th Avenue Northwest".
export function normalizeStreetQuery(q) {
  return q
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\bave?\b/gi, 'avenue')
    .replace(/\bst\b/gi, 'street')
    .replace(/\bdr\b/gi, 'drive')
    .replace(/\bcres?\b/gi, 'crescent')
    .replace(/\brd\b/gi, 'road')
    .replace(/\bblvd\b/gi, 'boulevard')
    .replace(/\bnw\b/gi, 'northwest')
    .replace(/\bne\b/gi, 'northeast')
    .replace(/\bsw\b/gi, 'southwest')
    .replace(/\bse\b/gi, 'southeast')
    .replace(/\bw\b/gi, 'west')
    .replace(/\be\b/gi, 'east')
    .replace(/\bn\b/gi, 'north')
    .replace(/\bs\b/gi, 'south');
}

const STREET_TYPES = ['Avenue', 'Street', 'Drive', 'Crescent', 'Road', 'Boulevard', 'Court', 'Lane', 'Place'];

// Street autocomplete. Returns [{ street, house, full, typeTag, score, positions }], best first.
export function searchStreets(streets, input, limit = 6) {
  const { house, streetPart } = parseHouseAndStreet(input);
  if (!streetPart) return [];

  const normQuery = normalizeStreetQuery(streetPart);
  const results = [];
  for (const street of streets) {
    const m1 = fuzzyMatch(street, streetPart);
    const m2 = fuzzyMatch(street, normQuery);
    const best = m1 && m2 ? (m1.score >= m2.score ? m1 : m2) : m1 || m2;
    if (!best) continue;
    results.push({
      street,
      house,
      full: house + street,
      typeTag: street.split(' ').find((p) => STREET_TYPES.includes(p)) || 'Street',
      score: best.score,
      positions: best.positions,
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Hotel / place picker for delivery addresses: places = [{ name, address, type }].
// Every query word must start a word of the name or the address ("temp gar", "super 8",
// "days", "diefenbaker"), so short queries stay precise. An empty query lists them all.
// Returns [{ place, positions }] (positions highlight the name), best first.
export function searchPlaces(places, input, limit = 50) {
  const words = String(input || '').toLowerCase().split(/\s+/).filter(Boolean);
  const wordStarts = (text) => {
    const starts = [];
    const lower = String(text).toLowerCase();
    for (let i = 0; i < lower.length; i++) if (i === 0 || SEPARATORS.has(lower[i - 1]) || lower[i - 1] === ',') starts.push(i);
    return { lower, starts };
  };
  const results = [];
  for (const place of places) {
    if (!words.length) {
      results.push({ place, positions: [], score: 0 });
      continue;
    }
    const name = wordStarts(place.name);
    const addr = wordStarts(place.address);
    const positions = [];
    let score = 0;
    let ok = true;
    for (const w of words) {
      const inName = name.starts.find((i) => name.lower.startsWith(w, i));
      if (inName !== undefined) {
        for (let k = 0; k < w.length; k++) positions.push(inName + k);
        score += 10 + (inName === 0 ? 5 : 0);
      } else if (addr.starts.some((i) => addr.lower.startsWith(w, i))) {
        score += 5;
      } else {
        ok = false;
        break;
      }
    }
    if (ok) results.push({ place, positions: [...new Set(positions)].sort((a, b) => a - b), score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
