/**
 * CSS-заглушка сугроба (.promo-strip::before) из тех же данных, что рисует холст (snow-drift.ts):
 * блок между маркерами <drift-placeholder> в app/globals.css генерируется здесь. snow-drift-css.test.ts
 * сверяет его с данными; `UPDATE_DRIFT_CSS=1 pnpm --filter @gunraid/web test snow-drift-css` переписывает.
 *
 * Фон — слои SVG (первый — сверху): L от левого края, C от середины, R от правого края (на узкой полосе
 * отъезжает вправо), щели с холмами на широкой полосе (гнёзда — вложенные <svg> с x/width в % щели и
 * preserveAspectRatio xMidYMax: вписаны с масштабом не больше 1, по центру, низом на низ — как gapMax на
 * холсте), подложка. Цвет по глубине — копии силуэта, сдвинутые вниз, с голубовато-серым (на глубине d
 * закрашено столько копий, сколько сдвигов не больше d). Телефон (по умолчанию, окно < 48rem) — эталон
 * целиком, как холст с профилем DRIFT_PHONE: края картинки у краёв полосы, части на своих местах, всё
 * поднято на DRIFT_PHONE.lift, копий по глубине — до предела затенения холста (DEPTH_PHONE), подложка до
 * подъёма темнеет к низу, как холст; широкая полоса — в @media.
 *
 * Тихие зоны — clip-path по той же модели потолка, что у холста (DRIFT_CAP: ровно над элементом,
 * подъём 0,55 в стороны), для раскладок текста и кнопки из DRIFT_TEXT_LAYOUTS: где текст переносится,
 * заглушка опускается так же, как холст, и смена заглушки на холст не выглядит «провалом». На телефоне при
 * плотности пикселей ниже HALO.maxPx холст держит запас больше (ореол) — для неё своя обрезка в @media.
 */
import {
  DEPTH_PHONE,
  DRIFT_C,
  DRIFT_CAP,
  DRIFT_EDGE_L,
  DRIFT_EDGE_R,
  DRIFT_GAP_LEFT,
  DRIFT_GAP_RIGHT,
  DRIFT_L,
  DRIFT_LAYOUT,
  DRIFT_PHONE,
  DRIFT_R,
  HALO,
  SNOW_DRIFT_DEFAULTS,
  driftSilhouette,
} from './snow-drift';

/** x = a·W + b, где W — ширина полосы, css px. */
type Lin = readonly [number, number];

/** Прямоугольник, к низу которого сугроб не подходит (как меряет PromoDrift): края и низ от верха полосы. */
export interface DriftLayoutRect {
  left: Lin;
  right: Lin;
  bottom: number;
}

/** Раскладка текста и кнопки полосы: широкая (md, окно от 768 px) или телефон; ширина полосы [min, max]. */
export interface DriftTextLayout {
  md: boolean;
  min: number;
  max: number;
  rects: readonly DriftLayoutRect[];
}

/**
 * Раскладки промо-полосы с текстом «+20% к депозиту / по промокоду» и кнопкой RAID2027 (шрифт TT Firs
 * Neue), снятые с живой страницы по ширинам окна 260–1300 px: строки текста (низ — по межстрочному,
 * нижняя — во всю ширину блока), видимая кнопка; верхние строки, до которых сугроб не достаёт, опущены.
 * Все края — линейные функции ширины полосы (текст и кнопка стоят по центру или прижаты к полям). Если
 * текст промо, шрифт или вёрстка полосы изменятся — перемерить и обновить (холст тихие зоны меряет сам,
 * это нужно только заглушке до JS).
 */
