# GunRaid — API

> Статус: **предложение этапа 0.** Контракты будут описаны zod-схемами в `packages/shared`; из них же генерируется OpenAPI (`/api/docs` в dev).

## Соглашения

- Базовый путь `/api/v1`, JSON. `{game}` = `standoff2` | `cs2`.
- Все суммы в запросах и ответах — целые гемы. Реальная валюта встречается только в пополнении (сумма и валюта оплаты).
- Ошибки: `{"error": {"code": "INSUFFICIENT_BALANCE", "details": {…}}}` + HTTP-статус. Текст ошибки выбирает фронт по коду (i18n).
- Строки в теле, запросе и адресе с NUL (U+0000) или половиной суррогатной пары PostgreSQL не сохранит — любая ручка
  отвечает 400 `VALIDATION_ERROR` с `details: [{path, code: 'invalid_text', message}]` (проверка в `ZodPipe`).
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
| GET | `/fair/proof/{type}/{id}` | P | данные для проверки результата (`case_opening`, `upgrade`, `contract`, `wheel_spin`, `battle`, `cargo`) — после раскрытия сида |

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

## Ивентовые грузы

Груз — розыгрыш одного приза среди купленных мест. Шаблон (вид груза) задаёт приз, число мест N, цену места, лимит
на игрока, длительность и условия; раунд — текущий розыгрыш шаблона со снимком этих значений. Места нумеруются
подряд 1…N в порядке покупки; раунд приземляется сразу при распродаже или по таймеру (если продано ≥ 1 места и не
меньше минимума продаж, если он задан); победитель — владелец выигравшего места среди проданных.

