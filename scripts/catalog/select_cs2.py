"""Шаг 1 (CS2): выбор скинов из ByMykel/CSGO-API и загрузка их картинок со Steam CDN.

    python3 scripts/catalog/select_cs2.py <рабочая папка>

Результат в рабочей папке: cs2-skins.json (исходные данные), cs2-items.json (выбранные), cs2-img/*.png.
Свой корневой сертификат прокси (если нужен) — в переменной CATALOG_CA_FILE.
"""
import hashlib, json, os, re, ssl, sys, time, urllib.request

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
ctx = ssl.create_default_context(cafile=os.environ.get('CATALOG_CA_FILE') or None)
SKINS_URL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json'
skins_path = os.path.join(OUT, 'cs2-skins.json')
if not os.path.exists(skins_path):
    with urllib.request.urlopen(urllib.request.Request(SKINS_URL, headers={'User-Agent': 'Mozilla/5.0 (catalog import)'}), context=ctx, timeout=120) as r:
        open(skins_path, 'wb').write(r.read())
data = json.load(open(skins_path, encoding='utf-8'))

# Модели: код в каталоге, название, тип, форма (как в сидах)
WEAPONS = [
    ('weapon_ak47', 'ak47', 'AK-47', 'rifle'), ('weapon_m4a1', 'm4a4', 'M4A4', 'rifle'),
    ('weapon_m4a1_silencer', 'm4a1s', 'M4A1-S', 'rifle'), ('weapon_awp', 'awp', 'AWP', 'sniper'),
    ('weapon_ssg08', 'ssg08', 'SSG 08', 'sniper'), ('weapon_deagle', 'deagle', 'Desert Eagle', 'pistol'),
    ('weapon_usp_silencer', 'usps', 'USP-S', 'pistol'), ('weapon_glock', 'glock18', 'Glock-18', 'pistol'),
    ('weapon_p250', 'p250', 'P250', 'pistol'), ('weapon_fiveseven', 'fiveseven', 'Five-SeveN', 'pistol'),
    ('weapon_mp9', 'mp9', 'MP9', 'smg'), ('weapon_mac10', 'mac10', 'MAC-10', 'smg'),
    ('weapon_ump45', 'ump45', 'UMP-45', 'smg'), ('weapon_p90', 'p90', 'P90', 'smg'),
    ('weapon_galilar', 'galilar', 'Galil AR', 'rifle'), ('weapon_famas', 'famas', 'FAMAS', 'rifle'),
    ('weapon_xm1014', 'xm1014', 'XM1014', 'shotgun'), ('weapon_nova', 'nova', 'Nova', 'shotgun'),
]
FAMOUS = {
    'AK-47': ['Redline', 'Asiimov', 'Vulcan', 'Fire Serpent', 'Neon Rider', 'Bloodsport', 'The Empress', 'Fuel Injector', 'Case Hardened', 'Slate'],
    'AWP': ['Dragon Lore', 'Asiimov', 'Hyper Beast', 'Lightning Strike', 'Medusa', 'Containment Breach', 'Neo-Noir', 'Wildfire', 'Atheris'],
    'M4A4': ['Howl', 'Asiimov', 'Neo-Noir', 'The Emperor', 'Desolate Space', 'Buzz Kill', 'In Living Color'],
    'M4A1-S': ['Hyper Beast', 'Printstream', 'Golden Coil', 'Cyrex', 'Hot Rod', "Chantico's Fire", 'Decimator'],
    'Desert Eagle': ['Blaze', 'Printstream', 'Code Red', 'Kumicho Dragon', 'Ocean Drive', 'Mecha Industries'],
    'USP-S': ['Kill Confirmed', 'Neo-Noir', 'Printstream', 'Orion', 'Cortex', 'The Traitor'],
    'Glock-18': ['Fade', 'Water Elemental', 'Wasteland Rebel', 'Bullet Queen', 'Vogue', 'Gamma Doppler'],
    'P250': ['See Ya Later', 'Asiimov', 'Muertos'], 'Five-SeveN': ['Hyper Beast', 'Monkey Business', 'Angry Mob'],
    'MP9': ['Starlight Protector', 'Hydra', 'Mount Fuji'], 'MAC-10': ['Neon Rider', 'Disco Tech', 'Stalker'],
    'UMP-45': ['Primal Saber', 'Wild Child'], 'P90': ['Asiimov', 'Death by Kitty', 'Emerald Dragon'],
    'Galil AR': ['Chatterbox', 'Cerberus'], 'FAMAS': ['Commemoration', 'Roll Cage'],
    'SSG 08': ['Dragonfire', 'Blood in the Water'], 'XM1014': ['Tranquility', 'Entombed'], 'Nova': ['Hyper Beast', 'Antique'],
}
KNIVES = [
    ('weapon_knife_karambit', 'karambit', 'Karambit', ['Doppler', 'Fade', 'Tiger Tooth', 'Marble Fade', 'Lore', 'Gamma Doppler', 'Slaughter', 'Crimson Web', 'Case Hardened', 'Autotronic']),
    ('weapon_knife_m9_bayonet', 'm9', 'M9 Bayonet', ['Doppler', 'Fade', 'Marble Fade', 'Tiger Tooth', 'Lore', 'Crimson Web']),
    ('weapon_knife_butterfly', 'butterfly', 'Butterfly Knife', ['Fade', 'Doppler', 'Slaughter', 'Marble Fade']),
    ('weapon_bayonet', 'bayonet', 'Bayonet', ['Doppler', 'Lore', 'Autotronic']),
    ('weapon_knife_flip', 'flip', 'Flip Knife', ['Doppler', 'Fade']),
    ('weapon_knife_widowmaker', 'talon', 'Talon Knife', ['Fade', 'Doppler']),
    ('weapon_knife_skeleton', 'skeleton', 'Skeleton Knife', ['Fade', 'Case Hardened']),
]
GLOVES = [
    ('sporty_gloves', 'sport_gloves', 'Sport Gloves', ['Vice', "Pandora's Box", 'Hedge Maze', 'Superconductor', 'Amphibious']),
    ('slick_gloves', 'driver_gloves', 'Driver Gloves', ['King Snake', 'Crimson Weave', 'Imperial Plaid']),
    ('specialist_gloves', 'specialist_gloves', 'Specialist Gloves', ['Crimson Kimono', 'Fade']),
    ('leather_handwraps', 'hand_wraps', 'Hand Wraps', ['Cobalt Skulls']),
    ('motorcycle_gloves', 'moto_gloves', 'Moto Gloves', ['Spearmint']),
]
RARITY = {
    'rarity_common_weapon': 'consumer', 'rarity_uncommon_weapon': 'industrial', 'rarity_rare_weapon': 'milspec',
    'rarity_mythical_weapon': 'restricted', 'rarity_legendary_weapon': 'classified', 'rarity_ancient_weapon': 'covert',
    'rarity_contraband_weapon': 'contraband', 'rarity_ancient': 'rare_special',
}
WEAR_IDS = {'SFUI_InvTooltip_Wear_Amount_0': 'FN', 'SFUI_InvTooltip_Wear_Amount_1': 'MW', 'SFUI_InvTooltip_Wear_Amount_2': 'FT',
            'SFUI_InvTooltip_Wear_Amount_3': 'WW', 'SFUI_InvTooltip_Wear_Amount_4': 'BS'}

