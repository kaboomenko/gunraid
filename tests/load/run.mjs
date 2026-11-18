#!/usr/bin/env node
/**
 * Нагрузочный и конкурентный прогон GunRaid против поднятого стека (docker compose).
 *
 *   pnpm load                                   # 20 игроков, 30 с, 200 сокетов
 *   pnpm load -- --users 50 --duration 60 --sockets 500
 *   pnpm load -- --base https://staging.example.com
 *
 * Фазы:
 *   1. Подготовка: тестовые игроки (dev-вход), тестовые пополнения.
 *   2. Смешанная нагрузка: открытия кейсов, продажи, апгрейды, контракты, баттлы с ботами,
 *      чтение страниц; параллельно N WebSocket-подключений слушают ленту дропов.
 *      После — ждём, что воркер доиграл все баттлы.
 *   3. Конкурентные атаки: двойное списание, повтор с тем же idempotency key,
 *      двойная продажа и двойной апгрейд одного предмета.
 *   4. Сверка: баланс каждого кошелька = сумма записей ledger (эндпоинт админки).
 *
 * Код выхода ≠ 0, если есть ответы 5xx, нарушен инвариант, не сошёлся ledger
 * или p95 открытия кейса выше порога (--p95, мс).
 * Нужен AUTH_DEV_LOGIN=true (по умолчанию в .env.example для локального стенда).
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';

const { values: opt } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    base: { type: 'string', default: process.env.LOAD_BASE_URL ?? 'http://localhost:8080' },
    users: { type: 'string', default: '20' },
    duration: { type: 'string', default: '30' },
    sockets: { type: 'string', default: '200' },
    game: { type: 'string', default: 'cs2' },
    p95: { type: 'string', default: '1500' },
    json: { type: 'string' },
  },
});

const BASE = opt.base.replace(/\/+$/, '');
const USERS = Number(opt.users);
const DURATION_MS = Number(opt.duration) * 1000;
const SOCKETS = Number(opt.sockets);
const GAME = opt.game;
const P95_LIMIT = Number(opt.p95);
const RUN = Date.now().toString(36);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- статистика

class Stats {
  byLabel = new Map();
  record(label, ms, status) {
    let s = this.byLabel.get(label);
    if (!s) {
      s = { lat: [], statuses: new Map() };
      this.byLabel.set(label, s);
    }
    s.lat.push(ms);
    s.statuses.set(status, (s.statuses.get(status) ?? 0) + 1);
  }
  static pct(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  }
  summary(elapsedMs) {
    const rows = [];
    for (const [label, s] of [...this.byLabel].sort((a, b) => b[1].lat.length - a[1].lat.length)) {
      const sorted = [...s.lat].sort((a, b) => a - b);
      const count = sorted.length;
      const errors5xx = [...s.statuses]
        .filter(([k]) => k >= 500 || k === 0)
        .reduce((a, [, v]) => a + v, 0);
      rows.push({
        label,
        count,
        rps: +(count / (elapsedMs / 1000)).toFixed(1),
        p50: Math.round(Stats.pct(sorted, 50)),
        p95: Math.round(Stats.pct(sorted, 95)),
        p99: Math.round(Stats.pct(sorted, 99)),
        max: Math.round(sorted[count - 1] ?? 0),
        statuses: Object.fromEntries([...s.statuses].sort((a, b) => a[0] - b[0])),
        errors5xx,
      });
    }
    return rows;
  }
}
const stats = new Stats();

// ---------------------------------------------------------------- HTTP-клиент с cookie

class Client {
  jar = new Map();
  constructor(name) {
    this.name = name;
  }
  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  store(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (!v || /max-age=0/i.test(raw)) this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  /** label — имя для статистики (по умолчанию «МЕТОД путь» без id). */
  async req(method, path, body, { idem, label, record = true } = {}) {
    const headers = { accept: 'application/json' };
    const cookie = this.cookie();
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      headers['x-csrf-token'] = this.jar.get('gr_csrf') ?? '';
    }
    if (idem) headers['idempotency-key'] = idem === true ? randomUUID() : idem;
    const name = label ?? `${method} ${path.replace(/[0-9a-f-]{36}/g, ':id').replace(/\?.*$/, '')}`;
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(`${BASE}/api/v1${path}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      if (record) stats.record(name, performance.now() - t0, 0);
      return { status: 0, body: { error: { code: 'NETWORK', message: String(err) } } };
    }
    const ms = performance.now() - t0;
    this.store(res);
    const data = await res.json().catch(() => null);
    if (record) stats.record(name, ms, res.status);
    return { status: res.status, body: data };
  }
  /** Повтор при 429 (лимиты запросов) с ожиданием, которое назвал сервер. */
  async retrying(method, path, body, opts = {}, attempts = 12) {
    for (let i = 0; ; i++) {
      const r = await this.req(method, path, body, opts);
      if (r.status !== 429 || i >= attempts) return r;
      const wait = Number(r.body?.error?.details?.retryAfterMs ?? 2000);
      await sleep(Math.min(wait, 65_000) + Math.random() * 300);
    }
  }
  async init() {
    await this.req('GET', '/health', undefined, { record: false });
  }
  async devLogin(preset, nickname) {
    await this.init();
    const r = await this.retrying(
      'POST',
      '/auth/dev-login',
      nickname ? { preset, nickname } : { preset },
      {
        record: false,
      },
    );
    if (r.status >= 300) throw new Error(`dev-login ${r.status}: ${JSON.stringify(r.body)}`);
    const me = await this.req('GET', '/me', undefined, { record: false });
    if (!me.body.adultConfirmed) {
      await this.req('POST', '/me/confirm-age', { confirm: true }, { record: false });
    }
    this.me = (await this.req('GET', '/me', undefined, { record: false })).body;
    return this.me;
  }
  /** retry=false — для фазы нагрузки: при лимите (429) пополнение просто пропускаем. */
  async topUp(usd, retry = true) {
    const call = (m, path, body, o) =>
      retry ? this.retrying(m, path, body, o) : this.req(m, path, body, o);
    const q = await call('POST', '/deposits/quote', {
      method: 'card',
      currency: 'USD',
      amount: String(usd),
    });
    if (!retry && q.status === 429) return false;
    if (q.status >= 300) throw new Error(`quote ${q.status}: ${JSON.stringify(q.body)}`);
    const d = await call('POST', '/deposits', { quoteId: q.body.quoteId }, { idem: true });
    if (!retry && d.status === 429) return false;
    if (d.status >= 300) throw new Error(`deposit ${d.status}: ${JSON.stringify(d.body)}`);
    const c = await call('POST', `/payments/mock/${d.body.id}/complete`, { result: 'success' });
    if (!retry && c.status === 429) return false;
    if (c.body?.status !== 'succeeded') throw new Error(`mock pay: ${JSON.stringify(c.body)}`);
    return true;
  }
  async balance() {
    return (await this.req('GET', '/me', undefined, { record: false })).body.balance;
  }
  async inventory() {
    const r = await this.req('GET', `/games/${GAME}/inventory?pageSize=100`, undefined, {
      label: 'GET inventory',
    });
    return (r.body?.items ?? []).filter((i) => i.status === 'in_inventory');
  }
  async ledgerSum() {
    let cursor = null;
    let sum = 0;
    do {
      const r = await this.req(
        'GET',
        `/me/transactions${cursor ? `?cursor=${cursor}` : ''}`,
        undefined,
        {
          record: false,
        },
      );
      for (const t of r.body.items) sum += t.amount;
      cursor = r.body.nextCursor;
    } while (cursor);
    return sum;
  }
}

// ---------------------------------------------------------------- проверки

const failures = [];
function check(ok, message) {
  if (ok) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}`);
    failures.push(message);
  }
}