export const DRIFT_TEXT_LAYOUTS: readonly DriftTextLayout[] = [
  // телефон, 4 строки (окно 260–274: Galaxy Fold и уже)
  {
    md: false,
    min: 236,
    max: 250,
    rects: [
      { left: [0.5, -72.14], right: [0.5, -54.19], bottom: 43.8 },
      { left: [0, 12], right: [1, -138.33], bottom: 52.2 },
      { left: [1, -114.33], right: [1, -12], bottom: 42 },
    ],
  },
  // телефон, 3 строки (окно 275–288)
  {
    md: false,
    min: 251,
    max: 264,
    rects: [
      { left: [0.5, -95.81], right: [0.5, -30.53], bottom: 37.8 },
      { left: [0, 12], right: [1, -138.33], bottom: 46.2 },
      { left: [1, -114.33], right: [1, -12], bottom: 42 },
    ],
  },
  // телефон, 2 строки (окно 289–767)
  {
    md: false,
    min: 265,
    max: 743,
    rects: [
      { left: [0.5, -120.05], right: [0.5, -6.28], bottom: 40.2 },
      { left: [0.5, 17.72], right: [0.5, 120.05], bottom: 42 },
    ],
  },
  // широкая, 3 строки (окно 768–792)
  {
    md: true,
    min: 720,
    max: 744,
    rects: [
      { left: [0.5, -287.42], right: [0.5, -91.58], bottom: 86.89 },
      { left: [0, 12], right: [1, -391], bottom: 112.09 },
      { left: [1, -319], right: [1, -12], bottom: 100.09 },
    ],
  },
  // широкая, 2 строки (окно от 793)
  {
    md: true,
    min: 745,
    max: Infinity,
    rects: [
      { left: [0.5, -360.14], right: [0.5, -18.86], bottom: 94.09 },
      { left: [0.5, 53.14], right: [0.5, 360.14], bottom: 100.09 },
    ],
  },
];

/**
 * Высота полосы и масштаб узора (как --snow-k в globals.css): широкая — 127 px (k = 1), телефон — 60 px
 * (k = 0,1795: эталон целиком на 336, профиль DRIFT_PHONE).
 */
export const STRIP = { md: { h: 127, k: 1 }, phone: { h: 60, k: DRIFT_PHONE.k } } as const;
/** Подложка заглушки, px узора (нижний слой фона; на телефоне — над подъёмом). */
const BAND_PX = 3.5;
/** Подъём силуэта, px узора: на телефоне сугроб стоит на сплошном слое снега. */
const liftOf = (md: boolean) => (md ? 0 : DRIFT_PHONE.lift);
/**
 * Допуск упрощения обрезки, css px: вершина убирается, если видимый (обрезанный) силуэт заглушки от этого
 * меняется не больше чем на TOL на всех ширинах раскладки.
 */
const TOL = 0.75;

// ---------------------------------------------------------------- фон (слои SVG)

const H = DRIFT_LAYOUT.height;
const BASE = '#eef3f9';
const DEEP = '#7d96be';
const DEEP_A = '.1';
/**
 * Подложка телефона (сплошной слой под поднятыми частями): цвет по высоте v (px узора над низом полосы, сверху
 * вниз) — средний цвет холста по ширине (замер при DPR 3 на окнах 320–767): к низу полосы снег темнеет и синеет
 * (DEPTH_PHONE в snow-drift.ts; макет 36.png у низа — rgb 172 189 212).
 */
const BAND_DEEP: readonly (readonly [number, string])[] = [
  [BAND_PX + DRIFT_PHONE.lift, '#e6ecf5'],
  [42, '#e0e7f1'],
  [27, '#dae2ee'],
  [17, '#ccd6e7'],
  [8, '#bac7dd'],
  [0, '#aabad5'],
];
/** Сдвиги копий для цвета по глубине: на глубине 9/15/22/30 px непрозрачность 0,1/0,19/0,27/0,34 — как у холста. */
const SHIFTS = [9, 15, 22, 30];
/** Телефон: копии в пределах затенения глубины холста (DEPTH_PHONE.depth — 0,19: глубже тело там не темнеет). */
const PHONE_SHIFTS = SHIFTS.filter(
  (_, i) => 1 - (1 - Number(DEEP_A)) ** (i + 1) <= DEPTH_PHONE.depth + 1e-9,
);

const num = (v: number) => {
  let s = (Math.round(v * 100) / 100).toString();
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s === '-0' ? '0' : s;
};
/** Числа подряд: минус сам разделяет. */
const seq = (vals: readonly number[]) =>
  vals.map((v, i) => (i && !num(v).startsWith('-') ? ' ' : '') + num(v)).join('');

