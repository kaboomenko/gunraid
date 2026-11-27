import {
  ADMIN_CARGO_ISSUES,
  CARGO_IMAGE_KINDS,
  CARGO_LAND_REASONS,
  CARGO_ROUND_STATUSES,
  cargoImageUrl,
  type AdminCargoDetailDto,
  type AdminCargoRoundSummaryDto,
  type ItemDto,
} from '@gunraid/shared';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ru from '../../../../messages/ru.json';
import {
  CARGO_CONFLICT_KEYS,
  CARGO_DRAFT_KEYS,
  CARGO_FIELD_ERROR_KEYS,
  cargoApiFieldErrors,
  cargoCancelState,
  cargoConflictKey,
  cargoDraftBody,
  cargoDraftErrors,
  cargoDraftFrom,
  cargoDraftRtp,
  cargoImageKind,
  durationHours,
  firstErrorField,
  fitSeatPrice,
  formatCargoRanges,
  mergeCargoDraft,
  newCargoDraft,
  nextSortOrder,
  sameCargoDraft,
  takeCargoFields,
  type CargoDraft,
} from './cargo-form';

const prize: ItemDto = {
  id: '01a2149f-9871-77ce-b0cb-13e50fae30b3',
  fullName: '★ Karambit | Slaughter (Factory New)',
  skinName: 'Slaughter',
  modelName: 'Karambit',
  typeCode: 'knife',
  rarity: { code: 'rare_special', name: 'Крайне редкий предмет', color: '#DCBB2A', sortOrder: 8 },
  imageUrl: '/media/skins/cs2/karambit-slaughter.webp',
  price: 14_400,
  isStattrak: false,
  isSouvenir: false,
  wear: 'FN',
  floatMin: '0.00000',
  floatMax: '0.07000',
  isWithdrawable: true,
};

const valid = (patch: Partial<CargoDraft> = {}): CargoDraft => ({
  ...newCargoDraft(6),
  name: '  Проверочный груз ',
  slug: 'test-cargo',
  prize,
  seatPrice: '160',
  ...patch,
});

