"""Шаг 2 (Standoff 2): скины со skins4fps.com — список, редкость (цвет), коллекция, картинка.

    python3 scripts/catalog/crawl_so2.py <рабочая папка>

Вежливо: запросы по одному с паузой; можно прервать и запустить снова — продолжит с места остановки.
Результат: so2-list.json, so2-items.json, so2-img/*.png. Сертификат прокси — CATALOG_CA_FILE.
"""
import html, json, os, re, ssl, sys, time, urllib.request

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
ctx = ssl.create_default_context(cafile=os.environ.get('CATALOG_CA_FILE') or None)

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (catalog import)'})
    with urllib.request.urlopen(req, context=ctx, timeout=40) as r:
        return r.read()

list_path = os.path.join(OUT, 'so2-list.json')
if not os.path.exists(list_path):
    found, page = [], 1
    while True:
        h = get(f'https://skins4fps.com/category/weapon-skin/?meta_slug=weapon-skin&page={page}').decode('utf-8', 'replace')
        rows = re.findall(r'<a href="/items/([^"/]+)/" class="text-decoration-none">\s*<img src="([^"]+)" class="card-img-top" alt="([^"]+)"', h)
        if not rows:
            break
        found += [(slug, html.unescape(title), img) for slug, img, title in rows]
        page += 1
        time.sleep(1)
    json.dump(found, open(list_path, 'w', encoding='utf-8'), ensure_ascii=False)
LIST = json.load(open(list_path, encoding='utf-8'))
SKIP_MODELS = {'Graffiti', 'Chibi', 'Fragment', 'Weapon Case', 'Knife Case', 'Item', 'Flash', 'HE', 'Molotov', 'Smoke'}
os.makedirs(os.path.join(OUT, 'so2-img'), exist_ok=True)
res_path = os.path.join(OUT, 'so2-items.json')
done = {}
if os.path.exists(res_path):
    done = {x['slug']: x for x in json.load(open(res_path, encoding='utf-8'))}

items = list(done.values())
for slug, title, img in LIST:
    m = re.match(r'(.+?) "(.+)"$', title)
    if not m:
        continue
    model, skin = m.group(1).strip(), m.group(2).strip()
    if model in SKIP_MODELS or slug in done:
        continue
    try:
        page = get(f'https://skins4fps.com/items/{slug}/').decode('utf-8', 'replace')
        badges = [html.unescape(b) for b in re.findall(r'<span class="badge[^"]*"[^>]*>([^<]+)</span>', page)]
        coll = re.search(r'<strong class="text-dark">Collection:</strong>\s*([^<]+)</p>', page)
        time.sleep(0.4)
        png = get(img)
        with open(os.path.join(OUT, 'so2-img', slug + '.png'), 'wb') as f:
            f.write(png)
        rec = {'slug': slug, 'title': title, 'model': model, 'skin': skin, 'badges': badges,
               'collection': html.unescape(coll.group(1)).strip() if coll else None}
        items.append(rec)
        done[slug] = rec
    except Exception as e:  # noqa: BLE001
        print('ERR', slug, e, flush=True)
    if len(items) % 25 == 0:
        json.dump(items, open(res_path, 'w', encoding='utf-8'), ensure_ascii=False)
        print('progress', len(items), flush=True)
    time.sleep(0.4)
json.dump(items, open(res_path, 'w', encoding='utf-8'), ensure_ascii=False)
print('DONE', len(items), flush=True)