function partPath(nodes: readonly number[]) {
  const rel: number[] = [];
  for (let i = 2; i < nodes.length; i += 2)
    rel.push(nodes[i]! - nodes[i - 2]!, -(nodes[i + 1]! - nodes[i - 1]!));
  return `M${num(nodes[0]!)} ${H}V${num(H - nodes[1]!)}l${seq(rel)}V${H}z`;
}

const bumpPath = (c: number, h: number, wl: number, wr: number) =>
  `M${num(c - wl)} ${H}c${seq([wl / 3, 0, (2 * wl) / 3, -h, wl, -h])}c${seq([wr / 3, 0, (2 * wr) / 3, h, wr, h])}z`;

/** Основная заливка — у корня (fill), копии ссылаются на силуэт без своей заливки и берут её у группы. */
const shade = (inner: string, shifts: readonly number[]) =>
  `<g id='a'>${inner}</g><g fill='${DEEP}' fill-opacity='${DEEP_A}'>` +
  shifts.map((y) => `<use href='#a' y='${y}'/>`).join('') +
  '</g>';

const svg = (attrs: string, body: string) =>
  `<svg xmlns='http://www.w3.org/2000/svg' fill='${BASE}'${attrs}>${body}</svg>`;
const enc = (s: string) =>
  s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3c').replace(/>/g, '%3e');
const url = (s: string) => `url("data:image/svg+xml,${enc(s)}")`;

/** Окно части: от первого до последнего узла (с концевыми спусками x может быть меньше нуля). */
const span = (nodes: readonly number[]) => [nodes[0]!, nodes[nodes.length - 2]!] as const;
const part = (nodes: readonly number[], shifts = SHIFTS) => {
  const [a, b] = span(nodes);
  return url(
    svg(
      ` viewBox='${num(a)} 0 ${num(b - a)} ${H}'`,
      shade(`<path d='${partPath(nodes)}'/>`, shifts),
    ),
  );
};

const gap = (slots: readonly (readonly number[])[], shifts = SHIFTS) => {
  let inner = '';
  for (const s of slots) {
    const [lo, hi, w] = s as [number, number, number];
    let d = '';
    for (let b = 3; b + 3 < s.length; b += 4) d += bumpPath(s[b]!, s[b + 1]!, s[b + 2]!, s[b + 3]!);
    const x = lo ? ` x='${num(lo * 100)}%'` : '';
    const wd = hi - lo !== 1 ? ` width='${num((hi - lo) * 100)}%'` : '';
    inner += `<svg${x}${wd} viewBox='0 0 ${num(w)} ${H}' preserveAspectRatio='xMidYMax'><path d='${d}'/></svg>`;
  }
  return url(svg('', shade(inner, shifts)));
};