describe('форма груза: проверка черновика', () => {
  it('новый черновик: стандартная картинка, 100 мест, сутки, активен, без лимита и условий', () => {
    const d = newCargoDraft(6);
    expect(d.imageUrl).toBe(cargoImageUrl('light'));
    expect([d.seatsTotal, d.durationMinutes, d.sortOrder]).toEqual(['100', '1440', '6']);
    expect(d.isActive).toBe(true);
    expect(cargoDraftErrors(d)).toEqual({
      name: { key: 'required' },
      slug: { key: 'required' },
      prize: { key: 'prize' },
      seatPrice: { key: 'required' },
    });
  });

  it('тело: имя без пробелов по краям, пустые необязательные поля — null', () => {
    const d = valid();
    expect(cargoDraftErrors(d)).toEqual({});
    expect(cargoDraftBody(d)).toEqual({
      slug: 'test-cargo',
      name: 'Проверочный груз',
      imageUrl: '/media/cargo/light.webp',
      prizeItemId: prize.id,
      seatsTotal: 100,
      seatPrice: 160,
      perUserLimit: null,
      durationMinutes: 1440,
      minLevel: null,
      depositWithinDays: null,
      minSeatsToLand: null,
      isActive: true,
      sortOrder: 6,
    });
  });

  it('бесплатный: цена 0 и лимит 1, введённые цена и лимит не проверяются и не уходят', () => {
    const d = valid({ free: true, seatPrice: 'abc', perUserLimit: '99999', minLevel: '5' });
    expect(cargoDraftErrors(d)).toEqual({});
    expect(cargoDraftBody(d)).toMatchObject({ seatPrice: 0, perUserLimit: 1, minLevel: 5 });
  });

  it('границы полей — как у adminCargoSchema', () => {
    const errors = cargoDraftErrors(
      valid({
        name: 'x',
        slug: 'Bad_Slug',
        seatsTotal: '1',
        durationMinutes: '4',
        minLevel: '1001',
        depositWithinDays: '0',
        sortOrder: '100001',
      }),
    );
    expect(errors).toEqual({
      name: { key: 'name' },
      slug: { key: 'slug' },
      seatsTotal: { key: 'range', values: { min: 2, max: 10_000 } },
      durationMinutes: { key: 'range', values: { min: 5, max: 43_200 } },
      minLevel: { key: 'range', values: { min: 1, max: 1000 } },
      depositWithinDays: { key: 'range', values: { min: 1, max: 3650 } },
      sortOrder: { key: 'range', values: { min: 0, max: 100_000 } },
    });
    expect(firstErrorField(errors)).toBe('name');
    expect(cargoDraftErrors(valid({ seatsTotal: '10000', durationMinutes: '43200' }))).toEqual({});
  });

  it('цена 0 у платного — подсказка про переключатель, не «от 1 до …»', () => {
    expect(cargoDraftErrors(valid({ seatPrice: '0' }))).toEqual({
      seatPrice: { key: 'paidPrice' },
    });
  });

  it('лимит и минимум продаж — не больше мест в раунде (как проверяет сервер)', () => {
    expect(
      cargoDraftErrors(valid({ seatsTotal: '20', perUserLimit: '21', minSeatsToLand: '25' })),
    ).toEqual({
      perUserLimit: { key: 'aboveSeats', values: { max: 20 } },
      minSeatsToLand: { key: 'aboveSeats', values: { max: 20 } },
    });
    // При ошибке в числе мест сравнение не делается — ошибка только у мест.
    expect(cargoDraftErrors(valid({ seatsTotal: '1', perUserLimit: '21' }))).toEqual({
      seatsTotal: { key: 'range', values: { min: 2, max: 10_000 } },
    });
    expect(
      cargoDraftErrors(valid({ seatsTotal: '20', perUserLimit: '20', minSeatsToLand: '20' })),
    ).toEqual({});
  });

  it('NUL и половина суррогатной пары в названии и пути картинки — ошибка «Недопустимые символы»', () => {
    expect(cargoDraftErrors(valid({ name: 'ab\u0000cd' }))).toEqual({ name: { key: 'chars' } });
    expect(cargoDraftErrors(valid({ name: 'ab\ud800cd' }))).toEqual({ name: { key: 'chars' } });
    expect(cargoDraftErrors(valid({ imageUrl: '/media/x\udc00.webp' }))).toEqual({
      imageUrl: { key: 'chars' },
    });
    // Эмодзи — целая пара, обычный текст.
    expect(cargoDraftErrors(valid({ name: 'Груз \ud83c\udf81' }))).toEqual({});
  });

  it('несохранённые правки: сравнение по значениям, приз — по id', () => {
    const d = valid();
    expect(sameCargoDraft(d, { ...d })).toBe(true);
    expect(sameCargoDraft(d, { ...d, prize: { ...prize } })).toBe(true);
    expect(sameCargoDraft(d, { ...d, name: 'Другое' })).toBe(false);
    expect(sameCargoDraft(d, { ...d, prize: null })).toBe(false);
    expect(sameCargoDraft(d, { ...d, free: true })).toBe(false);
  });

  it('из шаблона и обратно: бесплатный открывается с пустыми ценой и лимитом', () => {
    const detail = {
      id: '01a218bd-8f83-71f1-9a5b-3c7313cea25e',
      game: 'cs2',
      slug: 'free',
      name: 'Бесплатный груз',
      imageUrl: '/media/cargo/free.webp',
      isActive: true,
      sortOrder: 3,
      seatsTotal: 100,
      seatPrice: 0,
      perUserLimit: 1,
      durationMinutes: 1440,
      minLevel: null,
      depositWithinDays: 30,
      minSeatsToLand: null,
      prize,
      rtp: null,
      round: null,
      roundsLanded: 0,
      issue: null,
      archivedAt: null,
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
    } satisfies AdminCargoDetailDto;
    const d = cargoDraftFrom(detail);
    expect(d).toMatchObject({
      free: true,
      seatPrice: '',
      perUserLimit: '',
      depositWithinDays: '30',
    });
    expect(cargoDraftBody(d)).toMatchObject({
      seatPrice: 0,
      perUserLimit: 1,
      depositWithinDays: 30,
    });
    // Выключили «бесплатный» — цену надо ввести.
    expect(cargoDraftErrors({ ...d, free: false })).toEqual({ seatPrice: { key: 'required' } });
  });
});