// ---------------------------------------------------------------- фаза 1: подготовка

async function setup() {
  console.log(`\n▶ Подготовка: ${USERS} игроков на ${BASE} (игра ${GAME})`);
  const pub = new Client('public');
  await pub.init();
  const home = await pub.req('GET', `/games/${GAME}/home`, undefined, { record: false });
  if (home.status !== 200) throw new Error(`home ${home.status} — стек поднят?`);
  const cases = home.body.categories
    .flatMap((c) => c.cases)
    .filter((c) => c.price > 0 && !c.minLevel && !c.supplyTotal && !c.cooldownSeconds)
    .sort((a, b) => a.price - b.price);
  if (!cases.length) throw new Error('нет платных кейсов без ограничений');

  const battleCases = (
    await pub.req('GET', `/games/${GAME}/battles/cases`, undefined, { record: false })
  ).body
    .slice()
    .sort((a, b) => a.price - b.price);

  const players = [];
  // dev-вход ограничен по IP (30/мин) — создаём игроков пачками, ждём при 429.
  for (let i = 0; i < USERS; i += 5) {
    const batch = Array.from({ length: Math.min(5, USERS - i) }, (_, j) => {
      const c = new Client(`p${i + j}`);
      return c.devLogin('player', `load_${RUN}_${i + j}`).then(() => c);
    });
    players.push(...(await Promise.all(batch)));
  }
  await Promise.all(players.map((p) => p.topUp(100)));
  console.log(
    `  игроки готовы, баланс у каждого ≈ ${(await players[0].balance()).toLocaleString('ru-RU')} гемов`,
  );
  return { cases, battleCases, players };
}

