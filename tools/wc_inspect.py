"""Inspect live WooCommerce orders (transition-period debugging only).

Credentials come from the environment or a git-ignored .env file in the repo root:
    WC_STORE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET

Usage:
    python3 -I tools/wc_inspect.py            # list the 10 most recent orders
    python3 -I tools/wc_inspect.py 2565       # dump one order (billing, fees, meta_data)
"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path


def load_env():
    env_file = Path(__file__).resolve().parent.parent / '.env'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())
    missing = [k for k in ('WC_CONSUMER_KEY', 'WC_CONSUMER_SECRET') if not os.environ.get(k)]
    if missing:
        sys.exit(f'Missing {", ".join(missing)} (set them in .env)')


def get(path):
    base = os.environ.get('WC_STORE_URL', 'https://mjjadegarden.com')
    token = base64.b64encode(f"{os.environ['WC_CONSUMER_KEY']}:{os.environ['WC_CONSUMER_SECRET']}".encode()).decode()
    req = urllib.request.Request(f'{base}/wp-json/wc/v3/{path}',
                                 headers={'Authorization': f'Basic {token}', 'User-Agent': 'JadeGarden-Tools/2.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def main():
    load_env()
    if len(sys.argv) > 1:
        o = get(f'orders/{sys.argv[1]}')
        for key in ('status', 'total', 'total_tax', 'shipping_total', 'discount_total', 'billing', 'customer_note',
                    'fee_lines', 'coupon_lines', 'line_items'):
            print(f'{key}: {json.dumps(o.get(key), indent=2)}')
        print('meta_data:')
        for m in o.get('meta_data', []):
            print(f"  {m.get('key')} = {m.get('value')}")
        return
    for o in get('orders?per_page=10'):
        b = o.get('billing', {})
        items = ', '.join(f"{it['name']} x{it['quantity']}" for it in o.get('line_items', []))
        print(f"#{o['id']} {o['status']:<11} {o['date_created']}  ${o['total']:>7}  "
              f"{b.get('first_name', '')} {b.get('last_name', '')}  {items}")


if __name__ == '__main__':
    main()