def h(s):
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

by_weapon = {}
for s in data:
    by_weapon.setdefault(s['weapon']['id'], []).append(s)

def skin_name(s):
    return s['name'].split(' | ', 1)[1] if ' | ' in s['name'] else (s.get('pattern') or {}).get('name', s['name'])

def pick_wear(s, prefer=('FT', 'MW', 'FN', 'WW', 'BS')):
    wears = [WEAR_IDS.get(w['id']) for w in s.get('wears') or []]
    for w in prefer:
        if w in wears:
            return w
    return None

chosen = []
def add(s, model_code, model_name, typ, shape, prefer=('FT', 'MW', 'FN', 'WW', 'BS')):
    rarity = RARITY.get(s['rarity']['id'])
    if typ in ('knife', 'gloves'):
        rarity = 'rare_special'
    if not rarity or not s.get('image'):
        return
    chosen.append({'model': model_code, 'modelName': model_name, 'type': typ, 'shape': shape, 'skin': skin_name(s),
                   'rarity': rarity, 'wear': pick_wear(s, prefer), 'image': s['image'], 'stattrak': bool(s.get('stattrak')),
                   'collection': (s.get('collections') or [{}])[0].get('name') if s.get('collections') else None})

for wid, code, name, shape in WEAPONS:
    pool = [s for s in by_weapon.get(wid, []) if s['rarity']['id'] in RARITY]
    names = FAMOUS.get(name, [])
    picked = []
    for n in names:
        for s in pool:
            if skin_name(s) == n and s not in picked:
                picked.append(s); break
    # добираем по редкостям до 10 штук, детерминированно
    # недостающее добираем сначала дешёвыми редкостями: кейсам нужен широкий разброс цен
    order = ['rarity_rare_weapon', 'rarity_uncommon_weapon', 'rarity_common_weapon', 'rarity_mythical_weapon', 'rarity_legendary_weapon', 'rarity_ancient_weapon']
    groups = {r: sorted([s for s in pool if s['rarity']['id'] == r and s not in picked], key=lambda s: h(s['name'])) for r in order}
    i = 0
    while len(picked) < 13 and any(groups.values()):
        r = order[i % len(order)]
        if groups[r]:
            picked.append(groups[r].pop(0))
        i += 1
    for s in picked:
        add(s, code, name, 'weapon', shape)
for wid, code, name, finishes in KNIVES:
    pool = by_weapon.get(wid, [])
    for f in finishes:
        s = next((x for x in pool if skin_name(x) == f), None)
        if s:
            add(s, code, name, 'knife', 'knife', prefer=('FN', 'MW', 'FT', 'WW', 'BS'))
for wid, code, name, finishes in GLOVES:
    pool = by_weapon.get(wid, [])
    for f in finishes:
        s = next((x for x in pool if skin_name(x) == f), None)
        if s:
            add(s, code, name, 'gloves', 'gloves', prefer=('FT', 'MW', 'FN', 'WW', 'BS'))

print('chosen', len(chosen))
os.makedirs(os.path.join(OUT, 'cs2-img'), exist_ok=True)
def slug(x):
    return re.sub(r'[^a-z0-9]+', '-', (x['model'] + '-' + x['skin']).lower()).strip('-')
seen = set()
final = []
for x in chosen:
    sl = slug(x)
    if sl in seen:
        continue
    seen.add(sl)
    x['slug'] = sl
    path = os.path.join(OUT, 'cs2-img', sl + '.png')
    if not os.path.exists(path):
        try:
            req = urllib.request.Request(x['image'], headers={'User-Agent': 'Mozilla/5.0 (catalog import)'})
            with urllib.request.urlopen(req, context=ctx, timeout=40) as r:
                open(path, 'wb').write(r.read())
            time.sleep(0.15)
        except Exception as e:  # noqa: BLE001
            print('ERR', sl, e); continue
    final.append(x)
json.dump(final, open(os.path.join(OUT, 'cs2-items.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('saved', len(final))