// ---------------------------------------------------------------- фаза 2: смешанная нагрузка

async function playerLoop(p, cases, battleCases, deadline, counters) {
  const affordable = cases.slice(0, Math.max(1, Math.ceil(cases.length / 2)));
  while (performance.now() < deadline) {
    const roll = Math.random();
    try {
      if (roll < 0.4) {
        const c = pick(affordable);
        const count = Math.random() < 0.25 ? 3 : 1;
        const r = await p.req(
          'POST',
          `/games/${GAME}/cases/${c.slug}/open`,
          { count },
          {
            idem: true,
            label: 'POST case open',
          },
        );
        if (r.status === 200) counters.opened += count;
        if (r.body?.error?.code === 'INSUFFICIENT_BALANCE') await p.topUp(50, false);
      } else if (roll < 0.55) {
        await p.req('GET', `/games/${GAME}/home`, undefined, { label: 'GET home' });
        await p.req('GET', `/games/${GAME}/cases/${pick(cases).slug}`, undefined, {
          label: 'GET case',
        });
        await p.req('GET', `/games/${GAME}/feed`, undefined, { label: 'GET feed' });
      } else if (roll < 0.65) {
        await p.req('GET', '/me', undefined, { label: 'GET me' });
        await p.inventory();
      } else if (roll < 0.75) {
        const r = await p.req(
          'POST',
          `/games/${GAME}/inventory/sell`,
          { all: true },
          {
            idem: true,
            label: 'POST sell all',
          },
        );
        if (r.status === 200) counters.sold++;
      } else if (roll < 0.8) {
        // Баттл 1×1 с ботом: нагружает расписание раундов и выдачу в воркере.
        const bc = battleCases[0];
        const r = await p.req(
          'POST',
          `/games/${GAME}/battles`,
          {
            cases: [{ caseId: bc.id, count: 1 }],
            format: '1v1',
            mode: Math.random() < 0.5 ? 'classic' : 'crazy',
          },
          { idem: true, label: 'POST battle create' },
        );
        if (r.status === 200) {
          const bots = await p.req(
            'POST',
            `/battles/${r.body.id}/bots`,
            {
              clientSeed: randomUUID().replace(/-/g, ''),
            },
            { idem: true, label: 'POST battle bots' },
          );
          if (bots.status === 200) counters.battles.push(r.body.id);
        }
      } else if (roll < 0.9) {
        const t = await p.req(
          'GET',
          `/games/${GAME}/upgrade/targets?minPrice=300&maxPrice=3000&pageSize=10`,
          undefined,
          {
            label: 'GET upgrade targets',
          },
        );
        const target = t.body?.items?.[0];
        if (target) {
          const amount = Math.max(50, Math.floor(target.price / pick([2, 3, 5])));
          const r = await p.req(
            'POST',
            `/games/${GAME}/upgrade`,
            { amount, targetItemId: target.id },
            {
              idem: true,
              label: 'POST upgrade',
            },
          );
          if (r.status === 200) counters.upgrades++;
        }
      } else {
        const inv = await p.inventory();
        if (inv.length >= 3) {
          const r = await p.req(
            'POST',
            `/games/${GAME}/contract`,
            {
              userItemIds: inv.slice(0, 3).map((i) => i.id),
            },
            { idem: true, label: 'POST contract' },
          );
          if (r.status === 200) counters.contracts++;
        }
      }
    } catch (err) {
      counters.exceptions++;
      if (counters.exceptions < 5) console.log(`  ! ${p.name}: ${err.message}`);
    }
    await sleep(40 + Math.random() * 160);
  }
}

