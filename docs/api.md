# GunRaid — API

> Статус: **предложение этапа 0.** Контракты будут описаны zod-схемами в `packages/shared`; из них же генерируется OpenAPI (`/api/docs` в dev).

## Соглашения

- Базовый путь `/api/v1`, JSON. `{game}` = `standoff2` | `cs2`.
- Все суммы в запросах и ответах — целые гемы. Реальная валюта встречается только в пополнении (сумма и валюта оплаты).
- Ошибки: `{"error": {"code": "INSUFFICIENT_BALANCE", "details": {…}}}` + HTTP-статус. Текст ошибки выбирает фронт по коду (i18n).
- Аутентификация — httpOnly cookie. Все мутирующие запросы требуют CSRF-заголовок.
- Игровые и платёжные мутации требуют `Idempotency-Key` (в таблицах — **IK**) и попадают под rate limit.
- Пагинация: истории и ленты — курсором (`?cursor=&limit=`), каталог — страницами (`?page=`, удобно для SSR и SEO).
- Доступ: **P** — публично, **U** — вошедший пользователь (для игровых действий ещё и подтверждённые 18+), **S** — support, **A** — admin.

## Вход

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/auth/steam` | P | редирект в Steam (`?intent=login\|link`) |
| GET | `/auth/steam/callback` | P | проверка OpenID, вход или привязка, редирект на сайт |
| GET | `/auth/google`, `/auth/google/callback` | P | OAuth 2.0 + PKCE |
| POST | `/auth/telegram` | P | данные Login Widget → вход или привязка |
| POST | `/auth/dev-login` | только dev | вход тестовым пользователем — **если согласуем** (см. вопросы) |
| POST | `/auth/refresh` | P | ротация refresh-токена |
| POST | `/auth/logout` | U | выход |
| POST | `/auth/logout-all` | U | выход со всех устройств |
| DELETE | `/me/identities/{provider}` | U | отвязать способ входа (последний отвязать нельзя) |

## Профиль

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/me` | U | профиль, баланс, уровень и XP, роль, настройки, привязки |
| POST | `/me/confirm-age` | U | подтверждение 18+ |
| PATCH | `/me/settings` | U | звук, «быстро» по умолчанию, выбранная игра, ник |
| PUT | `/me/games/{game}/profile` | U | trade-ссылка CS2 (проверка формата) / ID Standoff 2 |
| GET | `/me/stats?game=` | U | открыто кейсов, сумма пополнений, лучший дроп, победы в режимах |
| GET | `/me/history/{kind}?game=&cursor=` | U | `drops`, `upgrades`, `contracts`, `battles`, `deposits`, `withdrawals`, `promocodes`, `bonuses` |
| GET | `/me/transactions?cursor=` | U | движение баланса (ledger) |
| GET | `/me/referral` | U | код и ссылка, число рефералов, доход |
| GET | `/me/achievements` | U | ачивки и прогресс |
| GET | `/me/entitlements` | U | доступные бесплатные кейсы, спины, бонусы к пополнению |
| GET | `/me/notifications?cursor=` | U | колокольчик |
| POST | `/me/notifications/read` | U | отметить прочитанными |
| GET | `/users/{shortId}?game=` | P | публичный профиль: ник, уровень, лучший дроп, последние дропы |

## Provably fair

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/fair/seed` | U | хэш текущего server seed, client seed, nonce |
| PUT | `/fair/client-seed` | U | новый client seed (с ротацией пары) |
| POST | `/fair/rotate` | U | раскрыть текущий server seed, выдать новую пару |
| GET | `/fair/seeds?cursor=` | U | раскрытые сиды |
| GET | `/fair/proof/{type}/{id}` | P | данные для проверки результата (`case_opening`, `upgrade`, `contract`, `wheel_spin`, `battle`) — после раскрытия сида |

## Каталог и кейсы

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/games` | P | список игр |
| GET | `/games/{game}/rarities` | P | редкости |
| GET | `/games/{game}/items` | P | все предметы: `q`, `rarity`, `type`, `model`, `priceMin`, `priceMax`, `stattrak`, `sort`, `page` |
| GET | `/games/{game}/items/facets` | P | значения для фильтров |
| GET | `/games/{game}/items/{id}` | P | предмет + кейсы, где встречается, и шанс |
| GET | `/games/{game}/home` | P | категории с кейсами, баннеры |
| GET | `/games/{game}/cases/{slug}` | P | цена, содержимое с шансами, тираж; для U — доступность бесплатного кейса и кулдаун |
| POST | `/games/{game}/cases/{slug}/open` | U, IK | `{count: 1..5, entitlementId?}` → результаты и данные для рулетки |
| GET | `/games/{game}/feed` | P | последние дропы (дальше — по WS) |
| GET | `/stats` | P | онлайн, открыто кейсов, пользователей |
| GET | `/config` | P | публичные настройки: курс гемов (`gemsPerUsd`) для подсказки на балансе, контакт поддержки, игры |