function background(phone: boolean): string[] {
  const k = 'var(--snow-k)';
  const px = (v: number) => `calc(${num(v)}px * ${k})`;
  const tall = `${px(H)} no-repeat`;
  const [la, lb] = span(DRIFT_L);
  const [ca, cb] = span(DRIFT_C);
  const [ra, rb] = span(DRIFT_R);
  if (la !== 0) throw new Error('DRIFT_L must start at the strip edge');
  // calc(50% + c) ставит середину картинки шириной w в середину полосы + c
  const cOff = DRIFT_LAYOUT.centre + ca + (cb - ca) / 2;
  if (phone) {
    // эталон целиком (как driftSilhouette(…, phone)): края картинки у краёв полосы, L с edge, R до W − edge,
    // щели — между частями и краями; все слои подняты на lift, ниже — подложка до lift + BAND_PX
    const e = DRIFT_PHONE.edge;
    const S = PHONE_SHIFTS;
    const band = BAND_PX + DRIFT_PHONE.lift;
    const up = `bottom ${px(DRIFT_PHONE.lift)}`;
    const [ea, eb] = span(DRIFT_EDGE_L);
    const [fa, fb] = span(DRIFT_EDGE_R);
    if (ea !== 0 || eb !== e || fa !== 0 || fb !== e)
      throw new Error('DRIFT_EDGE_L/R must span exactly DRIFT_PHONE.edge');
    if (BAND_DEEP[0]![0] !== band || BAND_DEEP[BAND_DEEP.length - 1]![0] !== 0)
      throw new Error('BAND_DEEP must span the underlay from its top to the strip bottom');
    // цвет подложки по высоте; последний — у низа полосы (слой на 1px ниже неё, см. ниже)
    const stops = BAND_DEEP.map(([v, c], i) =>
      !i ? c : i === BAND_DEEP.length - 1 ? `${c} calc(100% - 1px)` : `${c} ${px(band - v)}`,
    );
    const gapW = `max(0px, 50% - ${num(DRIFT_LAYOUT.ref / 2 + e)}px * ${k})`;
    return [
      `${part(DRIFT_EDGE_L, S)} left ${up} / ${px(e)} ${tall}`,
      `${part(DRIFT_L, S)} left ${px(e)} ${up} / ${px(lb - la)} ${tall}`,
      `${part(DRIFT_C, S)} left calc(50% + ${num(cOff)}px * ${k}) ${up} / ${px(cb - ca)} ${tall}`,
      // правый край окна R ([ra, rb], rb — последний узел) — у W − edge
      `${part(DRIFT_R, S)} right ${px(e)} ${up} / ${px(rb - ra)} ${tall}`,
      `${part(DRIFT_EDGE_R, S)} right ${up} / ${px(e)} ${tall}`,
      `${gap(DRIFT_GAP_LEFT, S)} left ${px(DRIFT_LAYOUT.left + e)} ${up} / ${gapW} ${tall}`,
      `${gap(DRIFT_GAP_RIGHT, S)} right ${px(DRIFT_LAYOUT.right + e)} ${up} / ${gapW} ${tall}`,
      // подложка — на 1px ниже полосы: верх слоя с дробной высотой Chromium округляет, и без запаса нижние
      // ~0,2 css полосы оставались без снега (просвечивал город)
      `linear-gradient(${stops.join(', ')}) left 0 bottom -1px / 100% calc(${num(band)}px * ${k} + 1px) no-repeat`,
    ];
  }
  // R: правый край окна — у правого края полосы, на узкой полосе отъезд (slide − W) / 2; в background-position
  // 100% = W − ширина картинки, поэтому W = 100% + (rb − ra)·k
  const slideBase = DRIFT_LAYOUT.slide - (rb - ra);
  const gapW = `max(0px, 50% - ${num(DRIFT_LAYOUT.ref / 2)}px * ${k})`;
  return [
    `${part(DRIFT_L)} left bottom / ${px(lb - la)} ${tall}`,
    `${part(DRIFT_C)} calc(50% + ${num(cOff)}px * ${k}) bottom / ${px(cb - ca)} ${tall}`,
    `${part(DRIFT_R)} calc(100% + max(0px, (${num(slideBase)}px * ${k} - 100%) / 2)) bottom / ${px(rb - ra)} ${tall}`,
    `${gap(DRIFT_GAP_LEFT)} left ${px(DRIFT_LAYOUT.left)} bottom / ${gapW} ${tall}`,
    `${gap(DRIFT_GAP_RIGHT)} right ${px(DRIFT_LAYOUT.right)} bottom / ${gapW} ${tall}`,
    `linear-gradient(${BASE}, ${BASE}) bottom / 100% ${px(BAND_PX)} no-repeat`,
  ];
}

// ---------------------------------------------------------------- тихие зоны (clip-path)

/** Потолок от элемента: ровно на высоте h (css px над низом) над [a, b], подъём DRIFT_CAP.slope в стороны. */
interface Vee {
  a: number;
  b: number;
  h: number;
}

const at = (l: Lin, W: number) => l[0] * W + l[1];

function vees(layout: DriftTextLayout, W: number, only?: readonly number[], halo = false): Vee[] {
  const { h: Hs } = layout.md ? STRIP.md : STRIP.phone;
  const clearance = layout.md
    ? SNOW_DRIFT_DEFAULTS.clearance
    : SNOW_DRIFT_DEFAULTS.clearanceCompact;
  // телефон — как холст: без ореола (DPR от 1,5) запас spreadCompact, с ореолом — spreadCompactHalo
  const spread = layout.md
    ? DRIFT_CAP.spread
    : halo
      ? DRIFT_CAP.spreadCompactHalo
      : DRIFT_CAP.spreadCompact;
  return layout.rects
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => !only || only.includes(i))
    .map(({ r }) => ({
      a: at(r.left, W) - DRIFT_CAP.pad,
      b: at(r.right, W) + DRIFT_CAP.pad,
      h: Hs - r.bottom - clearance - spread,
    }));
}