async function openSockets(n) {
  const sockets = [];
  const received = { feed: 0, stats: 0, connected: 0, errors: 0 };
  for (let i = 0; i < n; i++) {
    const s = io(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('connect', () => {
      received.connected++;
      s.emit('subscribe', `feed:${GAME}`);
    });
    s.on('connect_error', () => received.errors++);
    s.on('feed:drop', () => received.feed++);
    s.on('stats:update', () => received.stats++);
    sockets.push(s);
    if (i % 50 === 49) await sleep(100);
  }
  return { sockets, received };
}

async function mixedLoad(players, cases, battleCases) {
  console.log(
    `\n▶ Смешанная нагрузка: ${players.length} игроков × ${DURATION_MS / 1000} с, ${SOCKETS} WebSocket`,
  );
  const ws = await openSockets(SOCKETS);
  await sleep(1000);
  const counters = { opened: 0, sold: 0, upgrades: 0, contracts: 0, battles: [], exceptions: 0 };
  const t0 = performance.now();
  const deadline = t0 + DURATION_MS;
  await Promise.all(players.map((p) => playerLoop(p, cases, battleCases, deadline, counters)));
  const elapsed = performance.now() - t0;
  // Лента публикуется с задержкой (feed.delayMs) — дослушиваем.
  await sleep(7000);
  for (const s of ws.sockets) s.close();

  // Все баттлы должны доиграться: воркер успевает раунды и выдачу под нагрузкой.
  const watcher = players[0];
  const pending = new Set(counters.battles);
  const until = performance.now() + 90_000;
  while (pending.size && performance.now() < until) {
    for (const id of [...pending]) {
      const b = await watcher.req('GET', `/battles/${id}`, undefined, { record: false });
      if (b.body?.status === 'finished') pending.delete(id);
    }
    if (pending.size) await sleep(2000);
  }
  return { elapsed, counters, ws: ws.received, unfinishedBattles: pending.size };
}

// ---------------------------------------------------------------- фаза 3: конкурентные атаки

async function concurrency(cases) {
  console.log('\n▶ Конкурентные атаки');
  const price = cases[0].price;
  const slug = cases[0].slug;
  const open = (c, key) =>
    c.req(
      'POST',
      `/games/${GAME}/cases/${slug}/open`,
      { count: 1 },
      { idem: key ?? true, label: 'attack open' },
    );

  // 1. Двойное списание: денег ровно на K открытий, шлём 8 параллельных запросов.
  const a = new Client('attack-balance');
  await a.devLogin('player', `load_${RUN}_dbl`);
  await a.topUp(1);
  const start = await a.balance();
  const k = Math.floor(start / price);
  const results = await Promise.all(Array.from({ length: 8 }, () => open(a)));
  const ok = results.filter((r) => r.status === 200).length;
  const end = await a.balance();
  check(ok === Math.min(k, 8), `двойное списание: успешных открытий ${ok}, денег хватало на ${k}`);
  check(
    end === start - ok * price && end >= 0,
    `баланс ${start} → ${end} (−${ok}×${price}), не ушёл в минус`,
  );
  check((await a.ledgerSum()) === end, 'ledger игрока сходится после атаки');
  await sleep(3500);

  // 2. Один idempotency key — одна операция, сколько бы раз ни прислали.
  const b = new Client('attack-idem');
  await b.devLogin('player', `load_${RUN}_idem`);
  await b.topUp(5);
  const before = await b.balance();
  const invBefore = (await b.inventory()).length;
  const key = randomUUID();
  const same = await Promise.all(Array.from({ length: 8 }, () => open(b, key)));
  await sleep(300);
  const late = await open(b, key); // повтор после завершения — тот же ответ
  const invAfter = (await b.inventory()).length;
  const after = await b.balance();
  const okIds = new Set(
    [...same, late].filter((r) => r.status === 200).map((r) => r.body.results[0].openingId),
  );
  check(
    invAfter - invBefore === 1,
    `повтор с тем же ключом: предметов +${invAfter - invBefore} (ожидалось +1)`,
  );
  check(before - after === price, `списано ${before - after} (ожидалось ${price})`);
  check(okIds.size === 1, `все успешные ответы про одно открытие (${okIds.size})`);
  check(
    same.every((r) => r.status === 200 || r.body?.error?.code === 'IDEMPOTENCY_IN_PROGRESS'),
    'параллельные дубли: 200 (повтор ответа) или IDEMPOTENCY_IN_PROGRESS',
  );
  await sleep(3500);

  // 3. Двойная продажа одного предмета.
  const [item] = await b.inventory();
  const balBeforeSell = await b.balance();
  const sells = await Promise.all(
    Array.from({ length: 6 }, () =>
      b.req(
        'POST',
        `/games/${GAME}/inventory/sell`,
        { userItemIds: [item.id] },
        { idem: true, label: 'attack sell' },
      ),
    ),
  );
  const okSells = sells.filter((r) => r.status === 200);
  const balAfterSell = await b.balance();
  check(okSells.length === 1, `двойная продажа: успешных ${okSells.length} из 6`);
  const credited = okSells[0]?.body?.total ?? -1;
  check(
    balAfterSell - balBeforeSell === credited,
    `начислено один раз: +${balAfterSell - balBeforeSell} (продажа на ${credited})`,
  );
  await sleep(3500);

  // 4. Один предмет — в нескольких параллельных апгрейдах.
  await open(b);
  await sleep(500);
  const [stake] = await b.inventory();
  const t = await b.req(
    'GET',
    `/games/${GAME}/upgrade/targets?minPrice=${stake.item.price * 2}&pageSize=5`,
    undefined,
    {
      record: false,
    },
  );
  const target = t.body?.items?.[0];
  if (target) {
    const ups = await Promise.all(
      Array.from({ length: 6 }, () =>
        b.req(
          'POST',
          `/games/${GAME}/upgrade`,
          { userItemIds: [stake.id], targetItemId: target.id },
          {
            idem: true,
            label: 'attack upgrade',
          },
        ),
      ),
    );
    const upOk = ups.filter((r) => r.status === 200).length;
    check(upOk === 1, `двойной апгрейд одним предметом: успешных ${upOk} из 6`);
  } else {
    console.log('  – апгрейд пропущен: нет подходящей цели');
  }
  check((await b.ledgerSum()) === (await b.balance()), 'ledger игрока сходится после атак');
}

// ---------------------------------------------------------------- фаза 4: сверка

async function reconcile() {
  console.log('\n▶ Сверка ledger');
  const admin = new Client('admin');
  await admin.devLogin('admin');
  const r = await admin.req('GET', '/admin/ledger/reconciliation', undefined, { record: false });
  check(
    r.status === 200 && r.body.ok === true,
    `баланс каждого кошелька = сумма записей ledger (расхождений: ${r.body?.mismatches?.length ?? '?'})`,
  );
}

// ---------------------------------------------------------------- запуск

function printTable(rows) {
  const head = ['операция', 'кол-во', 'rps', 'p50', 'p95', 'p99', 'max', 'статусы'];
  const lines = rows.map((r) => [
    r.label,
    String(r.count),
    String(r.rps),
    `${r.p50}`,
    `${r.p95}`,
    `${r.p99}`,
    `${r.max}`,
    Object.entries(r.statuses)
      .map(([k, v]) => `${k}:${v}`)
      .join(' '),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cols) =>
    cols
      .map((c, i) => (i === 0 || i === 7 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join('  ');
  console.log(fmt(head));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const l of lines) console.log(fmt(l));
  console.log('(время — мс)');
}

const t0 = Date.now();
try {
  const { cases, battleCases, players } = await setup();
  const load = await mixedLoad(players, cases, battleCases);
  const rows = stats.summary(load.elapsed);
  console.log('');
  printTable(rows);
  const total = rows.reduce((a, r) => a + r.count, 0);
  console.log(
    `\nИтого: ${total} запросов за ${(load.elapsed / 1000).toFixed(1)} с (${(total / (load.elapsed / 1000)).toFixed(0)} rps); ` +
      `открыто кейсов: ${load.counters.opened}, продаж: ${load.counters.sold}, апгрейдов: ${load.counters.upgrades}, ` +
      `контрактов: ${load.counters.contracts}, баттлов: ${load.counters.battles.length}`,
  );
  console.log(
    `WebSocket: подключено ${load.ws.connected}/${SOCKETS}, ошибок ${load.ws.errors}, событий ленты ${load.ws.feed}, статистики ${load.ws.stats}`,
  );
  check(
    rows.every((r) => r.errors5xx === 0),
    'нет ответов 5xx и сетевых ошибок под нагрузкой',
  );
  const openRow = rows.find((r) => r.label === 'POST case open');
  check(
    Boolean(openRow) && openRow.p95 <= P95_LIMIT,
    `p95 открытия кейса ${openRow?.p95 ?? '—'} мс ≤ ${P95_LIMIT} мс`,
  );
  check(load.ws.connected === SOCKETS, `все ${SOCKETS} WebSocket подключились`);
  check(SOCKETS === 0 || load.ws.feed > 0, 'лента дропов доходит до подписчиков');
  check(
    load.unfinishedBattles === 0,
    `все баттлы с ботами доиграны (${load.counters.battles.length - load.unfinishedBattles}/${load.counters.battles.length})`,
  );

  await concurrency(cases);
  await reconcile();

  if (opt.json) {
    writeFileSync(
      opt.json,
      JSON.stringify(
        {
          base: BASE,
          users: USERS,
          durationMs: load.elapsed,
          sockets: SOCKETS,
          rows,
          counters: { ...load.counters, battles: load.counters.battles.length },
          ws: load.ws,
          failures,
        },
        null,
        2,
      ),
    );
  }
} catch (err) {
  failures.push(`прогон прерван: ${err.message}`);
  console.error(err);
}

console.log(
  `\n${failures.length ? '✗ ПРОВАЛ' : '✓ OK'} за ${((Date.now() - t0) / 1000).toFixed(0)} с`,
);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
