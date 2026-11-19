// Menu access. data/menu.json is the single source of truth for dishes and prices:
// the website, the staff POS (via /api/menu) and server-side pricing all read it.
import menuData from '../../data/menu.json' with { type: 'json' };
import { toCents } from './util.js';

const MENU = menuData.menu;
const BY_ID = new Map(MENU.map((item) => [item.id, item]));

export const getMenu = () => MENU;

export function getMenuItem(id) {
  return BY_ID.get(Number(id)) || null;
}

export const priceCents = (item) => toCents(item.price);
