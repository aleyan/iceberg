import { parse } from 'smol-toml';

export interface IcebergItem {
  slug: string;
  name: string;
  short_description: string;
  url: string;
  obscurity_bucket: number;
  obscurity_rating: number;
  cursedness_rating: number;
}

export function parseItems(source: string): IcebergItem[] {
  const rows = parse(source).items;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Expected at least one [[items]] entry.');
  const slugs = new Set<string>();
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Invalid entry ${index + 1}.`);
    const item = row as unknown as IcebergItem;
    for (const field of ['slug', 'name', 'short_description', 'url'] as const) {
      if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error(`Entry ${index + 1}: missing ${field}.`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) || slugs.has(item.slug)) throw new Error(`Invalid or duplicate slug: ${item.slug}.`);
    slugs.add(item.slug);
    if (!Number.isInteger(item.obscurity_bucket) || item.obscurity_bucket < 1 || item.obscurity_bucket > 10) throw new Error(`${item.slug}: bucket must be 1–10.`);
    for (const field of ['obscurity_rating', 'cursedness_rating'] as const) {
      if (!Number.isFinite(item[field]) || item[field] < 0 || item[field] > 10) throw new Error(`${item.slug}: invalid ${field}.`);
    }
    if (!['https:', 'http:'].includes(new URL(item.url).protocol)) throw new Error(`${item.slug}: source must be an HTTP(S) URL.`);
    return item;
  });
}

/** World height is monotonic within each bucket; cursedness spreads around ±π. */
export function arrangeItems(items: readonly IcebergItem[], water: number, top: number, bottom: number) {
  const depth = water - bottom;
  return Array.from({ length: 10 }, (_, index) => index + 1).flatMap(bucket => {
    const group = items.filter(item => item.obscurity_bucket === bucket);
    const byCurse = [...group].sort((a, b) => a.cursedness_rating - b.cursedness_rating || a.slug.localeCompare(b.slug));
    return group.sort((a, b) => a.obscurity_rating - b.obscurity_rating || a.slug.localeCompare(b.slug)).map((item, index) => {
      const fraction = (index + 0.5) / group.length;
      const curseRank = byCurse.indexOf(item);
      const angle = curseRank / Math.max(1, group.length - 1) * Math.PI * (curseRank % 2 ? -1 : 1);
      // Keep labels away from the bright water rim. The exposed tip has less
      // surface area, so give it extra vertical room in the open sky. The
      // abyss has no shell to distribute labels across, so use a readable
      // line-height rather than squeezing the whole bucket into a short band.
      const surfaceGap = 1;
      const surfaceSpan = Math.max(top - water, group.length * 0.48);
      const underwaterGap = 2.2;
      const submergedSpan = Math.max(0, depth - underwaterGap);
      const abyssSpan = Math.max(depth * 0.24, group.length * 0.82);
      const y = bucket === 1 ? water + surfaceGap + surfaceSpan * (1 - fraction)
        : bucket === 10 ? bottom - 1 - abyssSpan * fraction
        : water - underwaterGap - submergedSpan * ((bucket - 2 + fraction) / 8);
      return { item, y, angle };
    });
  });
}

export function slugFromQuery(search: string, knownSlugs: Set<string>) {
  const params = new URLSearchParams(search);
  if (params.has('item')) return params.get('item');
  // Also accept the compact ?some-item-slug form.
  return [...params].find(([key, value]) => !value && knownSlugs.has(key))?.[0] ?? null;
}