| Метод | Путь | Доступ | Что делает |
|---|---|---|---|
| GET | `/games/{game}/cargo` | P | грузы с открытым раундом (по порядку): `{items: CargoCardDto[], serverTime}` |
| GET | `/games/{game}/cargo/{slug}` | P (U — своя доступность) | шаблон, текущий раунд (`round`, хэш server seed с первой секунды), `noRound` (`PRIZE_UNAVAILABLE` / `STARTING`), доступность покупки (`reason`, `maxBuy`, свои места и client seed'ы), последний итог `lastResult` и `lastResultMySeats` — сколько мест вошедший купил в этом раунде (0 — гость или не участвовал: по нему страница узнаёт участника, даже если места куплены в другой вкладке), `serverTime`; 404 `CARGO_NOT_FOUND` — нет шаблона или он выключен и раунда нет |
| POST | `/games/{game}/cargo/{slug}/buy` | U, IK | `{roundId, count: 1..10 000, clientSeed}` → места `seatFrom…seatTo`, списание, раунд после покупки; если покупка заняла последнее место — `result` (итог) и `next` (новый раунд) |
| GET | `/fair/proof/cargo/{id}` | P (U — `mine`) | доказательство раунда: покупки по порядку мест (без покупателей), server seed после завершения, client seed раунда, выигравшее место или `voidSeat`, цена места (`seatPrice`), срок (`endsAt`), причина закрытия и минимум продаж — страница проверки сверяет причину с числами раунда; лимит `general` |

`clientSeed` в покупке **обязателен** (`^[A-Za-z0-9_-]{8,64}$`, иначе 400 `VALIDATION_ERROR`): сервер не подставляет
свой; сайт шлёт случайный. Ответ эхом отдаёт `clientSeed` и `serverSeedHash`, оба пишутся в meta записи ledger.

Ошибки покупки: 403 `CARGO_CONDITIONS_NOT_MET {reason: 'LEVEL', level} | {reason: 'NO_DEPOSIT', days}`;
402 `INSUFFICIENT_BALANCE`; 404 `CARGO_NOT_FOUND`; 409 `CARGO_ROUND_CLOSED {reason: 'stale' | 'status' | 'deadline'}`
(не тот раунд, раунд завершён, срок вышел — клиент перечитывает груз), `CARGO_SEATS_LEFT {left}` (без частичной
продажи), `CARGO_LIMIT_REACHED {limit, mine}`. Доказательство: 404 `CARGO_ROUND_NOT_FOUND`.

Причины `availability.reason`: `LOGIN`, `ADULT`, `LEVEL`, `NO_DEPOSIT`, `LIMIT`, `SOLD_OUT`, `CLOSED` (срок вышел,
приземление вот-вот), `UNAVAILABLE` (раунда нет). `maxBuy` — сколько мест можно взять за раз (для гостя — как будто
вошёл; для `ADULT` / `LEVEL` / `NO_DEPOSIT` — как без этих условий: от него шанс на карточке приза).

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
| GET | `/games/{game}/withdrawals/requirements` | U | условия: trade-ссылка / ID игрока, Steam, сумма пополнений, задержка после первого пополнения, лимит нового аккаунта |
| POST | `/games/{game}/withdrawals` | U, IK | `{userItemId}` — заявка; предмет переходит в статус «на выводе» |
| GET | `/withdrawals?game=`, `/withdrawals/{id}` | U | мои выводы, статус и история событий |
| POST | `/withdrawals/{id}/listing` | U | Standoff 2: `{reference, note?}` — лот выставлен на рынок |
| POST | `/withdrawals/{id}/cancel` | U | отмена, пока заявку не одобрили (или пока не выставлен лот) |

## Админка — `/api/v1/admin/…`

| Раздел | Эндпоинты | Доступ |
|---|---|---|
| Дашборд | `GET dashboard?days&game` — пользователи, пополнения, выводы, бонусы, GGR, фактический и целевой RTP по режимам (`cases`, `upgrade`, `contract`, `battles`, `cargo`), результат сверки ledger; `GET ledger/reconciliation` | A |
| Пользователи | `GET users?q&status&suspicious&role`; `GET users/{id}` — профиль, способы входа, профили игр, статистика, входы (IP и устройства), связанные аккаунты; `GET users/{id}/ledger` | S, A |
| | `POST users/{id}/balance` (± гемы, причина обязательна, IK); `POST users/{id}/ban` / `unban`; `PATCH users/{id}` (подозрительный, заметка, роль) | A |
| Выводы | `GET withdrawals?status`; `GET withdrawals/{id}`; `POST withdrawals/{id}/approve` (`{priceGold}` для Standoff 2), `reject` (`{reason}`), `confirm-purchase` (Standoff 2), `simulate` (`{event}` — **заглушка** CS2) | S, A |
| Пополнения | `GET deposits?status` | A |
| Настройки | `GET settings` (значения и значения по умолчанию); `PUT settings/{key}` — валидация схемой ключа; `GET fx-rates`, `PUT fx-rates/{currency}` | A |
| Кейсы | `GET games/{game}/case-categories`; `GET games/{game}/cases`; `POST games/{game}/cases`; `PUT games/{game}/cases/{id}`; `GET cases/{id}`; `PUT cases/{id}/contents` — сумма шансов ровно 100 %, новая неизменяемая ревизия | A |
| Каталог | `GET games/{game}/items?q&rarity&active`; `PATCH items/{id}` (цена, флаги); `POST games/{game}/items/bulk-price` (процент или цена по фильтру); `GET games/{game}/rarities`, `PATCH rarities/{id}`; `POST catalog/{game}/import` (CSV), `POST catalog/{game}/refresh-prices` | A |
| Бонусы | `GET/POST games/{game}/wheel-prizes`, `PUT …/{id}`; `GET/POST promo-codes`, `PUT promo-codes/{id}`; `GET/POST partners`, `PUT partners/{id}` (со статистикой); `PUT levels`; `GET leaderboards`, `PUT leaderboards/{id}`; `GET achievements`, `PATCH achievements/{id}`; `GET games/{game}/refs?q` (кейсы и предметы для форм) | A |
| Грузы | `GET games/{game}/cargo?archived=1` — шаблоны по порядку (архивные скрыты; с `archived=1` — в конце списка): приз, RTP при распродаже, открытый раунд (продано, выручка, участники, RTP при текущих продажах, попытки приземления и последняя ошибка), `issue`; `POST games/{game}/cargo` — создать (активный сразу получает раунд №1); `GET cargo/{id}`; `PUT games/{game}/cargo/{id}` — правка; `DELETE cargo/{id}` — в архив; `GET cargo/{id}/rounds?status&page&pageSize` — история раундов (новые первыми); `GET cargo-rounds/{id}` — раунд с участниками; `POST cargo-rounds/{id}/cancel` (`{reason}` от 5 символов) — отмена с возвратом гемов; `GET cargo-reconciliation` — сверка грузов с ledger (`{ok, mismatches, checkedAt}`) | A |
| Аудит | `GET audit?entityType&entityId` | A |

Все изменения из админки пишутся в `admin_audit_log` (кто, что, до/после, причина, IP). Балансы меняются только через ledger.

**Грузы в админке.** Тело создания и правки — все поля шаблона сразу (`adminCargoSchema`, без лишних ключей). Приз,
места, цена, лимит, длительность, условия и минимум продаж действуют со следующего раунда (идущий раунд живёт по
снимку), название, картинка, порядок и активность — сразу; выключенный груз доигрывает текущий раунд, новый не
начнётся; включённый груз без раунда получает его сразу. Бесплатный груз (`seatPrice: 0`) сохраняется с лимитом 1.
Адрес (slug) задаётся при создании и потом не меняется: по нему сид при выкладке узнаёт свои грузы (переименованный
сидовый груз создался бы заново с новым раундом), на него ведут ссылки. «Удаление» — архив: груз только читается, его
адрес остаётся занятым, раунды больше не открываются; архив
возможен только без открытого раунда — у активного груза отмена сразу открывает следующий раунд, поэтому сначала груз
выключают, затем отменяют раунд. Отмена раунда — в одной транзакции: возврат каждому платившему (одна запись
`cargo_refund` на игрока, уведомление со ссылкой на проверку раунда `/provably-fair?cargo={id}` — страница груза у
выключенного груза без раунда отвечает 404), client seed раунда и место, которое выиграло бы (`voidSeat`, публично на
странице проверки), следующий раунд; XP за отменённый раунд не начисляется. id из адреса приводится к нижнему регистру.
`issue` (первое подходящее): `LANDING_STUCK` — раунд открыт, но распродан или срок вышел больше минуты назад;
`PRIZE_INACTIVE` / `PRIZE_GAME` — приз выключен или из другой игры (новый раунд не начнётся); `NO_ROUND` — груз
активен, а раунда нет.

Ошибки: 400 `CARGO_PRIZE_INVALID {reason: 'missing' | 'game' | 'inactive'}` — приз не активный предмет этой игры (при
правке тот же приз не перепроверяется: выключенный в каталоге приз не мешает выключить или переименовать груз);
400 `VALIDATION_ERROR {field: 'perUserLimit' | 'minSeatsToLand'}` — больше, чем мест; 409 `CONFLICT {field: 'slug'}` —
адрес занят (и архивным грузом); 409 `CONFLICT {field: 'slug', reason: 'immutable'}` — правка со сменой адреса; 404 `CARGO_NOT_FOUND` — нет груза или он другой игры; 409 `CONFLICT
{reason: 'archived'}` — правка архивного; 409 `CONFLICT {reason: 'round_open', roundId}` — архив при открытом раунде;
404 `CARGO_ROUND_NOT_FOUND`; 409 `CARGO_ROUND_NOT_OPEN` — раунд уже завершён (в том числе повтор отмены); 409 `CONFLICT
{reason: 'cargo_busy'}` — покупки пять раз подряд меняли набор платящих во время отмены.

Аудит грузов: `cargo.create`, `cargo.update`, `cargo.archive` (сущность `cargo`; before / after — поля шаблона, у
создания и правки ещё `roundId` открытого ими раунда) и `cargo_round.cancel` (сущность `cargo_round`, причина; в after
— `users` и `gems` возврата, `purchases`, `clientSeed`, `voidSeat`, `nextRoundId`).

Режим `cargo` дашборда — приземлившиеся за период раунды: ставки — оплата мест, выплаты — призы платных раундов
(стоимость при выдаче), призы бесплатных грузов вычитаются из общего GGR, как бесплатные кейсы; целевого RTP нет.
Отменённые и закрытые по минимуму продаж раунды не учитываются — гемы вернулись.

## WebSocket (Socket.IO, `/socket.io`)

Клиент → сервер: `subscribe` / `unsubscribe` на комнаты `feed:{game}`, `battles:{game}`, `battle:{id}`, `case:{id}`,
`cargo:{game}`. Комната `user:{id}` подключается автоматически после входа. Никаких игровых действий через WS.

| Событие (сервер → клиент) | Комната | Данные |
|---|---|---|
| `feed:drop` | `feed:{game}` | игрок, предмет, источник (кейс / апгрейд / контракт / баттл / колесо / груз) |
| `stats:update` | все | онлайн, открыто кейсов |
| `case:supply` | `case:{id}` | остаток тиража |
| `battles:upsert`, `battles:remove` | `battles:{game}` | изменения списка лобби |
| `battle:state` | `battle:{id}` | полное состояние (`BattleDto`): участники, статус, `startsAt` |
| `battle:round` | `battle:{id}` | дропы раунда и `spinStartAt` (приходит за 1 с до старта вращения) |
| `battle:finished` | `battle:{id}` | итоговое состояние: победители, выигрыши, раскрытый server seed |
| `cargo:seats` | `cargo:{game}` | `{game, templateId, roundId, seatsSold, seatsTotal}` — после каждой покупки |
| `cargo:result` | `cargo:{game}` | `{game, slug, result: CargoResultDto}` — раунд приземлился (победитель, место), закрыт без победителя или отменён |
| `cargo:round` | `cargo:{game}` | `{game, templateId, slug, round: CargoRoundDto}` — начался новый раунд шаблона |
| `balance:update` | `user:{id}` | новый баланс |
| `inventory:update` | `user:{id}` | изменения инвентаря |
| `notification:new` | `user:{id}` | уведомление |
| `time:sync` | — | серверное время для синхронизации рулеток |
