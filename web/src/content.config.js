// Promotions are content, not code. One Markdown file in src/content/promotions/
// = one promotion shown on the website. Files starting with "_" are ignored (templates).
// Discounts themselves live in the D1 `coupons` table; a promotion file only ADVERTISES
// a coupon (coupon_code) or links somewhere. See AGENTS.md > "Promotions".
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const promotions = defineCollection({
  loader: glob({ pattern: '[!_]*.md', base: './src/content/promotions' }),
  schema: z.object({
    title: z.string().max(80),
    // Where it renders. Every placement renders nothing when it has no live promotion.
    placement: z.enum(['announcement', 'hero', 'home-feature', 'order-banner']),
    coupon_code: z.string().optional(), // must exist & be active in D1 `coupons`
    cta_label: z.string().optional(),
    cta_href: z.string().optional(),
    starts_at: z.coerce.date().optional(), // shown from (inclusive)
    ends_at: z.coerce.date().optional(), // hidden from (exclusive)
    priority: z.number().default(0), // higher first
  }),
});

export const collections = { promotions };
