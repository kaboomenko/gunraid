# GunRaid

Сервис открытия кейсов, апгрейдов, контрактов и кейс-баттлов со скинами для **Standoff 2** и **CS2**.
Внутренняя валюта — гемы (100 гемов = $1, курс — в настройках).

**Статус:** готовы этапы 1–7 (каркас, вход, каталог, инвентарь, ledger, тестовое пополнение, кейсы, provably fair, лента дропов, апгрейд, контракт, кейс-баттлы в реальном времени, бонусы: колесо, промокоды, ежедневный бонус, уровни, рефералы, лидерборды, достижения, уведомления; вывод предметов (CS2 — заглушка маркета, Standoff 2 — ручной поток) и админка `/admin`). Ход работ и принятые допущения — [docs/progress.md](docs/progress.md).

## Запуск одной командой

```bash
docker compose up --build
```

Сайт: http://localhost:8080. Миграции и сиды применяются автоматически (контейнер `migrate`).
Для входа без ключей Steam/Google/Telegram есть **тестовый вход** (кнопка «Войти» → «Тестовый вход»): он работает только при `AUTH_DEV_LOGIN=true` и никогда — при `APP_ENV=production`.

Демо-промокоды: `GUNRAID`, `BONUS10`, `FREECASE`, `SPIN`, `NEWBIE`, `SKINSO2`. Админка — `/admin` (тестовый вход «Админ» или «Поддержка»).

Переменные окружения — в [.env.example](.env.example); для локального запуска их задавать не нужно.

## Разработка с горячей перезагрузкой

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
docker compose up -d postgres redis
```

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

В режиме `pnpm dev` фронт открывается на http://localhost:3000 (`API_DEV_PROXY=http://localhost:4000` проксирует `/api` на API), API — на http://localhost:4000.

## Проверки

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Интеграционные тесты API работают на настоящих PostgreSQL и Redis (`docker compose up -d postgres redis`); тестовая база `gunraid_test` создаётся автоматически.

## Структура

```
apps/api      NestJS 12 (Fastify, ESM): REST /api/v1 + Socket.IO; worker.ts — фоновые задачи
apps/web      Next.js 16: сайт (SSR) и админка /admin
packages/shared  zod-контракты, коды ошибок, настройки, гемы
packages/db      Drizzle-схема, SQL-миграции, сиды
infra         Dockerfile'ы и Caddyfile
docs          архитектура, схема БД, API, план этапов
```

## Документы

- [ТЗ](GUNRAID_SPEC.md) — с журналом правок
- [Архитектура и стек](docs/architecture.md)
- [Схема БД](docs/database.md)
- [API и WebSocket-события](docs/api.md)
- [План этапов](docs/roadmap.md)
- [Открытые вопросы и принятые допущения](docs/open-questions.md)

Брендовые файлы — `assets/brand/` (оригинальный логотип, версия со склеенными контурами и эмблема).
