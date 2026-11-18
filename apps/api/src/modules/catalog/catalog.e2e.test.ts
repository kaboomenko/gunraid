import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ItemDetailDto, ItemFacetsDto, ItemsPageDto } from '@gunraid/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createTestApp } from '../../test/app.js';
import { parseCsv } from './csv.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('catalog (integration)', () => {
  it('lists items with filters, sort and pagination', async () => {
    const c = new TestClient(app);
    const all = await c.get<ItemsPageDto>('/api/v1/games/cs2/items?pageSize=10&sort=price_asc');
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(10);
    expect(all.body.total).toBeGreaterThanOrEqual(40);
    const prices = all.body.items.map((i) => i.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const knives = await c.get<ItemsPageDto>('/api/v1/games/cs2/items?type=knife');
    expect(knives.body.items.every((i) => i.typeCode === 'knife')).toBe(true);
    const search = await c.get<ItemsPageDto>('/api/v1/games/cs2/items?q=lime%20fury');
    expect(search.body.items.length).toBeGreaterThan(0);
    expect(search.body.items.every((i) => i.fullName.toLowerCase().includes('lime fury'))).toBe(true);
    const st = await c.get<ItemsPageDto>('/api/v1/games/cs2/items?stattrak=true');
    expect(st.body.items.every((i) => i.isStattrak)).toBe(true);
    const range = await c.get<ItemsPageDto>('/api/v1/games/standoff2/items?priceMin=100&priceMax=1000');
    expect(range.body.items.every((i) => i.price >= 100 && i.price <= 1000)).toBe(true);
  });

  it('returns facets and item details with rarity', async () => {
    const c = new TestClient(app);
    const facets = await c.get<ItemFacetsDto>('/api/v1/games/standoff2/items/facets');
    expect(facets.body.rarities.length).toBeGreaterThan(3);
    expect(facets.body.types.map((t) => t.code)).toContain('knife');
    const page = await c.get<ItemsPageDto>('/api/v1/games/standoff2/items?pageSize=1');
    const id = page.body.items[0]!.id;
    const detail = await c.get<ItemDetailDto>(`/api/v1/games/standoff2/items/${id}`);
    expect(detail.body.id).toBe(id);
    expect(detail.body.rarity.color).toMatch(/^#[0-9A-F]{6}$/i);
    const wrongGame = await c.get(`/api/v1/games/cs2/items/${id}`);
    expect(wrongGame.status).toBe(404);
  });

  it('imports a CSV with gem and USD prices (admin only)', async () => {
    const admin = new TestClient(app);
    await admin.devLogin('admin');
    const suffix = Date.now();
    const csv = [
      'market_name;full_name;skin_name;type;model;rarity;price_gems;price_usd;stattrak',
      `Test Item A ${suffix};Test Item A ${suffix};Alpha;weapon;akr;rare;1500;;0`,
      `Test Item B ${suffix};Test Item B ${suffix};Beta;weapon;akr;epic;;"12,34";1`,
      `Broken ${suffix};;;weapon;akr;nope;10;;0`,
    ].join('\n');
    const res = await admin.post<{ created: number; skipped: number; errors: Array<{ line: number }> }>(
      '/api/v1/admin/catalog/standoff2/import',
      { fileName: 'test.csv', csv },
    );
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0]?.line).toBe(4);
    const found = await admin.get<ItemsPageDto>(`/api/v1/games/standoff2/items?q=${suffix}&sort=price_asc`);
    expect(found.body.items.map((i) => i.price)).toEqual([1234, 1500]);

    const player = new TestClient(app);
    await player.loginNewPlayer('csv');
    const denied = await player.post('/api/v1/admin/catalog/standoff2/import', { fileName: 'x.csv', csv });
    expect(denied.status).toBe(403);
  });

  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ]);
  });
});