const veeAt = (v: Vee, x: number) => v.h + DRIFT_CAP.slope * Math.max(0, v.a - x, x - v.b);
const envAt = (vs: readonly Vee[], x: number) => Math.min(...vs.map((v) => veeAt(v, x)));

/**
 * Силуэт заглушки (css px над низом) по столбцам x = 0…W полосы шириной W при масштабе k; md — широкая
 * полоса (без подъёма), иначе телефон (профиль DRIFT_PHONE с подъёмом).
 */
function silhouette(W: number, k: number, md: boolean): Float32Array {
  const Wp = W / k;
  const lift = liftOf(md);
  const pat = new Float32Array(Math.ceil(Wp) + 2);
  driftSilhouette(pat, 0, Wp, !md);
  const out = new Float32Array(Math.floor(W) + 1);
  for (let x = 0; x < out.length; x++) {
    const u = x / k;
    const i = Math.min(pat.length - 2, Math.floor(u));
    out[x] = k * (pat[i]! + (pat[i + 1]! - pat[i]!) * (u - i) + lift);
  }
  return out;
}

/** Ширины полосы, на которых проверяется раскладка (до 3840 для открытой справа). */
function widths(layout: DriftTextLayout): number[] {
  const hi = Math.min(layout.max, 3840);
  const lo = Math.max(layout.min, 200);
  const out: number[] = [];
  const step = hi - lo > 600 ? 8 : 1;
  for (let W = lo; W <= hi; W += step) out.push(W);
  if (out[out.length - 1] !== hi) out.push(hi);
  return out;
}

/** Номера прямоугольников раскладки, потолок которых опускает сугроб хоть где-то (силуэт выше потолка − 0,3). */
function binding(layout: DriftTextLayout, halo: boolean): number[] {
  const { k } = layout.md ? STRIP.md : STRIP.phone;
  const hit = new Set<number>();
  for (const W of widths(layout)) {
    const sil = silhouette(W, k, layout.md);
    layout.rects.forEach((_, i) => {
      if (hit.has(i)) return;
      const [v] = vees(layout, W, [i], halo);
      for (let x = 0; x < sil.length; x++) {
        if (sil[x]! > veeAt(v!, x) - 0.3) {
          hit.add(i);
          return;
        }
      }
    });
  }
  return [...hit].sort((a, b) => a - b);
}

/** Вершины нижней огибающей потолков (x, h) слева направо, без лишних (на одной прямой). */
function envelope(vs: readonly Vee[]): [number, number][] {
  const s = DRIFT_CAP.slope;
  const xs = new Set<number>();
  for (const v of vs) {
    xs.add(v.a);
    xs.add(v.b);
    for (const u of vs) {
      if (u === v) continue;
      xs.add((u.h - v.h + s * (u.a + v.b)) / (2 * s)); // правый склон v и левый склон u
      xs.add(u.a - (v.h - u.h) / s); // ровный v и левый склон u
      xs.add(u.b + (v.h - u.h) / s); // ровный v и правый склон u
    }
  }
  const lo = Math.min(...vs.map((v) => v.a)) - 1000;
  const hi = Math.max(...vs.map((v) => v.b)) + 1000;
  const pts = [lo, ...[...xs].filter((x) => x > lo && x < hi).sort((a, b) => a - b), hi].map(
    (x) => [x, envAt(vs, x)] as [number, number],
  );
  const out: [number, number][] = [];
  for (const p of pts) {
    if (out.length && Math.abs(p[0] - out[out.length - 1]![0]) < 1e-6) continue;
    while (out.length >= 2) {
      const [q, r] = [out[out.length - 2]!, out[out.length - 1]!];
      const cross = (r[0] - q[0]) * (p[1] - q[1]) - (r[1] - q[1]) * (p[0] - q[0]);
      if (Math.abs(cross) > 1e-6 * Math.max(1, Math.abs(p[0] - q[0]))) break;
      out.pop();
    }
    out.push(p);
  }
  // крайние точки — там, где склоны выходят на верх полосы (дальше потолок не важен)
  return out;
}

