import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { arrangeItems, parseItems, slugFromQuery } from '../src/item-data';
const source = readFileSync(new URL('../demo/items.toml', import.meta.url), 'utf8');
const items = parseItems(source);

test('reads all rows independently of the declared count and accepts new entries', () => {
  const extra = '\n[[items]]\nslug="another-item"\nname="Another item"\nshort_description="A new entry."\nurl="https://example.com"\nobscurity_bucket=5\nobscurity_rating=5.5\ncursedness_rating=2.0\n';
  expect(parseItems(source.replace('item_count = 11', 'item_count = 1') + extra)).toHaveLength(items.length + 1);
});

test('orders depth by bucket and obscurity, leaving room around the water and beyond the ice', () => {
  const placed = arrangeItems(items, -0.72, 2.5, -22);
  for (let i = 1; i < placed.length; i++) expect(placed[i].y).toBeLessThan(placed[i - 1].y);
  for (let bucket = 1; bucket <= 10; bucket++) {
    const group = placed.filter(p => p.item.obscurity_bucket === bucket);
    for (let i = 1; i < group.length; i++) expect(group[i].item.obscurity_rating).toBeGreaterThanOrEqual(group[i - 1].item.obscurity_rating);
    const byCurse = group.toSorted((a, b) => a.item.cursedness_rating - b.item.cursedness_rating || a.item.slug.localeCompare(b.item.slug));
    expect(byCurse[0].angle).toBe(0);
    for (let i = 1; i < byCurse.length; i++) expect(Math.abs(byCurse[i].angle)).toBeGreaterThanOrEqual(Math.abs(byCurse[i - 1].angle));
  }
  expect(placed.filter(p => p.item.obscurity_bucket === 1).every(p => p.y > -0.72)).toBe(true);
  expect(placed.filter(p => p.item.obscurity_bucket === 10).every(p => p.y < -22)).toBe(true);
  expect(Math.min(...placed.filter(p => p.item.obscurity_bucket === 1).map(p => p.y))).toBeGreaterThanOrEqual(0.28);
  expect(Math.max(...placed.filter(p => p.item.obscurity_bucket === 2).map(p => p.y))).toBeLessThanOrEqual(-2.92);
  const abyss = placed.filter(p => p.item.obscurity_bucket === 10);
  expect(Math.max(...abyss.map(p => p.y)) - Math.min(...abyss.map(p => p.y))).toBeGreaterThan(0);
});

test('rejects duplicates and unsafe source links', () => {
  expect(() => parseItems(source + source.slice(source.indexOf('[[items]]'), source.indexOf('[[items]]', source.indexOf('[[items]]') + 1)))).toThrow('duplicate slug');
  expect(() => parseItems(source.replace(/url = "[^"]+"/, 'url = "javascript:alert(1)"'))).toThrow('HTTP(S)');
});

test('supports named and bare item query arguments without confusing scene options', () => {
  const known = new Set(items.map(item => item.slug)), slug = items[0].slug;
  expect(slugFromQuery(`?item=${slug}&still=1`, known)).toBe(slug);
  expect(slugFromQuery(`?${slug}`, known)).toBe(slug);
  expect(slugFromQuery('?overview&still=1', known)).toBe(null);
});
