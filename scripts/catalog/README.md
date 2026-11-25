# Демо-каталог из настоящих скинов

Скрипты собирают `packages/db/src/seed/real-catalog.ts` и картинки `apps/web/public/media/skins/{cs2,so2}/*.webp`
(400×200, предмет вписан по центру с полями). Нужны Python 3.10+ и Pillow.

```bash
python3 -m venv /tmp/catalog-venv && /tmp/catalog-venv/bin/pip install pillow
python3 scripts/catalog/select_cs2.py /tmp/catalog       # CS2: ByMykel/CSGO-API + картинки со Steam CDN
python3 scripts/catalog/crawl_so2.py /tmp/catalog        # Standoff 2: skins4fps.com (≈ 30 мин, можно прерывать)
/tmp/catalog-venv/bin/python scripts/catalog/build_catalog.py /tmp/catalog .
pnpm exec prettier --write packages/db/src/seed/real-catalog.ts
```

- **CS2** — по ~13 скинов на 18 популярных моделей оружия (известные скины плюс разброс по редкостям), ножи и перчатки;
  износ — один вариант на скин. Редкость — из данных API (ножи и перчатки — «Крайне редкий предмет»).
- **Standoff 2** — все скины оружия и ножей из категории «Weapon Skin» (без граффити, брелоков, фрагментов и кейсов).
  Редкость — по цвету на странице предмета: серый — обычное, голубой — необычное, синий — редкое, фиолетовый — эпическое,
  розовый — легендарное, красный — аркана, золотой — Nameless.
- **Цены** — ориентировочные и детерминированные: диапазон по редкости (у ножей и перчаток — свой), множитель износа,
  известные скины — ближе к верху диапазона. Реальные цены загружаются CSV-импортом в админке.
- Корневой сертификат прокси, если он нужен для HTTPS, — переменная `CATALOG_CA_FILE`.