/** Точки многоугольника обрезки при ширине W: [x, y от верха полосы] (крайние — на верхнем крае). */
function clipPoints(
  layout: DriftTextLayout,
  W: number,
  only: readonly number[],
  halo: boolean,
): [number, number][] {
  const { h: Hs } = layout.md ? STRIP.md : STRIP.phone;
  const env = envelope(vees(layout, W, only, halo));
  const s = DRIFT_CAP.slope;
  const first = env[1]!;
  const last = env[env.length - 2]!;
  const inner = env.slice(1, -1);
  return [
    [first[0] - (Hs - first[1]) / s, 0],
    ...inner.map(([x, h]) => [x, Hs - h] as [number, number]),
    [last[0] + (Hs - last[1]) / s, 0],
  ];
}

const coord = (a: number, b: number) => {
  const bb = Math.round(b);
  if (a === 0) return bb ? `${bb}px` : '0';
  const pct = `${a * 100}%`;
  return bb ? `calc(${pct} ${bb < 0 ? '-' : '+'} ${Math.abs(bb)}px)` : pct;
};

export interface DriftClip {
  layout: DriftTextLayout;
  /** Обрезка для холста с ореолом (телефон, DPR ниже HALO.maxPx): правило — в @media (resolution < …). */
  halo: boolean;
  /** Прямоугольники раскладки, потолок которых опускает сугроб. */
  rects: number[];
  /** null — после упрощения все вершины на верхнем крае: обрезка ничего не срезает, правила нет. */
  polygon: string | null;
  /** Наибольшее отличие обрезанного силуэта заглушки от обрезанного потолком холста (css px) по ширинам раскладки. */
  maxErr: number;
}

/** Обрезка заглушки для каждой раскладки (на телефоне — и для холста с ореолом), где потолок что-то опускает. */
export function driftClips(): DriftClip[] {
  const out: DriftClip[] = [];
  for (const layout of DRIFT_TEXT_LAYOUTS)
    for (const halo of layout.md ? [false] : [false, true]) {
      const clip = clipOf(layout, halo);
      if (clip) out.push(clip);
    }
  return out;
}

