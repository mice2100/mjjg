"""Import photos from the old WordPress site and convert them to WebP.

What it does
  1. Downloads every image in the WordPress media library (public REST API, no key needed).
  2. Archives ALL real images (theme placeholders skipped) as WebP in assets/old-site-webp/
     (git-ignored; for reference only, NOT published: much of it is stock / third-party).
  3. Publishes only the restaurant's OWN photos, resized, to web/public/images/:
       menu/<menuId>.webp + menu/<menuId>-sm.webp   (product photo of each dish)
       site/<slug>.webp  + site/<slug>-sm.webp      (story, hero, gallery)
  4. Writes the `image` field into data/menu.json and web/src/data/gallery.json.

Requires ImageMagick 7 (`magick`, with WebP + HEIC support).
Usage:  python3 -I tools/import_old_site_images.py [--cache DIR]
Re-running is safe: it regenerates everything from the source images.
"""
import html
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://mjjadegarden.com'
MENU_JSON = ROOT / 'data' / 'menu.json'
OUT = ROOT / 'web' / 'public' / 'images'
GALLERY_JSON = ROOT / 'web' / 'src' / 'data' / 'gallery.json'
ARCHIVE = ROOT / 'assets' / 'old-site-webp'

# Curated: WordPress media id -> (slug, group, English alt text). Only the restaurant's own photos.
# Excluded on purpose: Envato stock, images copied from other restaurants/recipe blogs, AI art,
# theme icons, and Facebook photos showing identifiable customers (needs their consent).
SITE_PHOTOS = {
    # Story / exterior
    785: ('storefront', 'room', 'Jade Garden storefront on Main Street North'),
    693: ('exterior', 'room', 'Jade Garden building in downtown Moose Jaw'),
    # Dining room
    1069: ('dining-room', 'room', 'Dining room with banquet tables set for guests'),
    1068: ('dining-room-2', 'room', 'Bright dining room with large windows'),
    1070: ('dining-room-3', 'room', 'Round tables with lazy Susans for family-style meals'),
    1072: ('dining-room-4', 'room', 'Main dining room and buffet area'),
    1071: ('banquet-table', 'room', 'Banquet table set with a red flower centrepiece'),
    695: ('banquet-room', 'room', 'Banquet room with round tables'),
    696: ('dining-room-5', 'room', 'Dining room seating'),
    1073: ('bar', 'room', 'Licensed bar with a full selection of drinks'),
    1074: ('bar-2', 'room', 'Bar counter decorated for good fortune'),
    1075: ('decor', 'room', 'Tea set and traditional decor'),
    1076: ('table-flowers', 'room', 'Poinsettia centrepiece on a dining table'),
    1940: ('holiday-dining', 'room', 'Dining room decorated for the holidays'),
    1941: ('holiday-flowers', 'room', 'Holiday poinsettia by the window'),
    # Buffet
    1087: ('buffet', 'buffet', 'Hot buffet line'),
    1088: ('buffet-2', 'buffet', 'Wonton soup and crispy wontons on the buffet'),
    1089: ('buffet-3', 'buffet', 'Spring rolls and fried chicken on the buffet'),
    1090: ('buffet-4', 'buffet', 'Sweet and sour chicken balls on the buffet'),
    1091: ('buffet-5', 'buffet', 'Chow mein and dumplings on the buffet'),
    1093: ('buffet-6', 'buffet', 'Dumplings and noodles on the buffet'),
    1085: ('buffet-desserts', 'buffet', 'Desserts on ice at the buffet'),
    808: ('buffet-7', 'buffet', 'Buffet trays with serving tongs'),
    811: ('buffet-8', 'buffet', 'Full buffet station'),
    822: ('buffet-salad', 'buffet', 'Salad and fruit bar'),
    # Food (photographed in-house)
    1247: ('hero-ginger-beef', 'food', 'Ginger beef with sauce being poured over it'),
    1104: ('food-shanghai-noodle', 'food', 'Beef Shanghai noodles lifted with chopsticks'),
    1115: ('food-dumplings', 'food', 'Pan-fried dumplings'),
    1013: ('food-chili-oil', 'food', 'House-made chili oil'),
    1014: ('food-montreal-ribs', 'food', 'Spicy Montreal ribs'),
    1011: ('food-bbq-pork', 'food', 'BBQ pork tenderloin'),
    1110: ('food-mantou', 'food', 'Deep-fried mantou with condensed milk'),
    1112: ('food-szechuan', 'food', 'Spicy stir-fry with sauce'),
    1113: ('food-kung-pao', 'food', 'Kung pao chicken'),
    1120: ('food-seafood-veg', 'food', 'Shrimp and scallops with broccoli'),
    1121: ('food-singapore-noodle', 'food', 'Singapore fried rice noodles'),
    1122: ('food-crispy-chow-mein', 'food', 'House special crispy chow mein'),
    1185: ('food-combo', 'food', 'Combo plate with chicken balls, rice and spring roll'),
    1209: ('food-wonton-soup', 'food', 'War wonton soup with BBQ pork'),
    1252: ('food-chicken-balls', 'food', 'Sweet and sour chicken balls'),
    1016: ('food-egg-shrimp', 'food', 'Scrambled eggs with shrimp'),
}

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'JadeGarden-Tools/2.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode()), int(r.headers.get('X-WP-TotalPages') or 1)


