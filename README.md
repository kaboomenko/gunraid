# GunRaid

Сервис открытия кейсов, апгрейдов, контрактов и кейс-баттлов со скинами для **Standoff 2** и **CS2**.
Внутренняя валюта — гемы (100 гемов = $1, курс — в настройках).

**Статус:** готовы все этапы 1–8: каркас и вход, каталог, инвентарь, ledger, тестовое пополнение, кейсы, provably fair, лента дропов, апгрейд, контракт, кейс-баттлы в реальном времени, бонусы (колесо, промокоды, ежедневный бонус, уровни, рефералы, лидерборды, достижения, уведомления), вывод предметов (CS2 — заглушка маркета, Standoff 2 — ручной поток), админка `/admin`, правовые страницы (черновики с пометкой «TODO: юрист»), FAQ, SEO, мобильная версия, e2e и нагрузочные тесты. Ход работ, допущения и что осталось до запуска — [docs/progress.md](docs/progress.md).

## Запуск одной командой

```bash
docker compose up --build
```

Сайт: http://localhost:8080. Миграции и сиды применяются автоматически (контейнер `migrate`).
Для входа без ключей Steam/Google/Telegram есть **тестовый вход** (кнопка «Войти» → «Тестовый вход»): он работает только при `AUTH_DEV_LOGIN=true` и никогда — при `APP_ENV=production`.

Демо-промокоды: `GUNRAID`, `BONUS10`, `FREECASE`, `SPIN`, `NEWBIE`, `SKINSO2`. Админка — `/admin` (тестовый вход «Админ» или «Поддержка»).

Переменные окружения — в [.env.example](.env.example); для локального запуска их задавать не нужно.

## Запуск на Mac

1. Установите [Docker Desktop](https://www.docker.com/products/docker-desktop/) — для Mac с чипом Apple (M1 и новее) версию «Apple Silicon», для старых — «Intel». Запустите его и дождитесь статуса «Engine running».
2. Скачайте код: на странице репозитория **Code → Download ZIP** и распакуйте архив. Или в «Терминале»:

   ```bash
   git clone https://github.com/kaboomenko/gunraid.git
   ```

3. В «Терминале» перейдите в папку проекта (наберите `cd `, перетащите папку в окно и нажмите Enter) и запустите:

   ```bash
   docker compose up -d --build --wait
   ```

   Первая сборка занимает 5–15 минут; когда всё поднимется, команда вернёт приглашение «Терминала».

4. Откройте сайт:

   ```bash
   open http://localhost:8080
   ```

Остановить — `docker compose down` (данные сохранятся), начать с чистой базой — `docker compose down -v`.

| Если видите                                                                                    | Что сделать                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot connect to the Docker daemon` или `command not found: docker`                          | Docker Desktop не установлен или не запущен                                                                                                      |
| `port is already allocated` про порт 8080                                                      | запустить на другом порту: `HTTP_PORT=8081 PUBLIC_URL=http://localhost:8081 docker compose up -d --build --wait` и открыть http://localhost:8081 |
| `port is already allocated` про 5432 или 6379 (на Маке уже работает свой PostgreSQL или Redis) | `POSTGRES_PORT=5433 REDIS_PORT=6380 docker compose up -d --build --wait`                                                                         |
| сборка обрывается: `killed`, `exit code 137`                                                   | Docker Desktop → Settings → Resources → Memory: 4 ГБ или больше                                                                                  |

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

Сквозные тесты в браузере (Playwright, десктоп и телефон) и нагрузочный прогон — против поднятого стека:

```bash
pnpm e2e
```

```bash
pnpm load
```

Подробно — [docs/testing.md](docs/testing.md).

## Структура

```
apps/api      NestJS 12 (Fastify, ESM): REST /api/v1 + Socket.IO; worker.ts — фоновые задачи
apps/web      Next.js 16: сайт (SSR) и админка /admin
packages/shared  zod-контракты, коды ошибок, настройки, гемы
packages/db      Drizzle-схема, SQL-миграции, сиды
packages/game-core  provably fair и игровая математика (общая для сервера и браузера)
tests/e2e     сквозные тесты Playwright
tests/load    нагрузочный и конкурентный прогон
infra         Dockerfile'ы и Caddyfile
docs          архитектура, схема БД, API, план этапов
```

## Документы

- [ТЗ](GUNRAID_SPEC.md) — с журналом правок
- [Архитектура и стек](docs/architecture.md)
- [Схема БД](docs/database.md)
- [API и WebSocket-события](docs/api.md)
- [План этапов](docs/roadmap.md)
- [Тестирование: e2e, нагрузка, результаты](docs/testing.md)
- [Открытые вопросы и принятые допущения](docs/open-questions.md)

Брендовые файлы — `assets/brand/` (оригинальный логотип, версия со склеенными контурами и эмблема).
