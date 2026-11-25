// Restaurant facts used across the website. Edit here, not in page markup.
// Source: the live mjjadegarden.com site (October 2026). Confirm with the owner before changing.
import menuData from '../../../data/menu.json';
import galleryData from './gallery.json';

export const SITE = {
  name: 'Jade Garden Restaurant',
  shortName: 'Jade Garden',
  tagline: 'Fresh, authentic Chinese cuisine in downtown Moose Jaw since 2012',
  phone: '(306) 694-5566',
  phoneHref: 'tel:+13066945566',
  email: 'order@mjjadegarden.com',
  address: {
    street: '471 Main St N',
    city: 'Moose Jaw',
    region: 'SK',
    postalCode: 'S6H 0W5',
    country: 'CA',
  },
  mapsUrl: 'https://maps.google.com/?q=471+Main+St+N,+Moose+Jaw,+SK+S6H+0W5',
  facebookUrl: 'https://www.facebook.com/p/Jade-Garden-Restaurant-Moose-Jaw-100063075647488/',
  // Open Tuesday–Sunday, closed Monday.
  hours: [
    { label: 'Buffet lunch', value: '11:00 am – 3:00 pm' },
    { label: 'Buffet supper', value: '4:00 pm – 7:45 pm' },
    { label: 'Take-out & delivery', value: '11:00 am – 8:00 pm' },
  ],
  openDays: 'Tuesday – Sunday',
  closedDays: 'Closed Mondays',
  deliveryFee: 7, // house; apartments, condos and hotels pay deliveryFeeApartment (worker/lib/util.js)
  deliveryFeeApartment: 8,
};

// Dishes highlighted on the home page (menu item ids from data/menu.json).
// Not a promotion: prices shown are the regular menu prices.
export const FEATURED_ITEM_IDS = [15, 17, 40, 4, 72, 59];

export const MENU = menuData.menu;

// "A1. Egg Roll" / "B8 Ginger Beef" -> "Egg Roll" / "Ginger Beef"
export const displayName = (item) => item.name.replace(/^[A-Z]+\d+[A-Z]?\.?\s+/, '');
export const formatPrice = (n) => `$${Number(n).toFixed(2)}`;

// Photos imported from the old site by tools/import_old_site_images.py (restaurant's own photos only).
export const GALLERY = galleryData;
export const PHOTO = Object.fromEntries(galleryData.map((p) => [p.slug, p]));