describe('форма груза: ошибки API', () => {
  const d = valid({ seatsTotal: '50' });

  it('VALIDATION_ERROR {field} — «не больше мест», массив схемы — по путям', () => {
    expect(cargoApiFieldErrors('VALIDATION_ERROR', { field: 'minSeatsToLand' }, d)).toEqual({
      minSeatsToLand: { key: 'aboveSeats', values: { max: 50 } },
    });
    expect(
      cargoApiFieldErrors(
        'VALIDATION_ERROR',
        [
          { path: 'prizeItemId', code: 'invalid_format', message: 'x' },
          { path: 'seatsTotal', code: 'too_small', message: 'x' },
          { path: 'unknown', code: 'unrecognized_keys', message: 'x' },
        ],
        d,
      ),
    ).toEqual({
      prize: { key: 'prize' },
      seatsTotal: { key: 'range', values: { min: 2, max: 10_000 } },
    });
    // Недопустимые символы (ZodPipe) — своим текстом, а не «от 2 до 80 символов».
    expect(
      cargoApiFieldErrors(
        'VALIDATION_ERROR',
        [{ path: 'name', code: 'invalid_text', message: 'x' }],
        d,
      ),
    ).toEqual({ name: { key: 'chars' } });
  });

  it('приз, занятый slug и CONFLICT с причиной', () => {
    expect(cargoApiFieldErrors('CARGO_PRIZE_INVALID', { reason: 'game' }, d)).toEqual({
      prize: { key: 'prizeGame' },
    });
    expect(cargoApiFieldErrors('CARGO_PRIZE_INVALID', { reason: 'inactive' }, d)).toEqual({
      prize: { key: 'prizeInactive' },
    });
    expect(cargoApiFieldErrors('CARGO_PRIZE_INVALID', { reason: 'missing' }, d)).toEqual({
      prize: { key: 'prizeMissing' },
    });
    expect(cargoApiFieldErrors('CONFLICT', { field: 'slug' }, d)).toEqual({
      slug: { key: 'slugTaken' },
    });
    // Адрес после создания не меняется (S1).
    expect(cargoApiFieldErrors('CONFLICT', { field: 'slug', reason: 'immutable' }, d)).toEqual({
      slug: { key: 'slugImmutable' },
    });
    expect(cargoApiFieldErrors('CONFLICT', { reason: 'archived' }, d)).toEqual({});
    expect(cargoConflictKey('CONFLICT', { reason: 'archived' })).toBe('archived');
    expect(cargoConflictKey('CONFLICT', { reason: 'round_open', roundId: 'x' })).toBe('roundOpen');
    expect(cargoConflictKey('CONFLICT', { reason: 'cargo_busy' })).toBe('busy');
    expect(cargoConflictKey('CONFLICT', { field: 'slug' })).toBeNull();
    expect(cargoConflictKey('CARGO_ROUND_NOT_OPEN', undefined)).toBeNull();
  });
});

describe('форма груза: чужая правка при несохранённых своих (W1)', () => {
  const base = valid({ seatPrice: '10', name: 'Груз' });

  it('нетронутые поля — из новой версии, тронутые — из формы, без конфликта', () => {
    const mine = { ...base, name: 'Моё имя' };
    const theirs = { ...base, seatPrice: '25' };
    const m = mergeCargoDraft(base, mine, theirs);
    expect(m.draft).toEqual({ ...base, name: 'Моё имя', seatPrice: '25' });
    expect(m.conflicts).toEqual([]);
  });

  it('правили одно поле оба — конфликт; одинаково — нет; приз сравнивается по id', () => {
    const mine = { ...base, seatPrice: '30', seatsTotal: '200' };
    const theirs = { ...base, seatPrice: '25', seatsTotal: '200', prize: { ...prize } };
    const m = mergeCargoDraft(base, mine, theirs);
    expect(m.draft).toMatchObject({ seatPrice: '30', seatsTotal: '200' });
    expect(m.conflicts).toEqual(['seatPrice']);
  });

  it('прежний конфликт держится, пока значения расходятся; совпали — пропадает', () => {
    const mine = { ...base, seatPrice: '30' };
    const v1 = { ...base, seatPrice: '25' };
    const first = mergeCargoDraft(base, mine, v1);
    expect(first.conflicts).toEqual(['seatPrice']);
    // Следующая чужая правка — другого поля: цена остаётся в конфликте.
    const v2 = { ...v1, durationMinutes: '60' };
    const second = mergeCargoDraft(v1, first.draft, v2, first.conflicts);
    expect(second.draft).toMatchObject({ seatPrice: '30', durationMinutes: '60' });
    expect(second.conflicts).toEqual(['seatPrice']);
    // На сервере поставили ту же цену, что в форме, — конфликта больше нет.
    const v3 = { ...v2, seatPrice: '30' };
    expect(mergeCargoDraft(v2, second.draft, v3, second.conflicts).conflicts).toEqual([]);
  });

  it('«Взять сохранённые значения» — только указанные поля', () => {
    const mine = { ...base, seatPrice: '30', name: 'Моё имя' };
    const theirs = { ...base, seatPrice: '25' };
    expect(takeCargoFields(mine, theirs, ['seatPrice'])).toEqual({ ...mine, seatPrice: '25' });
    // Список полей покрывает весь черновик.
    expect([...CARGO_DRAFT_KEYS].sort()).toEqual(Object.keys(base).sort());
  });
});