## Инвентарь

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/games/{game}/inventory` | U | `status`, `sort` (цена / редкость / дата), `cursor`; сумма предметов |
| POST | `/games/{game}/inventory/sell` | U, IK | `{userItemIds}` или `{all: true}` |

## Апгрейд и контракт

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/games/{game}/upgrade/config` | P | комиссия, мин./макс. шанс, множители |
| GET | `/games/{game}/upgrade/targets` | P | цели из каталога: `minPrice`, `maxPrice`, `q`, `sort`, `page`, `pageSize` |
| POST | `/games/{game}/upgrade` | U, IK | `{userItemIds}` (1–10) или `{amount}` + `targetItemId` → результат (шанс и бросок в миллионных) |
| GET | `/games/{game}/upgrade/history` | U | последние апгрейды пользователя |
| GET | `/games/{game}/contract/config` | P | лимиты предметов, коэффициенты, вероятность получить больше вложенного |
| POST | `/games/{game}/contract` | U, IK | `{userItemIds}` (по настройкам: 3–10) → результат |
| GET | `/games/{game}/contract/history` | U | последние контракты пользователя |

## Кейс-баттлы

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/games/{game}/battles/config` | P | лимит кейсов, длительность раунда, обратный отсчёт, боты, таймаут лобби |
| GET | `/games/{game}/battles/cases` | P | кейсы, доступные для баттлов (платные, без тиража, уровня и кулдауна) |
| GET | `/games/{game}/battles` | P | `status=active\|finished`, `format`, `mode`, `minPrice`, `maxPrice`, `mine=1`, `page`, `pageSize` |
| POST | `/games/{game}/battles` | U, IK | `{cases: [{caseId, count}], format, mode}` — создать, оплатить и занять место 1 |
| GET | `/battles/{id}` | P | состояние; раунды видны с момента их вращения, итог и server seed — после завершения |
| POST | `/battles/{id}/join` | U, IK | `{slot?}` — занять место (в 2×2 место определяет команду) |
| POST | `/battles/{id}/bots` | U | создатель заполняет свободные места ботами; `{clientSeed?}` — сид из браузера для ботов |
| POST | `/battles/{id}/cancel` | U | создатель до старта; возврат всем участникам |
| GET | `/fair/proof/battle/{id}` | P | сиды участников, client seed баттла, составы кейсов и билеты по раундам, бросок ничьей |

## Бонусы

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/games/{game}/wheel` | P | призы с весами; для U — доступность, причина блокировки (кулдаун, возраст аккаунта, нет пополнения), таймер, доп. вращения, история |
| POST | `/games/{game}/wheel/spin` | U, IK | вращение: бесплатное раз в N часов или доп. вращение по бонусу; приз — provably fair |
| GET | `/fair/proof/wheel_spin/{id}` | P | данные для проверки вращения (сиды, nonce, билет, веса призов на момент вращения) |
| GET | `/bonuses/daily` | U | стрик, награда за сегодня, когда следующий |
| POST | `/bonuses/daily/claim` | U, IK | забрать ежедневный бонус (один раз за «день сайта») |
| POST | `/promo/activate` | U | `{code, game?}`; лимит 6 запросов в минуту против перебора |
| GET | `/me/entitlements` | U | активные бонусы: бесплатные кейсы, доп. вращения, бонусы к пополнению |
| GET | `/me/level` | U | уровень, XP, порог следующего уровня и награда за него |
| GET | `/levels` | P | таблица уровней и наград |
| GET | `/me/referrals` | U | реферальный код, процент, приглашённые, пополнившие, заработано |
| GET | `/me/achievements` | U | достижения с прогрессом |
| GET | `/users/{shortId}/achievements` | P | полученные достижения игрока |
| GET | `/games/{game}/leaderboards` | P | день и неделя: топ-20, призы, моя позиция, победители прошлого периода |
| GET | `/notifications` | U | последние уведомления и число непрочитанных |
| POST | `/notifications/read` | U | `{ids?}` — отметить прочитанными (все, если без ids) |

