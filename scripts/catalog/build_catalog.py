"""Шаг 3: сборка демо-каталога — картинки 400×200 webp и packages/db/src/seed/real-catalog.ts.

    python3 scripts/catalog/build_catalog.py <рабочая папка> <корень репозитория>

Нужен Pillow (pip install pillow). Вход — результаты select_cs2.py и crawl_so2.py.
"""
import hashlib, json, math, os, re, sys
from PIL import Image

SRC, REPO = sys.argv[1], sys.argv[2]
IMG_OUT = os.path.join(REPO, 'apps/web/public/media/skins')
TS_OUT = os.path.join(REPO, 'packages/db/src/seed/real-catalog.ts')
W, H, PAD_X, PAD_Y = 400, 200, 10, 8

def h(s):
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def convert(src, dst):
    im = Image.open(src).convert('RGBA')
    bbox = im.split()[3].point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    scale = min((W - 2 * PAD_X) / im.width, (H - 2 * PAD_Y) / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(im, ((W - im.width) // 2, (H - im.height) // 2), im)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    canvas.save(dst, 'WEBP', quality=80, alpha_quality=85, method=6)

def price(key, lo, hi, bias=1.0):
    """Детерминированная «рыночная» цена: лог-равномерно в [lo, hi], bias>1 — ближе к верху."""
    u = h(key) ** (1 / bias)
    v = math.exp(math.log(lo) + (math.log(hi) - math.log(lo)) * u)
    step = 1 if v < 100 else 5 if v < 1000 else 10 if v < 10000 else 100
    return int(round(v / step) * step)

# ---------- CS2 ----------
cs2 = json.load(open(os.path.join(SRC, 'cs2-items.json'), encoding='utf-8'))
CS2_RANGES = {'consumer': (3, 25), 'industrial': (5, 60), 'milspec': (10, 400), 'restricted': (60, 2500),
              'classified': (300, 9000), 'covert': (1200, 60000), 'contraband': (450000, 450000), 'rare_special': (9000, 180000)}
CS2_TOP = {'Dragon Lore': 1.0, 'Howl': 1.0, 'Fire Serpent': 0.95, 'Printstream': 0.8, 'Gungnir': 1.0, 'Asiimov': 0.6, 'Vulcan': 0.7,
           'Lore': 0.9, 'Doppler': 0.75, 'Fade': 0.8, 'Marble Fade': 0.7, 'Gamma Doppler': 0.75, 'Crimson Web': 0.85, 'Case Hardened': 0.6,
           'Pandora\'s Box': 0.9, 'Vice': 0.8, 'King Snake': 0.7}
WEAR_MULT = {'FN': 1.0, 'MW': 0.8, 'FT': 0.6, 'WW': 0.5, 'BS': 0.45, None: 0.7}
cs2_models, cs2_items, cs2_colls = {}, [], {}
for x in cs2:
    lo, hi = CS2_RANGES[x['rarity']]
    if x['type'] == 'gloves':
        lo, hi = 8000, 120000
    top = CS2_TOP.get(x['skin'])
    base = (lo + (hi - lo) * top) if top is not None and lo != hi else price('cs2:' + x['slug'], lo, hi)
    v = max(1.0, base * WEAR_MULT[x['wear']])
    step = 1 if v < 100 else 5 if v < 1000 else 10 if v < 10000 else 100
    p = int(round(v / step) * step)
    img = f"/media/skins/cs2/{x['slug']}.webp"
    convert(os.path.join(SRC, 'cs2-img', x['slug'] + '.png'), os.path.join(IMG_OUT, 'cs2', x['slug'] + '.webp'))
    cs2_models.setdefault(x['model'], {'code': x['model'], 'name': x['modelName'], 'type': x['type'], 'shape': x['shape']})
    coll = None
    if x.get('collection'):
        coll = slugify(x['collection'].replace('The ', '').replace(' Collection', ''))
        cs2_colls[coll] = x['collection']
    cs2_items.append({'model': x['model'], 'skin': x['skin'], 'rarity': x['rarity'], 'price': p, 'wear': x['wear'], 'image': img, 'collection': coll})
    # StatTrak™-вариант у части скинов, где он существует в игре (та же картинка, цена ×1.8)
    if x.get('stattrak') and h('st:' + x['slug']) < 0.3:
        v = p * 1.8
        step = 1 if v < 100 else 5 if v < 1000 else 10 if v < 10000 else 100
        cs2_items.append({'model': x['model'], 'skin': x['skin'], 'rarity': x['rarity'], 'price': int(round(v / step) * step), 'wear': x['wear'],
                          'stattrak': True, 'image': img, 'collection': coll})

# ---------- Standoff 2 ----------
so2 = json.load(open(os.path.join(SRC, 'so2-items.json'), encoding='utf-8'))
COLOR_RARITY = {'Gray': 'common', 'Grey': 'common', 'White': 'common', 'Light Blue': 'uncommon', 'Cyan': 'uncommon', 'Green': 'uncommon',
                'Blue': 'rare', 'Purple': 'epic', 'Pink': 'legendary', 'Red': 'arcane', 'Gold': 'nameless', 'Yellow': 'nameless'}
SO2_RANGES = {'common': (3, 25), 'uncommon': (8, 60), 'rare': (20, 250), 'epic': (80, 1200), 'legendary': (300, 5000),
              'arcane': (1500, 25000), 'nameless': (5000, 60000)}
KNIVES = {'Karambit', 'Butterfly', 'M9 Bayonet', 'Kunai', 'Tanto', 'Dual Daggers', 'Fang', 'jKommando', 'Kukri', 'Scorpion', 'Sting',
          'Flip', 'Stiletto', 'Mantis'}
SHAPES = {'rifle': ['AKR', 'AKR12', 'M4', 'M4A1', 'M16', 'FN FAL', 'FAMAS', 'VAL', 'M60'], 'sniper': ['AWM', 'M40', 'M110'],
          'pistol': ['Desert Eagle', 'USP', 'P350', 'G22', 'TEC-9', 'F/S', 'Berettas'], 'smg': ['MP7', 'UMP45', 'P90', 'MP5', 'MAC10', 'Akimbo Uzi'],
          'shotgun': ['SM1014', 'FabM', 'SPAS']}
EXISTING_CODES = {'FN FAL': 'fnfal', 'Desert Eagle': 'deagle'}
unknown_colors = {}
so2_models, so2_items, so2_colls = {}, [], {}
seen = set()
for x in so2:
    model = 'F/S' if x['model'] == 'FS' else x['model']
    color = x['badges'][1] if len(x['badges']) > 1 else None
    rarity = COLOR_RARITY.get(color)
    if rarity is None:
        unknown_colors[color] = unknown_colors.get(color, 0) + 1
        rarity = 'rare'
    typ = 'knife' if model in KNIVES else 'weapon'
    shape = 'knife' if typ == 'knife' else next((k for k, v in SHAPES.items() if model in v), 'rifle')
    code = EXISTING_CODES.get(model) or re.sub(r'[^a-z0-9]+', '_', model.lower()).strip('_')
    key = (code, x['skin'].lower())
    if key in seen:
        continue
    seen.add(key)
    lo, hi = SO2_RANGES[rarity]
    if typ == 'knife':
        lo, hi = max(lo, 6000), max(hi, 90000)
    p = price('so2:' + x['slug'], lo, hi)
    src = os.path.join(SRC, 'so2-img', x['slug'] + '.png')
    if not os.path.exists(src):
        continue
    convert(src, os.path.join(IMG_OUT, 'so2', x['slug'] + '.webp'))
    so2_models.setdefault(code, {'code': code, 'name': model, 'type': typ, 'shape': shape})
    coll = None
    if x.get('collection'):
        coll = slugify(x['collection'])
        so2_colls[coll] = x['collection']
    so2_items.append({'model': code, 'skin': x['skin'], 'rarity': rarity, 'price': p, 'image': f"/media/skins/so2/{x['slug']}.webp", 'collection': coll})
print('unknown SO2 colors', unknown_colors)

def ts_obj(d):
    parts = []
    for k, v in d.items():
        if v is None:
            continue
        parts.append(f'{k}: {json.dumps(v, ensure_ascii=False)}')
    return '{ ' + ', '.join(parts) + ' }'

def sort_models(ms):
    order = {'weapon': 0, 'knife': 1, 'gloves': 2}
    return sorted(ms.values(), key=lambda m: (order.get(m['type'], 3), m['name']))

lines = ['/**',
         ' * Настоящий демо-каталог: скины CS2 (ByMykel/CSGO-API, картинки Steam CDN) и Standoff 2 (skins4fps.com).',
         ' * Сгенерировано scripts/catalog/build_catalog.py — не править вручную. Картинки: apps/web/public/media/skins/.',
         ' * Цены в гемах — ориентировочные, детерминированные (для демо и тестов), правятся в админке.',
         ' */',
         "import type { ItemSeed, ModelSeed } from './catalog-data.js';", '']
def emit(name, typ, rows):
    lines.append(f'export const {name}: {typ}[] = [')
    for r in rows:
        lines.append('  ' + ts_obj(r) + ',')
    lines.append('];')
    lines.append('')
emit('CS2_MODELS', 'ModelSeed', sort_models(cs2_models))
lines.append('export const CS2_COLLECTIONS: Array<{ code: string; name: string }> = ' + json.dumps([{'code': k, 'name': v} for k, v in sorted(cs2_colls.items())], ensure_ascii=False) + ';')
lines.append('')
emit('CS2_ITEMS', 'ItemSeed', sorted(cs2_items, key=lambda i: (i['model'], i['skin'], bool(i.get('stattrak')))))
emit('SO2_MODELS', 'ModelSeed', sort_models(so2_models))
lines.append('export const SO2_COLLECTIONS: Array<{ code: string; name: string }> = ' + json.dumps([{'code': k, 'name': v} for k, v in sorted(so2_colls.items())], ensure_ascii=False) + ';')
lines.append('')
emit('SO2_ITEMS', 'ItemSeed', sorted(so2_items, key=lambda i: (i['model'], i['skin'])))
open(TS_OUT, 'w', encoding='utf-8').write('\n'.join(lines))
print('cs2', len(cs2_items), 'models', len(cs2_models), '| so2', len(so2_items), 'models', len(so2_models))