/** Обрезка раскладки (halo — для холста с ореолом); null — потолок ничего не опускает. */
function clipOf(layout: DriftTextLayout, halo: boolean): DriftClip | null {
  const only = binding(layout, halo);
  if (!only.length) return null;
  const ws = widths(layout);
  const W1 = ws[0]!;
  const W2 = ws[ws.length - 1]! > W1 ? ws[ws.length - 1]! : W1 + 1;
  const p1 = clipPoints(layout, W1, only, halo);
  const p2 = clipPoints(layout, W2, only, halo);
  if (p1.length !== p2.length)
    throw new Error(`clip topology changes within layout ${layout.min}..${layout.max}`);
  let lin = p1.map((p, i) => {
    const q = p2[i]!;
    const a = Math.round(((q[0] - p[0]) / (W2 - W1)) * 2) / 2;
    if (Math.abs(q[1] - p[1]) > 0.01) throw new Error('clip vertex height depends on width');
    return { a, b: Math.round((p[0] - a * W1 + (q[0] - a * W2)) / 2), y: Math.round(p[1]) };
  });
  // лишние вершины долой: обрезанный силуэт (то, что видно) не должен измениться больше чем на TOL
  const { h: Hs, k } = layout.md ? STRIP.md : STRIP.phone;
  const sils = ws.map((W) => silhouette(W, k, layout.md));
  // видимый силуэт заглушки не ниже подложки (на телефоне — подложка до подъёма)
  const band = (BAND_PX + liftOf(layout.md)) * k;
  const err = (cand: typeof lin) => {
    let e = 0;
    ws.forEach((W, wi) => {
      const vs = vees(layout, W, only, halo);
      const sil = sils[wi]!;
      const pts = cand.map((v) => [v.a * W + v.b, v.y] as const);
      let j = 0;
      for (let x = 0; x <= W; x++) {
        while (j < pts.length && pts[j]![0] <= x) j++;
        if (j === 0 || j === pts.length) continue;
        const [x0, y0] = pts[j - 1]!;
        const [x1, y1] = pts[j]!;
        const clip = Hs - (y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
        const sv = Math.max(sil[x]!, band);
        e = Math.max(e, Math.abs(Math.min(sv, clip) - Math.min(sv, envAt(vs, x))));
      }
    });
    return e;
  };
  for (let i = 1; i < lin.length - 1;) {
    const cand = [...lin.slice(0, i), ...lin.slice(i + 1)];
    if (err(cand) <= TOL) lin = cand;
    else i++;
  }
  const maxErr = err(lin);
  const verts = lin.map((v) => `${coord(v.a, v.b)} ${v.y ? `${v.y}px` : '0'}`);
  const polygon = lin.some((v) => v.y > 0)
    ? `polygon(0 100%, 0 0, ${verts.join(', ')}, 100% 0, 100% 100%)`
    : null;
  return { layout, halo, rects: only, polygon, maxErr };
}

/** Поля полосы по горизонтали (px-3 с двух сторон): @container меряет ширину без них, как и перенос текста. */
const PADDING = 24;

/**
 * Условие @container по ширине содержимого полосы (полоса − PADDING): от min раскладки (самая узкая
 * в группе — без нижней границы, на случай полос уже замеренных, например с полосой прокрутки) до min
 * следующей (самая широкая — без верхней границы).
 */
function query(l: DriftTextLayout): string {
  const group = DRIFT_TEXT_LAYOUTS.filter((x) => x.md === l.md);
  const i = group.indexOf(l);
  const lo = i > 0 ? l.min - PADDING : 0;
  const hi = i < group.length - 1 ? group[i + 1]!.min - PADDING : Infinity;
  if (!lo && hi === Infinity) return '';
  if (!lo) return `(width < ${hi}px)`;
  if (hi === Infinity) return `(width >= ${lo}px)`;
  return `(${lo}px <= width < ${hi}px)`;
}

/**
 * Блок CSS между маркерами <drift-placeholder> (без маркеров): фон заглушки и её обрезка по тихим
 * зонам; indent — отступ правил (в globals.css они внутри @layer components).
 */
export function driftPlaceholderCss(indent = ''): string {
  const i1 = indent;
  const lines: string[] = [];
  // сначала телефон (без @media), потом широкая полоса внутри @media (порог 48rem — как md: у высоты
  // полосы и --snow-k): на широкой полосе её правила идут позже и перекрывают телефонные
  const clips = driftClips();
  for (const md of [false, true]) {
    // отступы правил: j1 — уровень правила (внутри @media — на шаг глубже), j2/j3 — вложенные
    const j1 = indent + (md ? '  ' : '');
    const j2 = j1 + '  ';
    const j3 = j1 + '    ';
    if (md) lines.push(`${i1}@media (width >= 48rem) {`);
    lines.push(`${j1}.promo-strip::before {`, `${j2}background:`);
    background(!md).forEach((layer, i, all) =>
      lines.push(`${j3}${layer}${i < all.length - 1 ? ',' : ';'}`),
    );
    lines.push(`${j1}}`);
    const rule = (c: DriftClip, j1: string) => {
      const [j2, j3] = [j1 + '  ', j1 + '    '];
      const q = query(c.layout);
      if (q)
        lines.push(
          `${j1}@container ${q} {`,
          `${j2}.promo-strip::before {`,
          `${j3}clip-path: ${c.polygon};`,
          `${j2}}`,
          `${j1}}`,
        );
      else lines.push(`${j1}.promo-strip::before {`, `${j2}clip-path: ${c.polygon};`, `${j1}}`);
    };
    for (const c of clips.filter((x) => x.layout.md === md && !x.halo && x.polygon)) rule(c, j1);
    // телефон с ореолом (DPR ниже HALO.maxPx): холст держит запас больше — своя обрезка поверх
    const low = clips.filter((x) => x.layout.md === md && x.halo && x.polygon);
    if (low.length) {
      lines.push(`${j1}@media (width < 48rem) and (resolution < ${HALO.maxPx}dppx) {`);
      for (const c of low) rule(c, j2);
      lines.push(`${j1}}`);
    }
    if (md) lines.push(`${i1}}`);
  }
  return lines.join('\n');
}