describe('форма груза: окно отмены раунда (W2)', () => {
  const summary = (over: Partial<AdminCargoRoundSummaryDto> = {}): AdminCargoRoundSummaryDto => ({
    id: '01a21963-a263-7634-bb25-ce9c62dee779',
    number: 3,
    status: 'open',
    seatsSold: 2,
    seatsTotal: 10,
    seatPrice: 10,
    revenue: 20,
    participants: 1,
    prize,
    prizeValue: 14_400,
    rtpNow: 720,
    minSeatsToLand: null,
    landAttempts: 0,
    lastLandError: null,
    lastLandErrorAt: null,
    startedAt: '2026-11-26T10:00:00.000Z',
    endsAt: '2026-11-27T10:00:00.000Z',
    serverSeedHash: 'hash',
    ...over,
  });

  it('текст — по живой сводке того же раунда, а не по снимку на момент открытия', () => {
    const picked = summary();
    const live = summary({ seatsSold: 7, revenue: 70, participants: 2 });
    expect(cargoCancelState(picked, live)).toEqual({ kind: 'paid', round: live });
    expect(cargoCancelState(picked, summary({ seatsSold: 0, revenue: 0 })).kind).toBe('empty');
    expect(cargoCancelState(picked, summary({ seatPrice: 0, revenue: 0 })).kind).toBe('free');
  });

  it('раунд сменился или пропал — отменять нечего', () => {
    const picked = summary();
    expect(cargoCancelState(picked, summary({ id: 'next-round', number: 4 }))).toEqual({
      kind: 'gone',
      round: picked,
    });
    expect(cargoCancelState(picked, null)).toEqual({ kind: 'gone', round: picked });
    expect(cargoCancelState(null, picked)).toEqual({ kind: 'gone', round: null });
  });
});

describe('форма груза: подсказки', () => {
  it('часы, RTP, цена под RTP 90 %, порядок нового груза', () => {
    expect(durationHours('90')).toBe(1.5);
    expect(durationHours('1440')).toBe(24);
    expect(durationHours('')).toBeNull();
    expect(cargoDraftRtp(valid())).toBeCloseTo(0.9);
    expect(cargoDraftRtp(valid({ free: true }))).toBeNull();
    expect(cargoDraftRtp(valid({ seatPrice: '' }))).toBeNull();
    // Сиды: приз 14 400, 100 мест → 160 за место (RTP 90 %).
    expect(fitSeatPrice(14_400, 100)).toBe(160);
    expect(fitSeatPrice(10, 500)).toBe(1);
    expect(nextSortOrder([{ sortOrder: 5 }, { sortOrder: 2 }])).toBe(6);
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([{ sortOrder: 100_000 }])).toBe(100_000);
  });

  it('картинка: стандартный вид или свой путь', () => {
    expect(cargoImageKind('/media/cargo/special.webp')).toBe('special');
    expect(cargoImageKind('/media/cargo/special-256.webp')).toBeNull();
    expect(cargoImageKind('/media/custom/x.webp')).toBeNull();
  });

  it('места участника: каждая покупка отдельно, остаток числом', () => {
    expect(formatCargoRanges([[7, 7]])).toEqual({ text: '№7', more: 0 });
    expect(
      formatCargoRanges([
        [1, 3],
        [4, 4],
        [9, 12],
        [20, 20],
        [30, 31],
        [40, 40],
      ]),
    ).toEqual({ text: '№1–3, №4, №9–12, №20', more: 2 });
  });
});