def fetch_all(path):
    # Pages can hold fewer than per_page items (hidden attachments), so trust X-WP-TotalPages.
    out, page, total = [], 1, 1
    while page <= total:
        batch, total = fetch_json(f'{SITE}/wp-json/{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
        out += batch
        page += 1
    return out


def magick(*args):
    subprocess.run(['magick', *map(str, args)], check=True)


def to_webp(src, dst, max_px, quality=80):
    dst.parent.mkdir(parents=True, exist_ok=True)
    magick(f'{src}[0]', '-auto-orient', '-strip', '-resize', f'{max_px}x{max_px}>', '-quality', quality, dst)


def size_of(path):
    w, h = subprocess.run(['magick', 'identify', '-format', '%w %h', str(path)], check=True,
                          capture_output=True, text=True).stdout.split()
    return int(w), int(h)


def is_placeholder(path):
    # The theme's 1200x800 grey placeholders all share this exact pixel spread.
    sd = subprocess.run(['magick', f'{path}[0]', '-colorspace', 'gray', '-format', '%[fx:standard_deviation]', 'info:'],
                        capture_output=True, text=True).stdout.strip()
    return sd in ('0.0805662', '0.0535334')


def main():
    cache = Path(sys.argv[sys.argv.index('--cache') + 1]) if '--cache' in sys.argv else ROOT / '.cache' / 'old-site'
    cache.mkdir(parents=True, exist_ok=True)

    media = [m for m in fetch_all('wp/v2/media?_fields=id,source_url,mime_type') if m['mime_type'].startswith('image/')]
    products = fetch_all('wc/store/v1/products?')
    print(f'{len(media)} images, {len(products)} products')

    files = {}
    for m in media:
        ext = m['source_url'].rsplit('.', 1)[-1].lower()
        f = cache / f"{m['id']}.{ext}"
        if not f.exists():
            req = urllib.request.Request(m['source_url'], headers={'User-Agent': 'JadeGarden-Tools/2.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                f.write_bytes(r.read())
        files[m['id']] = f

    # 1. Archive everything that is a real image.
    archived = 0
    for mid, f in files.items():
        if is_placeholder(f):
            continue
        name = re.sub(r'[^A-Za-z0-9._-]+', '-', next(m['source_url'] for m in media if m['id'] == mid).rsplit('/', 1)[-1])
        to_webp(f, ARCHIVE / f'{mid}-{name.rsplit(".", 1)[0]}.webp', 2000, 82)
        archived += 1
    print(f'archived {archived} images to {ARCHIVE.relative_to(ROOT)}')

    # 2. Menu photos: match old-site products to data/menu.json by name.
    norm = lambda s: re.sub(r'[^a-z0-9]', '', html.unescape(s).lower())
    data = json.loads(MENU_JSON.read_text())
    by_name = {norm(i['name']): i for i in data['menu']}
    for item in data['menu']:
        item.pop('image', None)
    matched = 0
    for p in products:
        item = by_name.get(norm(p['name']))
        if not item or not p['images']:
            continue
        mid = p['images'][0]['id']
        to_webp(files[mid], OUT / 'menu' / f"{item['id']}.webp", 1200)
        to_webp(files[mid], OUT / 'menu' / f"{item['id']}-sm.webp", 480, 76)
        item['image'] = f"/images/menu/{item['id']}.webp"
        matched += 1
    MENU_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f'menu photos: {matched} of {len(data["menu"])} dishes')

    # 3. Site photos (story, hero, gallery).
    gallery = []
    for mid, (slug, group, alt) in SITE_PHOTOS.items():
        big = OUT / 'site' / f'{slug}.webp'
        to_webp(files[mid], big, 1800, 80)
        to_webp(files[mid], OUT / 'site' / f'{slug}-sm.webp', 640, 76)
        w, h = size_of(big)
        gallery.append({'src': f'/images/site/{slug}.webp', 'thumb': f'/images/site/{slug}-sm.webp',
                        'width': w, 'height': h, 'group': group, 'alt': alt, 'slug': slug})
    GALLERY_JSON.write_text(json.dumps(gallery, indent=2) + '\n')
    print(f'site photos: {len(gallery)}')


if __name__ == '__main__':
    main()