Бесплатное открытие кейса по бонусу — `POST /games/{game}/cases/{slug}/open` с `{count: 1, useBonus: true}`; в `availability.freeOpens` — сколько таких открытий есть. Бонус к пополнению применяется автоматически: котировка показывает `entitlementBonusGems`, право тратится при зачислении.

## Пополнение (тестовое)

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/payments/methods` | U | методы и валюты оплаты, минимальные суммы, курс «100 гемов = $1» |
| POST | `/deposits/quote` | U | `{method, currency, amount}` → сколько гемов будет начислено, бонус за первое пополнение и бонус по праву, курс, срок действия котировки |
| POST | `/deposits` | U, IK | `{quoteId}` → URL оплаты; зачисление строго по котировке |
| GET | `/deposits/{id}` | U | статус |
| POST | `/payments/webhook/{provider}` | подпись | вебхук провайдера |
| POST | `/payments/mock/{id}/complete` | **заглушка** | страница тестовой оплаты: «успех» / «ошибка» → подписанный вебхук |

## Вывод

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| POST | `/games/{game}/withdrawals` | U, IK | `{userItemId}` — заявка на вывод |
| GET | `/withdrawals?cursor=`, `/withdrawals/{id}` | U | мои выводы и статус |
| POST | `/withdrawals/{id}/listing` | U | Standoff 2: данные выставленного на рынок лота |
| POST | `/withdrawals/{id}/cancel` | U | отмена, пока заявку не взяли в работу |

## Админка — `/api/v1/admin/…`

| Раздел | Эндпоинты | Доступ |
|---|---|---|
| Дашборд | `GET dashboard?from&to&game` — пользователи, пополнения, выводы, GGR, фактический и целевой RTP по режимам; `GET ledger/reconciliation` | A |
| Каталог | CRUD `items`, `rarities`, `item-types`, `item-models`, `collections`; `POST items/import` (CSV), `GET imports/{id}`; `POST items/bulk-price` (по фильтру: % или сумма) | A |
| Кейсы | CRUD `cases`, `case-categories`, `banners`; `PUT cases/{id}/contents` (проверка суммы 100 %, новая ревизия); `POST cases/rtp-preview` | A |
| Настройки | `GET/PUT settings/{key}` — currency (курс гемов), deposit, upgrade, contract, battle, sell, wheel, daily, first_deposit, referral, xp, antifraud, withdrawal, feed, site | A |
| Бонусы | CRUD `wheel-prizes`, `promo-codes` (+ статистика), `partners` (+ статистика), `levels`, `achievements`, `leaderboards` (+ результаты периодов) | A |
| Пользователи | `GET users?q=`; `GET users/{id}` — профиль, ledger, инвентарь, история, IP и устройства, связанные аккаунты; `POST users/{id}/ban`, `unban`; `POST users/{id}/balance-adjustments` (± гемы, причина обязательна, IK); `PATCH users/{id}` (флаг подозрительного; роль — только A); заметки | S — чтение, A — всё |
| Выводы | `GET withdrawals?status=`; `POST withdrawals/{id}/approve`, `reject`, `confirm-purchase` (Standoff 2), `simulate/{event}` (заглушка CS2) | S / A (по согласованию) |
| Пополнения | `GET deposits` (с реальной суммой и валютой оплаты); CRUD `fx-rates` — курсы валют оплаты к доллару | A |
| Аудит | `GET audit-log` | A |

## WebSocket (Socket.IO, `/socket.io`)

Клиент → сервер: `subscribe` / `unsubscribe` на комнаты `feed:{game}`, `battles:{game}`, `battle:{id}`, `case:{id}`. Комната `user:{id}` подключается автоматически после входа. Никаких игровых действий через WS.

| Событие (сервер → клиент) | Комната | Данные |
|---|---|---|
| `feed:drop` | `feed:{game}` | игрок, предмет, источник (кейс / апгрейд / контракт / баттл) |
| `stats:update` | все | онлайн, открыто кейсов |
| `case:supply` | `case:{id}` | остаток тиража |
| `battles:upsert`, `battles:remove` | `battles:{game}` | изменения списка лобби |
| `battle:state` | `battle:{id}` | полное состояние (`BattleDto`): участники, статус, `startsAt` |
| `battle:round` | `battle:{id}` | дропы раунда и `spinStartAt` (приходит за 1 с до старта вращения) |
| `battle:finished` | `battle:{id}` | итоговое состояние: победители, выигрыши, раскрытый server seed |
| `balance:update` | `user:{id}` | новый баланс |
| `inventory:update` | `user:{id}` | изменения инвентаря |
| `notification:new` | `user:{id}` | уведомление |
| `time:sync` | — | серверное время для синхронизации рулеток |