describe('тексты админки грузов', () => {
  const c = ru.admin.cargo;
  const t = createTranslator({ locale: 'ru', messages: ru, namespace: 'admin.cargo' });

  it('у каждого значения перечислений есть текст', () => {
    const missing = (values: readonly string[], dict: Record<string, unknown>) =>
      values.filter((v) => !(v in dict));
    expect(missing(ADMIN_CARGO_ISSUES, c.issues)).toEqual([]);
    expect(missing(ADMIN_CARGO_ISSUES, c.issuesShort)).toEqual([]);
    expect(missing(CARGO_ROUND_STATUSES, c.statuses)).toEqual([]);
    expect(missing(CARGO_LAND_REASONS, c.landReasons)).toEqual([]);
    expect(missing(CARGO_IMAGE_KINDS, c.images)).toEqual([]);
    expect(missing([...CARGO_FIELD_ERROR_KEYS, ...CARGO_CONFLICT_KEYS, 'form'], c.errors)).toEqual(
      [],
    );
    expect(ru.admin.nav.cargo).toBe('Грузы');
    expect(
      missing(['cases', 'upgrade', 'contract', 'battles', 'cargo'], ru.admin.dashboard.modeNames),
    ).toEqual([]);
  });

  it('отмена раунда: падежи после числа участников', () => {
    expect(t('cancelText', { participants: 1, gems: '160 гемов' })).toBe(
      '1 участнику вернётся 160 гемов. Отмена попадёт в аудит.',
    );
    expect(t('cancelText', { participants: 2, gems: '600 гемов' })).toBe(
      '2 участникам вернётся 600 гемов. Отмена попадёт в аудит.',
    );
    expect(t('cancelText', { participants: 21, gems: '3 360 гемов' })).toBe(
      '21 участнику вернётся 3 360 гемов. Отмена попадёт в аудит.',
    );
    expect(t('cancelTextFree', { participants: 5 })).toBe(
      'Груз бесплатный — гемы не списывались. Места 5 участников аннулируются. Отмена попадёт в аудит.',
    );
    expect(t('cancelTextFree', { participants: 1 })).toBe(
      'Груз бесплатный — гемы не списывались. Места 1 участника аннулируются. Отмена попадёт в аудит.',
    );
  });

  it('бесплатный груз: без «гемы вернутся/вернули/вернуть» (W3); GGR — и про бесплатные грузы', () => {
    for (const text of [
      t('minSeatsHintFree'),
      t('cancelConfirmNoRefund'),
      t('cancelledNoRefund'),
      t('landReasonMinSeatsFree'),
    ]) {
      expect(text).not.toMatch(/гем/);
    }
    expect(t('cancelGone', { number: 4 })).toBe('Раунд №4 уже завершён — отменять нечего.');
    expect(ru.admin.dashboard.ggrHint).toContain('бесплатных грузов');
    expect(ru.admin.dashboard.ggrHint).toContain('бесплатных кейсов');
    expect(t('conflict', { fields: 'Цена места, гемы' })).toContain('Цена места, гемы');
    expect(t('slugFixedHint', { game: 'cs2', slug: 'light' })).toBe(
      'На сайте: /cs2/cargo/light. Адрес после создания не меняется',
    );
  });

  it('подстановки: диапазон, места, адрес на сайте', () => {
    expect(t('errors.range', { min: '2', max: '10 000' })).toBe('Целое число от 2 до 10 000');
    expect(t('voidSeat', { seat: 17 })).toBe('№17 выиграло бы');
    expect(t('slugHint', { game: 'cs2', slug: 'light' })).toBe('На сайте: /cs2/cargo/light');
    expect(t('images.custom', { path: '/media/x.webp' })).toBe('Свой путь: /media/x.webp');
  });
});
